---
name: reviewer-core-engine
description: "The review engine in reviewer-core/ — pipeline order (assemblePrompt → injection guard → injected LLMProvider → structured output → grounding gate → Review), the purity rule that keeps it free of DB/GitHub/fs, untrusted-content wrapping, the mechanical citation gate and deterministic scoring, structured-output repair, and the map-reduce threshold. Use when touching prompt assembly, adding a prompt slot, changing grounding, structured parsing or the run orchestration. Does NOT cover the server's persistence and SSE around a run (see sse-streaming, onion-architecture) or contract shape (see zod)."
version: 1.0.0
metadata:
  tags: reviewer-core, llm, prompt, grounding, structured-output, engine, prompt-injection
---

# Reviewer Core Engine (`reviewer-core/`)

Pure review logic: **diff → prompt → LLM → grounded findings**. Background and the public
API list are in [`../../../reviewer-core/README.md`](../../../reviewer-core/README.md);
this skill is the rules you must not break while editing it.

## Scope guardrail

| Question | Skill |
|---|---|
| "How is a prompt assembled / a finding grounded / a run orchestrated?" | **reviewer-core-engine** (this skill) |
| "How does the server persist and stream a run?" | `sse-streaming`, `onion-architecture` |
| "What shape is `Review` / `Finding`?" | `zod` (contracts live in `@devdigest/shared`) |
| "How do I test the engine?" | `vitest-server-testing` is for `server/`; the engine's own suite is plain Vitest with a stubbed `LLMProvider` |

## The purity rule

The engine's **only** side effect is a call through the injected `LLMProvider`. No
database, no GitHub, no filesystem, no persistence, no memory retrieval. That is what
makes it mock-testable, and it is the property most easily lost by a convenience import.

- Never import from `server/`. The dependency runs one way: the server consumes the engine.
- Callers pass **resolved strings**, not identifiers — skill *bodies*, not slugs. If a
  step needs the engine to look something up, the lookup belongs in the caller.
- Consumed as TypeScript **source** through a path alias; the package never emits JS and
  `build` is a type-check. Package manager is **npm**, not pnpm.
- New exports go through `src/index.ts` — deep imports from consumers are not part of the
  contract.

## Pipeline order (do not reorder)

`assemblePrompt()` → `wrapUntrusted()` + `INJECTION_GUARD` → `LLMProvider` →
`parseWithRepair()` → `groundFindings()` → `Review`.

`review/run.ts` (`reviewPullRequest`) orchestrates it: single-pass by default, map-reduce
per file when the diff is large and multi-file (`strategy: 'auto'`, threshold
`DEFAULT_MAP_THRESHOLD_LINES = 400`), then reduce, then the **shared** grounding gate.

## Untrusted content

All external content — diff, PR body, code, skills, specs, repo map — is **data, never
instructions**.

- Every new external slot goes through `wrapUntrusted(label, content)`, which also
  neutralises attempts to close the delimiter.
- `INJECTION_GUARD` is appended to every agent's system prompt by `assemblePrompt`, so it
  covers every review path. **Harden there, not downstream** — pattern-matching untrusted
  text at a call site only ever catches one phrasing in one language.
- Untrusted text claiming the code is a fixture, demo, intentional or out of scope never
  waives a finding. If you add a slot that could carry such a claim, it changes nothing
  about severity — the guard already says so; do not add a competing rule.
- Cap author-controlled text (`MAX_PR_DESCRIPTION_CHARS = 4000`) so one huge body cannot
  eat the token budget.
- The assembly manifest (`PromptSectionMeta[]`) records section, source, trust and size —
  **deliberately not the content**. That omission is the safety property; do not "improve"
  the manifest by logging what a section said.

## The grounding gate

Mechanical, mandatory, and the reason the engine cannot hallucinate a location.

- A diff-finding survives only if `[start_line, end_line]` intersects a real **new-side**
  hunk line for the same file (`buildLineIndex`).
- Full-file kinds (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`) come from scanners
  that are not tied to a hunk — they require only that the file is present in the diff. A
  new scanner kind that is not hunk-anchored must be added to `FULL_FILE_KINDS`, or every
  one of its findings is silently dropped.
- Dropped findings are returned with reasons for the trace — keep them, they are what
  makes a drop debuggable.
- **The score is recomputed from the surviving findings** (`scoreFromFindings`), never
  taken from the model. Do not pass the model's score through.

## Structured output

`toJsonSchema` (Zod → draft-07 strict JSON Schema, reused for OpenAI `json_schema` and
Anthropic forced tool-use `input_schema`), `extractJson` (fence-stripping + balanced-brace
extraction), `parseWithRepair` (validate, and on failure return a reprompt instruction so
the caller can retry). Retries are bounded: `DEFAULT_REVIEW_MAX_RETRIES = 2`.

Widen the Zod contract in `@devdigest/shared` first when the model must return a new field
— the same schema drives the request schema and the parse.

## Anti-patterns

- Importing `server/`, a DB client, `node:fs`, or the GitHub SDK into the engine.
- Passing slugs/ids and having the engine resolve them.
- Adding a prompt section without `wrapUntrusted`, or with content in the manifest.
- Trusting the model's `score`, or skipping `groundFindings` "because the model was right".
- Adding a scanner kind without deciding its grounding mode.
- Unbounded reprompt loops instead of `DEFAULT_REVIEW_MAX_RETRIES`.
- Running `pnpm` in this package, or expecting `build` to emit JS.
