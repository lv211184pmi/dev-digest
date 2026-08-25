# mcp (`@devdigest/mcp`) — agent notes

**npm, not pnpm.** This package has its own `package-lock.json`. `server/` and
`client/` use pnpm; running pnpm here is a mistake.

## Commands

```sh
npm test           # vitest, hermetic — fetch stubbed, no API, no network
npm run typecheck  # tsc --noEmit — this IS the build; the package emits no JS
npm start          # tsx src/index.ts — a stdio server, spawned by an MCP host
```

## Conventions

- **stdout is the JSON-RPC channel.** A single `console.log` anywhere in
  `src/**` corrupts the protocol and the host drops the connection with a parse
  error that names nothing useful. **All logging goes to `console.error`.**
- **Two zod versions live here, and they never mix in one expression.** Bare
  `zod` is **v3** — the version `@devdigest/shared` is written in, used for
  validating API responses. The `zod4` npm alias is **v4.4.3** and is **only**
  for MCP tool schemas, because `@modelcontextprotocol/server@2` requires
  `StandardSchemaWithJSON` and v3 does not satisfy it. Tool schemas import
  `* as z from 'zod4'`; everything touching `@devdigest/shared` imports bare
  `zod`.
- The tsconfig `paths` keeps the bare `"zod"` self-alias but deliberately has
  **no `"zod/*"` wildcard**, unlike `reviewer-core/tsconfig.json`. Adding it
  silently breaks the SDK. See `INSIGHTS.md` before touching that block.
- **The five tool names are a fixed user-facing contract**: `list_agents`,
  `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`. They
  are bare on purpose — Claude Code namespaces client-side as
  `mcp__devdigest__*`. Do not rename or namespace them.
- **Tool descriptions and parameter `.describe()` strings are approved verbatim
  text**, held in `src/tools/descriptions.ts` and `src/tools/schemas.ts`. A test
  asserts each registered description is byte-identical to its const. They read
  long; that is deliberate — do not "tighten" them.
- Arguments are **flat scalars only** (`repo: string`, `pr: int`,
  `agent: string`). No nested objects, no arrays, no unions — models get those
  wrong far more often than they get a string wrong.
- Errors come from the catalogue in `src/domain/errors.ts` and every message
  names the cause **and** the next action. Echo at most 300 chars of an API
  error `message`, never its `details`.

## Gotchas

- **Everything is read-only except `run_agent_on_pr`, which spends real money**
  on LLM calls. Never call it speculatively or in a loop over agents, and never
  add a tool that writes without saying so in its description.
- No database and no DI container — this package only speaks HTTP to the local
  Fastify API on `:3001`. Anything needing the DB belongs in `server/`.
- Tests are hermetic `*.test.ts` with `fetch` stubbed. **Never name a file
  `*.it.test.ts`** — that suffix is the server's testcontainers-Postgres
  selector and would get this package collected by the wrong CI lane.

## Read when

- Read `INSIGHTS.md` first for what was already tried here, and run the
  `engineering-insights` skill at the end of the task to add to it.
- Read `README.md` for the tool table, the request-path diagram, env vars and
  the `.mcp.json` registration.
- Read `../server/README.md` before adding a tool — the API map is the set of
  routes a tool can be built from, and this package adds none.
- Read `../TESTING.md` before adding a test or touching CI.
