# client/specs

One file per UI feature: `YYYY-MM-DD-feature-name.md`, the **Spec ID being the filename
stem**. If it also needs a new endpoint, put the spec in the root
[`../../specs/`](../../specs/) so both sides stay in one document — its routing table is
the authority.

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
## Route(s)                <!-- src/app/**/page.tsx path -->
## Data                    <!-- which hook in src/lib/hooks, which endpoint -->
## States                  <!-- loading / empty / error / success -->
## Copy                    <!-- keys to add under messages/<locale>/ -->
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance   <!-- where each input comes from, who owns it, when it goes stale -->
## Untrusted inputs        <!-- PR diffs, cloned repos, GitHub payloads, LLM output -->
## Open questions
```

`## States` is not optional and not a formality: every one of loading / empty / error /
success needs defined copy and a defined next action. `## Edge cases`,
`## Untrusted inputs` and `## Open questions` are never omitted — write "None" explicitly.
