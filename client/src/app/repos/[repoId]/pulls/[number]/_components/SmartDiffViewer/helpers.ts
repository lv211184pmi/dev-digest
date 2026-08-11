/** Pure helpers for SmartDiffViewer — no React, no fetch. */
import type { PrFile, Severity, SmartDiffFinding } from "@devdigest/shared";
import { SEVERITY_RANK } from "./constants";

/** Index the PR's files by path once, for O(1) lookup per `SmartDiffFile` —
    the server response deliberately carries no patch text, so the viewer
    matches each Smart Diff entry back to its already-loaded `pr.files` row. */
export function indexFilesByPath(files: PrFile[]): Map<string, PrFile> {
  const map = new Map<string, PrFile>();
  for (const f of files) map.set(f.path, f);
  return map;
}

/** Findings anchored to a file, keyed by the NEW-file line they cite —
    `start_line` is what the grounding gate cites, so this matches `Line.newNo`
    (see `parsePatch`). Multiple findings can share a line. A finding on a pure
    deletion has no `newNo` to match against and never renders a badge — a
    known limitation. */
export function findingsByNewLine(findings: SmartDiffFinding[]): Map<number, SmartDiffFinding[]> {
  const map = new Map<number, SmartDiffFinding[]>();
  for (const f of findings) {
    const list = map.get(f.start_line);
    if (list) list.push(f);
    else map.set(f.start_line, [f]);
  }
  return map;
}

/** The most severe finding among a file's findings, or null when there are
    none — drives the file card's left-edge colour. */
export function topSeverity(findings: SmartDiffFinding[]): Severity | null {
  let top: Severity | null = null;
  for (const f of findings) {
    if (top == null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[top]) top = f.severity;
  }
  return top;
}
