# Conventions extractor

**Status:** agreed
**Packages touched:** server, client (`@devdigest/shared` contract change)

## Problem

DevDigest's reviewer agents only know the rules a human typed into a Skill.
Every repo already encodes house rules in its code — error-handling shape,
naming, module structure — and today a maintainer has to write those out by
hand before an agent can enforce them.

This feature scans a cloned repo, proposes conventions with **verifiable
evidence**, lets a maintainer accept/reject/edit each one, and merges the
accepted set into a single `<repo>-conventions` Skill that can be linked to an
agent. The design constraint that shapes everything: an LLM-proposed rule is
worthless if its citation is invented, so every candidate is mechanically
grounded against the exact bytes that were put in the prompt — ungrounded
candidates are dropped, never shown.

Half of this feature is already scaffolded and unused: the `conventions`
table, a `ConventionCandidate` Zod contract, `repoIntel.getConventionSamples()`,
a `'conventions'` entry in the feature-model registry, the nav item, a
placeholder page, and a fully-written `messages/en/conventions.json` all exist.
This spec finishes work that was scaffolded and never wired.

## Routes

All routes live in the new `conventions` module
(`server/src/modules/conventions/infrastructure/http/routes.ts`), registered
in `server/src/modules/index.ts`.

| Method | Path | Response | Codes |
| --- | --- | --- | --- |
| POST | `/repos/:id/conventions/extract` | `ExtractConventionsAccepted` | 202 · 404 · **409** active run (returns the winner's `run_id`) |
| GET | `/repos/:id/conventions` | `ConventionsView` | 200 (`run:null` pre-first-scan) · 404 |
| PATCH | `/conventions/:id` | `ConventionCandidate` | 200 · 404 · 422 |
| POST | `/conventions/runs/:id/decisions` | `{ updated }` | 200 · 404 |
| GET | `/conventions/runs/:id/skill-draft` | `ConventionSkillDraft` | 200 · 404 · 409 zero accepted |
| POST | `/conventions/runs/:id/skill` | `Skill` | 201 · 404 · 409 |

Everything after the extract POST is **run-scoped, not repo-scoped** —
operating on "the latest run" would race a re-scan landing between a GET and a
mutation. Execution is a background job on the existing `JobRunner`: the POST
returns 202 immediately and the client polls `GET /repos/:id/conventions`
until `run.status` is terminal.

## Schema changes

`server/src/db/schema/knowledge.ts`, migration via `pnpm db:generate` /
`pnpm db:migrate` (never hand-written).

**New table `convention_runs`** — holds what nothing else can: `sample_count`
+ `finished_at` for the *"Detected from N sample files · last scan 1h ago"*
subtitle, "one active extraction per repo", and groups a re-scan's candidate
set.

```
id uuid PK · workspaceId → workspaces (cascade) · repoId → repos (cascade)
status text enum ['queued','running','done','failed'] not null default 'queued'
sampleCount / candidateCount / droppedCount  integer not null default 0
provider · model · tokensIn · tokensOut · costUsd     -- off StructuredResult, no pricing lookup
skillId uuid → skills (set null) · error text
createdAt now() · finishedAt timestamptz
index convention_runs_repo_idx (repo_id, created_at desc)
uniqueIndex convention_runs_active_uniq (repo_id) WHERE status in ('queued','running')
```

**Extend `conventions`** (never written to today, so `NOT NULL` adds are
zero-risk): add `runId → convention_runs (cascade)`, `category text enum NOT
NULL`, `evidenceStartLine` / `evidenceEndLine` integer, `createdAt now()`;
make `repoId` `NOT NULL`; index on `run_id`.

`accepted` stays a boolean — no tri-state. It is set `true` at insert time in
the extractor (not via a column default), so "start unselected" stays a
one-line change later.

**Category enum** (shared by DB, contract, model schema): `naming | structure
| error_handling | testing | typing | imports | logging | api_design |
other`.

## Adapters needed

Four ports in `domain-services/ports.ts`, all implemented under
`infrastructure/external/`:

- `RepoFileReader.read(path) → string|null` — `CloneFileReader`, backed by
  `container.git.readFile(repoRef, path)`. Normalizes both failure shapes
  (`MockGitClient` returns `''`, `SimpleGitClient` throws `ENOENT`) to `null`,
  and rejects any path containing `..`.
- `SamplePicker.rankedPaths(repoId, n)` — `RankSamplePicker`, a 4-line adapter
  over `repoIntel.getConventionSamples(repoId, n)` (no need to depend on the
  full ~20-method `RepoIntel` port).
- `ConventionModel.extract(prompt) → ConventionExtractionOutput` —
  `LlmExtractor`, one `completeStructured` call via `container.llm(provider)`.
- `SkillWriter.create(input) → Skill` — thin wrapper over
  `container.skillsRepo`, used so the application service can compose the
  skill insert inside its own transaction.

No new external SDK. No `node:fs` in the service layer.

## Data

**Sample selection is code-only — no model call.** `CONFIG_CANDIDATES`
(`package.json`, `tsconfig.json`, `.eslintrc.json`, `.prettierrc`,
`.editorconfig` families) are probed directly, since `repoIntel`'s
`file_rank` walk only indexes `.ts/.tsx/.js/.jsx/.mjs/.cjs` and filters out
config-like paths — configs can never appear in the ranked list. First hit
per family only, max 5. `package.json` is trimmed to `name, type,
packageManager, engines, scripts, dependencies, devDependencies`.

Source files come from `repoIntel.getConventionSamples(repoId, 12)` —
already rank-ordered and junk-filtered, paths only.

`packSamples()` (pure) budgets `MAX_SOURCE_FILE_BYTES 8_000` ·
`MAX_CONFIG_FILE_BYTES 4_000` · `MAX_TOTAL_BYTES 96_000` (~24k tokens).
Configs first, then sources in rank order; each file truncated from the head
with a `… [truncated]` marker; stop at the total cap. `run.sample_count` is
the count that actually reached the prompt (realistically ~17, not the 84 in
early mockups).

`renderSampleBlock()` emits 1-based line-number gutters (`   1│ …`) so the
model's `evidence.line` citation is checkable, wrapped in
`<untrusted>…</untrusted>` since repo contents are attacker-influenceable.

**The single LLM call** (`infrastructure/external/llm-extractor.ts`):
module-local Zod `ConventionExtractionOutput = { conventions: [{ category,
rule, evidence: { file, line, snippet }, confidence }] }`, `schemaName:
'ConventionExtraction'`, `temperature 0`, `maxTokens 2500`, `maxRetries 1`,
`timeoutMs 90_000` (under `JobRunner`'s 120s hard timeout). Model resolves via
`getFeatureModelOverride(container, wsId, 'conventions') ?? { provider:
'openrouter', model: 'deepseek/deepseek-v4-flash' }`. `tokensIn/tokensOut/
costUsd/model` copy straight off `StructuredResult` onto the run row.

**Grounding** (`domain-services/grounding.ts`, pure, never reads the clone —
consults only the in-memory `SampledFile[]`): path must be in the sampled set
(exact or unambiguous suffix match), `1 ≤ line ≤ file.lines.length`, snippet
(when ≥8 chars) must appear within `line-1 ± 3` (normalized whitespace, case
preserved), rule text deduped, evidence window rebuilt from the real file
(`[matched-2, matched+6]` clamped) — never from the model's own text. First
failure wins; dropped candidates are never persisted. A 100%-dropped run is
still `done` with 0 candidates, never `failed`.

**Skill merge** (`domain-services/merge.ts`, pure): `# <name>` H1, one intro
line naming `owner/repo`, one `## <slug>` per accepted candidate with the
sanitized rule and `` Detected in `path:startLine` `` — no code snippets in
the body (token cost + injection surface). Deterministic order (category enum
→ confidence desc → path asc) so the same accepted set produces a
byte-identical body. Rendering happens server-side (`GET …/skill-draft`);
editing happens client-side (`POST …/skill` persists whatever the user
edited).

## States

Run status: `queued → running → done | failed`. Client polls
`GET /repos/:id/conventions` on a self-terminating interval (1500ms while
non-terminal, off once terminal).

- **No active repo** (`/conventions` is not repo-scoped in the URL) —
  dedicated empty state.
- **Never scanned** (`run: null`) — CTA to run extraction.
- **Scanning** (`run.status` queued/running) — spinner, polling.
- **Failed** (`run.status === 'failed'`) — `run.error` surfaced inline; no
  separate error endpoint, no SSE.
- **Not indexed** — an unindexed repo (or `REPO_INTEL_ENABLED=false`) yields
  zero samples; the run still finishes `done` with `candidate_count: 0` and
  `error: 'repo is not indexed yet'` (not `failed` — nothing broke).
- **List** — cards, each with rule, evidence block (`path:start-end`), a
  confidence bar, accept/reject, inline edit.
- **Skill-creation modal** — seeded from the server-rendered draft, editable,
  `enabled` defaults **ON** (see Decisions below), live token count.

## Copy

`messages/en/conventions.json` already covers `page.crumb*`, `headingPrefix`,
`repoFallback`, `subtitle`, `scanning`, `rescan`, `runExtraction`,
`extractionFailed`, `loadError`, `empty.*`, `candidateCount`,
`card.confidence/accepted/accepting`. New keys needed: `page.subtitleDetected`
· `neverScanned` · `notIndexed` · `noRepo.*` · `toolbar.{deselectAll,
selectAll, acceptedCount, createSkill, noneAccepted, skillCreated}` ·
`card.{reject, edit, saveEdit, cancelEdit, rulePlaceholder, copyEvidence,
copied, category.*}` · `modal.{title, banner, nameLabel, descriptionLabel,
typeLabel, enabledLabel, enabledHint, bodyLabel, filenameBar, footerNote,
create, creating}`. `card.acceptAsSkill` becomes unused.

## Decisions

| Question | Decision |
| --- | --- |
| Execution | Background job on the existing `JobRunner`; POST returns 202, client polls |
| Model | Module-local default `openrouter` / `deepseek/deepseek-v4-flash`, no `FEATURE_MODELS` registry change |
| Sample selection | Code-only, no model call |
| Skill `enabled` | Defaults **ON** in the modal — a deliberate deviation from the recorded rule that non-manual sources default `enabled: false` (root `INSIGHTS.md`). Defensible here because: (1) the skill body contains only model-written rule sentences and paths, never raw repo code; (2) rules are sanitized and length-capped; (3) the modal *is* the vetting step — there is no path to a saved skill a human hasn't read. `source` stays `'extracted'`. |
| Concurrency | Two layers: a service pre-check (force-fail an active run older than 10 min, else 409) plus a DB partial unique index as the hard backstop (loser's insert → `23505` → mapped 409 with the winner's `run_id`) |
| Job retry safety | The job handler must never throw (`JobRunner` retries a failed handler up to 3×, which would be up to 3 paid model calls per failure) — it catches and calls `store.failRun()` instead, so the job resolves `done` while `convention_runs.status` says `failed` |

## Acceptance criteria

1. `POST /repos/:id/conventions/extract` returns 202 with a `run_id`; a
   second POST while that run is active returns 409 with the *same*
   `run_id`.
2. After the job completes, `GET /repos/:id/conventions` returns only
   grounded candidates — a candidate citing a never-sampled file, an
   out-of-range line, or a non-matching snippet never appears.
3. Each returned candidate's evidence (`file`, `start_line`, `end_line`,
   `snippet`) matches real bytes in the sampled file, not the model's
   verbatim citation.
4. `PATCH /conventions/:id` flips `accepted`/edits `rule`/`category`;
   `POST /conventions/runs/:id/decisions` with no `ids` flips every candidate
   in the run.
5. `GET /conventions/runs/:id/skill-draft` 409s at zero accepted candidates;
   otherwise renders a deterministic markdown body with no raw code.
6. `POST /conventions/runs/:id/skill` creates a `Skill` with
   `source: 'extracted'`, `type: 'convention'`, `enabled: true`, `version: 1`,
   populated `evidence_files`, a `skill_versions` v1 row, and
   `convention_runs.skill_id` set — all inside one transaction.
7. A repo that is unindexed (or has `REPO_INTEL_ENABLED=false`) finishes the
   run `done` with `candidate_count: 0`, not `failed`.
8. A throwing LLM call ends the run `failed` and produces **exactly one**
   `completeStructured` call — never three.
9. Killing the server mid-extraction and restarting it flips the orphaned
   `running` run to `failed` on boot (the reaper), and re-extraction works
   again immediately after.
10. The `/conventions` page renders all five states (no-repo, never-scanned,
    scanning, failed, list) and stops polling once `run.status` is terminal.
