import type { CSSProperties } from "react";
import { CARD_GRID_COLS } from "./constants";

/** Co-located styles for ConventionsView — matches SkillsListView's page
 *  shell so /conventions reads as one system with the rest of Skills Lab. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  grid: { display: "grid", gridTemplateColumns: CARD_GRID_COLS, gap: 14, marginTop: 18 } satisfies CSSProperties,
  failedBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--danger)",
    background: "var(--bg-elevated)",
    color: "var(--danger)",
    fontSize: 13,
    marginTop: 18,
  } satisfies CSSProperties,
} as const;
