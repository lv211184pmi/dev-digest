import { describe, expect, it, vi } from 'vitest';
import type { ReviewRecord, RunSummary } from '@devdigest/shared';
import {
  isFailureStatus,
  isTerminalStatus,
  selectReviewsForRuns,
  selectTargetRuns,
  waitForRuns,
  type PollEndpoints,
} from '../src/domain/poll.js';

/**
 * `RunSummary` has 17 fields and a test that spells them all out hides the one
 * field it is about — here that is almost always `status`.
 */
function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'General Reviewer',
    provider: 'openai',
    model: 'gpt-5',
    status: 'running',
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: '2026-01-01T00:00:00.000Z',
    score: null,
    blockers: null,
    ...over,
  };
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'General Reviewer',
    kind: 'review',
    verdict: 'approve',
    summary: 'looks fine',
    score: 90,
    model: 'gpt-5',
    grounding: null,
    created_at: '2026-01-01T00:00:00.000Z',
    findings: [],
    ...over,
  };
}

// ---- the injected clock ----------------------------------------------------

/**
 * A fake clock whose time advances only when the loop sleeps. Nothing in this
 * file waits: `sleep` resolves on the microtask queue and moves `now` forward by
 * exactly the delay it was asked for, so elapsed time is a deterministic
 * function of how many times the loop went round.
 */
function clock() {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number): Promise<void> => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

// ---- the stubbed endpoint --------------------------------------------------

/** One scripted poll: the rows to return, or the failure to throw. */
type Step = RunSummary[] | Error;

interface Stub extends PollEndpoints {
  calls: Array<{ prId: string; signal: AbortSignal | undefined }>;
}

/**
 * Plays `steps` in order, repeating the last one forever — which is what lets a
 * cap test script "running, and keep saying running" in one line.
 */
