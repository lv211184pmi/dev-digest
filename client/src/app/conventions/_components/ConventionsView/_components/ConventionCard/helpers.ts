/** Confidence → color tier, mirroring `@devdigest/ui`'s `ConfidenceNum`
 *  (`primitives/ConfidenceNum.tsx`) so a percentage reads the same color
 *  everywhere in the app. Used for BOTH the confidence bar fill and the
 *  card's left accent border, so they always agree. */
export function confidenceColor(pct: number): string {
  if (pct >= 85) return "var(--ok)";
  if (pct >= 65) return "var(--warn)";
  return "var(--text-muted)";
}
