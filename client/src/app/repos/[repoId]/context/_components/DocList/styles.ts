import type { CSSProperties } from "react";

/* R38 (client/INSIGHTS.md:108): every flex/grid ancestor between a rendered
   repo-relative path and the card edge gets `minWidth: 0` — a flex/grid item
   otherwise defaults to `min-width: auto`, i.e. never narrower than the
   path's unbroken width. `word-break`/`overflowWrap` alone does not fix
   this; the ancestor chain does. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  row: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
    padding: "9px 14px",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    minWidth: 0,
  }),
  icon: (active: boolean): CSSProperties => ({
    flex: "0 0 auto",
    marginTop: 2,
    color: active ? "var(--accent)" : "var(--text-muted)",
  }),
  path: {
    display: "block",
    fontSize: 13,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
