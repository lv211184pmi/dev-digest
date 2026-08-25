# Insights — server

Server-side decisions and dead ends. Read before redesigning anything here; a
lot of what looks arbitrary was a deliberate trade-off.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here. Insights about `src/vendor/shared/` go in the **root** `INSIGHTS.md` —
a contract change reaches every package.

---

## Decisions

### 2026-07-31 — Schema-first validation at the route boundary

**What:** every route declares Zod `params`/`body`/response schemas from
`@devdigest/shared` via `fastify-type-provider-zod`; invalid input is rejected
with `422` before the handler runs.
**Why:** one definition has to drive both request validation and response
serialization, or the two drift.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside each handler — it
validated input only, left responses unchecked, and duplicated the schema
reference in every route.

## What Works

_None yet._

## What Doesn't Work

- **2026-08-24** — a "collect N items then stop" walker that hard-stops the
  instant `out.length >= maxFiles` can never distinguish "found exactly the
  cap" from "found more and got cut off" — its own length can never exceed the
  cap, so a caller's `truncated = length >= maxFiles` check is a false
  positive whenever discovery lands on *exactly* the cap. Hit in
  `GitClient.listFiles` (`adapters/git/simple-git.ts`'s `walkForMatches`) feeding
  `project-context-service.ts`'s `list()`: a repo with exactly
  `MAX_DISCOVERED_FILES` matching files was reported `truncated: true` even
  though nothing was left out. The bug was locked in, not caught, by a test
  that fed exactly the cap and asserted `truncated: true`. **Fixed 2026-08-24**
  — the walker now collects `maxFiles + 1` so real truncation is
  distinguishable, the caller sets `truncated = length > maxFiles` and slices
  the result back to `maxFiles` before returning it. General rule: any
  cap-and-stop collector needs to collect one *past* the cap to know whether
  it was actually cut off. Also watch for a hand-rolled `Mock*Client` in
  `adapters/mocks.ts` that reimplements a similar cap independently rather
  than delegating — `MockGitClient.listFiles` still unconditionally slices to
  `maxFiles` post-fix and does not mirror the real adapter's new
  collect-one-extra behavior, so a future hermetic test reaching for the
  shared mock to test a truncation boundary will silently get the *stale*
  (pre-fix) semantics unless it builds a local override, as
  `test/project-context-routes.test.ts`'s `OverflowGitClient` does.

- **2026-08-25** — `MockGitClient.readFile` (`src/adapters/mocks.ts`) returns
  `''` unconditionally for any path absent from its `files` fixture map — it
  cannot distinguish "not in the fixture" from "genuinely empty," even though
  the real adapter's read path (`CloneFileSource.readRaw` /
  `SimpleGitClient.readFile`) throws/returns `null` on a missing file. This
  blocks writing a "discoverable but unreadable" test directly against the
  shared mock: a test needs its own `GitClient` subclass overriding
  `readFile` to throw, mirroring real ENOENT behavior — see
  `UnreadableFileGitClient` in `test/project-context-routes.test.ts`. Check
  before reaching for `MockGitClient` alone to test a missing/unreadable-file
  branch; it will silently return an empty string instead.

## Codebase Patterns

- **2026-08-23** — adding a **versioned** field to an agent or skill config is a
  four-place edit, and not one of the four fails loudly if you miss it.
  (1) `agent_versions.config_json` is `jsonb`, but `AgentRepository.snapshotVersion`
  builds it from an explicit eight-field whitelist — `provider`, `model`,
  `system_prompt`, `output_schema`, `strategy`, `ci_fail_on`, `repo_intel`,
  `skills` (`server/src/modules/agents/repository.ts:148-167`) — so a new field is
  simply absent from every snapshot. (2) Whether a version is cut at all is decided
  by two more field whitelists, `isSkillConfigChange`
  (`server/src/modules/skills/helpers.ts:48-58`) and `isConfigChange`
  (`server/src/modules/agents/helpers.ts:61-74`); a change to an unlisted field
  bumps nothing. (3) `skill_versions` rows are
  `{skillId, version, body, changeSummary}` and nothing else
  (`server/src/modules/skills/repository.ts:118-129`), so a skill-side field needs
  a real column, not just a serializer edit — otherwise the snapshot is
  byte-identical to its predecessor and the Versions tab shows v5 → v6 with no
  visible difference. (4) `SkillRepository.restoreVersion` (`:156-167`) restores
  **only `body`**, and its own comment notes that "a restore that matches the
  current body is a no-op" — so restoring a version whose sole difference is the
  new field does nothing at all, with no error. Grep all four before adding one.

