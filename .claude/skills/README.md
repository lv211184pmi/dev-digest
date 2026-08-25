# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Bindable? | Description |
|-------|-------|-----------|-------------|
| [engineering-insights](engineering-insights/SKILL.md) | Project | no | Read `<module>/INSIGHTS.md` before a task, record what was learned after |
| [pr-self-review](pr-self-review/SKILL.md) | Project | no | Meta-skill: routes the diff to the relevant skills below and blocks the PR workflow on any CRITICAL finding |
| [corner-case-checklist](corner-case-checklist/SKILL.md) | Project | **standing** | Checks changed functions against empty/zero/negative/first-last/boundary corner cases. Bound on every step that adds or changes behaviour |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | yes | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | yes | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | yes | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | yes | Backend layering — domain/application/infrastructure rings, dependency direction, per-tool rules |
| [vitest-server-testing](vitest-server-testing/SKILL.md) | Backend (testing) | yes | `server/` test lanes: hermetic `*.test.ts` vs DB-backed `*.it.test.ts`, testcontainers fixture, Docker skip guard, `app.inject()`, mock adapters |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | yes | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | yes | React anti-patterns, state management, hooks rules |
| [ui-architecture](ui-architecture/SKILL.md) | Frontend | yes | Where components/hooks/utils/constants live, feature colocation, barrel-file rules |
| [react-query-patterns](react-query-patterns/SKILL.md) | Frontend | yes | TanStack Query hooks in `client/src/lib/hooks/`: key shape, what a mutation must invalidate, the global error-toast contract |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend (testing) | yes | General-purpose React Testing Library guide with Vitest |
| [reviewer-core-engine](reviewer-core-engine/SKILL.md) | reviewer-core | yes | The engine: pipeline order, purity rule, untrusted-content wrapping, the citation grounding gate, structured-output repair |
| [sse-streaming](sse-streaming/SKILL.md) | Full-stack | yes | Run events: the replay-first `RunBus`, the SSE route, the `EventSource` consumer, and the order for adding an event kind |
| [e2e-flows](e2e-flows/SKILL.md) | e2e | yes | `specs/*.flow.json` format, deterministic locators only, seeded read-only data, the hermetic runner |
| [zod](zod/SKILL.md) | Full-stack | yes | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | yes | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | yes | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | no | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) — a documentation skill, owned by `document-writer` |

**Bindable?** is the single source of truth for whether a skill may be matched by
[pr-self-review](pr-self-review/SKILL.md) Step 3 and bound into an `implementation-planner`
plan's **Skills contract**. `no` means the skill is process or documentation machinery, not
construction guidance — binding it produces findings or prose where code was asked for.
`standing` means it is bound by *behaviour changed*, not by path.

## Agents

Subagents live in `.claude/agents/` and are invoked via the Task tool. Full cards —
responsibilities, permissions, input/output artifacts and the sources each agent's rules
come from — are in [`../agents/README.md`](../agents/README.md).

| Agent | Model | Description |
|-------|-------|-------------|
| [researcher](../agents/researcher.md) | Sonnet | Read-only repo + web research; returns a structured report with conclusions, justifications, links and an explicit "could not find" list |
| [spec-creator](../agents/spec-creator.md) | Opus | Writes one EARS specification into the right `specs/` directory, after a design-analysis pass that names the gaps, uncovered corner cases, cross-module contracts and undefined UX states. Writes intent only — `specs/` is the sole directory it can write to |
| [implementation-planner](../agents/implementation-planner.md) | Opus | Analyses the requirements (flagging what is unclear and how to improve it), then turns them into a step-by-step plan file under `.claude/plans/`; binds the exact files to touch and the skills the implementer must load, and asks whether execution runs multi-agent or single-agent. Never authors a spec |
| [implementer](../agents/implementer.md) | Inherit | Executes an approved plan across backend and frontend, loads the plan's bound skills, edits only listed files, runs scoped typecheck + tests. Self-checks scope, `Done when`, constraints — but produces no traceability table or AC verdicts; that audit is `plan-verifier`'s. Never commits, never reviews |
| [test-writer](../agents/test-writer.md) | Inherit | **Not in the default chain — invoked by hand.** Writes and repairs tests in `client/` (Vitest + RTL) and `server/` (hermetic vs DB-backed lanes), following `TESTING.md`'s typological philosophy. Edits test files only — a needed source change is reported, not made |
| [plan-verifier](../agents/plan-verifier.md) | Sonnet | **The chain's gate, run immediately after `implementer`.** Audits an implemented change against one plan file, requirement by requirement, with `path:line` evidence and one of four verdicts per row. On a gap it emits a remediation directive that routes back into `implementer`. Refuses to run without a plan; never reviews quality |
| [architecture-reviewer](../agents/architecture-reviewer.md) | Sonnet | Boundary review only — backend rings in `server/`, placement in `client/`, purity and the grounding-gate veto in `reviewer-core/` — returning severity-labelled findings with the rule each breaks. Read-only: describes a fix, never applies one |
| [document-writer](../agents/document-writer.md) | Inherit | Turns a change, plan or notes into docs that land in the right file (package README, `docs/`, `specs/`) per each directory's own rules, with Mermaid where it earns its place. Writes `*.md` only |

`implementation-planner` → `implementer` is a handoff pair: the plan file is the contract, since a
subagent inherits no conversation history. Plans live in `.claude/plans/` (gitignored). The
implementer **archives** the plan to `.claude/plans/archive/` with `Status: implemented` on
a fully green run, or keeps it in place as `Status: blocked` otherwise; `plan-verifier`
reads it from either location, and on a gap emits a directive that moves it back and appends
a `## Remediation` section the implementer will scope its next run to.
`implementation-planner`, `implementer`, `test-writer`, `plan-verifier` and
`architecture-reviewer` all source their path→skill routing and per-package test commands
from [pr-self-review](pr-self-review/SKILL.md) Steps 2–4 rather than carrying their own copy
— **Step 4 in particular is the single source of truth for verification commands**, and it
carries the `server/` lane split, the `--reporter=dot` rule and the rule that a skipped
suite is not a passing suite.

## Commands

| Command | What |
|---|---|
| [`/implement`](../commands/implement.md) | Drives the **construction half** of the chain, from an approved plan file onward: `implementer` → `plan-verifier` (gate) → `architecture-reviewer` → `pr-self-review` (gate) → `document-writer`. Tests come from the plan's own steps, not from `test-writer`. Detects the phase from the plan files and the tree, and applies remediation directives from `plan-verifier` and `architecture-reviewer` (capped at two cycles per reviewer). Takes `--spec`, `--design <screenshots/mockups>` and free-text notes, and writes them into the plan's `## Run inputs` section — supporting material only; free text that would change scope is refused and routed back to `implementation-planner`. `/implement status` reports position without running anything. **`spec-creator` and `implementation-planner` are run by hand, before it** — each ends in a decision the caller has to make |

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
