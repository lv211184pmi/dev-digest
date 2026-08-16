# Blast radius

**Status:** shipped
**Packages touched:** server, client, mcp, shared (`@devdigest/shared` contract change)

> Shipped. How the feature works today is documented next to the code in
> [`../server/src/modules/blast/README.md`](../server/src/modules/blast/README.md)
> (request pipeline, the four rings, coverage rules), with the routes in
> [`../server/README.md`](../server/README.md#api-map-starter), the card in
> [`../client/README.md`](../client/README.md) and the tool in
> [`../mcp/README.md`](../mcp/README.md). This file is kept as the record of
> what was agreed and where reality differed — see the notes marked **Shipped
> as** below. One item did not land: the `pr_blast` migration is generated but
> **not applied** (Open questions, B1).

## Problem

A reviewer opening a PR asks one question before any other: **"what can this diff
impact?"** Today nothing answers it. The PR Overview page shows the diff and the
intent classification, and the reader has to reconstruct the reach of a change by
hand — open each changed file, find what it exports, grep for callers, guess which
HTTP endpoints and cron jobs sit downstream.

Every fact needed to answer it is already in the `repo-intel` Postgres index:
`symbols` knows what each changed file declares, `references` knows who calls it,
`file_edges` knows who imports whom, and `file_facts` knows which files declare an
HTTP endpoint or a cron. What is missing is the composition — and a route.

The design constraint that shapes everything: **an impact map is worthless if it
quietly says "nothing".** An unindexed repo, a fork PR with an empty diff, a PR
over GitHub's 100-file page, a `.py` file the parser cannot read — every one of
these produces an empty node set that reads identically to "this change is safe".
So no state in this feature is allowed to degrade to an empty array. Anything that
is not a real, index-backed answer must name itself as `partial` or `unavailable`,
carry a non-empty explanation, and list the specific changed files the index could
not see.

The second constraint follows from the first: **the model may not contribute a
node.** Exactly one cheap LLM call runs, and its entire input is the node list that
has already been computed deterministically — no diff, no repo source, no PR body.
Its structured output has one field, `summary`. It writes prose about the map; it
cannot change the map.

A meaningful share of this feature is already scaffolded and unused:
`RepoIntelService.getBlastRadius()` (no consumers, no route), the `BlastRadius`
Zod contract, `client/messages/en/blast.json` (every string, entirely unconsumed),
the half-width grid slot on `OverviewTab`, the `file_edges` reverse index whose
schema comment says verbatim that it exists for this walk, and a registered
placeholder MCP tool. This spec finishes work that was scaffolded and never wired.

## Routes

Both routes live in the new `blast` module
(`server/src/modules/blast/infrastructure/http/routes.ts`), built to the four
onion rings from the start and registered in `server/src/modules/index.ts`.

| Method | Path | Response | Codes |
| --- | --- | --- | --- |
| GET | `/pulls/:id/blast` | `PrBlastRecord` | 200 (`summary: null` when never derived) · 404 unknown PR |
| POST | `/pulls/:id/blast` | `PrBlastRecord` | 200 · 404 · rate-limited 10/min |

`GET` deliberately returns **200 with `summary: null`** rather than the 404 that
`GET /pulls/:id/intent` returns for a missing derivation. The deterministic map is
the product; the sentence is a garnish, and it ships whether or not the summary
has ever been derived.

Neither route declares a `response:` schema. No route in `server/src/modules` does
today, so this feature is not the place to activate that path.

## Scope — in / out

**In**

- A `blast` server module (four rings) and the two routes above.
- Changed files read from `pr_files`.
- Changed symbols read from the persistent index via `repoIntel.getBlastRadius`.
- Callers per changed symbol: rank-sorted descending, **capped at 20 per symbol**,
  with the true pre-cap count reported separately. The declaration file and 1-based
  line travel with every node so each is a clickable `path:line`.
- Downstream HTTP endpoints and cron jobs, reached by a reverse crawl of
  `file_edges` of depth exactly `BFS_DEPTH = 2`, through a new batched
  `getImporters` query — never the unfiltered `getEdges(repoId)`.
- An honest index-state block: `full` / `partial` / `unavailable`, a machine
  reason, a composed human explanation that is **non-empty whenever the state is
  not `full`**, and a `files_not_covered` list naming the specific misses.
- One cached LLM summary (1-2 sentences), keyed on `head_sha` + a hash of the
  computed nodes, in a new `pr_blast` table modelled on `pr_intent`. The nodes
  themselves are never persisted — they are re-derived every request, so a reindex
  can never serve a stale map.
- The Blast card on PR Overview: stat row, Tree | Graph toggle, collapsible
  symbol → callers → endpoint/cron chips, sha-pinned GitHub links.
- `get_blast_radius` in the MCP, implemented over the new route with an
  `outputSchema` and leads-forward errors for the unindexed and no-files cases.

**Out**

- **"Prior PRs touching these files."** That is the `PrHistory` block of the PR
  Brief — a separate feature with its own data source. Not even a placeholder.
- **The indexer pipeline.** Blast reads the index; it never changes how the index
  is built. If a node looks wrong, the fix is a coverage explanation, not a parser
  change.
- **AST-level endpoint→handler attribution.** The index knows only which *file*
  declares an endpoint, never which handler. UI copy therefore says "potentially
  touched", not "touched".
- **Non-TS/JS languages.** `SUPPORTED_EXT` is `.ts/.tsx/.js/.jsx/.mjs/.cjs`. A
  `.py` or `.go` file in the diff is invisible to the index; the correct response
  is to name it in `files_not_covered`, not to add a parser.
- **New `@devdigest/ui` primitives.** Vendored and do-not-touch. A collapsible is
  hand-rolled inside the card.
- **`pr_brief`.** It exists, is unwritten, and has no cache-key columns, so it
  cannot express the reuse rule this feature needs. Left alone.
- **A `response:` schema on any route**, and **a second LLM call** anywhere.

## Contract changes

`@devdigest/shared` first, then consumers — and both vendored mirrors
(`server/src/vendor/shared/contracts/`, `client/src/vendor/shared/contracts/`)
move together and stay byte-identical.

In `contracts/brief.ts`:

| Schema | Change |
| --- | --- |
| `ChangedSymbol` | **+** `line: number` (1-based declaration line, `0` = unknown) |
| `BlastCaller` | unchanged |
| `DownstreamImpact` | **+** `caller_count: number` (pre-cap total), **+** `truncated: boolean` |
| `BlastIndexState` | **new** — `'full' \| 'partial' \| 'unavailable'` |
| `BlastIndexInfo` | **new** — `state`, `reason`, `explanation`, `indexed_files`, `files_covered`, `files_not_covered` |
| `BlastTotals` | **new** — `symbols`, `callers`, `endpoints`, `crons` |
| `BlastRadius` | **+** `index: BlastIndexInfo`, **+** `totals: BlastTotals` |
| `BlastSummary` | **new** — the LLM's structured output. Exactly one field, `summary`. |

In `contracts/review-api.ts`: **new** `PrBlastRecord`, `BlastRadius.extend(...)`
with `pr_id`, a nullable `summary`, the provenance columns (`head_sha`, `provider`,
`model`, `cost_usd`, `tokens_in`, `tokens_out`, `derived_at`) and a derived
`is_stale` — shaped exactly like the neighbouring `PrIntentRecord`.

In `contracts/platform.ts`: **new** `'blast_summary'` member of `FeatureModelId`
and its `FEATURE_MODELS` entry. `resolveFeatureModel` and the Settings UI are both
registry-driven, so neither needs a code change.

Every additive field on an already fixture-tested object carries `.default(...)`.
`server/test/contracts.test.ts` parses `BlastRadius` from a fixture that has no
`index`, no `totals`, no `line` and no `caller_count`; that test must keep passing
**unmodified**, and it is the proof the change is genuinely additive.
`BlastIndexInfo` defaults to `state: 'unavailable'` — never `full` — so an absent
block cannot be mistaken for a complete answer. That is the "do not mask missing
data" rule expressed in the type.

### Correction to `specs/03-devdigest-mcp.md`

That spec predicts, at its "one future-facing contract" note, that "when the
blast-radius route is built it serializes that schema, so the placeholder tool can
be filled in **without a contract change** either." **That prediction does not
hold, and this spec overrides it.**

The existing `BlastRadius` (`changed_symbols`, `downstream`, `summary`) cannot
express two things this feature requires:

1. **The index-state block.** Honest degradation is the core requirement, and there
   is nowhere in the old shape to say "partial, here is why, here are the files I
   could not see". Without it the tool would return an empty `downstream` that
   reads as "nothing is impacted" — the exact failure this feature exists to
   prevent.
2. **`line` on `ChangedSymbol`.** Callers already carry a line; the changed symbol
   did not, so its own declaration could not be made clickable.

A contract change is therefore required, `specs/03`'s scope note ("Any
`@devdigest/shared` change" listed as out) is superseded for this work, and its
acceptance criterion #5 (`get_blast_radius` returns the not-implemented error) is
replaced by criterion 9 below.

## Acceptance criteria

1. `server/src/modules/blast/` exists with all four onion rings, is registered in
   `server/src/modules/index.ts`, and `GET /pulls/:id/blast` returns 200.
2. Changed files come from `pr_files`; an empty list produces
   `index.state: 'unavailable'` with reason `no_changed_files`, never a silent
   empty map.
3. `changed_symbols` is populated from `repoIntel.getBlastRadius`, each entry
   carrying `file`, `kind` and a 1-based `line`.
4. Callers are grouped per symbol, rank-sorted descending, capped at **20 per
   symbol and not globally**, with `caller_count` reporting the true pre-cap total
   and `truncated` set accordingly. Regression-tested.
5. Endpoints and crons are reached through a reverse `file_edges` crawl of depth
   exactly `BFS_DEPTH = 2` via the new batched `getImporters` query.
6. Any non-`full` index yields `index.state ∈ {partial, unavailable}`, a
   **non-empty** `explanation`, and a `files_not_covered` list naming the specific
   misses.
7. The Blast card renders in the Overview right-hand column with a stat row, a
   Tree | Graph toggle, and collapsible symbol → callers → endpoint/cron chips.
8. Every `path:line` is a link to a **sha-pinned** GitHub blob URL with the correct
   `#L<line>`; when the repo name or head sha is unknown it renders as plain mono
   text rather than a dead link.
9. `get_blast_radius` calls the new route, declares an `outputSchema`, spends the
   response budget on a per-symbol cap while keeping `caller_count` honest, and no
   "unimplemented" text survives anywhere in `mcp/`.
   **Shipped as:** the token budget is spent on the *symbol* list, not the caller
   list — `BLAST_SYMBOLS_MAX = 20` symbols with a top-level `truncated` flag,
   each carrying the server's full (already 20-capped) caller list pre-joined onto
   it. The 5-caller cap in the original criterion was dropped: the server's cap
   already bounds the payload, and re-capping in the tool would have made
   `caller_count` the only honest number in a list the model can see, which is
   the ambiguity this feature exists to remove. The tool also reads `GET` only,
   never the POST, so it stays free and `readOnlyHint: true` stays true.
10. The prompt contains no repo source, no diff and no PR body — asserted by test.
11. `Object.keys(BlastSummary.shape)` is exactly `['summary']`, and a model
    returning fabricated counts changes nothing in `downstream` or `totals`.
    **Shipped as:** the schema half is asserted in `blast-render.test.ts`
    (one key; extra fields stripped on parse). The end-to-end half — running
    `BlastUseCase` against a lying summarizer and comparing the node set — has
    no test: the planned `server/test/blast-service.test.ts` was not written.
    It is enforced by construction (`BlastSummary` has one field and the use
    case reads only `result.summary`), but not by a regression test.
12. The ripgrep full-tree scan is unreachable from this feature: two gates in the
    application service plus a permanent flag guard inside `getBlastRadius`.
    **Shipped as:** all three guards exist in the code. No test asserts that
    `container.codeIndex` is never reached — `repo-intel-facade-degraded.test.ts`
    exercises `getBlastRadius` with the flag off but only checks the returned
    shape, and the two use-case gates have no test at all, for the same
    missing-file reason as criterion 11.
13. `server/test/contracts.test.ts` passes unmodified.
14. All three `vendor/shared/contracts/*` file pairs are byte-identical.
15. All three package suites are green, each with its own package manager
    (pnpm in `server/` and `client/`, npm in `mcp/`).

## Open questions

- **B1 (blocking, infrastructure not design) — the Drizzle snapshot is behind
  `src/db/schema.ts`.** `src/db/migrations/meta/_journal.json` ends at
  `0013_lazy_captain_flint`, but `0013_curvy_bromley.sql` is committed and absent
  from the journal, so the snapshot still shows `pr_intent` with four columns and
  `findings` with no `scope`. `pnpm db:generate` therefore emits `ADD COLUMN`
  statements for that drift alongside `CREATE TABLE "pr_blast"`, and they carry no
  `IF NOT EXISTS`, so applying the file fails on any database where
  `0013_curvy_bromley.sql` was run by hand. Resolution: generate, inspect, and stop
  without applying if the file contains anything beyond the `CREATE TABLE` —
  reconciling the journal is its own change, and migrations are never hand-edited.

  **Outcome: still open — `pr_blast` does not exist in any database yet.**
  `pnpm db:generate` emitted `0014_purple_psylocke.sql`, which is exactly the
  predicted mix: `CREATE TABLE "pr_blast"` plus `ALTER TABLE "findings" ADD
  COLUMN "scope"` and twelve `ADD COLUMN`s on `pr_intent`. It was **not**
  applied. The generated file, its `meta/0014_snapshot.json` and the new
  `_journal.json` entry are all committed, so the next `db:generate` builds on
  them; what is missing is the `db:migrate`. Everything else in this spec
  typechecks and unit-tests without the table — only runtime and the DB-backed
  lane are blocked. Unblocking it is a journal-reconciliation change of its own,
  not part of this feature.
- **N1 — endpoint attribution is file-granular.** An endpoint declared in a caller
  file is attributed to every changed symbol whose callers live in that file.
  Default taken: attribute broadly and label the UI "potentially touched" rather
  than dropping the edge. Revisit only if the noise is visible on a real repo.
- **N2 — `is_stale` semantics.** Default taken: stale means a stored row exists
  whose `head_sha` **or** `facts_hash` no longer matches, so a reindex alone can
  mark a summary stale. Deliberate — the summary describes the nodes, and the nodes
  moved.
- **N3 — should `blast_summary` be user-selectable in Settings?** Default taken:
  yes, by virtue of being in `FEATURE_MODELS`, which is what the Settings UI is
  driven from. No extra UI work.
