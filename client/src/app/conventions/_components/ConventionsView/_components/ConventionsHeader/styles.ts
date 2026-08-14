import type { CSSProperties } from "react";

export const s = {
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 6 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
} as const;
