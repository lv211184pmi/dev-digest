import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/**
 * Severities that render regardless of scope. The design's "severity >= high"
 * has no direct equivalent in this repo's three-value `Severity`, so CRITICAL
 * only is exempt; widening it to WARNING is a one-line change here.
 */
const ALWAYS_IN_SCOPE: Severity[] = ["CRITICAL"];

/** A finding is collapsible only when it is marked out of scope AND not exempt. */
export function isOutOfScope(f: FindingRecord): boolean {
  return f.scope === "out_of_scope" && !ALWAYS_IN_SCOPE.includes(f.severity);
}

/** Optionally drop low-confidence findings and sort by severity. */
export function visibleFindings(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/**
 * Split the visible findings into in-scope and out-of-scope buckets.
 *
 * NOTHING is removed: the two buckets together are exactly `visibleFindings`,
 * and the panel renders the second one behind a collapsed toggle. This mirrors
 * the grounding gate's `dropped[]` philosophy — never go silent about a finding
 * that exists.
 */
export function splitByScope(
  findings: FindingRecord[],
  hideLow: boolean,
): { inScope: FindingRecord[]; outOfScope: FindingRecord[] } {
  const shown = visibleFindings(findings, hideLow);
  return {
    inScope: shown.filter((f) => !isOutOfScope(f)),
    outOfScope: shown.filter(isOutOfScope),
  };
}
