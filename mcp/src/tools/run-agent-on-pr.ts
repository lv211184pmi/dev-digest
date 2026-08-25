/**
 * `run_agent_on_pr` — the tool design principle #1 ("result, not operation") was
 * written for.
 *
 * One call does the whole job: resolve the repo, the PR and the agent, start the
 * run, WAIT for it, and return the projected verdict and findings. The API needs
 * four round trips and two uuid lookups to get there; a model calling this tool
 * needs `"acme/payments-api"`, `482` and `"Security Reviewer"`.
 *
 * THIS IS THE ONLY TOOL THAT SPENDS MONEY. Its annotations say so
 * (`readOnlyHint: false`, `idempotentHint: false`) precisely so a host cannot
 * auto-approve it as a read, and the description repeats it in capitals.
 *
 * Three things about the API shape this handler exists to absorb:
 *
 * 1. `POST /pulls/:id/review` is FIRE-AND-FORGET. Its `reviews` array is always
 *    `[]` — the contract's doc comment claiming the reviews come back "once the
 *    run completes" is stale. The run ids in `runs` are the only usable result
 *    and everything downstream is keyed off them.
 * 2. An EMPTY `runs` array is a failure this handler has to catch itself.
 *    `waitForRuns` deliberately returns `done` for an empty id list (so its loop
 *    cannot spin on a vacuously-true `every`), so without the guard below "the
 *    API started nothing" would be reported as a clean review.
 * 3. A FAILED run is invisible in `/pulls/:id/reviews`: per-agent failures are
 *    caught and only logged server-side, and an absent review is also what a
 *    clean PR with zero findings looks like. The run row carries the error text,
 *    which is why the `failed` outcome is answered from the poll result and
 *    never from the review list.
 *
 * On timeout or host cancellation the server-side run is deliberately left
 * RUNNING — the user is paying for it — and the caller gets `still_running` plus
 * the `run_id` to pick it up with `get_findings`.
 */

import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server';
import type { Endpoints } from '../api/endpoints.js';
import { DEFAULT_MAX_FINDINGS, ERROR_MAX, RUN_TIMEOUT_MS, TOOL_PREFIX } from '../config.js';
import { errorMessages, toErrorResult, toolError, truncate } from '../domain/errors.js';
import { selectReviewsForRuns, waitForRuns, type WaitOptions } from '../domain/poll.js';
import { formatReviewDigest, projectReview, type ReviewResult } from '../domain/project.js';
import { resolveAgent, resolvePr, resolveRepo } from '../domain/resolve.js';
import { RUN_AGENT_ON_PR_DESCRIPTION, RUN_AGENT_ON_PR_TITLE } from './descriptions.js';
import { ReviewResultOutput, RunAgentOnPrInput } from './schemas.js';

/** What the tool needs from the outside world. Injected so tests need no fetch. */
export interface RunAgentOnPrDeps {
  endpoints: Endpoints;
}

export interface RunAgentOnPrOptions {
  /**
   * Extra `waitForRuns` options, merged under our own `signal`. This is the test
   * seam: injecting `now`/`sleep` is what lets the suite exercise a five-minute
   * cap without waiting five minutes — or one second.
   */
  wait?: Omit<WaitOptions, 'signal'>;
}

export type RunAgentOnPrHandler = (
  args: RunAgentOnPrInput,
  ctx: ServerContext,
) => Promise<CallToolResult>;

/**
 * How often a progress notification goes out while we block.
 *
 * Hosts reset their per-request idle timeout when a progress notification
 * arrives, and that is the only reason a 5-minute blocking call survives a host
 * whose default cap is 60 seconds. 10s is comfortably inside every default we
 * know of and costs one tiny notification per tick.
 */
const PROGRESS_INTERVAL_MS = 10_000;

/**
 * Builds the handler. `registerRunAgentOnPr` is the production caller and passes
 * no options; tests call this directly with a fake clock.
 */
