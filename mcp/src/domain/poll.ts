/**
 * Wait for a set of review runs to reach a terminal status.
 *
 * `POST /pulls/:id/review` is fire-and-forget: it returns run ids and an always
 * empty `reviews` array, and the actual work happens in the background. Turning
 * that into `run_agent_on_pr`'s single blocking call (design principle #1,
 * "result, not operation") means polling `GET /pulls/:id/runs` until the runs we
 * started settle. This module is that loop, and nothing else — it performs no
 * projection and raises no `ToolError`, so the tool handler stays the only place
 * that decides what a caller is told.
 *
 * THE RULE THAT MATTERS MOST: decide from the run ids the POST returned, never
 * from the PR's aggregate run status. `/pulls/:id/runs` returns EVERY run the PR
 * ever had, so a review someone ran yesterday is sitting there as `done`. An
 * implementation that asks "are all runs for this PR terminal?" returns
 * instantly, with the previous agent's verdict, while ours is still running.
 * `selectTargetRuns` is the guard and `waitForRuns` never looks at anything else.
 *
 * WHY `failed` IS A BRANCH HERE AND NOT LATER: per-agent failures are caught and
 * only logged server-side, and the error text lands on `RunSummary.error`.
 * `GET /pulls/:id/reviews` therefore cannot distinguish "the run died" from "the
 * PR is clean and the review has zero findings" — both are an absent or empty
 * review. The run row is the only place that difference exists, so it has to be
 * read here, while we still have it.
 *
 * Ported from this repo's canonical wait loop, `server/test/helpers/runs.ts`,
 * with HTTP-appropriate timings from `config.ts` in place of that helper's 25ms
 * database polling.
 */

import type { ReviewRecord, RunSummary } from '@devdigest/shared';
import type { Endpoints } from '../api/endpoints.js';
import {
  FIRST_DELAY_MS,
  MAX_CONSECUTIVE_POLL_ERRORS,
  POLL_INTERVAL_MS,
  RUN_TIMEOUT_MS,
} from '../config.js';

/**
 * The statuses a run never leaves. There is deliberately no `queued`: rows are
 * written as `running` the instant the POST returns, so "not yet started" is not
 * a state this loop can observe.
 */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'failed', 'cancelled']);

/** The terminal statuses that mean the review did not happen. */
export const FAILURE_STATUSES: ReadonlySet<string> = new Set(['failed', 'cancelled']);

/**
 * `RunSummary.status` is `z.string().nullable()`, so every read of it goes
 * through these two. A null status is treated as "still running" — the optimism
 * is deliberate: the alternative is calling an in-flight run terminal and
 * reporting a verdict that does not exist yet.
 */
export function isTerminalStatus(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.has(status ?? '');
}

export function isFailureStatus(status: string | null | undefined): boolean {
  return FAILURE_STATUSES.has(status ?? '');
}

/**
 * How the wait ended.
 *
 * - `done` — every target run reached `done`.
 * - `failed` — at least one target run reached `failed` or `cancelled`.
 * - `timeout` — the cap elapsed, or polling failed too many times in a row. Both
 *   mean the same thing to the caller ("the run is still out there, hand back
 *   its id"), so they are one outcome rather than two branches nobody splits.
 * - `aborted` — the MCP host cancelled the request.
 */
export type PollOutcome = 'done' | 'failed' | 'timeout' | 'aborted';

export interface WaitResult {
  outcome: PollOutcome;
  /**
   * The target runs as last seen, in the order they were requested. Empty when
   * the first poll never succeeded — the caller still holds the run ids it
   * passed in, which is what a `timeout` or `aborted` result is for.
   */
  runs: RunSummary[];
  /** The first target run that failed or was cancelled; null otherwise. */
  failedRun: RunSummary | null;
  /** `failedRun.error` — the ONLY place a failure's cause survives. Null otherwise. */
  error: string | null;
}

/** Injected so tests can drive the loop without a real timer. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface WaitOptions {
  /** Host cancellation. An abort returns `aborted`; it never cancels the server-side run. */
  signal?: AbortSignal;
  /** Clock, defaulted to `Date.now`. Only ever used for elapsed time. */
  now?: () => number;
  /** Defaults to a real, abort-aware `setTimeout`. */
  sleep?: Sleep;
  timeoutMs?: number;
  intervalMs?: number;
  firstDelayMs?: number;
  maxConsecutiveErrors?: number;
}

/** The slice of the API this loop needs. Anything wider is not its business. */
export type PollEndpoints = Pick<Endpoints, 'listRuns'>;

/**
 * The target runs, in the order their ids were requested.
 *
 * Requested order, not response order: `/pulls/:id/runs` promises no ordering,
 * so a caller reading `runs[0]` off the raw response would be reading whichever
 * run the database happened to return first. Ids with no matching row are
 * dropped rather than represented as a hole — a run that has not appeared yet is
 * simply not terminal, which is what the loop needs to know.
 */