- **2026-08-05** — a job handler that makes a paid LLM call must never let its
  promise reject, or `JobRunner` (`platform/jobs.ts`) retries it up to 3x
  (`retries: 2` default, no per-job timeout override) — one failure becomes up
  to 3 paid model calls. Pattern used in
  `modules/conventions/infrastructure/http/routes.ts`'s job registration: wrap
  the use-case call in try/catch and call a `failRun`-style persistence method
  in the catch block, never rethrowing, so the `jobs` row ends `done` while
  the domain's own status column (e.g. `convention_runs.status`) says
  `failed`. That mismatch between the two tables is intentional — comment it
  at the call site, or the next reader "fixes" it by removing the try/catch
  and silently reintroduces 3x spend. Also set `timeoutMs` on the
  `StructuredRequest` itself (e.g. 90s) so the LLM call fails with a clear
  message before `JobRunner`'s own 120s hard timeout fires first. Verified by
  `test/conventions-extract.test.ts`'s anti-retry assertion (exactly one
  `completeStructured` call after a throwing model). This will bite the next
  LLM-backed job too — check for it before adding one.
- **2026-08-04** — a feature's CRUD layer having its own `*.it.test.ts` does
  not mean its runtime *effect* is tested. `test/skills.it.test.ts` covered
  skill CRUD, versioning, and the `agent_skills` link/reorder round trip
  thoroughly, but nothing asserted that a linked+enabled skill's body actually
  reaches `run-executor.ts`'s assembled prompt (`linkedSkills` →
  `skillBodies` → `assemblePrompt({ skills })`) or that `skip_skills` zeroes
  it out for one run. That behavior lives in the *reviews* module, not the
  *skills* module, so the right home for it is `test/reviews.it.test.ts`
  (added: "a linked, enabled skill is spliced into the prompt…", asserting on
  `GET /runs/:id/trace` → `prompt_assembly.skills`) — not a new skills test
  file. When a feature attaches to an existing pipeline via a link table,
  write the "does it actually change pipeline behavior" test in the pipeline
  module's test file, not the feature's own.
- **2026-08-03** — module layering is inconsistent, not absent: `repos`,
  `agents`, `reviews`, `repo-intel` follow `routes.ts` → `service.ts` →
  `repository.ts`, but `pulls`, `polling`, `settings`, `workspace` call
  `container.db` straight from the route handler (`pulls/routes.ts` alone has
  ~15 raw Drizzle calls in 393 lines). Repositories are also constructed two
  different ways — via `container.agentsRepo`/`reviewRepo` vs. `new
  XRepository(container.db)` inline inside `reviews/service.ts:34`,
  `repos/service.ts:36`, `agents/service.ts:55`. The `onion-architecture` skill
  (`.claude/skills/onion-architecture/`) documents the intended layering and a
  strangler backlog for the four non-conforming modules — read it before adding
  a new module or touching one of the four. `modules/conventions/` (added
  2026-08-05) is this repo's first module actually built with the real
  `domain-model/domain-services/application-services/infrastructure` folders
  from day one — a concrete worked example beyond the skill's own docs when
  starting the strangler work on `pulls`/`polling`/`settings`/`workspace`.
