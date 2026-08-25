# devdigest-mcp — local stdio MCP server

**Status:** in progress
**Packages touched:** `mcp/` (new), repo docs, CI

## Problem

DevDigest's review loop is reachable only through the web studio. An agent
working inside a codebase — Claude Code, Cursor, the MCP Inspector — cannot ask
which reviewers exist, run one over a pull request, read what it found, or pull
the conventions DevDigest extracted from that repo. It has to leave the editor,
open `:3000`, and copy the answer back by hand.

The Fastify API on `:3001` already exposes everything needed for that except a
blast-radius route (since added by `specs/04-blast-radius.md`). So the missing
piece is not backend capability, it is a
**translation layer**: a local stdio MCP server that takes flat human arguments
(`repo`, `pr`, `agent`) and returns a concise structured result, so the model
never has to learn DevDigest's uuids or its multi-call orchestration.

Four principles shape the tool surface, and each one lands somewhere concrete:

| Principle | Where it is enforced |
| --- | --- |
| **Result, not operation** | `run_agent_on_pr` resolves, starts, polls and projects in one call |
| **Flat arguments** | every tool takes scalars only — `repo`/`pr`/`agent` are strings and ints, never objects |
| **Concise structured response** | `ConciseFinding` keeps 8 of `FindingRecord`'s 17 fields; 20 findings by default |
| **Errors lead forward** | every failure is one of 18 catalogued codes, each ending in an imperative next step |

The last one is the reason this is a package and not a `fetch` wrapper. An agent
that gets `404` learns nothing; an agent that gets "No agent named 'sec'. Call
`list_agents` — its `name` values are exactly what this argument accepts" fixes
itself on the next call.

## Scope — in / out

**In**

- A new top-level `mcp/` package: **npm** with its own lockfile (mirroring
  `reviewer-core/` and `e2e/`), `type: module`, `tsx` entrypoint, vitest. No DB,
  no Drizzle, no DI container — it talks to `http://localhost:3001` over `fetch`,
  where there is no auth (`LocalNoAuthProvider`) and no route prefix.

- **Five tools**, each with a `DevDigest · ` title, an onboarding-quality
  description and `openWorldHint: true`:

  | Tool | Input (flat scalars) | Reads only? |
  | --- | --- | --- |
  | `list_agents` | *(none)* | yes |
  | `run_agent_on_pr` | `repo`, `pr`, `agent` | **no — spends money** |
  | `get_findings` | `repo`, `pr`, `agent?`, `run_id?`, `max_findings? = 20` | yes |
  | `get_conventions` | `repo` | yes |
  | `get_blast_radius` | `repo`, `pr` | yes |

- **`run_agent_on_pr` blocks.** It polls to completion with a ~5 min cap
  (env-tunable); on timeout it returns `status: "still_running"` plus the
  `run_id` and directs the agent to `get_findings` rather than stranding the run
  or re-spending on a second one.

- **`get_conventions` returns the skill-draft markdown** (~800 tokens), not the
  full `ConventionsView` (~3k tokens, and it carries raw source snippets). Rule
  sentences and `path:line` citations only.

- **`get_blast_radius` shipped as a discoverable placeholder** — registered so
  the capability and its argument shape were stable, with no `outputSchema`,
  always returning `isError` with a message pointing at `run_agent_on_pr`.
  **Superseded by `specs/04-blast-radius.md`**, which built the
  `GET /pulls/:id/blast` route and filled the tool in. The argument shape
  survived unchanged, which is what the placeholder was for.

- **Repo-level docs and CI**: the package tables in `README.md` / `AGENTS.md`,
  the `TESTING.md` suite map, a `.github/workflows/mcp.yml` path-filtered on
  `mcp/**` and `server/src/vendor/shared/**`, the `pr-self-review` routing
  tables, and a committed `.mcp.json` so a host offers the server for approval.

**Out**

- **Blast Radius itself.** It ships as a registered placeholder, not an
  implementation. The real feature reads `repo-intel`'s symbol and import graph
  and needs a `server/` route first — a separate plan.
  *(Done: that separate plan is `specs/04-blast-radius.md`. The out-of-scope
  line stood for this feature and is kept as the record of what it deferred.)*
- **Any `server/`, `client/`, `reviewer-core/` or `@devdigest/shared` change.**
  No blast-radius route, no PR-number lookup endpoint, no response schemas added
  to the two routes that lack them (`GET /agents`, `GET /pulls/:id/reviews` are
  validated client-side instead).
- **`scripts/dev.sh`.** A stdio server is spawned by the host, not run as a
  daemon; nothing in the running stack imports `mcp/`. The one-time
  `cd mcp && npm ci` is documented in the READMEs instead.
- **Multi-agent (`all: true`) runs.** Agents run serially, so wall time is the
  sum of N LLM calls and does not fit a 5-min cap. The poll loop is written
  generically for N runs, but no tool exposes it.
- **MCP resources and prompts**, SSE (`/runs/:id/events`), skills CRUD, finding
  accept/dismiss, smart-diff, intent.

## Contract changes

**None.** `mcp/` consumes `@devdigest/shared` unchanged, aliased at
type-check time to `server/src/vendor/shared/` exactly as `reviewer-core` does —
which is why the CI path filter includes that directory. Neither mirror is
edited.