export function selectTargetRuns(all: RunSummary[], runIds: readonly string[]): RunSummary[] {
  const byId = new Map(all.map((r) => [r.run_id, r]));
  const seen = new Set<string>();
  const picked: RunSummary[] = [];

  for (const id of runIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const run = byId.get(id);
    if (run !== undefined) picked.push(run);
  }
  return picked;
}

/**
 * The reviews produced by a specific set of runs.
 *
 * By `run_id` membership, never by array position: `/pulls/:id/reviews` returns
 * every review the PR ever received, in no guaranteed order, so `reviews[0]` is
 * a different agent's opinion as often as not. `ReviewRecord.run_id` is
 * nullable; a null can belong to no run and is always dropped.
 */
export function selectReviewsForRuns(
  reviews: ReviewRecord[],
  runIds: readonly string[],
): ReviewRecord[] {
  if (runIds.length === 0) return [];
  const wanted = new Set(runIds);
  return reviews.filter((r) => r.run_id !== null && wanted.has(r.run_id));
}

/** Host cancellation surfaces as a raw `AbortError`, never as a `ToolError`. */
function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

/** Abort-aware `setTimeout`: a cancelled request must not wait out the interval. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

function settled(outcome: PollOutcome, runs: RunSummary[]): WaitResult {
  return { outcome, runs, failedRun: null, error: null };
}

/**
 * Poll until every run in `runIds` is terminal, the cap elapses, or the host
 * cancels.
 *
 * Timing: one `firstDelayMs` pause before the first poll (a short review can
 * already be finished by then, and polling at t=0 only ever returns `running`),
 * then one poll every `intervalMs`. At the 2s default that is 30 requests a
 * minute, well under the API's global 120/min limit — a tighter loop would spend
 * the caller's rate budget on their own review.
 *
 * A poll that throws is retried: the API restarting mid-review is a routine
 * local-development event and losing the run ids over it would strand a review
 * the user is paying for. After `maxConsecutiveErrors` failures in a row we stop
 * and report `timeout`, which hands those ids back. One success resets the
 * count, so a flaky minute never accumulates into a give-up.
 *
 * An abort returns `aborted` and deliberately does NOT cancel the server-side
 * run: it keeps going, and the caller returns its `run_id` so the user can pick
 * the result up with `get_findings`.
 *
 * Zero run ids returns `done` immediately, without an HTTP call — there is
 * nothing to wait for. Callers raise `run_not_started` before getting here; this
 * is only a guarantee that the loop cannot spin on a vacuous condition.
 */
export async function waitForRuns(
  endpoints: PollEndpoints,
  prId: string,
  runIds: readonly string[],
  options: WaitOptions = {},
): Promise<WaitResult> {
  const {
    signal,
    now = Date.now,
    sleep = defaultSleep,
    timeoutMs = RUN_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
    firstDelayMs = FIRST_DELAY_MS,
    maxConsecutiveErrors = MAX_CONSECUTIVE_POLL_ERRORS,
  } = options;

  if (runIds.length === 0) return settled('done', []);
  if (signal?.aborted) return settled('aborted', []);

  const start = now();
  let runs: RunSummary[] = [];
  let consecutiveErrors = 0;

  await sleep(firstDelayMs, signal);

  for (;;) {
    if (signal?.aborted) return settled('aborted', runs);

    try {
      const all = await endpoints.listRuns(prId, signal ? { signal } : {});
      consecutiveErrors = 0;
      runs = selectTargetRuns(all, runIds);

      // Failure first: with two runs where one failed and one succeeded, the
      // failure is the news. Reporting `done` would hide it behind a partial
      // verdict.
      const failedRun = runs.find((r) => isFailureStatus(r.status));
      if (failedRun !== undefined) {
        return { outcome: 'failed', runs, failedRun, error: failedRun.error };
      }

      // Every requested run must be present AND done. `runs.every(...)` alone is
      // true of an empty array, so a response that has not yet grown the rows
      // would read as success.
      const allDone = runs.length === new Set(runIds).size && runs.every((r) => r.status === 'done');
      if (allDone) return settled('done', runs);
    } catch (e) {
      // A cancellation is an answer, not a failed attempt — it must not be
      // retried, and must not count towards the error budget.
      if (isAbortError(e) || signal?.aborted) return settled('aborted', runs);

      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) return settled('timeout', runs);
    }

    // Checked after the poll, so a run that finished during `firstDelayMs` is
    // always reported even when the cap is tiny.
    if (now() - start >= timeoutMs) return settled('timeout', runs);

    await sleep(intervalMs, signal);
  }
}
