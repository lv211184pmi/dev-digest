import type { CSSProperties } from "react";
import { SEV } from "@devdigest/ui";
import type { Severity } from "@devdigest/shared";

/** Co-located styles for SmartDiffViewer. Diff-line/file-card primitives
    (`fileCard`, `fileHeader`, `filePath`, `fileStat`, `addText`, `delText`,
    `fileBody`, `hunk`, `lineNo`, `lineText`) come from the widened
    `@/components/diff-viewer` barrel so Smart and Original order render
    identically; only Smart-Diff-specific pieces live here. */
export const s = {
  viewer: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  header: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  headerText: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statsText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,

  splitBanner: {
    border: "1px solid var(--warn)",
    borderRadius: 8,
    background: "var(--warn-bg)",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  splitTitle: { fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  splitBody: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  splitList: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  splitItem: {
    fontSize: 12.5,
    padding: "3px 9px",
    borderRadius: 5,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  groups: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  group: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 14px",
    cursor: "pointer",
  } satisfies CSSProperties,
  groupTitle: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupDesc: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginLeft: "auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  groupBody: {
    borderTop: "1px solid var(--border)",
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  findingsBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 5,
    padding: "2px 8px",
    border: "none",
    cursor: "pointer",
  } satisfies CSSProperties,

  lineSeverity: { marginLeft: "auto", paddingRight: 8, display: "inline-flex" } satisfies CSSProperties,
  lineSeverityTagBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,
  lineSeverityTag: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color,
  }),
} as const;

/** Role colour square in a group header. */
export function roleSquareFor(colorVar: string): CSSProperties {
  return { width: 10, height: 10, borderRadius: 3, background: colorVar, flexShrink: 0 };
}

/** Diff row left edge — coloured only on the exact line a finding cites, so
    the marker reads as "this line" rather than "this file" or "this hunk". */
export function lineSeverityEdgeFor(severity: Severity | null): CSSProperties {
  return { borderLeft: `3px solid ${severity ? SEV[severity].c : "transparent"}` };
}

/** Diff row highlight after a scroll-to-line jump; fades back on its own. */
export function lineHighlightFor(active: boolean): CSSProperties {
  return { background: active ? "var(--accent-bg)" : undefined, transition: "background .3s" };
}