export function createRunAgentOnPrHandler(
  deps: RunAgentOnPrDeps,
  options: RunAgentOnPrOptions = {},
): RunAgentOnPrHandler {
  const { endpoints } = deps;

  return async (args, ctx) => {
    const signal = ctx.mcpReq.signal;

    try {
      // Flat arguments in, uuids out. Any of the three can raise a catalogued
      // `ToolError` that names what to pass instead.
      const repo = await resolveRepo(endpoints, args.repo, { signal });
      const pr = await resolvePr(endpoints, repo, args.pr, { signal });
      const agent = await resolveAgent(endpoints, args.agent, { signal });

      // A 429 here is the per-route 10/min review limit and already arrives as
      // `run_rate_limited` from the endpoint layer — mapped once, in
      // `endpoints.startReview`, because only that call site knows the limit is
      // about runs rather than the API's global 120/min budget.
      const started = await endpoints.startReview(pr.id, agent.id, { signal });

      const runIds = started.runs.map((r) => r.run_id);
      const primaryRunId = runIds[0];
      if (primaryRunId === undefined) {
        // Trap 2 from the header: `waitForRuns([])` answers `done`, so this
        // guard is the only thing between "nothing started" and a fabricated
        // clean bill of health.
        throw toolError('run_not_started', agent.name, pr.number);
      }

      // The run row's own name beats the resolved one: an `agent` argument that
      // was a bare id resolves to a `ResolvedAgent` whose `name` IS that id, and
      // a response saying `7f3c…` reviewed the PR helps nobody.
      const agentName = started.runs[0]?.agent_name ?? agent.name;
      const timeoutMs = options.wait?.timeoutMs ?? RUN_TIMEOUT_MS;

      const stopProgress = startProgress(ctx, timeoutMs, `Reviewing ${repo.fullName} #${pr.number} with ${agentName}`);
      let wait;
      try {
        wait = await waitForRuns(endpoints, pr.id, runIds, { ...options.wait, signal });
      } finally {
        stopProgress();
      }

      const base = {
        repo: repo.fullName,
        pr: pr.number,
        agent: agentName,
        runId: primaryRunId,
        note: agent.note,
      };

      if (wait.outcome === 'failed') {
        const failedRunId = wait.failedRun?.run_id ?? primaryRunId;
        return result(failedResult({ ...base, runId: failedRunId, error: wait.error }));
      }

      if (wait.outcome === 'timeout' || wait.outcome === 'aborted') {
        return result(stillRunningResult({ ...base, outcome: wait.outcome, timeoutMs }));
      }

      // `done`. The reviews list holds every review this PR ever received, so it
      // is filtered to OUR run ids before projection — position in that array
      // means nothing, and a previous agent's verdict sits in it.
      const reviews = await endpoints.listReviews(pr.id, { signal });
      const mine = selectReviewsForRuns(reviews, runIds);
      const projection = projectReview(mine, { runId: primaryRunId }, DEFAULT_MAX_FINDINGS);

      return result({
        ...projection,
        repo: repo.fullName,
        pr: pr.number,
        // A run that finished without a stored review projects as
        // `not_reviewed`; keeping our own names and run id on it means the
        // caller can still act (its `next_step` says to re-read with
        // `get_findings`), instead of being told to start the run again.
        agent: projection.agent ?? agentName,
        run_id: projection.run_id ?? primaryRunId,
        next_step: withNote(projection.next_step, agent.note),
      });
    } catch (e) {
      // Every catalogued failure lands here as a `ToolError` with a leads-forward
      // message; anything else is replaced wholesale rather than leaking a stack
      // trace into the calling model's context. A host cancellation during
      // resolution also lands here, which is harmless: the host has already
      // stopped listening for this result.
      //
      // Spread for the same reason as `structuredContent` below: `CallToolResult`
      // carries an index signature and an interface does not satisfy one.
      return { ...toErrorResult(e) };
    }
  };
}

