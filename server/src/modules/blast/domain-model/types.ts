/**
 * blast module — domain shapes.
 *
 * PURE: no Zod, no Drizzle, no `node:*`. The wire DTOs (`BlastRadius`,
 * `PrBlastRecord`, …) belong to `infrastructure/http`; what lives here is the
 * plain node vocabulary the assembly and coverage maths operate on.
 *
 * The one deliberate exception is that `assemble.ts` returns `DownstreamImpact`
 * / `BlastTotals` directly — those two are plain data with no behaviour, and
 * re-declaring them here only to map them field-for-field at the boundary would
 * be ceremony with no invariant behind it.
 */

/** The node list handed to the summariser. This is the ENTIRE model input. */
export interface BlastNodes {
  symbols: Array<{ name: string; file: string; line: number; kind: string }>;
  callers: Array<{ symbol: string; file: string; line: number; viaSymbol: string }>;
  endpoints: string[];
  crons: string[];
  totals: { symbols: number; callers: number; endpoints: number; crons: number };
  /** So the sentence can be honest about what the index could not see. */
  indexState: 'full' | 'partial' | 'unavailable';
}

/**
 * Everything `buildCoverage` needs to decide how much of this PR the index
 * actually saw. Deliberately primitives-only: no `IndexState` row, no DB type,
 * so the coverage rules are testable without a database.
 */
export interface CoverageInput {
  /** repo-intel `IndexStatus`, or null when there is no index row at all. */
  indexStatus: 'full' | 'partial' | 'degraded' | 'failed' | null;
  /** repo-intel `DegradedReason` or a blast-local reason. */
  degradedReason: string | null;
  /** Paths from `pr_files`. */
  changedFiles: string[];
  /** Changed files the index has at least one symbol row for. */
  indexedSymbolFiles: string[];
  /** Total files the index holds for the repo. */
  indexedFiles: number;
  /** Rows actually in `pr_files`. */
  prFilesCount: number;
  /** GitHub's own count on the PR — a gap means the 100-file page truncated. */
  pullFilesCount: number;
  /** Index stats blob from `repo_index_state.stats`. */
  stats?: IndexStatsShape;
}

/**
 * The subset of `repo_index_state.stats` that affects coverage. Every field is
 * optional — the blob is untyped jsonb and old rows predate several keys.
 */
export interface IndexStatsShape {
  /** Files dropped because the repo exceeded MAX_INDEXED_FILES. */
  bounded?: number;
  /** Files skipped for exceeding MAX_FILE_SIZE. */
  skippedTooLarge?: number;
  /** Set when the import-graph build threw; rank/edges are unreliable. */
  graphFailed?: string;
  /** Indexing stopped early against its own time budget. */
  softBudgetReached?: boolean;
  /** Per-file parse failures. */
  parseDegraded?: Array<{ file: string; reason: string }>;
}
