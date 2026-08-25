import type { CSSProperties } from "react";

/* R38 (client/INSIGHTS.md:108): every flex/grid ancestor between a rendered
   repo-relative path and the card edge gets `minWidth: 0` — a flex item
   otherwise defaults to `min-width: auto`, i.e. never narrower than the
   path's unbroken width. `overflowWrap: "anywhere"` alone does not fix this;
   the ancestor chain does. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 760,
    minWidth: 0,
  } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,
  heading: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  counter: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  tokenTotal: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  filterRow: { display: "flex", minWidth: 0 } satisfies CSSProperties,
  filterInput: {
    width: "100%",
    fontSize: 13,
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  /* Wraps <Checkbox label={...}> so its internal <label> (which the vendored
     Checkbox does not expose a style prop for) still grows to fill the row
     (C3 remediation — the label itself carries no flex, so the growth has
     to come from this wrapper). */
  checkboxWrap: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  /* The Checkbox's `label`: a visually-hidden full-path span carries the
     accessible name (R22), and the two `aria-hidden` siblings carry the
     sighted, filename-first/directory-second presentation (R6) — excluded
     from the accessible-name computation so the two never concatenate. */
  rowMain: { display: "flex", alignItems: "baseline", gap: 6, flex: 1, minWidth: 0 } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
  fileName: {
    fontSize: 13,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
  dirName: {
    fontSize: 12,
    color: "var(--text-muted)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
  noMatches: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" } satisfies CSSProperties,
  handle: {
    display: "flex",
    color: "var(--text-muted)",
    cursor: "grab",
    flexShrink: 0,
  } satisfies CSSProperties,
  handleDisabled: { cursor: "not-allowed", opacity: 0.5 } satisfies CSSProperties,
  serializesAs: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  serializesLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  serializesBlock: {
    margin: 0,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
  caption: {
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footer: {
    position: "sticky",
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  drawerTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  drawerPath: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
  drawerUsedBy: {
    fontSize: 12,
    fontWeight: 400,
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  drawerMeta: {
    display: "flex",
    gap: 16,
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 12,
  } satisfies CSSProperties,
  drawerTruncated: {
    fontSize: 12,
    color: "var(--warn)",
    marginBottom: 10,
  } satisfies CSSProperties,
} as const;
