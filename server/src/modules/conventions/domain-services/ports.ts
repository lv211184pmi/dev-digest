import type { RawConventionCandidate, GroundedConvention } from '../domain-model/candidate.js';

/**
 * Port interfaces for the conventions module. Implementations live under
 * `infrastructure/external/` and `infrastructure/persistence/`; hermetic
 * tests inject fakes so `application-services` never needs a DB, the
 * filesystem, or a real model call.
 */

/** Reads one file from a repo's clone. Never throws — both "missing" and
 *  "not cloned" collapse to `null` so callers don't need try/catch. */
export interface RepoFileReader {
  read(path: string): Promise<string | null>;
}

/** Rank-ordered, junk-filtered source file paths for a repo (paths only). */
export interface SamplePicker {
  rankedPaths(repoId: string, n: number): Promise<string[]>;
}

export interface ConventionExtractionPrompt {
  system: string;
  user: string;
}

export interface ConventionModelResult {
  conventions: RawConventionCandidate[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/** The single structured LLM call that proposes candidates from the sample block. */
export interface ConventionModel {
  extract(prompt: ConventionExtractionPrompt): Promise<ConventionModelResult>;
}

export interface CompletedRunResult {
  workspaceId: string;
  repoId: string;
  candidates: GroundedConvention[];
  sampleCount: number;
  droppedCount: number;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  /** Set for the "not indexed yet" degradation — the run is still `done`. */
  error?: string | null;
}

/**
 * Persistence port for the EXTRACTION flow only (what the job handler needs).
 * The full CRUD surface for the HTTP routes lives on the concrete
 * `ConventionsRepository` — that side is exercised by DB-backed tests, so it
 * doesn't need a port abstraction. This one exists so
 * `conventions-extract.test.ts` can run with an in-memory fake, no DB.
 */
export interface ConventionsStore {
  markRunning(runId: string): Promise<void>;
  completeRun(runId: string, result: CompletedRunResult): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
}