The one future-facing contract this feature would need already exists:
`BlastRadius` (`changed_symbols`, `downstream`, `summary`) is defined at
`server/src/vendor/shared/contracts/brief.ts:81`. When the blast-radius route is
built it serializes that schema, so the placeholder tool can be filled in without
a contract change either.

**This prediction was half right.** `specs/04-blast-radius.md` did serialize
`BlastRadius` from `GET /pulls/:id/blast` — but it had to *extend* it first. Two
fields the placeholder era could not foresee: an `index` block (state,
explanation, `files_not_covered`), because a blast map that cannot say what the
index missed is indistinguishable from one that found nothing; and a `line` on
`ChangedSymbol`, so a declaration is clickable. Both landed additively with
`.default(...)`, so no consumer broke. The lesson worth keeping: a placeholder
stabilises an *argument* shape cheaply, but predicting a *response* shape before
the feature exists is guesswork.

One package-local wrinkle that is *not* a contract change but must not be
mistaken for one: the MCP SDK requires **zod v4** while `@devdigest/shared` is
**zod v3** source, so `mcp/package.json` installs both (`zod@^3` plus
`zod4: npm:zod@^4`). Tool schemas use v4, shared contracts use v3, and the two
never mix in one expression.

## Acceptance criteria

Verified manually against the seeded stack (`acme/payments-api`, PR #482), with
`./scripts/dev.sh --no-client` up and `cd mcp && npm ci` done:

1. `npx @modelcontextprotocol/inspector ./node_modules/.bin/tsx src/index.ts`
   lists **exactly five** tools, and `run_agent_on_pr` is the only one whose
   annotations do not say `readOnlyHint: true`.
2. `list_agents` returns the four seeded reviewers (General / Security /
   Performance / Test Quality), and its `name` values are byte-identical to what
   `run_agent_on_pr` accepts as `agent`.
3. `get_findings {repo: "acme/payments-api", pr: 482}` returns either the seeded
   review or a `not_reviewed` result that names `run_agent_on_pr` as the next
   step. Both outcomes pass.
4. `get_conventions {repo: "acme/payments-api"}` walks three branches in one
   sequence: `conventions_never_run` on a fresh seed → run the extractor and
   accept nothing → `conventions_none_accepted` **with the candidate count** →
   accept one rule → markdown returns.
5. ~~`get_blast_radius` returns `isError` with the not-implemented message and
   the pointer to `run_agent_on_pr`.~~ **Superseded by
   `specs/04-blast-radius.md`**: the tool now returns the PR's impact map, and
   its own acceptance criteria replace this one.
6. `run_agent_on_pr {repo: "acme/payments-api", pr: 482, agent: "General
   Reviewer"}` **with** an LLM key blocks 20–90 s and returns `completed` with a
   verdict, a 0–100 score, severity counts and findings; **without** a key it
   returns `failed` naming the missing key. The second branch matters because it
   is invisible from `GET /pulls/:id/reviews` alone.
7. Error paths lead forward: `agent: "nope"` → `agent_not_found` naming
   `list_agents`; `pr: 999999` → `pr_not_found` listing imported numbers; the API
   stopped → `api_unreachable` naming `./scripts/dev.sh`. No message ever
   interpolates `ApiErrorBody.details`.
8. A finished sibling run on the same PR does **not** make a still-running review
   look complete — the poll loop matches only the `run_id`s the POST returned.
9. Restarting Claude Code in the repo offers the project server for approval and
   the tools appear as `mcp__devdigest__*`.
10. `cd mcp && npm run typecheck && npm test` is green, with both zod majors in
    one program. No `*.it.test.ts` exists here — that suffix is the server's
    testcontainers selector and this package touches no DB.

## Open questions

- **Non-blocking** — `scripts/dev.sh` gaining an `npm ci` for `mcp/`. Default
  taken: **no**. The `reviewer-core` precedent exists only because the API
  imports its source at runtime; nothing in the running stack imports `mcp/`.
- **Non-blocking** — committing `.mcp.json`. Default taken: **yes**. Claude Code
  prompts for approval on first use, so the server is discoverable without being
  silently active. The `command` is the package-local
  `./mcp/node_modules/.bin/tsx` deliberately: the repo root has no
  `node_modules`, so `npx` would resolve nothing and try to download.
- **Non-blocking** — progress notifications during the blocking 5-min call
  (hosts reset their idle timeout on progress). Default taken: **implement if the
  progress token wires cleanly, otherwise ship without** and record it in
  `mcp/INSIGHTS.md`. Cancellation is handled regardless: an aborted request
  returns the `run_id` rather than cancelling the server-side run.
- **Non-blocking** — Node version. `engines: {node: ">=22"}` is declared per repo
  convention, but npm `engines` is advisory and the host chooses the interpreter,
  so a host on Node 20 spawns it silently. Noted in `mcp/README.md`.
- **Blocking if it ever regresses** — if the dual-zod install stops type-checking
  in one program, **stop and ask** rather than hand-writing zod-v4 mirrors of the
  response contracts inside `mcp/`; that would duplicate `@devdigest/shared` and
  needs its own decision.