- **2026-08-03** — `grep -rn "\.transaction(" server/src` returns zero hits.
  Multi-statement writes are non-atomic and this is nowhere recorded as a
  deliberate choice — e.g. `pulls/routes.ts:251-265` deletes then re-inserts
  `pr_files`/`pr_commits`; a failed insert leaves the pull with no files. Any
  work that adds a second write in the same request should use
  `db.transaction(...)` rather than assume this is fine because "nothing else
  does it either." **Confirmed again 2026-08-24**: Project Context's
  `AgentsRepository.setContextDocs`/`SkillsRepository.setContextDocs`/
  `restoreVersion` originally did the doc-row write, the version bump, and the
  `snapshotVersion` insert as three separate un-transacted round trips — a
  crash between them desyncs the version/snapshot audit trail from the actual
  attachment rows. **Fixed 2026-08-24** by wrapping all three in one
  `db.transaction()` per method (`agents/repository.ts:314-349`,
  `skills/repository.ts:313-355,203-256`). The fix has a second gotcha worth
  keeping: a private helper called *inside* the transaction (here,
  `snapshotVersion`, which itself calls `contextDocsForSnapshot`/
  `linkedSkills`/`skillIdsForAgent`) must have the `tx` handle threaded through
  **every read it does**, not just the final insert — a read issued via
  `this.db` inside an open transaction runs on a different pooled connection
  and won't see the transaction's own uncommitted writes, so the snapshot
  would silently capture the *pre*-write state. `AgentsRepository.update()`
  and `SkillsRepository.update()` still do their version bump and
  `snapshotVersion` insert as two separate un-transacted calls (not fixed —
  out of this fix's scope) — the same race applies there and to any future
  method that writes more than one table per logical save.

## Tool & Library Notes

- **2026-08-25** — `TiktokenTokenizer`'s `cl100k_base` encoder (js-tiktoken)
  is pathologically slow on a long run of a single repeated character:
  ~6.2s to encode one 8001-char `'x'.repeat(8001)` string vs ~11ms for 8001
  chars of varied content. A boundary test built with `.repeat()` that
  happens to route through the real tokenizer instead of the mockable
  `ContainerOverrides.tokenizer` seam can single-handedly dominate a whole
  suite's runtime — one such test in
  `server/test/project-context-routes.test.ts` accounted for over 90% of a
  32-file hermetic lane's total execution time (15.2s of ~15.2s) before
  being fixed by passing `overrides: { tokenizer: { count: () => 0 } }` in
  `buildApp`. Use varied-content fixtures for large boundary tests, or stub
  the tokenizer, whichever is cheaper for the assertion at hand.
- **2026-08-11** — `RipgrepCodeIndex.references()` and `.symbols()`
  (`src/adapters/codeindex/ripgrep.ts:99-126`) do NOT shell out to ripgrep
  despite the class name — only `.grep()` does. Both instead do a full
  recursive `this.walk(root)` over the entire cloned repo, `readFile`-ing
  every file under 2MB sequentially and regexing every line, with no cache,
  no concurrency, and no cap. Cheap on a diff-scoped CI checkout; on a studio
  review of a large monorepo it's a full-tree scan per call with no timeout.
  Before calling `codeIndex.symbols`/`.references` on a request hot path,
  check whether the persistent `symbols`/`references` tables
  (`src/modules/repo-intel/repository.ts`) already cover the need instead —
  see the `getCallerSignatures` fix below.
- **2026-08-03** — `dependency-cruiser` is already a `server/` runtime
  dependency, but only used as a library for the repo-intel indexer
  (`src/adapters/depgraph/index.ts`), not wired to any architecture rule set.
  Adding a `.dependency-cruiser.cjs` with `forbidden` rules to mechanically
  enforce the onion-architecture ring boundaries would cost zero new packages —
  there is no ESLint in this repo at all, so `eslint-plugin-boundaries` is not
  a same-cost alternative.

## Recurring Errors & Fixes

- **2026-08-15** — a review that returns `verdict: approve`, `score: 100`,
  zero findings and the summary "The diff is empty" is a **false pass**, not a
  clean PR. `loadDiff` (`src/modules/reviews/diff-loader.ts:19-29`) tries
  `git diff base...headSha` in the clone, then falls back to reassembling
  `pr_files.patch`, and returns an empty `UnifiedDiff` when both come up dry —
  the agent then dutifully approves nothing. Both paths fail together for any
  PR opened from a **fork**: the clone's refspec is
  `+refs/heads/main:refs/remotes/origin/main` only (`POST /repos/:id/refresh`
  does not add `refs/pull/*/head`), so the head SHA is absent
  (`git -C server/clones/<owner>/<name> cat-file -t <headSha>` → `could not
  get object info`), and `pr_files` is empty until something imports it.
  Diagnose with `select count(*), count(patch) from pr_files where
  pr_id='<uuid>'`; fix by calling `GET /pulls/:id` once, which re-imports
  files/commits from GitHub, then re-run the agent. Neither the run nor the
  MCP `run_agent_on_pr` response distinguishes this from a genuine approve —
  check `additions`/`files_count` on the pull row before trusting a 100.
- **2026-08-15** — `pulls.listFiles` in `src/adapters/github/octokit.ts:80-85`
  is a single un-paginated call with `per_page: 100`, so any PR over 100 files
  is silently truncated to the first 100 — the reviewer sees a partial diff and
  says so in its summary ("not present in the provided diff") without any
  warning that data was dropped. Observed on
  `ai-agentic-engineering-neo/dev-digest#131`: pull row says `files_count: 424`,
  `pr_files` holds 100 rows / 98 patches. Use `octokit.paginate` there before
  trusting a review of a large PR.
- **2026-08-11** — a review stuck logging `Resolving <provider> provider
  done` and nothing after (no `Prompt assembled` line) is hung inside
  `run-executor.ts`'s `buildCallersDigest`/`buildRepoMapDigest`/
  `buildRankNote` — none of the three wrap themselves in a `runLog.step`
  start event, only log on completion, so a hang there is silent in the Live
  Log. Root cause found this date: `RepoIntelService.getCallerSignatures`
  called `container.codeIndex.references()` (the ripgrep adapter's
  full-repo-walk path — see Tool & Library Notes above) once per
  changed-file symbol on EVERY review, indexed or not, contradicting
  `repo-intel/types.ts`'s own "T2+ serves reads purely from the Postgres
  cache" contract. **Fixed 2026-08-11** in `src/modules/repo-intel/
  service.ts` — `getCallerSignatures` now reads exclusively from the
  persistent index (mirrors `tryPersistentBlast`) and degrades to `[]` when
  unindexed, same as `getRepoMap`/`getFileRank`. If a `repo-intel` facade
  method is ever slow again, check first whether it's still calling
  `container.codeIndex.*` instead of `this.repo.*`.
- **2026-08-11** — `test/reviews.it.test.ts` (testcontainers Postgres) is
  flaky independent of any code change: reran it 5× against unmodified code
  and got 2 different failures on 2 of 5 runs (`Cannot read properties of
  undefined (reading 'findings')` and `(reading 'skills')`), each time a
  different subtest. Looks like testcontainers/DB timing under load, not a
  logic bug — rerun 2-3× in isolation before assuming a local failure here
  was caused by your change.

## Open Questions

_None yet._
