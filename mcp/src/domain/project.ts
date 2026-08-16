import type {
  FindingCategory,
  FindingRecord,
  ReviewRecord,
  Severity,
  SeverityCounts,
  Verdict,
} from '@devdigest/shared';
import {
  DEFAULT_MAX_FINDINGS,
  RATIONALE_MAX,
  SUGGESTION_MAX,
  SUMMARY_MAX,
} from '../config.js';

/**
 * Findings projection — the API's verbose `ReviewRecord[]` narrowed to the
 * concise payload a model actually reads.
 *
 * This module is where design principle #3 ("concise structured response") is
 * enforced: one raw `/pulls/:id/reviews` response can be tens of thousands of
 * tokens, almost all of it `rationale` markdown, uuids and persistence
 * bookkeeping that no tool here can act on. A `ConciseFinding` keeps 8 of
 * `FindingRecord`'s 17 fields; everything dropped is either an identifier no
 * tool accepts (`id`, `review_id`), a UI-only marker (`confidence`, `kind`,
 * `scope`, `trifecta_components`, `evidence`) or an action timestamp for an
 * action this server does not expose (`accepted_at`, `dismissed_at`).
 *
 * Pure by contract: no fetch, no clock, no environment. Selection, filtering,
 * ordering and truncation are all decided from the arguments, which is what
 * makes the trap cases below testable without a server.
 */

/** Fixed display/sort order. Also the order counts are rendered in. */
const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const satisfies readonly Severity[];

const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Lifecycle of the thing the caller asked about, not of one HTTP call. */
export type ReviewStatus = 'completed' | 'still_running' | 'failed' | 'not_reviewed';

/** 8 of `FindingRecord`'s 17 fields; `rationale`/`suggestion` are truncated. */
export interface ConciseFinding {
  severity: Severity;
  category: FindingCategory;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  suggestion: string | null;
}

/**
 * The tool-facing review payload. `run_id` is deliberately the only uuid here —
 * everything else addresses by meaning (`repo`, `pr`, `agent`).
 */
export interface ReviewResult {
  status: ReviewStatus;
  repo: string;
  pr: number;
  agent: string | null;
  run_id: string | null;
  verdict: Verdict | null;
  score: number | null;
  summary: string | null;
  counts: SeverityCounts;
  findings: ConciseFinding[];
  total_findings: number;
  truncated: boolean;
  error: string | null;
  next_step: string | null;
}

/**
 * What a pure projection can know. `repo`/`pr` are the caller's own resolved
 * arguments and never appear in a `ReviewRecord`, so the tool layer completes
 * the payload with `{ repo, pr, ...projectReview(...) }`.
 */
export type ReviewProjection = Omit<ReviewResult, 'repo' | 'pr'>;

/**
 * How to address one review: by exact run, by agent name, or not at all
 * (= the most recent review by any agent). `runId` wins when both are given,
 * matching the documented precedence in the `get_findings` description.
 */
export interface ReviewSelector {
  runId?: string | null;
  agentName?: string | null;
}

/**
 * Project the reviews the API returned for one PR into the concise result.
 *
 * Order of operations matters and is asserted by the tests: dismissed findings
 * are dropped FIRST, `counts` and `total_findings` are computed on what
 * survives, and only THEN is the list capped. Counting after the cap would make
 * a 25-finding review report the 20 that fit.
 */
export function projectReview(
  reviews: ReviewRecord[],
  selector: ReviewSelector = {},
  maxFindings: number = DEFAULT_MAX_FINDINGS,
): ReviewProjection {
  const review = selectReview(reviews, selector);
  if (review === null) return notReviewed(selector);

  // Dismissing a finding is the user saying "handled" — it must stop driving
  // both the list and the counter, exactly as the PR list does server-side.
  const kept = (review.findings ?? []).filter((f) => f.dismissed_at == null);
  const counts = tally(kept);
  const ordered = [...kept].sort(compareFindings);
  const cap = Math.max(0, Math.trunc(maxFindings));
  const capped = ordered.slice(0, cap);

  return {
    status: 'completed',
    agent: review.agent_name ?? null,
    run_id: review.run_id ?? null,
    verdict: review.verdict ?? null,
    score: review.score ?? null,
    summary: review.summary == null ? null : truncate(review.summary, SUMMARY_MAX),
    counts,
    findings: capped.map(toConciseFinding),
    total_findings: kept.length,
    truncated: capped.length < kept.length,
    error: null,
    next_step: null,
  };
}

/**
 * One-line human digest for a tool result's `content` text, e.g.
 * `request_changes · score 42 · 3 CRITICAL, 5 WARNING — 8 findings`.
 * The structured payload carries the detail; this is what a human skimming the
 * transcript sees, so it never repeats LLM-authored finding text.
 */
