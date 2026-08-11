# Intent layer

**Status:** agreed
**Packages touched:** server, client, reviewer-core (`@devdigest/shared` contract change)

## Problem

Every review agent today reads the same thing: a diff, a repo map, and a set of
skills. None of them knows what the PR was *for*. That has two costs.

The first is noise. A reviewer that cannot tell "this PR renames a config key"
from "this PR rewrites the auth middleware" reports everything it notices, and a
large share of what it notices is pre-existing code the author never touched.
There is no signal in the output that separates "you broke this" from "this was
already like that".

The second is repetition. The material that would answer "what is this PR for?"
— the title, the body, the linked ticket, the in-repo spec the body points at,
the shape of the changed-file list — is author-controlled prose that no agent
currently reads at all. When three agents run on one PR, each of them would have
to re-read it.

The fix is to derive the PR's **intent** exactly once per review batch with one
cheap LLM call, persist it on the already-existing (and never-written) `pr_intent`
table, feed it into every agent's prompt as **untrusted data**, and use it to
**mark** findings `in_scope` / `out_of_scope`.

`pr_intent` (`server/src/db/schema/reviews.ts:73`), the `Intent` contract
(`contracts/brief.ts:9`), `upsertIntent` / `getIntent`
(`repository/pull.repo.ts:49,64`) and `resolveFeatureModel`
(`server/src/modules/settings/feature-models.ts:51`) all exist already and have
zero callers. This spec finishes scaffolding that was built and never wired.

## Scope — in / out

**In**

- **Five source kinds**, each recorded as `{kind, ref, status}` on the persisted
  record, so the UI can say *why* an intent is thin rather than just that it is:

  | kind | ref | gathered from |
  | --- | --- | --- |
  | `pr_title` | the PR number | the pull row |
  | `pr_body` | the PR number | the pull row |
  | `linked_issue` | `owner/repo#N` | GitHub REST, via the existing `GitHubClient` port |
  | `repo_spec` | the in-repo path | the clone, read only after a path-confinement check |
  | `changed_files` | `N files` | the loaded `UnifiedDiff` file list + synthesized hunk headers |

  Two further kinds exist for bookkeeping and are not "sources" in the sense
  above: `commit_messages` (gathered **only** when the PR body is blank, capped
  at the 20 most recent) and `external_link` (see below).

  `status` is one of `used` (the material made it into the classifier input),
  `unavailable` (we tried to fetch it and could not — 404, missing file, network
  error), or `unresolved` (we deliberately did not try).

- **External non-GitHub links are never fetched in v1.** A link to a Notion page,
  a Jira ticket or an internal wiki is recorded as `{kind: 'external_link', ref:
  <url>, status: 'unresolved'}` and surfaced in the UI as missing context.
  Rationale: fetching an arbitrary author-supplied URL from the server is an SSRF
  primitive, and `server/src/adapters/` contains no arbitrary-URL client today —
  building one correctly (resolve-then-validate the **IP**, `redirect: 'manual'`
  with per-hop revalidation, a hop cap, a byte-counted size cap, a timeout) is
  its own piece of work with its own review. Recording the link as unresolved is
  strictly better than fetching it badly: the user sees exactly what the model
  did not get to read.

