---
name: e2e-flows
description: "Browser end-to-end flows in e2e/ — the specs/NN-name.flow.json format, {BASE} substitution, why wait --url / wait --text ARE the assertions, the deterministic-locators-only rule (never the AI chat command), the seeded read-only data the flows target, and the hermetic runner that must be used instead of your dev DB. Use when adding, repairing or debugging a browser flow. Does NOT cover component tests (see react-testing-library) or server tests (see vitest-server-testing)."
version: 1.0.0
metadata:
  tags: e2e, browser, agent-browser, testing, deterministic, flows
---

# E2E Flows (`e2e/`)

Deterministic UI flows driven by Vercel **agent-browser** (a CDP automation CLI, not a
test framework). **No Playwright, no LLM, no API key.** Background and the flow catalogue
are in [`../../../e2e/README.md`](../../../e2e/README.md).

## Scope guardrail

| Question | Skill |
|---|---|
| "How do I add or fix a browser flow?" | **e2e-flows** (this skill) |
| "How do I test a component in isolation?" | `react-testing-library` |
| "How do I test a route or the DB?" | `vitest-server-testing` |
| "Is the UI code itself right?" | `react-best-practices`, `ui-architecture` |

## A flow is JSON, not code

`e2e/specs/NN-name.flow.json`:

```jsonc
{
  "name": "App boots and lands on the seeded repo's PR list",
  "steps": [
    { "cmd": ["open", "{BASE}/"],         "label": "load the app root" },
    { "cmd": ["wait", "--url", "/pulls"], "label": "root redirects to PRs" },
    { "cmd": ["wait", "--text", "#482"],  "label": "seeded PR row visible" }
  ]
}
```

- `{BASE}` → `E2E_BASE_URL` (default `http://localhost:3000`).
- Each `cmd` is passed **verbatim** to `agent-browser`; commands share one browser session.
- **The waits are the assertions.** `wait --text` / `wait --url` exit non-zero when the
  condition never holds, which fails the step and the flow. You do not need — and should
  not add — a separate assertion step to check what a wait already proved.
- `"assert": { "stdoutIncludes": "…" }` is the only extra check: a substring match on the
  command's stdout.
- Flows run in **lexical filename order**; `NN` is that order. Give a new flow the next
  free number and add its row to the coverage table in `e2e/README.md`.

## Determinism is the constraint

- **Locators: `--url`, `--text`, `find role|text|label` only.** Never the AI `chat`
  command — it needs a key and makes runs non-reproducible. No CSS or XPath selectors.
- **Flows target read-only seeded data**: the demo repo `acme/payments-api`, PR `#482`, the
  seeded agents and their seeded run/verdict/findings. Nothing a flow does may trigger a
  model call.
- Never assert on LLM-generated prose — it is not stable. Assert on seeded values and on
  chrome the app renders deterministically.
- A flow must not create, mutate or delete data; the next flow assumes the seeded state.

## Running it — use the hermetic runner

```sh
npm i -g agent-browser && agent-browser install   # once
cd e2e && npm run e2e:hermetic                    # or ./scripts/e2e.sh
```

The hermetic runner boots an isolated, freshly-seeded stack on alternate ports (Postgres
`5433`, API `3101`, web `3100`) and tears it down, leaving your dev DB untouched.

**Running against your own dev stack usually fails flows 02/04/05**, and not because they
are broken: flow `02` follows the home redirect to the *first* repo, so it assumes the
seeded demo repo is the only one. Your dev DB normally has other imported repos.

> ⚠️ **Never `docker compose down -v`** to "reset" the dev DB — `-v` deletes the
> `devdigest_pgdata` volume with every imported repo and review in it. The hermetic runner
> exists so you never need to.

Package manager is **npm** here, not pnpm. Env knobs: `E2E_BASE_URL`,
`AGENT_BROWSER_BIN`, `E2E_STEP_TIMEOUT` (ms, default 60000). Failure screenshots land in
`e2e/test-results/` (git-ignored, uploaded as a CI artifact).

## Debugging a red flow

1. Read the failing step's `label` and the screenshot in `e2e/test-results/`.
2. Confirm the precondition: is this a hermetic run, or a dev DB with extra repos?
3. Re-run just that flow's commands against a live stack to see the real page state.
4. Only then change the spec — a flow that fails because the seed changed is a seed
   question, not a locator question.

## Anti-patterns

- Playwright/Puppeteer APIs, or any test-framework syntax — flows are JSON.
- The AI `chat` command, or a locator that depends on styling or DOM structure.
- Asserting on model output, timestamps, or anything else not seeded.
- A flow that writes data, or that depends on a previous flow's writes.
- Bumping `E2E_STEP_TIMEOUT` to hide a genuinely missing element.
- Running against the dev DB and then "fixing" flows 02/04/05 to match it.
- `docker compose down -v`.
