# Insights — client

UI decisions and dead ends. Read before restructuring pages, state, or the data
layer.

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
  `src/path/to/file.tsx:42`
```

Roughly 5 entries per section. Promote stable entries into `docs/` and delete
them here.

---

## Decisions

### 2026-08-03 — Zero-consumer components: judge by what they are, not just the call count

**What:** during the ui-architecture refactor, two zero-consumer components
were found (`components/page-shell`'s `FeaturePlaceholder` and
`components/mermaid-diagram`). Both were kept rather than deleted, but for
different reasons discovered by reading each file, not by the caller count
alone: `FeaturePlaceholder`'s own header comment called itself temporary
scaffolding ("Feature agents (A1–A6) replace `FeaturePlaceholder` with their
real screen"), while `MermaidDiagram` is a fully-built component backed by a
real `mermaid` package dependency (syntax validation, lazy import, SVG
render) — no stub markers, no TODO, just unwired.
**Why:** "zero callers" alone doesn't distinguish leftover scaffolding from
real work that hasn't been connected yet. The file's own content (a comment
admitting temporariness vs. a genuine implementation with a real dependency)
is the signal that matters, and only the human who owns the roadmap can say
whether unwired-but-real functionality should stay.
**Rejected:** deleting both as "dead code" on caller count alone — would have
destroyed the `mermaid` rendering work with no way to tell later whether it
was intentional.

## What Works

- **2026-08-10** — building `SmartDiffViewer`'s `SmartFileCard`/`SmartCodeLine`
  as two new ~60-line components sharing `diff-viewer`'s `styles.ts` was
  cheaper than reusing `FileCard`/`CodeLine`. Those two are tightly coupled to
  the inline-comments API (thread partitioning, hover/composer state); adding
  optional `findingsByLine`/`target`/`forceOpen` props for one caller would
  have dragged the comment path into re-renders it doesn't need. Reuse the
  presentation (`parsePatch`, `Line`, `chevronFor`/`lineRowFor`/`lineSignFor`,
  the shared `diffStyles`) via a widened barrel; write new components when the
  interaction model actually differs.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffViewer/_components/SmartFileCard/SmartFileCard.tsx`

## What Doesn't Work

- **2026-08-12** — Do not seed a deep-link "target" (which item to
  open/focus/scroll to) with a lazy `useState(() => …)` initializer and call
  it done — `FindingsPanel`'s `focusIdx`/`showOutOfScope` were seeded this way
  from `targetFindingId` on the assumption that `{tab === "x" && <XTab
.../>}` (`page.tsx:144-181`) always remounts the receiver fresh when a new
  target arrives, since Files changed and Agent runs are mutually-exclusive
  tabs. False in the common case: `ReviewRunAccordion` only remounts
  `FindingsPanel` the FIRST time a run opens; the newest run is
  `defaultOpen` and stays mounted, so a target that resolves to an
  already-open run (the usual case — most clicks land on the latest review)
  never re-triggers the initializer, and every subsequent click silently
  lands on whatever `focusIdx` was on the first render (index 0, i.e. always
  the first/most-severe finding, not the one clicked). Symptom as reported by
  the user: "click the warning badge, it opens the critical one instead — same
  for any other click." **Fixed 2026-08-12**: turned the seed into a
  live-syncing `useEffect` keyed on `[targetFindingId, targetFindingNonce]`
  (nonce bumps on every click, even re-clicking the same id), plus a new
  `expandNonce`/`shouldExpand` pair on `FindingCard` since `defaultExpanded`
  is _also_ mount-only and can't re-open an already-mounted, already-collapsed
  card either. Lesson: before relying on a "this receiver always remounts"
  assumption, verify EVERY ancestor between the state owner and the receiver
  actually unmounts on every target change — one `defaultOpen`/
  conditionally-stable ancestor in the middle breaks it.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:58`
  `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:50`

- **2026-08-12** — A "force this one open" signal must be sent to EVERY
  sibling, not just the target, or previously-opened siblings never close.
  First pass at the finding-targeting fix above passed `FindingCard` an
  `expandSignal` prop that was only non-zero for the matching card — this
  expanded the right card but left any already-expanded OTHER card (the
  default-first one, or one the user had manually opened) stuck open, so a
  click could end with two cards expanded at once. Fix: pass the SAME nonce
  to every card in the list plus a per-card `shouldExpand: f.id ===
targetFindingId` boolean, and have the effect do `setExpanded(!!shouldExpand)`
  (not `setExpanded(true)`) on every bump — every non-target card explicitly
  collapses on the same tick the target expands.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:52`

## Codebase Patterns

