import type { ProposedSplit, Severity, SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import { classifyPath, normalizePath } from './classify.js';
import {
  SEVERITY_RANK,
  SMART_DIFF_MIN_SPLIT_GROUPS,
  SMART_DIFF_ROLE_ORDER,
  SMART_DIFF_TOO_BIG_LINES,
  SPLIT_PASSTHROUGH_SEGMENTS,
} from './constants.js';

/**
 * Pure domain-service. Never `FindingRow`/`PullRow` — an onion rule: row types
 * must not appear in an application-service signature. Callers (service.ts)
 * map their DB rows into these plain shapes first.
 */
export interface SmartDiffInputFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface SmartDiffInputFinding {
  id: string;
  file: string;
  severity: Severity;
  startLine: number;
  endLine: number;
  dismissed: boolean;
}

/** `none` sorts after every real severity — see SEVERITY_RANK. */
const NO_FINDINGS_RANK = 3;

/** Byte comparison, not `localeCompare` — ICU collation varies by Node build. */
function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Which top-level segment a file's `proposed_splits` bucket falls into.
 * Container segments (`src`, `app`, …) are passed through to the segment
 * after them, so `src/billing/x.ts` buckets as `billing`, not `src`.
 */
function splitBucket(path: string): string {
  const segments = path.split('/');
  if (segments.length > 1 && SPLIT_PASSTHROUGH_SEGMENTS.has(segments[0] ?? '')) {
    return segments[1] ?? segments[0]!;
  }
  return segments[0] ?? path;
}

function topSeverityRank(findings: SmartDiffFile['findings']): number {
  if (findings.length === 0) return NO_FINDINGS_RANK;
  let best = NO_FINDINGS_RANK;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity];
    if (rank < best) best = rank;
  }
  return best;
}

/**
 * Total comparator (see plan "Sort order"):
 *   1. has findings (true first)
 *   2. top severity ascending (CRITICAL < WARNING < SUGGESTION < none)
 *   3. count at that top severity, descending
 *   4. additions + deletions, descending
 *   5. path ascending, byte comparison
 */
function compareFiles(a: SmartDiffFile, b: SmartDiffFile): number {
  const aHas = a.findings.length > 0;
  const bHas = b.findings.length > 0;
  if (aHas !== bHas) return aHas ? -1 : 1;

  const aTop = topSeverityRank(a.findings);
  const bTop = topSeverityRank(b.findings);
  if (aTop !== bTop) return aTop - bTop;

  const aCount = a.findings.filter((f) => SEVERITY_RANK[f.severity] === aTop).length;
  const bCount = b.findings.filter((f) => SEVERITY_RANK[f.severity] === bTop).length;
  if (aCount !== bCount) return bCount - aCount;

  const aLines = a.additions + a.deletions;
  const bLines = b.additions + b.deletions;
  if (aLines !== bLines) return bLines - aLines;

  return comparePath(a.path, b.path);
}

/**
 * Build a deterministic `SmartDiff` from a PR's files and its findings from
 * surviving reviews (caller already applied `selectLatestReviewPerAgent` and
 * dropped dismissed rows is NOT assumed — dismissal is re-checked here via
 * `dismissed`, consistent with `rollupSeverities`).
 *
 * Algorithm: normalize files into a path → accumulator map, bucket
 * non-dismissed findings by normalized path (a finding whose file isn't in
 * `files` is dropped), sort each file's findings by severity then start
 * line, derive deduped ascending `finding_lines`, classify each file's role,
 * group in fixed role order (empty groups omitted), sort each group with the
 * total comparator, then compute `split_suggestion` over core+wiring only.
 */
export function buildSmartDiff(input: {
  files: SmartDiffInputFile[];
  findings: SmartDiffInputFinding[];
}): SmartDiff {
  const filesByPath = new Map<string, SmartDiffFile>();
  for (const f of input.files) {
    const path = normalizePath(f.path);
    filesByPath.set(path, {
      path,
      pseudocode_summary: null,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: [],
      findings: [],
    });
  }

  for (const finding of input.findings) {
    if (finding.dismissed) continue;
    const path = normalizePath(finding.file);
    const acc = filesByPath.get(path);
    if (!acc) continue; // orphan finding: its file isn't in this PR's files — dropped
    acc.findings.push({
      finding_id: finding.id,
      severity: finding.severity,
      start_line: finding.startLine,
      // Clamp against bad model output: a range can't end before it starts.
      end_line: Math.max(finding.endLine, finding.startLine),
    });
  }

  const roleByPath = new Map<string, SmartDiffRole>();
  for (const file of filesByPath.values()) {
    file.findings.sort((a, b) => {
      const r = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return r !== 0 ? r : a.start_line - b.start_line;
    });
    file.finding_lines = Array.from(new Set(file.findings.map((f) => f.start_line))).sort(
      (a, b) => a - b,
    );
    roleByPath.set(file.path, classifyPath(file.path));
  }

  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  for (const file of filesByPath.values()) {
    const role = roleByPath.get(file.path)!;
    const arr = byRole.get(role);
    if (arr) arr.push(file);
    else byRole.set(role, [file]);
  }

  const groups = SMART_DIFF_ROLE_ORDER.filter((role) => (byRole.get(role)?.length ?? 0) > 0).map(
    (role) => ({
      role,
      files: byRole.get(role)!.sort(compareFiles),
    }),
  );

  // core+wiring only — a 5k-line lockfile is not reviewer burden.
  const coreWiring: SmartDiffFile[] = [];
  for (const file of filesByPath.values()) {
    const role = roleByPath.get(file.path)!;
    if (role === 'core' || role === 'wiring') coreWiring.push(file);
  }
  const totalLines = coreWiring.reduce((sum, f) => sum + f.additions + f.deletions, 0);

  const buckets = new Map<string, string[]>();
  for (const file of coreWiring) {
    const bucket = splitBucket(file.path);
    const arr = buckets.get(bucket);
    if (arr) arr.push(file.path);
    else buckets.set(bucket, [file.path]);
  }
  const proposedSplits: ProposedSplit[] =
    buckets.size >= SMART_DIFF_MIN_SPLIT_GROUPS
      ? Array.from(buckets.entries())
          .sort(([a], [b]) => comparePath(a, b))
          .map(([name, files]) => ({ name, files: files.slice().sort(comparePath) }))
      : [];

  return {
    groups,
    split_suggestion: {
      too_big: totalLines > SMART_DIFF_TOO_BIG_LINES,
      total_lines: totalLines,
      proposed_splits: proposedSplits,
    },
  };
}