/** Registers the tool. The description and title are the approved consts, never inline text. */
export function registerRunAgentOnPr(server: McpServer, deps: { endpoints: Endpoints }): void {
  server.registerTool(
    `${TOOL_PREFIX}run_agent_on_pr`,
    {
      title: RUN_AGENT_ON_PR_TITLE,
      description: RUN_AGENT_ON_PR_DESCRIPTION,
      inputSchema: RunAgentOnPrInput,
      outputSchema: ReviewResultOutput,
      annotations: {
        // It spends real money on LLM calls, so it must never be auto-approvable
        // as a read. `destructiveHint: false` is still true — it writes a review,
        // it does not delete anything.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    createRunAgentOnPrHandler(deps),
  );
}

// ---- Result shaping --------------------------------------------------------

interface ResultBase {
  repo: string;
  pr: number;
  agent: string;
  runId: string;
  note: string | null;
}

/**
 * The MCP tool result: a one-line human digest in `content` plus the structured
 * payload. Never a JSON dump in the text — the digest is what a human skimming
 * the transcript reads, and it repeats no LLM-authored finding prose.
 */
function result(payload: ReviewResult): CallToolResult {
  return {
    content: [{ type: 'text', text: formatReviewDigest(payload) }],
    // Spread rather than passed straight through: `ReviewResult` is an interface
    // and TypeScript gives implicit index signatures only to anonymous object
    // types, which is what `structuredContent: Record<string, unknown>` wants.
    structuredContent: { ...payload },
  };
}

/**
 * A run that ended in `failed`/`cancelled`.
 *
 * This is a RESULT, not an `isError` — the caller asked "what happened to this
 * PR" and "the run died" is an answer, one that only exists here. The message is
 * still built from the catalogue's `run_failed` builder so a failure reads the
 * same whether it arrives as a status or as a thrown `ToolError`, and it carries
 * the `run_id`: without it the user cannot address the run they just paid for.
 */
function failedResult(o: ResultBase & { error: string | null }): ReviewResult {
  // The error text comes from a provider via the API and can be LLM-authored, so
  // it is truncated like any other echoed API text before it enters another
  // model's context.
  const error = o.error === null ? null : truncate(o.error, ERROR_MAX);

  return {
    ...empty(o),
    status: 'failed',
    error,
    next_step: withNote(errorMessages.run_failed(error, o.runId), o.note),
  };
}

/**
 * The cap elapsed, or the host cancelled. In BOTH cases the server-side run is
 * still going and was deliberately not cancelled — so the answer is the run id
 * and an instruction to read it later, never "try again", which would start a
 * second paid run alongside the first.
 */
function stillRunningResult(
  o: ResultBase & { outcome: 'timeout' | 'aborted'; timeoutMs: number },
): ReviewResult {
  const pickItUp =
    `Wait about a minute, then call get_findings with repo "${o.repo}" and pr ${o.pr} — or with ` +
    `run_id "${o.runId}" to address this exact run. Do NOT call run_agent_on_pr again; that would ` +
    'start a second run and charge for it.';

  const head =
    o.outcome === 'aborted'
      ? 'The MCP host cancelled this call, but the review is still running inside DevDigest — it was not cancelled there.'
      : `The ${Math.round(o.timeoutMs / 1000)}-second wait ran out while the review was still running inside DevDigest.`;

  return {
    ...empty(o),
    status: 'still_running',
    next_step: withNote(`${head} ${pickItUp}`, o.note),
  };
}

/** The fields every non-`completed` result shares. `run_id` is never empty here. */
function empty(o: ResultBase): ReviewResult {
  return {
    status: 'still_running',
    repo: o.repo,
    pr: o.pr,
    agent: o.agent,
    run_id: o.runId,
    verdict: null,
    score: null,
    summary: null,
    counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
    findings: [],
    total_findings: 0,
    truncated: false,
    error: null,
    next_step: null,
  };
}

/**
 * Appends the resolver's remark — today only "this agent is disabled, and
 * DevDigest ran it anyway". Surfaced rather than enforced: the API genuinely
 * runs a disabled agent addressed by id, so refusing here would block something
 * the caller explicitly asked for and the server is happy to do.
 */
function withNote(nextStep: string | null, note: string | null): string | null {
  if (note === null) return nextStep;
  return nextStep === null ? note : `${nextStep} ${note}`;
}

// ---- Progress --------------------------------------------------------------

/**
 * Emits `notifications/progress` while the call blocks, and returns the stopper.
 *
 * Only when the request carried a progress token: the spec forbids progress
 * notifications for a request that did not ask for them, and a host that did not
 * ask has nothing to correlate them with.
 *
 * Deliberately a timer beside the wait rather than a hook inside it — the poll
 * loop's business is run statuses, not host liveness, and this way a host with no
 * token creates no timer at all. `unref` keeps the interval from holding the
 * process open, and a notification that fails is swallowed: a host that will not
 * take progress is not a reason to fail a review the user is paying for.
 */
function startProgress(ctx: ServerContext, totalMs: number, message: string): () => void {
  const token = ctx.mcpReq._meta?.progressToken;
  if (token === undefined || token === null) return () => {};

  const startedAt = Date.now();
  const send = (): void => {
    void ctx.mcpReq
      .notify({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: Math.min(Date.now() - startedAt, totalMs),
          total: totalMs,
          message,
        },
      })
      .catch(() => {
        // stdout is the JSON-RPC channel, so there is nowhere useful to say this
        // that is worth the noise. The review continues either way.
      });
  };

  send();
  const timer = setInterval(send, PROGRESS_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
