# Insights — reviewer-core

Engine decisions and dead ends. Read before changing prompt assembly, structured
output, or grounding — the constraints here are deliberate.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. If it would be obvious to anyone reading the code, leave it out.

Formats — `Decisions` takes prose; every other section takes a dated bullet:

```markdown
### YYYY-MM-DD — <short title>

**What:** the decision, in one sentence.
**Why:** the constraint that forced it.
**Rejected:** what we tried or considered, and how it failed.
```

```markdown
- **YYYY-MM-DD** — <the claim, specific enough to act on cold>.
  `src/path/to/file.ts:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

### 2026-07-31 — Mechanical grounding gate, not a trusted model

**What:** every finding must cite a real line in the diff or it is dropped, and
the verdict score is recomputed from the surviving findings.
**Why:** the model reliably invents plausible line references, and a citation
check is verifiable where a self-reported confidence is not.
**Rejected:** trusting the model's own locations and score. Findings pointed at
lines that were not in the diff, and the score did not move when they were
removed.

## What Works

_None yet._

## What Doesn't Work

- **2026-08-23** — `wrapUntrusted()` fences document *text*, but an identifier
  interpolated **outside** the wrapper (e.g. a `### <path>` heading emitted next
  to `<untrusted>` on purpose, so a finding can cite the path) is not fenced by
  it and needs its own sanitization. A crafted filename containing a newline or
  `<`/`>` could otherwise break out of the heading. **Fixed in
  `reviewer-core/src/prompt.ts` via `sanitizeHeadingPath()`**, applied to the
  path before it is used both in the heading and in the `wrapUntrusted` source
  label. General rule: any untrusted-adjacent identifier placed outside an
  `<untrusted>…</untrusted>` block needs the same stripping treatment as the
  wrapped content, not just the content inside the wrapper. **Sharpened
  2026-08-24**: the first cut of `sanitizeHeadingPath()` stripped control
  characters and `<`/`>` but not `"` — since the sanitized path also lands
  inside a quoted attribute (`wrapUntrusted`'s `source="spec:${path}"`), a path
  containing `"` (a legal filename character) broke out of that attribute and
  injected a fake-looking `trusted="true"`-style attribute into the trusted
  opening tag, even though the tag itself couldn't be reopened/closed. **Fixed
  2026-08-24** by adding `"` to the stripped set. The sharper general rule: a
  sanitization allowlist must be checked against **every** syntactic context
  the sanitized value gets interpolated into (heading text *and* a quoted
  attribute here), not just the first/most obvious one — enumerate every call
  site before declaring a sanitizer complete.

## Codebase Patterns

_None yet._

## Tool & Library Notes

_None yet._

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
