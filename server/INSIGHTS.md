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

_None yet._

## Codebase Patterns

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
  a new module or touching one of the four.
- **2026-08-03** — `grep -rn "\.transaction(" server/src` returns zero hits.
  Multi-statement writes are non-atomic and this is nowhere recorded as a
  deliberate choice — e.g. `pulls/routes.ts:251-265` deletes then re-inserts
  `pr_files`/`pr_commits`; a failed insert leaves the pull with no files. Any
  work that adds a second write in the same request should use
  `db.transaction(...)` rather than assume this is fine because "nothing else
  does it either."

## Tool & Library Notes

- **2026-08-03** — `dependency-cruiser` is already a `server/` runtime
  dependency, but only used as a library for the repo-intel indexer
  (`src/adapters/depgraph/index.ts`), not wired to any architecture rule set.
  Adding a `.dependency-cruiser.cjs` with `forbidden` rules to mechanically
  enforce the onion-architecture ring boundaries would cost zero new packages —
  there is no ESLint in this repo at all, so `eslint-plugin-boundaries` is not
  a same-cost alternative.

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
