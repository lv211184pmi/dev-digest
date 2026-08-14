# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [engineering-insights](engineering-insights/SKILL.md) | Project | Read `<module>/INSIGHTS.md` before a task, record what was learned after |
| [pr-self-review](pr-self-review/SKILL.md) | Project | Meta-skill: routes the diff to the relevant skills above and blocks the PR workflow on any CRITICAL finding |
| [corner-case-checklist](corner-case-checklist/SKILL.md) | Project | Checks changed functions against empty/zero/negative/first-last/boundary corner cases |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Backend layering — domain/application/infrastructure rings, dependency direction, per-tool rules |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [ui-architecture](ui-architecture/SKILL.md) | Frontend | Where components/hooks/utils/constants live, feature colocation, barrel-file rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |

## Agents

Subagents live in `.claude/agents/` and are invoked via the Task tool. Full cards —
responsibilities, permissions, input/output artifacts and the sources each agent's rules
come from — are in [`../agents/README.md`](../agents/README.md).

| Agent | Model | Description |
|-------|-------|-------------|
| [researcher](../agents/researcher.md) | Sonnet | Read-only repo + web research; returns a structured report with conclusions, justifications, links and an explicit "could not find" list |
| [planner](../agents/planner.md) | Opus | Turns a request into a step-by-step plan file under `.claude/plans/`; binds the exact files to touch and the skills the implementer must load |
| [implementer](../agents/implementer.md) | Inherit | Executes an approved plan across backend and frontend, loads the plan's bound skills, edits only listed files, runs scoped typecheck + tests. Never commits, never reviews |
| [test-writer](../agents/test-writer.md) | Inherit | Writes and repairs tests in `client/` (Vitest + RTL) and `server/` (hermetic vs DB-backed lanes), following `TESTING.md`'s typological philosophy. Edits test files only — a needed source change is reported, not made |
| [plan-verifier](../agents/plan-verifier.md) | Sonnet | Audits an implemented change against one plan file, requirement by requirement, with `path:line` evidence and one of four verdicts per row. Refuses to run without a plan; never reviews quality |
| [architecture-reviewer](../agents/architecture-reviewer.md) | Opus | Boundary review only — backend rings in `server/`, placement in `client/` — returning severity-labelled findings with the rule each breaks. Read-only: describes a fix, never applies one |
| [document-writer](../agents/document-writer.md) | Inherit | Turns a change, plan or notes into docs that land in the right file (package README, `docs/`, `specs/`) per each directory's own rules, with Mermaid where it earns its place. Writes `*.md` only |

`planner` → `implementer` is a handoff pair: the plan file is the contract, since a
subagent inherits no conversation history. Plans live in `.claude/plans/` (gitignored). The
implementer **archives** the plan to `.claude/plans/archive/` with `Status: implemented` on
a fully green run, or keeps it in place as `Status: blocked` otherwise; `plan-verifier`
reads it from either location. `planner`, `implementer` and `architecture-reviewer` all
source their path→skill routing and per-package test commands from
[pr-self-review](pr-self-review/SKILL.md) Steps 2–4 rather than carrying their own copy.

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
