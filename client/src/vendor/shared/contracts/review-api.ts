import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { BlastRadius, Intent, IntentConfidence, IntentSource, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/**
 * Intent persisted for a PR: the `Intent` the model produced plus everything the
 * server derived around it. `confidence` and `sources` live here rather than on
 * `Intent` precisely so the model cannot self-report them.
 *
 * `is_stale` is **server-derived** on read (the stored `head_sha` vs the PR's
 * current head) and never stored — same shape as `deriveReviewStatus`.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
  head_sha: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  derived_at: z.string().nullable(),
  is_stale: z.boolean(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/**
 * GET/POST /pulls/:id/blast. Mirrors `PrIntentRecord`: `is_stale` is derived on read.
 *
 * Only the summary and its provenance are ever persisted — the nodes
 * (`changed_symbols`, `downstream`, `totals`, `index`) are re-derived from the
 * repo-intel index on every request, so a reindex can never serve a stale map.
 */
export const PrBlastRecord = BlastRadius.extend({
  pr_id: z.string(),
  /** null until the summary has been derived — the deterministic map ships without it. */
  summary: z.string().nullable(),
  head_sha: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  derived_at: z.string().nullable(),
  /** Stored summary's head_sha/facts_hash no longer match what was just computed. */
  is_stale: z.boolean(),
});
export type PrBlastRecord = z.infer<typeof PrBlastRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
