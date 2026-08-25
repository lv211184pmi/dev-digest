# server/specs

One file per server-side feature: `YYYY-MM-DD-feature-name.md`, the **Spec ID being the
filename stem**. Anything that also changes the UI, or that touches
`src/vendor/shared/**`, belongs in the root [`../../specs/`](../../specs/) instead — its
routing table is the authority.

Acceptance criteria are written in **EARS** grammar; the five patterns, the phrasing rules
and the banned words are in
[`../../.claude/agents/spec-creator.md`](../../.claude/agents/spec-creator.md), Step 3.

```markdown
# Spec: <Feature>

**Spec ID:** <YYYY-MM-DD-feature-name>
**Status:** draft | agreed | in progress | shipped
**Supersedes:** <path to the spec this replaces, or "—">

## Problem and user
## Goals / Non-goals
## User stories
## Routes                  <!-- method + path + which @devdigest/shared schema -->
## Schema changes          <!-- tables/columns; remember: db:generate, never hand-write -->
## Adapters needed         <!-- new port behind the DI container? -->
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance   <!-- where each input comes from, who owns it, when it goes stale -->
## Untrusted inputs        <!-- PR diffs, cloned repos, GitHub payloads, LLM output -->
## Open questions
```

`## Edge cases`, `## Untrusted inputs` and `## Open questions` are never omitted — write
"None" explicitly.

Most course lessons land as a new `src/modules/<name>/` plugin — say which module the spec
creates or extends.