- **2026-08-25** — The vendored `Checkbox` (`src/vendor/ui/kit/Checkbox.tsx`)
  derives its accessible name from its native `<label>`'s rendered text
  content, in DOM order — it exposes no separate `aria-label`/`name` prop.
  Splitting a row's *visible* label (filename-first, directory-second, per
  R6) from its *accessible* name (the full repo-relative path, per R22)
  needs a visually-hidden span carrying the full path placed first in the
  label, with the sighted filename/dir spans marked `aria-hidden` so they
  don't concatenate into the computed name. Get the ordering wrong (hidden
  span not first, or missing `aria-hidden` on the sighted siblings) and the
  accessible name silently becomes the visible DOM order instead of the
  full path — no type error, no visible symptom, only a screen-reader/
  testing-library query mismatch.
  `client/src/components/context-tab/ContextTab.tsx:154-166`
- **2026-08-24** — A new App Router page is unreachable from the UI until it
  gets an entry in `NAV` (`src/vendor/ui/nav.ts`) — the single registry behind
  three consumers: the sidebar (`vendor/ui/shell/Sidebar.tsx:45`), the ⌘K
  palette (`components/app-shell/hooks/useShellCommands.ts:21`) and the
  `g`-then-key shortcuts (`components/app-shell/hooks/useGlobalShortcuts.ts:45`).
  The Project Context page shipped complete but invisible: the route, `GET
  /repos/:id/project-context`, an `activeKeyFor()` branch already returning
  `"context"` (`components/app-shell/helpers.ts:30`) and `nav.context` /
  `nav.onboarding-tour` keys already in `messages/en/shell.json` were all in
  place — only the `NAV` item was missing, so nothing anywhere linked to
  `/repos/:repoId/context`. When adding a route, check all five. Note the
  palette resolves its label via ``t(`nav.${it.key}`)`` while `NavItem` renders
  the hardcoded `item.label` (`vendor/ui/shell/NavItem.tsx:38`) — set both, and
  keep them identical. `nav.ts` is the standing exception to "`src/vendor/ui`
  is off-limits" (see the 2026-08-01 entry below): it is our own route
  registry, not vendored third-party code, and commit `6ed1c96` already edited
  it to add the Skills item.
  `client/src/vendor/ui/nav.ts:21`

- **2026-08-16** — Never render an unbounded list of repo-relative paths as one
  `array.join(", ")` string inside a wrapping block, AND that alone does not
  fix path overflow inside a flex/grid layout — both were needed for
  `BlastRadiusCard`. First pass: switched `index.files_not_covered` from
  `array.join(", ")` + `wordBreak: "break-all"` (which split paths mid-segment,
  `client/messages/en/age` / `nts.json`, with no visual continuation cue) to
  one `PathLink` per line, matching `SymbolNode`'s existing caller-list pattern
  (`VISIBLE_CALLERS`/`VISIBLE_NOT_COVERED`, "+N more"). **Still overflowed the
  card in a live screenshot** — the real cause is that flex/grid _items_
  default to `min-width: auto`, i.e. never narrower than their content's
  min-content size, and a path with no spaces has a min-content size equal to
  its full unbroken width. `word-break: break-word` does not change
  min-content sizing (CSS Text spec: only a last-resort break at layout time),
  so the item — and the card itself, also a grid item in `OverviewTab`'s
  `minmax(0, 1fr)` grid — still got pushed wider than its track and the text
  visibly spilled past the rounded border. **Fix:** `overflow-wrap: anywhere`
  (not `break-word`) on every text container that can hold a raw path
  (`noticeBody`, `notCoveredFile`, the new `pathWrap` around every `PathLink`
  in a flex row) plus explicit `minWidth: 0` on each flex/grid item in the
  chain, including `s.card` itself. `anywhere` is the one value that also
  shrinks min-content, which is what actually stops the push-wide.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/styles.ts:6`
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx:43`

