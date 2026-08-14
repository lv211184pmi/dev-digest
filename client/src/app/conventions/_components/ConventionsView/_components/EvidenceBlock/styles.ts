import type { CSSProperties } from "react";

export const s = {
  block: {
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  path: { fontSize: 12, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
  pre: {
    margin: 0,
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    overflowX: "auto",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
