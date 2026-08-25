import type { ChatMessage } from '@devdigest/shared';

/**
 * Port interfaces for the blast module. Implementations live under
 * `infrastructure/persistence/` and `infrastructure/external/`; hermetic tests
 * inject fakes so `application-services` never needs a DB or a real model call.
 *
 * That is not incidental — the most important assertions in this feature
 * ("with the flag off the index is never touched", "a cache hit makes zero
 * model calls", "a lying model cannot change a single node") are only cheap to
 * write because both sides of the use case are ports.
 */

/** The PR facts blast needs, as plain data. */
export interface BlastPull {
  id: string;
  repoId: string;
  headSha: string;
  /** GitHub's own changed-file count, for detecting the 100-file truncation. */
  filesCount: number;
}

/**
 * Read port over the pulls/pr_files tables.
 *
 * Declared in plain domain shapes rather than as `ReviewRepository` so no
 * Drizzle row type reaches the use case — a `PrFileRow` in an
 * application-service signature would be a layering violation, and it would
 * also drag a DB dependency into the hermetic tests.
 */
export interface BlastPullReader {
  getPull(workspaceId: string, prId: string): Promise<BlastPull | null>;
  /** Paths from `pr_files`, in whatever order the table returns. */
  getChangedFiles(prId: string): Promise<string[]>;
}

/** The persisted summary row. Only the sentence and its provenance are cached. */
export interface BlastSummaryRow {
  summary: string;
  headSha: string | null;
  factsHash: string | null;
  provider: string | null;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  derivedAt: Date | null;
}

export interface BlastSummaryStore {
  get(prId: string): Promise<BlastSummaryRow | null>;
  upsert(prId: string, row: BlastSummaryRow): Promise<void>;
}

export interface BlastSummaryResult {
  summary: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** `null` when the model is not in the price book — NEVER 0, which would read as free. */
  costUsd: number | null;
}

/**
 * The single structured LLM call. Takes already-rendered messages, so the
 * implementation has no say in what the model is shown — `render.ts` owns that,
 * and this port cannot widen it.
 */
export interface BlastSummarizer {
  summarise(messages: ChatMessage[]): Promise<BlastSummaryResult>;
}
