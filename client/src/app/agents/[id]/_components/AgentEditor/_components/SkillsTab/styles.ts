import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)", marginBottom: 16 } satisfies CSSProperties,
  filterInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
    marginBottom: 12,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  handle: { display: "flex", color: "var(--text-muted)", cursor: "grab" } satisfies CSSProperties,
  name: { flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text-primary)" } satisfies CSSProperties,
  loading: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