- **2026-08-12** — `FindingCard`'s `data-finding-id={f.id}` attribute and its
  `focused` prop were already wired in before any caller used them for
  cross-component targeting — `FindingsPanel` only ever set `focused={i ===
focusIdx}` with `focusIdx` defaulting to `0`, and nothing read
  `data-finding-id`. Implementing "Files changed → Agent runs" (jump to one
  finding's card from its Smart Diff line) needed exactly this: scope a
  `querySelectorAll('[data-finding-id]')` to the panel root, match on
  `dataset.findingId`, and seed `focusIdx`/`defaultExpanded` from a
  `targetFindingId` prop via a lazy `useState` initializer. Before adding a new
  marker or boolean prop for a "find/highlight one item" need, grep the target
  component for unused `data-*` attributes first.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:55`
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:58`

- **2026-08-03** — A single-line component barrel (`export { X } from "./X"`)
  is the repo's real convention at every nesting depth, not just at a feature
  root. `components/diff-viewer/` alone has 7 of them
  (`CodeLine/index.ts`, `FileCard/index.ts`, etc.), and ~20 more exist under
  `app/**/_components/<Name>/index.ts`. The anti-pattern to actually avoid is an
  `export *` hub (`components/index.ts` re-exporting every feature, or
  `lib/hooks/index.ts` doing `export * from "./reviews"` across 5 sibling
  files, which resolves any name collision silently by file order) — not a
  nested `index.ts` per se. Judge a barrel by whether it re-exports everything
  in its directory (`export *`) vs. one named thing from one sibling file.
  `client/src/components/diff-viewer/CodeLine/index.ts`
  `client/src/lib/hooks/index.ts`

- **2026-08-01** — Any overlay anchored to a PR-list row must be portalled to
  `document.body` with `position: fixed`, not absolutely positioned inside the
  row. `s.tableCard` sets `overflow: "hidden"` (it is what keeps the first/last
  row inside the card's rounded corners), so an absolute panel is clipped at the
  card edge — invisibly fine for the top rows and broken for every row near the
  bottom, which is the majority. `SeverityCounters` anchors via
  `getBoundingClientRect()`, flips above the trigger when the panel would run
  past `window.innerHeight`, and repositions on `scroll`/`resize` (capture
  phase) rather than closing, so a row scrolling under the cursor does not read
  as a dismissal. Note this makes "outside click" span two disjoint nodes — the
  dismiss handler must check the trigger wrapper **and** the portalled panel.
  There is still no `Popover` primitive; `src/vendor/ui` is off-limits, so
  app-level overlays copy the outside-click shape from
  `src/vendor/ui/kit/Dropdown.tsx:60`.
  `client/src/components/severity-counters/SeverityCounters.tsx:104`
  `client/src/app/repos/[repoId]/pulls/styles.ts:91`

## Tool & Library Notes

- **2026-08-16** — Mermaid's `click <id> href "<url>" <target>` line only opens
  a real anchor with `target="<target>"` when `<target>` is a **bare, unquoted**
  token (`_blank`, `_self`, …). Quoting it (`click n0 href "url" "_blank"`)
  parses without error and still emits `<a href="url">` — but mermaid reads the
  quoted string as a tooltip argument, silently drops it, and the link opens in
  the _same_ tab. Verified empirically against the installed `mermaid` package
  by patching `flowDiagram-*.mjs`'s `setLink` to log its `target` arg: only the
  unquoted-target form populates it. This works fine under
  `securityLevel: "strict"` too — that setting only gates `click <id>
call fn()` JS callbacks (`setClickFun` no-ops unless `securityLevel ===
"loose"`); the `href` form's `setLink` has no such gate, so adding
  click-to-GitHub links to a diagram never requires loosening security level.
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/graph.ts:104`

- **2026-08-10** — `@testing-library/user-event` is not a `client/`
  dependency. Every interaction test in this package, including new
  `SmartDiffViewer.test.tsx`/`DiffTab.test.tsx`, uses `fireEvent` from
  `@testing-library/react` (see `RunHistory.test.tsx` for the prior
  precedent). Reaching for `userEvent` fails module resolution — add the
  dependency first, or use `fireEvent`.

## Recurring Errors & Fixes

- **2026-08-01** — `TS7053: … expression of type 'Severity' can't be used to
index type '{ CRITICAL: number; WARNING: number; SUGGESTION: number; }'.
Property 'INFO' does not exist` means `Severity` was imported from
  `@devdigest/ui` when it should have come from `@devdigest/shared`. The two are
  different types with the same name: the UI token map carries a fourth `INFO`
  entry (`src/vendor/ui/primitives/tokens.ts:5`) that the Zod enum
  (`contracts/findings.ts:11`) does not define and the API never emits. Import
  the contract type for anything that indexes, tallies, or round-trips a
  severity; the UI type is a superset, so a contract value still passes straight
  into `<SeverityBadge severity={…} />` with no cast. Existing call sites that
  do `f.severity as Severity` are papering over exactly this.
  `client/src/components/severity-counters/SeverityCounters.tsx:9`

- **2026-08-01** — A vitest failure whose two sides look identical —
  `expected '9 119 tok' to be '9 119 tok'` — is a look-alike Unicode space, not
  an environment difference. `formatTokenCount` had a literal THIN SPACE
  (U+2009) typed into `.replace(/,/g, " ")`, invisible in the diff and in the
  test output. Dump code points first —
  `[...s].map((c) => c.charCodeAt(0).toString(16))` — before theorising about
  ICU or jsdom locale data, which is where this was initially misdiagnosed.
  Group digits with `.replace(/\B(?=(\d{3})+(?!\d))/g, " ")` rather than
  `toLocaleString` plus a separator swap, so the separator is a plain U+0020 a
  test can type. Find strays with `rg '\x{2009}' src/`.
  `client/src/lib/format.ts:40`

## Open Questions

_None yet._
