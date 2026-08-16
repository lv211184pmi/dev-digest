import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard. Card chrome mirrors IntentCard so the
    two sit as a matched pair in the Overview's two-column top row. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    // Grid/flex items default to `min-width: auto`, i.e. never narrower than
    // their content's min-content size. A long unbroken path inside forces
    // that size up, which pushes this card past its grid track instead of
    // wrapping — this is what let text spill past the rounded border.
    minWidth: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  headerText: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Stat row + view toggle share one line; the toggle is pushed right. */
  statRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  statValue: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,

  /** Hand-rolled segmented control — there is no Segmented primitive in @devdigest/ui. */
  segmented: {
    marginLeft: "auto",
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  segment: (on: boolean): CSSProperties => ({
    padding: "3px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    border: "none",
    cursor: "pointer",
    background: on ? "var(--bg-hover)" : "transparent",
    color: on ? "var(--text-primary)" : "var(--text-muted)",
    fontWeight: on ? 600 : 400,
  }),

  notice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  // `overflow-wrap: anywhere` (not `break-word`) deliberately — `anywhere`
  // is the one that also shrinks min-content sizing, so a long unbroken path
  // inside `index.explanation` can't force this flex item wider than its
  // track. `break-word` only breaks at layout time and would still overflow.
  noticeBody: { flex: "1 1 220px", minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  /** One file per line rather than a single comma-joined run-on paragraph —
   *  the join produced arbitrary mid-word line breaks on long paths and read
   *  as broken/overlapping text. Capped the same way callers are: see
   *  VISIBLE_NOT_COVERED. */
  notCovered: {
    marginTop: 6,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  notCoveredFile: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

  summary: {
    fontSize: 13.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  summaryRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,

  symbolRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 8px",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    flexShrink: 0,
    // Accent, not muted — the disclosure caret is the one interactive
    // affordance in the row and reads as inert next to the equally-muted
    // <> icon otherwise. Matches the design reference.
    color: "var(--accent)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform 120ms ease",
  }),
  symbolName: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  symbolCount: {
    marginLeft: "auto",
    fontSize: 11.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  /** Indented body under an expanded symbol. */
  branch: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "2px 0 10px 22px",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: 12.5,
  } satisfies CSSProperties,
  branchGlyph: {
    flexShrink: 0,
    color: "var(--text-muted)",
    fontSize: 11,
  } satisfies CSSProperties,
  /** Wraps every `PathLink` inside a flex row. Flex items default to
   *  `min-width: auto`, so a `path:line` with no spaces — the common case —
   *  never shrinks and overflows the row instead of wrapping. */
  pathWrap: { minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  } satisfies CSSProperties,
  moreCallers: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    paddingLeft: 17,
  } satisfies CSSProperties,

  graphBox: {
    overflowX: "auto",
    padding: "4px 0",
  } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