export function formatReviewDigest(result: ReviewProjection): string {
  if (result.status !== 'completed') {
    const head = result.error ? `${result.status}: ${result.error}` : result.status;
    return result.next_step ? `${head} — ${result.next_step}` : head;
  }

  const parts: string[] = [result.verdict ?? 'no verdict'];
  if (result.score !== null) parts.push(`score ${result.score}`);
  const counts = SEVERITIES.filter((s) => result.counts[s] > 0).map(
    (s) => `${result.counts[s]} ${s}`,
  );
  if (counts.length > 0) parts.push(counts.join(', '));

  return `${parts.join(' · ')} — ${describeCount(result)}`;
}

/**
 * Pick the one review the selector addresses.
 *
 * `run_id` filters — it never indexes. The API gives no ordering guarantee for
 * `/pulls/:id/reviews`, so anything that trusted position here would silently
 * return a different agent's review.
 *
 * "Latest" means: among the candidates, prefer `kind === 'review'` over
 * `kind === 'summary'` (a summary carries no findings, so a newer summary must
 * not shadow the review it summarises), then take the max `created_at`. This
 * re-derives `selectLatestReviewPerAgent` from `server/src/modules/pulls/
 * status.ts` on purpose — importing it would drag the server's module graph
 * into this package.
 */
function selectReview(reviews: ReviewRecord[], selector: ReviewSelector): ReviewRecord | null {
  const runId = selector.runId ?? null;
  const agentName = selector.agentName ?? null;

  let candidates = reviews;
  if (runId !== null) {
    candidates = reviews.filter((r) => r.run_id === runId);
  } else if (agentName !== null) {
    const wanted = normalizeName(agentName);
    candidates = reviews.filter((r) => normalizeName(r.agent_name ?? '') === wanted);
  }

  const full = candidates.filter((r) => r.kind === 'review');
  const pool = full.length > 0 ? full : candidates;

  let best: ReviewRecord | undefined;
  for (const r of pool) {
    if (best === undefined || compareCreatedAt(r, best) > 0) best = r;
  }
  return best ?? null;
}

/** Nothing matched — still a structured answer, and it names the next action. */
function notReviewed(selector: ReviewSelector): ReviewProjection {
  const runId = selector.runId ?? null;
  const agentName = selector.agentName ?? null;

  let nextStep: string;
  if (runId !== null) {
    nextStep =
      `No review is stored for run ${runId} yet. If that run is still in flight, ` +
      'call get_findings again in a minute; otherwise start a fresh review with run_agent_on_pr.';
  } else if (agentName !== null) {
    nextStep =
      `No review by '${agentName}' exists for this pull request. Call run_agent_on_pr with ` +
      'that agent, or omit the agent argument to read the most recent review by any agent.';
  } else {
    nextStep =
      'This pull request has never been reviewed. Call run_agent_on_pr to produce a review.';
  }

  return {
    status: 'not_reviewed',
    agent: agentName,
    run_id: runId,
    verdict: null,
    score: null,
    summary: null,
    counts: emptyCounts(),
    findings: [],
    total_findings: 0,
    truncated: false,
    error: null,
    next_step: nextStep,
  };
}

function emptyCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

/** Post-dismissal-filter, pre-cap — the counter reports what exists, not what fit. */
function tally(findings: FindingRecord[]): SeverityCounts {
  const counts = emptyCounts();
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** CRITICAL → WARNING → SUGGESTION, then file, then start line. */
function compareFindings(a: FindingRecord, b: FindingRecord): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.start_line - b.start_line;
}

/** Positive when `a` is newer than `b`. */
function compareCreatedAt(a: ReviewRecord, b: ReviewRecord): number {
  const ta = timestamp(a.created_at);
  const tb = timestamp(b.created_at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  // Equal or unparseable instants: lexicographic order, which is correct for
  // the ISO-8601 UTC strings the API emits and stable for anything else.
  if (a.created_at === b.created_at) return 0;
  return a.created_at < b.created_at ? -1 : 1;
}

function timestamp(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function toConciseFinding(f: FindingRecord): ConciseFinding {
  return {
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    // `rationale` is unbounded LLM markdown — the single largest token risk in
    // the payload. `suggestion` stays null when null; an empty string would
    // read as "the reviewer suggested nothing", which is a different claim.
    rationale: truncate(f.rationale, RATIONALE_MAX),
    suggestion: f.suggestion == null ? null : truncate(f.suggestion, SUGGESTION_MAX),
  };
}

/** Never returns more than `max` characters; the ellipsis is inside the budget. */
function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function describeCount(result: ReviewProjection): string {
  const total = result.total_findings;
  if (total === 0) return 'no findings';
  const noun = total === 1 ? 'finding' : 'findings';
  return result.truncated
    ? `showing ${result.findings.length} of ${total} ${noun}`
    : `${total} ${noun}`;
}
