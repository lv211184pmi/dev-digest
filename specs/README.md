# specs/ — cross-package

Forward-looking specs for work that **spans more than one package**. Work that lives
inside a single package goes in that package's `specs/` instead.

A spec describes **what to build and why it is done** — not how the code works today
(that is `docs/`) and not what we already rejected (that is `INSIGHTS.md`).

One file per feature: `YYYY-MM-DD-feature-name.md`. The **Spec ID is the filename stem**.
The older `NN-feature-name.md` files keep their names; only new specs use the date form.

## Index

| Spec | Status | Packages touched |
|---|---|---|
| [`01-findings-severity-counters.md`](01-findings-severity-counters.md) | shipped | server, client |
| [`02-conventions-extractor.md`](02-conventions-extractor.md) | agreed | server, client |
| [`02-intent-layer.md`](02-intent-layer.md) | agreed | server, client, reviewer-core, shared |
| [`03-devdigest-mcp.md`](03-devdigest-mcp.md) | in progress | mcp, server |
| [`04-blast-radius.md`](04-blast-radius.md) | shipped | server, client, mcp, shared |
| [`2026-08-23-project-context.md`](2026-08-23-project-context.md) | shipped (v1 + revision 2 + revision 3) | server, client, reviewer-core, shared |

## Which directory a spec belongs in

| The feature touches | Spec goes to |
|---|---|
| `server/**` only | [`../server/specs/`](../server/specs/) |
| `client/**` only | [`../client/specs/`](../client/specs/) |
| `reviewer-core/**` only | [`../reviewer-core/specs/`](../reviewer-core/specs/) |
| `e2e/**` | **here** — [`../e2e/specs/`](../e2e/specs/) is reserved for runnable `.flow.json` |
| `mcp/**` | **here** — there is no `mcp/specs/`; precedent [`03-devdigest-mcp.md`](03-devdigest-mcp.md) |
| `server/src/vendor/shared/**` | **here** — that is `@devdigest/shared`; a contract change reaches every package and is never module-local |
| **≥2 packages** | **here** |

`**Packages touched:**` is the visible test of whether a spec belongs in this directory:
**one package listed means it is in the wrong directory.**

## Shape

Acceptance criteria are written in **EARS** grammar — the five patterns, the phrasing
rules and the banned words are in
[`../.claude/agents/spec-creator.md`](../.claude/agents/spec-creator.md), Step 3.

```markdown
# Spec: <Feature>

**Spec ID:** <YYYY-MM-DD-feature-name>
**Status:** draft | agreed | in progress | shipped
**Supersedes:** <path to the spec this replaces, or "—">
**Packages touched:** server, client

## Problem and user
## Goals / Non-goals
## User stories
## Contract changes        <!-- @devdigest/shared first, always -->
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance   <!-- where each input comes from, who owns it, when it goes stale -->
## Untrusted inputs        <!-- PR diffs, cloned repos, GitHub payloads, LLM output -->
## Open questions
```

`## Edge cases`, `## Untrusted inputs` and `## Open questions` are never omitted — write
"None" explicitly. A spec with zero EARS criteria is not a spec.

Once shipped, either delete the spec or set `Status: shipped` and move any durable
explanation into `docs/`. Stale specs are worse than missing ones — an agent reads them as
current intent.