function stub(steps: Step[], onCall?: (n: number) => void): Stub {
  const calls: Stub['calls'] = [];
  const listRuns = vi.fn(async (prId: string, opts?: { signal?: AbortSignal }) => {
    calls.push({ prId, signal: opts?.signal });
    onCall?.(calls.length);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step ?? [];
  });
  return { listRuns, calls };
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

const FAST = { firstDelayMs: 1000, intervalMs: 2000, maxConsecutiveErrors: 3 };

/**
 * The loop's contract: it reports the fate of THE RUNS IT WAS GIVEN, and never
 * the fate of the pull request. Every branch below exists because the caller has
 * exactly one shot at telling the user what happened — `run_agent_on_pr` blocks
 * on this, and whatever comes back is the answer.
 */
describe('waitForRuns — reaching a terminal status', () => {
  it('run already done on the first poll → done, after one poll', async () => {
    const c = clock();
    const api = stub([[run({ status: 'done' })]]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(result.runs.map((r) => r.run_id)).toEqual(['run-1']);
    expect(result.error).toBeNull();
    expect(api.calls).toHaveLength(1);
    // The first poll is deferred: a review that finished inside the delay is
    // reported without a second round trip.
    expect(c.slept).toEqual([1000]);
  });

  it('running, running, then done → done on the third poll', async () => {
    const c = clock();
    const api = stub([[run()], [run()], [run({ status: 'done' })]]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(3);
    expect(c.slept).toEqual([1000, 2000, 2000]);
  });

  it('run failed → failed, carrying that run’s error text', async () => {
    const c = clock();
    const api = stub([[run({ status: 'failed', error: 'no API key for provider openai' })]]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    // This is the whole reason failure is detected here: /pulls/:id/reviews
    // shows the same nothing for a dead run and for a clean PR.
    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('no API key for provider openai');
    expect(result.failedRun?.run_id).toBe('run-1');
  });

  it('run cancelled → failed, with a null error surviving as null', async () => {
    const c = clock();
    const api = stub([[run({ status: 'cancelled', error: null })]]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('failed');
    expect(result.error).toBeNull();
  });

  it('one target done, one target failed → failed, not done', async () => {
    const c = clock();
    const api = stub([
      [run({ run_id: 'a', status: 'done' }), run({ run_id: 'b', status: 'failed', error: 'boom' })],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['a', 'b'], { ...FAST, ...c });

    // A partial verdict must not bury the failure that produced it.
    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('boom');
  });
});

/**
 * The trap this module exists to avoid. `/pulls/:id/runs` returns every run the
 * PR ever had, so any implementation that reads aggregate status returns the
 * previous agent's verdict the moment it is asked.
 */
describe('waitForRuns — deciding only from the requested run ids', () => {
  it('a sibling run already done while the target still runs → keeps polling', async () => {
    const c = clock();
    const api = stub([
      // Yesterday's Security Reviewer run, terminal, sitting in the same list.
      [run({ run_id: 'old-run', agent_name: 'Security Reviewer', status: 'done' }), run()],
      [run({ run_id: 'old-run', agent_name: 'Security Reviewer', status: 'done' }), run()],
      [
        run({ run_id: 'old-run', agent_name: 'Security Reviewer', status: 'done' }),
        run({ status: 'done' }),
      ],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(3);
    // And the sibling never leaks into the result the caller projects.
    expect(result.runs.map((r) => r.run_id)).toEqual(['run-1']);
  });

  it('only a sibling run in the response, terminal → not done until the target appears', async () => {
    const c = clock();
    const api = stub([
      // The row for our run has not been read back yet, and the only thing in
      // the list is terminal. "Are all runs for this PR done?" answers yes here
      // — with a verdict produced by another agent, on another day.
      [run({ run_id: 'old-run', agent_name: 'Security Reviewer', status: 'done' })],
      [
        run({ run_id: 'old-run', agent_name: 'Security Reviewer', status: 'done' }),
        run({ status: 'done' }),
      ],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(2);
    expect(result.runs.map((r) => r.run_id)).toEqual(['run-1']);
  });

  it('a sibling run already failed while the target still runs → not reported as failed', async () => {
    const c = clock();
    const api = stub([
      [run({ run_id: 'old-run', status: 'failed', error: 'someone else’s problem' }), run()],
      [
        run({ run_id: 'old-run', status: 'failed', error: 'someone else’s problem' }),
        run({ status: 'done' }),
      ],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(result.error).toBeNull();
  });

  it('two targets, only one done → keeps polling until both are', async () => {
    const c = clock();
    const api = stub([
      [run({ run_id: 'a', status: 'done' }), run({ run_id: 'b' })],
      [run({ run_id: 'a', status: 'done' }), run({ run_id: 'b', status: 'done' })],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['a', 'b'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(2);
  });

  it('a requested run missing from the response → not treated as done', async () => {
    const c = clock();
    const api = stub([
      // Only one of the two rows is visible yet. `every` over what came back
      // would be vacuously satisfied.
      [run({ run_id: 'a', status: 'done' })],
      [run({ run_id: 'a', status: 'done' }), run({ run_id: 'b', status: 'done' })],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['a', 'b'], { ...FAST, ...c });

    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(2);
    expect(result.runs.map((r) => r.run_id)).toEqual(['a', 'b']);
  });

  it('a null status → treated as still running, never as terminal', async () => {
    const c = clock();
    const api = stub([[run({ status: null })], [run({ status: 'done' })]]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    // `RunSummary.status` is nullable in the contract. Calling null terminal
    // would report a verdict that does not exist yet.
    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(2);
  });
});

/**
 * Giving up. Every non-terminal exit hands the run ids back rather than throwing,
 * because the server-side run is still going and `get_findings` can collect it.
 */
describe('waitForRuns — caps, cancellation and poll failures', () => {
  it('cap elapsed while still running → timeout, keeping the run it was watching', async () => {
    const c = clock();
    const api = stub([[run()]]); // repeats: never finishes

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c, timeoutMs: 5000 });

    // t=1000 poll, t=3000 poll, t=5000 poll → cap reached.
    expect(result.outcome).toBe('timeout');
    expect(api.calls).toHaveLength(3);
    expect(result.runs.map((r) => r.run_id)).toEqual(['run-1']);
  });

  it('signal aborted before the loop starts → aborted, without any HTTP call', async () => {
    const c = clock();
    const api = stub([[run({ status: 'done' })]]);
    const controller = new AbortController();
    controller.abort();

    const result = await waitForRuns(api, 'pr-1', ['run-1'], {
      ...FAST,
      ...c,
      signal: controller.signal,
    });

    expect(result.outcome).toBe('aborted');
    expect(api.calls).toHaveLength(0);
  });

  it('signal aborted mid-poll → aborted, and the server-side run is left alone', async () => {
    const c = clock();
    const controller = new AbortController();
    const api = stub([[run()]], (n) => {
      if (n === 2) controller.abort();
    });

    const result = await waitForRuns(api, 'pr-1', ['run-1'], {
      ...FAST,
      ...c,
      signal: controller.signal,
    });

    expect(result.outcome).toBe('aborted');
    expect(api.calls).toHaveLength(2);
    // Nothing cancels the run: the caller hands the id back so the user can pick
    // the result up with get_findings. `listRuns` is the only call made at all.
    expect(result.runs.map((r) => r.run_id)).toEqual(['run-1']);
    expect(api.calls.every((call) => call.signal === controller.signal)).toBe(true);
  });

  it('an AbortError thrown by the poll → aborted, not counted as a poll failure', async () => {
    const c = clock();
    const api = stub([[run()], abortError()]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    expect(result.outcome).toBe('aborted');
    expect(api.calls).toHaveLength(2);
  });

  it('3 consecutive poll errors → timeout rather than a throw', async () => {
    const c = clock();
    const api = stub([new Error('ECONNREFUSED')]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    // The run ids are the caller's; the point is that they reach the caller as a
    // result instead of being lost inside a rejected promise.
    expect(result.outcome).toBe('timeout');
    expect(result.runs).toEqual([]);
    expect(api.calls).toHaveLength(3);
  });

  it('errors either side of a successful poll → the counter resets and the wait completes', async () => {
    const c = clock();
    const api = stub([
      new Error('ECONNREFUSED'),
      new Error('ECONNREFUSED'),
      [run()], // API back up — this is what resets the budget
      new Error('ECONNREFUSED'),
      new Error('ECONNREFUSED'),
      [run({ status: 'done' })],
    ]);

    const result = await waitForRuns(api, 'pr-1', ['run-1'], { ...FAST, ...c });

    // Five failures in six polls, but never three in a row: a flaky minute must
    // not accumulate into abandoning a review the user is paying for.
    expect(result.outcome).toBe('done');
    expect(api.calls).toHaveLength(6);
  });

  it('no run ids → done immediately, without an HTTP call', async () => {
    const c = clock();
    const api = stub([[run({ status: 'done' })]]);

    const result = await waitForRuns(api, 'pr-1', [], { ...FAST, ...c });

    // Nothing to wait for. The caller raises `run_not_started` for this case;
    // the guard is here so the loop cannot spin on a vacuous condition.
    expect(result.outcome).toBe('done');
    expect(result.runs).toEqual([]);
    expect(api.calls).toHaveLength(0);
    expect(c.slept).toEqual([]);
  });
});

/**
 * The two pure selectors. Both exist to make "by id" the only way to attribute a
 * row to a run — position in an unordered API response is never a handle.
 */
describe('selectTargetRuns / selectReviewsForRuns — attribution is by id', () => {
  it('mixed rows → only the requested ones, in the requested order', () => {
    const all = [run({ run_id: 'c' }), run({ run_id: 'a' }), run({ run_id: 'zzz' })];

    expect(selectTargetRuns(all, ['a', 'c']).map((r) => r.run_id)).toEqual(['a', 'c']);
  });

  it('empty inputs → empty output, both ways round', () => {
    expect(selectTargetRuns([], ['a'])).toEqual([]);
    expect(selectTargetRuns([run()], [])).toEqual([]);
  });

  it('a duplicated run id → the run appears once', () => {
    expect(selectTargetRuns([run({ run_id: 'a' })], ['a', 'a']).map((r) => r.run_id)).toEqual(['a']);
  });

  it('reviews for other runs → filtered out by run_id, never by position', () => {
    const reviews = [
      review({ id: 'rev-old', run_id: 'old-run' }),
      review({ id: 'rev-mine', run_id: 'run-1' }),
    ];

    expect(selectReviewsForRuns(reviews, ['run-1']).map((r) => r.id)).toEqual(['rev-mine']);
    // Taking reviews[0] would return a different agent's verdict entirely.
    expect(selectReviewsForRuns(reviews, [])).toEqual([]);
  });

  it('a review with a null run_id → belongs to no run', () => {
    expect(selectReviewsForRuns([review({ run_id: null })], ['run-1'])).toEqual([]);
  });

  it('status predicates → null and unknown statuses are non-terminal', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
    // There is no `queued` status — rows are `running` from the POST onwards.
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isFailureStatus('done')).toBe(false);
    expect(isFailureStatus('cancelled')).toBe(true);
    expect(isFailureStatus(null)).toBe(false);
  });
});
