# reviewer-core/specs

One file per engine change: `YYYY-MM-DD-feature-name.md`, the **Spec ID being the filename
stem**. A change that also touches the API or the UI belongs in the root
[`../../specs/`](../../specs/) — its routing table is the authority.

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
## Prompt slots            <!-- new/changed section in assemblePrompt -->
## Public API              <!-- what src/index.ts starts exporting; who consumes it -->
## Grounding impact        <!-- does this change what survives the gate? -->
## Determinism             <!-- must stay reproducible under a stubbed LLMProvider -->
## Acceptance criteria (EARS)
## Edge cases
## Non-functional requirements
## Inputs and provenance   <!-- where each input comes from, who owns it, when it goes stale -->
## Untrusted inputs        <!-- the diff and the repo map are untrusted; so is LLM output -->
## Open questions
```

`## Edge cases`, `## Untrusted inputs` and `## Open questions` are never omitted — write
"None" explicitly.

Two constraints every spec here must respect: the package stays **pure** (no DB, GitHub,
or filesystem), and the **grounding gate keeps its veto**. A spec that needs either broken
belongs in [`../../server/specs/`](../../server/specs/) instead.
