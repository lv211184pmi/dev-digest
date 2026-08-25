import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    minWidth: 0,
  } satisfies CSSProperties,
  pageHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  truncatedNotice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 8,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    fontSize: 13,
  } satisfies CSSProperties,
  resyncRow: {
    display: "flex",
    justifyContent: "center",
    marginTop: 4,
  } satisfies CSSProperties,
  // R38: `body` is a flex ancestor of the path text rendered inside DocList /
  // DocPreview — `minWidth: 0` here (and on every ancestor down to the path
  // element itself) is load-bearing, not decorative (client/INSIGHTS.md:108).
  body: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    minWidth: 0,
  } satisfies CSSProperties,
  // The list is a fixed-width column — a touch wider than the app's own nav
  // sidebar — so the document being read gets everything that's left.
  docListCol: { flex: "0 0 300px", minWidth: 0 } satisfies CSSProperties,
  previewCol: { flex: "1 1 0%", minWidth: 0 } satisfies CSSProperties,
  noSelection: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    gap: 14,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
