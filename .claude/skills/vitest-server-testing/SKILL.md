---
name: vitest-server-testing
description: "Server-side testing for server/ with Vitest — the hermetic (*.test.ts) vs DB-backed (*.it.test.ts) lane split, the testcontainers Postgres fixture, the Docker skip guard, app.inject() route tests, and the mock adapters that keep the unit lane key-free. Use when adding or repairing a test under server/test/ or server/src/**, choosing which lane a test belongs in, or deciding how to fake the outside world. Does NOT cover React component tests (see react-testing-library), browser flows (see e2e-flows), or how the code under test should be written (see fastify-best-practices, onion-architecture, drizzle-orm-patterns)."
version: 1.0.0
metadata:
  tags: testing, vitest, server, testcontainers, integration, hermetic, backend
---

# Vitest Server Testing (`server/`)

The lane split is the whole skill: **a filename decides whether a test may touch a
database.** Everything else follows from that. The philosophy — typological, not
exhaustive — is in [`TESTING.md`](../../../TESTING.md); this skill is the mechanics.

## Scope guardrail

| Question | Skill |
|---|---|
| "Which lane does this server test belong in? How do I get a DB?" | **vitest-server-testing** (this skill) |
| "How do I test a React component or hook?" | `react-testing-library` |
| "How do I add a browser flow?" | `e2e-flows` |
| "Is the route/query/layering under test written correctly?" | `fastify-best-practices`, `drizzle-orm-patterns`, `onion-architecture` |
| "Does this test cover the edges?" | `corner-case-checklist` |

## The two lanes

| Lane | Filename | May use | Runner selection |
|---|---|---|---|
| Unit (hermetic) | `*.test.ts` | `app.inject()`, mocks, pure functions | `pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| Integration | `*.it.test.ts` | real Postgres via testcontainers, migrations, seed | `pnpm exec vitest run .it.test` |

**The binding rule: a test that imports `test/helpers/pg.ts` MUST be named
`*.it.test.ts`.** Naming it `*.test.ts` puts a Docker dependency in the lane CI runs
without Docker, and the failure looks like a connection bug rather than a naming mistake.

`vitest.config.ts` includes both `test/**/*.test.ts` and `src/**/*.test.ts`, and sets
`testTimeout`/`hookTimeout` to 120 s because container startup is slow — do **not** raise a
per-test timeout to paper over a hanging test.

**Do not rely on `test:unit` / `test:integration` package scripts.**
`server/package.json` is `skip-worktree` (a local variant diverges from the committed
file), which is why CI and `TESTING.md` both spell the split out as `pnpm exec vitest run …`.

## Integration tests: the fixture and the skip guard

`server/test/helpers/pg.ts` starts `pgvector/pgvector:pg16` — the same image as
docker-compose, so the `vector` extension is present — runs migrations, and returns a
Drizzle handle.

Every integration file opens with the guard, at module top level:

```ts
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
```

Then use `d(...)`, never bare `describe(...)`. A file without the guard turns "no Docker
daemon here" into a red suite instead of a clean skip.

Lifecycle: `startPg()` in `beforeAll`, `fixture.stop()` in `afterAll` (it closes the
handle *and* the container). Build the app under test with `buildApp({ config })` and
`loadConfig({ ...process.env, NODE_ENV: 'test' })`, then `seed()`.

### Runs are fire-and-forget — wait for them

`POST` review routes return `runIds` immediately and persist in the background while the
client subscribes to SSE. Asserting on persisted reviews, findings or traces right after
the POST is a race. Use `waitForPrRuns(db, prId, { expected })` from
`test/helpers/runs.ts`, which polls `agent_runs` until every row is terminal
(`done` / `failed` / `cancelled`). Never substitute a fixed `setTimeout`.

## Hermetic tests: inject, don't listen

Route tests use `app.inject()` — no port, no server lifecycle:

```ts
const app = await buildApp({ config, overrides: { github: new MockGitHubClient({ login: 'octocat' }) } });
const res = await app.inject({ method: 'GET', url: '/health' });
await app.close();
```

`buildApp`'s `overrides` is the injection seam. The fakes live in
`server/src/adapters/mocks.ts`: `MockLLMProvider`, `MockEmbedder`, `MockGitHubClient`,
`MockGitClient`, `MockCodeIndex`, `MockAuthProvider`, `MockSecretsProvider`. **A hermetic
test never reaches the network and never needs a key** — if you are reaching for one, you
either want a mock or you are in the wrong lane.

`postgres-js` connects lazily, so routes that never query (e.g. `/health`, validation and
error-envelope checks) genuinely run without Docker. That laziness is the reason the
hermetic lane can test routes at all — it is not licence to let a DB-touching route in.

## What to test

Follow `TESTING.md`: behaviour at the seams — routes, adapters, contracts, the review
pipeline — one happy path plus the edge that actually matters. Line coverage is not a
goal, and a test that would not catch a class of regression we care about is not written.

Before declaring a subject done, run `corner-case-checklist` over it.

## Anti-patterns

- A `*.test.ts` that imports `helpers/pg.ts`, or an `*.it.test.ts` with no Docker guard.
- `setTimeout` instead of `waitForPrRuns` for background run completion.
- Raising `testTimeout` to make a flaky test pass.
- Real HTTP, a real key, or a real git clone in the hermetic lane.
- `app.listen()` in a test where `app.inject()` would do.
- Forgetting `await app.close()` / `fixture.stop()` — leaked handles hang the suite.
- Weakening an assertion to make the lane green.
- Running `pnpm test` (both lanes) in CI-shaped contexts where only one lane is intended.