- **Confidence is derived, never model-emitted.** The `Intent` schema handed to
  the LLM carries no `confidence` field at all — a field that does not exist
  cannot be self-reported, and a self-reported score is exactly the thing
  `reviewer-core/INSIGHTS.md:32-40` records as unverifiable ("a citation check is
  verifiable where a self-reported confidence is not"). Confidence is a pure
  function of the `IntentSource[]` list:
  - `low` — the PR body is absent/blank **and** no linked issue reached `used`;
  - `high` — the body was `used` **and** no source is `unavailable`/`unresolved`;
  - `medium` — everything else.

- **One LLM call per review batch.** The derivation happens in the run executor
  *before* the per-agent loop, so a three-agent fan-out classifies once. The
  result is cached on `(pr_id, head_sha, sources_hash)`; a re-run against an
  unchanged head with unchanged sources makes no call at all.

- **Mark and dim — nothing is ever deleted.** Findings gain an optional
  `scope: 'in_scope' | 'out_of_scope'`. Out-of-scope findings are persisted,
  returned by the API, and rendered in the UI behind a collapsed
  `N out-of-scope [show]` toggle. No code path removes a finding from the array.
  A `CRITICAL` finding is never marked out-of-scope by the model, and is never
  collapsed by the UI even if it somehow is.

- **The intent reaches the prompt as untrusted data; the rule for using it is
  trusted.** The rendered intent block goes through `wrapUntrusted('intent', …)`
  in `reviewer-core/src/prompt.ts`; the instruction describing how to read
  `in_scope`/`out_of_scope` lives in the system message next to
  `INJECTION_GUARD`, and is written to **lose** to that guard. Scope can never
  suppress a real defect.

- **Endpoints.** `GET /pulls/:id/intent` (no LLM call, 404 when never derived)
  and `POST /pulls/:id/intent` (force re-derive, rate-limited like the review
  trigger, because it spends money).

- **UI.** An `IntentCard` on the PR detail Overview tab, above the description,
  with four states: absent, present, stale (`is_stale` — stored head differs from
  the PR's current head), and low-confidence (a badge plus a line naming the
  missing sources, built from `sources[]`).

**Out**

- **A general URL fetcher / SSRF policy.** See above.
- **`server/src/modules/pulls/status.ts` and `client/src/lib/findings.ts`.**
  Out-of-scope findings **still count** toward the PR-list severity rollup.
  This is a decision, not an omission: `status.ts:22-30` already records that
  confidence "is NOT considered … a view-level toggle on the detail panel, not a
  decision about what exists", and `scope` is exactly the same class of view
  marker. Root `INSIGHTS.md:87-107` records that the rollup rule is duplicated
  across those two files and that changing one without the other makes the same
  PR report two different numbers — so a future revisit must change **both** in
  one PR. This spec changes neither.
- **`risk_brief` as a second LLM call.** `risk_areas` is emitted by the one
  intent call. The `risk_brief` feature model stays registered and unused.
- **Renaming the `intent` field to `summary`.** The wire and column name stays
  `intent`; the UI labels it "Summary".
- **A new settings component.** `SettingsModels.tsx` already maps over
  `FEATURE_MODELS` generically and renders a `review_intent` picker.
- **Smart Diff**, the other half of the same roadmap row.

## Contract changes

`@devdigest/shared` first, then consumers. **Both mirrors must be edited**:
`server/src/vendor/shared/` and `client/src/vendor/shared/`.

`contracts/brief.ts`

- `IntentSourceKind = z.enum(['pr_title','pr_body','linked_issue','repo_spec','changed_files','commit_messages','external_link'])`
- `IntentSourceStatus = z.enum(['used','unavailable','unresolved'])`
- `IntentSource = z.object({ kind, ref, status })`
- `IntentConfidence = z.enum(['high','medium','low'])`
- `Intent` gains `risk_areas: z.array(z.string())` and **nothing else**. It is the
  LLM structured-output schema, so it carries no `confidence` and no `sources`.

`contracts/review-api.ts`

- `PrIntentRecord = Intent.extend({ pr_id, confidence, sources[], head_sha,
  provider, model, cost_usd, tokens_in, tokens_out, derived_at, is_stale })`.
  `is_stale` is **server-derived** on read (stored `head_sha` vs the PR's current
  head) and never stored — the same shape as `deriveReviewStatus`.

`contracts/findings.ts`

- `FindingScope = z.enum(['in_scope','out_of_scope'])`
- `Finding.scope: FindingScope.nullish()` — `.nullish()` exactly like the existing
  `kind` field, which is the proven pattern for a strict `json_schema` structured
  output here.

`contracts/trace.ts`

- `PromptAssembly.intent: z.string().nullish()`, so a run's trace shows the exact
  intent text the prompt carried.

`contracts/platform.ts`

- The `review_intent` feature-model default flips from `openai/gpt-4.1` to
  `openrouter` / `deepseek/deepseek-v4-flash`, matching `onboarding`. The runtime
  mirror `client/src/lib/feature-models.ts` carries the same flip.

`adapters.ts` (**server mirror only** — the client copy is already a trimmed
subset)

- `StructuredRequest.requireParameters?: boolean`, an OpenRouter-only opt-in that
  sends `provider: { require_parameters: true }`.

Database (`server/src/db/schema/reviews.ts`, applied via `pnpm db:generate`):
`pr_intent` gains `confidence`, `sources`, `risk_areas`, `head_sha`,
`sources_hash`, `provider`, `model`, `cost_usd`, `tokens_in`, `tokens_out`,
`derived_at`; `findings` gains a nullable `scope`.

## Acceptance criteria

1. **Exactly two LLM calls are visible in a run's Live Log** — one `kind: 'tool'`
   line for the cheap intent classifier and one for the main review — regardless
   of how many agents are in the batch.
2. `GET /pulls/:id/intent` returns 404 before any derivation, and after a
   `POST /pulls/:id/intent` returns a record with `confidence`, `sources[]`,
   `risk_areas[]` and `is_stale: false`.
3. A run's trace has a non-null `prompt_assembly.intent`, and the `user` prompt
   contains `<untrusted source="intent">`.
4. The system message contains **both** the existing "never reduce/descope"
   sentence and the new scope rule, and the scope rule states in words that it is
   subordinate to the first.
5. An intent derivation that throws leaves every agent run at `status: 'done'` —
   the run degrades to no intent section, exactly like `buildRepoMapDigest`
   returning `undefined`. It never routes through `failAll`.
6. A finding persisted with `scope: 'out_of_scope'` comes back on
   `GET /pulls/:id/reviews` — persisted, never dropped — and is collapsed but
   reachable in the UI. A `CRITICAL` one renders normally.
7. The intent call's cost is stored on `pr_intent` only and is never added into
   an agent run's `cost_usd`, so a three-agent fan-out cannot triple-count it.
8. No diff line text ever reaches the classifier: hunk headers are *synthesized*
   from `DiffHunk.oldStart/oldLines/newStart/newLines`, and `UnifiedDiff.raw` is
   not read in the intent path.
9. A spec path taken from the PR body is read only after a path-confinement check
   against the repo's clone root; `../`, absolute paths and escaping relative
   paths are rejected.

## Open questions

- **Non-blocking** — the exact confidence rule. Default taken above; it is one
  pure function (`intent/confidence.ts`) to retune.
- **Non-blocking** — the design's "severity >= high renders regardless of scope"
  has no direct equivalent in this repo's three-value `Severity` enum
  (`CRITICAL | WARNING | SUGGESTION`). Default taken: **CRITICAL only** is exempt
  from collapsing. Widening it to WARNING is a one-line change in
  `FindingsPanel/helpers.ts`.
- **Non-blocking** — `sources_hash` is not in the original column list, but the
  cache key `(pr_id, head_sha, sources_hash)` requires persisting it. Default
  taken: add the column.
- **Non-blocking** — commit messages are gathered only when the PR body is blank,
  capped at the 20 most recent.
</content>
</invoke>
