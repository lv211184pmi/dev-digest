import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
    padding: "40px 12px",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  pathWrap: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  path: {
    display: "block",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,
  usedBy: {
    fontSize: 13,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  content: {
    minWidth: 0,
    overflowWrap: "anywhere",
    padding: "20px 24px 24px",
  } satisfies CSSProperties,
  truncatedNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
} as const;
