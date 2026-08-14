import type { CSSProperties } from "react";

export const s = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 4px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  count: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
} as const;
