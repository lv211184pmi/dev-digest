import type { CSSProperties } from "react";

export const s = {
  // No `gap` here — FormField already gives itself a `marginBottom:20`
  // (vendor/ui/kit/FormField.tsx); stacking a flex gap on top of that was
  // the double-spacing bug. Horizontal padding matches Modal's own header
  // (`18px 24px`) / footer (`16px 24px`) padding so content lines up.
  body: { display: "flex", flexDirection: "column", padding: "20px 24px 8px" } satisfies CSSProperties,
  banner: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 20,
  } satisfies CSSProperties,
  row: { display: "flex", gap: 16 } satisfies CSSProperties,
  rowItem: { flex: 1 } satisfies CSSProperties,
  enabledLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } satisfies CSSProperties,
  enabledHint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  filenameBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  footerNote: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
