# Insights — mcp

MCP-server decisions and dead ends. Read before touching the tsconfig `paths`,
the dual-zod split, or anything that assumes the DevDigest API returns findings
synchronously — several of the constraints here cost a debugging session each.

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
them here.

---

## Decisions

### 2026-08-15 — Two zods, and NO `zod/*` path wildcard

**What:** this package depends on both `zod@^3.25.76` (bare `zod`, what
`@devdigest/shared` is written in, used to validate API responses) and
`zod4: npm:zod@^4.4.3` (MCP tool schemas only), and its `tsconfig.json` keeps the
bare `"zod"` self-alias while deliberately **omitting** the `"zod/*"` wildcard
that `reviewer-core/tsconfig.json` carries.
**Why:** `@modelcontextprotocol/server@2` requires schemas satisfying
`StandardSchemaWithJSON`; zod 3.25.76's `zod/v4` subpath implements
`StandardSchemaV1` *without* `~standard.jsonSchema`, so a v3 schema cannot be
registered. The bare `"zod"` alias has to stay, because `@devdigest/shared`
imports bare `'zod'` and would otherwise resolve upward into `server/`'s
`node_modules` tree.
**Rejected:** copying `reviewer-core/tsconfig.json` verbatim, wildcard included.
The wildcard hijacked the SDK's own `import * as z from "zod/v4"` and resolved it
to **our** zod 3.25.76 shim, which lacks `jsonSchema`. `skipLibCheck` masked the
resulting mismatch, so the build typechecked green and would only have blown up
several steps later, at `registerTool`. The wildcard is safe in `reviewer-core`
only because that is a single-zod package with no dependency importing a `zod/*`
subpath — it is a landmine specifically in a dual-zod package.
**Cost:** an import of a `zod` subpath (`zod/v4`, `zod/mini`) from *our* source
will now resolve through node_modules rather than the alias. Nothing here does
that, and tool schemas must import `zod4` anyway.

### 2026-08-15 — The latest-review-per-agent rule is duplicated here on purpose

**What:** `src/domain/project.ts` re-derives "newest review per agent" locally
(group by `agent_name`, max `created_at`, prefer `kind === 'review'`) instead of
reusing the server's implementation.
**Why:** the canonical `selectLatestReviewPerAgent` is server-internal, and
importing it would drag the server's module graph — DI container, Drizzle, its
whole plugin tree — into a package whose entire premise is that it speaks only
HTTP.
**Rejected:** importing from `server/src/modules/pulls/status.ts:17-72` through a
path alias. Also rejected: adding a server route that returns the already-reduced
set, which is out of scope for this package (no `server/` changes).
**Cost:** a third copy of one rule — the client already carries its own. If the
rule changes, three places move together.
`server/src/modules/pulls/status.ts:17-72`

## What Works

- **2026-08-15** — probe a green typecheck before trusting it. After the
  dual-zod fix the build passed, which proves nothing on its own; passing a
  zod-**v3** `z.object()` to `registerTool` was confirmed to fail with
  `Property 'jsonSchema' is missing`, which proves the passing case actually
  discriminates. Worth doing whenever a build "just works" right after a version
  or path fix. `src/tools/schemas.ts:26`
- **2026-08-15** — "errors lead forward" is mechanically testable, not just a
  review guideline: assert an imperative-verb regex matches at index **> 0**
  across the whole error catalogue. The `> 0` is the whole trick — one assertion
  then catches both a message that states a cause with no next step and one that
  barks an instruction without first saying what went wrong.
  `test/errors.test.ts`

## What Doesn't Work

- **2026-08-15** — `POST /pulls/:id/review` is fire-and-forget: its `reviews`
  array is **always** `[]`, so no "run the agent and return the findings" flow
  can be built on the response alone; it must keep the returned `run_id`s and
  poll. The doc comment at
  `server/src/vendor/shared/contracts/review-api.ts:40-44` claims the opposite
  and is stale. `server/src/modules/reviews/service.ts:167`
- **2026-08-15** — polling the PR's aggregate run status returns a false
  "finished": a previously completed run on the same PR makes the whole PR look
  done while the run we just started is still going. Poll `GET /pulls/:id/runs`
  filtered to **exactly the `run_id`s the POST returned**, and filter the reviews
  by those same ids. `src/domain/poll.ts`

## Codebase Patterns

- **2026-08-15** — `strategy`, `ci_fail_on` and `repo_intel` on a `GET /agents`
  response are a **client-side artifact here**, not API output: that route
  declares no response schema, so those values exist only because our own
  `Agent.parse` applies the schema's `.default()`s. Anything reading them is
  reading a local decision, not something the server sent.
  `server/src/vendor/shared/contracts/knowledge.ts:296`

## Tool & Library Notes

- **2026-08-15** — typing a generic validate helper as
  `(schema: z.ZodType<T>) => T` is a trap when the schema has `.default()`
  fields: TS resolves `T` to the schema's **input** type, where the defaulted
  keys are still optional, so the parsed result silently fails to satisfy
  `z.infer<typeof Schema>` at the call site. Be generic over the *schema*
  instead — `<S extends z.ZodTypeAny>(s: S) => z.output<S>`. Hit with `Agent`,
  which defaults `strategy`, `ci_fail_on` and `repo_intel`.
  `src/api/endpoints.ts:101-108`

## Recurring Errors & Fixes

- **2026-08-15** — `registerTool` failing with `Property 'jsonSchema' is
  missing` means a **zod v3** schema reached the SDK. Fix the import, not the
  schema: tool schemas are `import * as z from 'zod4'`, bare `zod` is for
  `@devdigest/shared` only. The same error appears with a correct import if a
  `"zod/*"` wildcard is present in `tsconfig.json` — see Decisions.
  `src/tools/schemas.ts:26`

- **2026-08-15** — a **raw NUL byte written into source** makes the file binary
  to `file(1)`, git and grep, while `tsc` and vitest read it happily. It got in
  as a cache-key separator (`` `${repoId}\0${prNumber}` ``, a sound technique)
  typed as the literal byte rather than the `\0` escape. The tell is `grep`
  returning **nothing at all** — not "0 matches" — for a file you can see has
  the string. Git would have stopped rendering diffs for it. Write control
  characters as escapes, always. `src/domain/resolve.ts:144`

- **2026-08-15** — branching on an error's **message text** to detect an HTTP
  status is a smell that shows up whenever the layer that knows the status is
  not the layer that can write a useful message. Here the skill-draft 409 needs
  the repo name and candidate count, which `endpoints.ts` does not have. The fix
  is to carry the fact, not re-derive it: `ToolError` has an optional `status`,
  `client.ts` tags every non-2xx via `withStatus`, and the tool compares a
  number. Note this means a stubbed `Endpoints` in a test must build its errors
  the way `client.ts` does, or it will not exercise the real branch.
  `src/domain/errors.ts:38-62`, `src/tools/get-conventions.ts:45`

## Open Questions

- **2026-08-15** — `get_findings` returns "no review yet" as an `isError`, while
  `run_agent_on_pr` returns the same `ReviewResult.status: 'not_reviewed'` as a
  structured payload (its done-but-no-review branch). The asymmetry is
  deliberate — a findings query answered with a valid-looking payload of zero
  counts reads as "clean PR", which is the opposite of the truth — but it does
  mean one status value reaches the wire from only one of the two tools. Revisit
  if a caller is ever observed misreading either form.
  `src/tools/get-findings.ts:67-79`, `src/tools/run-agent-on-pr.ts:151-156`
