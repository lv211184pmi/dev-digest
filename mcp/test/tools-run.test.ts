import { describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  FindingRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';
import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import type { Endpoints } from '../src/api/endpoints.js';
import { ERROR_MAX, TOOL_PREFIX } from '../src/config.js';
import { errorMessages, toolError } from '../src/domain/errors.js';
import { RUN_AGENT_ON_PR_DESCRIPTION, RUN_AGENT_ON_PR_TITLE } from '../src/tools/descriptions.js';
import { ReviewResultOutput } from '../src/tools/schemas.js';
import {
  createRunAgentOnPrHandler,
  registerRunAgentOnPr,
  type RunAgentOnPrOptions,
} from '../src/tools/run-agent-on-pr.js';

/**
 * `run_agent_on_pr` is the one tool that spends money, and the only one whose
 * result the caller cannot re-derive by asking again — a lost `run_id` strands a
 * paid review with no handle on it. These tests are written around that: every
 * non-completed branch is asserted to carry a NON-EMPTY run id, and the failed
 * branch is asserted to explain itself, because a failed run and a clean PR with
 * zero findings are indistinguishable everywhere else in the API.
 *
 * Nothing here waits. The poll loop's clock and sleep are injected through the
 * handler's `wait` option, so a five-minute cap elapses in microtasks.
 */

// ---- Typed factories -------------------------------------------------------
// `RunSummary` has 17 fields, `FindingRecord` 17, `Repo` 9 — spelling them out
// per test would bury the one field the test is actually about.

const AGENT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const ARGS = { repo: 'acme/payments-api', pr: 482, agent: 'General Reviewer' };

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner: 'acme',
    name: 'payments-api',
    full_name: 'acme/payments-api',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...over,
  };
}

function pull(over: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 482,
    title: 'Add idempotency keys',
    author: 'octocat',
    branch: 'feat/idempotency',
    base: 'main',
    head_sha: 'abc123',
    additions: 40,
    deletions: 3,
    files_count: 4,
    status: 'needs_review',
    ...over,
  };
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    name: 'General Reviewer',
    description: 'reviews everything',
    provider: 'openai',
    model: 'gpt-5',
    system_prompt: 'you review code',
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...over,
  };
}

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: 'run-1',
    agent_id: AGENT_ID,
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

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'f-1',
    review_id: 'rev-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: 'do this instead',
    confidence: 0.9,
    kind: 'finding',
    scope: 'in_scope',
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev-1',
    pr_id: 'pr-1',
    agent_id: AGENT_ID,
    run_id: 'run-1',
    agent_name: 'General Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'a summary',
    score: 42,
    model: 'gpt-5',
    grounding: null,
    created_at: '2026-01-01T00:00:00.000Z',
    findings: [],
    ...over,
  } as ReviewRecord;
}

/**
 * `reviews` is ALWAYS `[]` on the wire — `POST /pulls/:id/review` is
 * fire-and-forget. The factory hard-codes that rather than letting a test set
 * it, so no test can accidentally prove a handler that reads it works.
 */
function started(over: Partial<Omit<ReviewRunResponse, 'reviews'>> = {}): ReviewRunResponse {
  return {
    pr_id: 'pr-1',
    runs: [{ run_id: 'run-1', agent_id: AGENT_ID, agent_name: 'General Reviewer' }],
    ...over,
    reviews: [],
  };
}

// ---- The Endpoints stub ----------------------------------------------------

interface Script {
  pulls?: PrMeta[];
  agents?: Agent[];
  /** The `POST /pulls/:id/review` answer, or the error it raises. */
  start?: ReviewRunResponse | Error;
  /** One entry per poll of `GET /pulls/:id/runs`; the last entry repeats forever. */
  runs?: RunSummary[][];
  reviews?: ReviewRecord[];
  /** Fires after each poll — how a test aborts mid-wait. */
  onRuns?: (n: number) => void;
}

/**
 * A fresh repo id per stub, deliberately.
 *
 * `resolvePr` memoizes `repoId + number → prId` in a process-wide cache for 60
 * seconds, which is right in production (that route re-syncs from GitHub on
 * every call) and poisonous across tests: a shared id would let one test's
 * resolution satisfy the next test's assertion that `listPulls` was called.
 */
let repoSeq = 0;

function stub(script: Script = {}) {
  const repoId = `repo-${(repoSeq += 1)}`;
  const calls: string[] = [];
  let polls = 0;

  const listRepos = vi.fn(async () => {
    calls.push('listRepos');
    return [repo({ id: repoId })];
  });
  const listPulls = vi.fn(async () => {
    calls.push('listPulls');
    return script.pulls ?? [pull()];
  });
  const listAgents = vi.fn(async () => {
    calls.push('listAgents');
    return script.agents ?? [agent()];
  });
  const startReview = vi.fn(async (_prId: string, _agentId: string, _opts?: unknown) => {
    calls.push('startReview');
    const answer = script.start ?? started();
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const listRuns = vi.fn(async () => {
    calls.push('listRuns');
    polls += 1;
    const steps = script.runs ?? [[run({ status: 'done' })]];
    script.onRuns?.(polls);
    return steps[Math.min(polls - 1, steps.length - 1)] ?? [];
  });
  const listReviews = vi.fn(async () => {
    calls.push('listReviews');
    return script.reviews ?? [];
  });
  /**
   * The DevDigest API has no "cancel a run" route and this tool must never want
   * one: on a timeout or a host cancellation the run keeps going and the caller
   * is handed its id. The spy exists so "we did not cancel" is asserted rather
   * than assumed from the absence of a method.
   */
  const cancelRun = vi.fn();

  const endpoints = {
    listRepos,
    listPulls,
    listAgents,
    startReview,
    listRuns,
    listReviews,
    cancelRun,
  } as unknown as Endpoints;

  return {
    endpoints,
    calls,
    repoId,
    listRepos,
    listPulls,
    listAgents,
    startReview,
    listRuns,
    listReviews,
    cancelRun,
  };
}

// ---- The fake host ---------------------------------------------------------

/**
 * A clock that only moves when the loop sleeps, so elapsed time is a
 * deterministic function of how many times the loop went round and the suite
 * never waits on a real timer.
 */
function clock(): Required<Pick<NonNullable<RunAgentOnPrOptions['wait']>, 'now' | 'sleep'>> {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number): Promise<void> => {
      t += ms;
    },
  };
}

/** Poll timings small enough to read, plus the injected clock. */
function fast(over: NonNullable<RunAgentOnPrOptions['wait']> = {}): RunAgentOnPrOptions {
  return {
    wait: { ...clock(), firstDelayMs: 1000, intervalMs: 2000, timeoutMs: 300_000, ...over },
  };
}

function context(over: { signal?: AbortSignal; progressToken?: string | number } = {}) {
  const notify = vi.fn(async (): Promise<void> => {});
  const ctx = {
    mcpReq: {
      signal: over.signal ?? new AbortController().signal,
      notify,
      _meta: over.progressToken === undefined ? undefined : { progressToken: over.progressToken },
    },
  } as unknown as ServerContext;
  return { ctx, notify };
}

/**
 * The structured payload, parsed with the tool's own declared `outputSchema`.
 *
 * Parsing rather than reading is the point: `isError` results skip the SDK's
 * output validation, so every success-shaped branch here has to satisfy the
 * schema or a host would reject the call at runtime.
 */
function payload(result: CallToolResult) {
  expect(result.isError).toBeUndefined();
  const parsed = ReviewResultOutput.safeParse(result.structuredContent);
  if (!parsed.success) {
    throw new Error(`structuredContent does not satisfy ReviewResultOutput: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** The `content` text of an error result, asserted to actually be an error. */
function errorText(result: CallToolResult): string {
  expect(result.isError).toBe(true);
  const block = result.content[0];
  expect(block?.type).toBe('text');
  return block?.type === 'text' ? block.text : '';
}

function callTool(
  s: ReturnType<typeof stub>,
  options: RunAgentOnPrOptions = fast(),
  ctxParts: Parameters<typeof context>[0] = {},
  args: typeof ARGS = ARGS,
) {
  const host = context(ctxParts);
  const handler = createRunAgentOnPrHandler({ endpoints: s.endpoints }, options);
  return { result: handler(args, host.ctx), notify: host.notify };
}

// ---- Registration ----------------------------------------------------------

/**
 * The registration is a contract with two audiences: the model, which reads the
 * description, and the HOST, which reads the annotations to decide whether a
 * call can be auto-approved. Getting `readOnlyHint` wrong here would let a host
 * spend the user's money without asking.
 */
describe('registerRunAgentOnPr — registration', () => {
  function registered() {
    const tools: Array<{ name: string; config: Record<string, unknown> }> = [];
    const server = {
      registerTool: (name: string, config: Record<string, unknown>) => {
        tools.push({ name, config });
        return {};
      },
    } as never;

    registerRunAgentOnPr(server, { endpoints: stub().endpoints });
    return tools;
  }

  it('registers exactly one tool, named run_agent_on_pr under the configured prefix', () => {
    const tools = registered();

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe(`${TOOL_PREFIX}run_agent_on_pr`);
  });

  it('uses the approved title and description consts byte-for-byte', () => {
    const config = registered()[0]?.config ?? {};

    expect(config.title).toBe(RUN_AGENT_ON_PR_TITLE);
    expect(config.description).toBe(RUN_AGENT_ON_PR_DESCRIPTION);
  });

  it('is annotated as a money-spending write, so no host can auto-approve it as a read', () => {
    const config = registered()[0]?.config ?? {};

    expect(config.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('declares both an input and an output schema', () => {
    const config = registered()[0]?.config ?? {};

    expect(config.inputSchema).toBeDefined();
    expect(config.outputSchema).toBeDefined();
  });
});

// ---- Happy path ------------------------------------------------------------

/**
 * One call, four API round trips, and a projected result. The assertions that
 * matter are the ones a shortcut would break: the run id we started is what the
 * reviews are filtered by, and the digest is prose rather than a JSON dump.
 */
describe('run_agent_on_pr — completed', () => {
  it('resolves, starts, waits and returns the review as completed', async () => {
    const s = stub({
      runs: [[run({ status: 'running' })], [run({ status: 'done' })]],
      reviews: [
        review({
          findings: [
            finding({ id: 'f-1', severity: 'CRITICAL', title: 'unbounded query' }),
            finding({ id: 'f-2', severity: 'WARNING', title: 'missing test' }),
          ],
        }),
      ],
    });

    const r = await callTool(s).result;
    const out = payload(r);

    expect(out.status).toBe('completed');
    expect(out.repo).toBe('acme/payments-api');
    expect(out.pr).toBe(482);
    expect(out.agent).toBe('General Reviewer');
    expect(out.run_id).toBe('run-1');
    expect(out.verdict).toBe('request_changes');
    expect(out.score).toBe(42);
    expect(out.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
    expect(out.findings).toHaveLength(2);
    // Most severe first — the model reads the top of the list.
    expect(out.findings[0]?.severity).toBe('CRITICAL');
    expect(out.total_findings).toBe(2);
    expect(out.truncated).toBe(false);
    expect(out.next_step).toBeNull();
    expect(s.calls).toEqual([
      'listRepos',
      'listPulls',
      'listAgents',
      'startReview',
      'listRuns',
      'listRuns',
      'listReviews',
    ]);
  });

  it('answers with a one-line human digest, not a JSON dump', async () => {
    const s = stub({
      reviews: [review({ findings: [finding({ severity: 'CRITICAL' })] })],
    });

    const r = await callTool(s).result;
    const text = r.content[0]?.type === 'text' ? r.content[0].text : '';

    expect(text).toBe('request_changes · score 42 · 1 CRITICAL — 1 finding');
    expect(text).not.toContain('{');
  });

  it('starts the run against the resolved uuids and forwards the host signal', async () => {
    const controller = new AbortController();
    const s = stub();

    await callTool(s, fast(), { signal: controller.signal }).result;

    expect(s.startReview).toHaveBeenCalledWith('pr-1', AGENT_ID, { signal: controller.signal });
  });

  it('projects only the run it started, never a previous agent’s review of the same PR', async () => {
    const s = stub({
      reviews: [
        review({ id: 'rev-old', run_id: 'run-yesterday', verdict: 'approve', score: 100 }),
        review({ id: 'rev-mine', run_id: 'run-1', verdict: 'request_changes', score: 42 }),
      ],
    });

    const out = payload(await callTool(s).result);

    expect(out.run_id).toBe('run-1');
    expect(out.verdict).toBe('request_changes');
    expect(out.score).toBe(42);
  });

  it('a finished run with no stored review keeps the run id and points at get_findings', async () => {
    const s = stub({ reviews: [] });

    const out = payload(await callTool(s).result);

    expect(out.status).toBe('not_reviewed');
    // The run id is the whole value of this branch: without it the caller has no
    // handle on a run DevDigest already charged for.
    expect(out.run_id).toBe('run-1');
    expect(out.agent).toBe('General Reviewer');
    expect(out.next_step).toContain('get_findings');
  });

  it('names the agent from the run row, so an id-shaped argument still reads as a name', async () => {
    const s = stub();

    const out = payload(
      await callTool(s, fast(), {}, { ...ARGS, agent: AGENT_ID }).result,
    );

    expect(out.agent).toBe('General Reviewer');
  });
});

// ---- Failure ---------------------------------------------------------------

/**
 * The only branch that can tell a dead run from a clean PR. `/pulls/:id/reviews`
 * shows an absent review for both, so if this handler read the review list to
 * decide, a missing API key would be reported as "approve, no findings".
 */
describe('run_agent_on_pr — failed run', () => {
  const failed = [[run({ status: 'failed', error: 'provider 401: invalid api key' })]];

  it('reports status failed and names the missing-API-key cause with the run id', async () => {
    const s = stub({ runs: failed });

    const out = payload(await callTool(s).result);

    expect(out.status).toBe('failed');
    expect(out.error).toBe('provider 401: invalid api key');
    expect(out.next_step).toContain('API key');
    expect(out.next_step).toContain('Settings');
    expect(out.next_step).toContain('run-1');
    expect(out.run_id).toBe('run-1');
    expect(out.findings).toEqual([]);
  });

  it('does not consult the review list, which cannot distinguish this from a clean PR', async () => {
    const s = stub({ runs: failed, reviews: [review({ verdict: 'approve', score: 100 })] });

    const out = payload(await callTool(s).result);

    expect(out.status).toBe('failed');
    expect(out.verdict).toBeNull();
    expect(s.listReviews).not.toHaveBeenCalled();
  });

  it('truncates a long provider error before it reaches the calling model', async () => {
    const s = stub({ runs: [[run({ status: 'failed', error: 'x'.repeat(5000) })]] });

    const out = payload(await callTool(s).result);

    expect(out.error?.length).toBeLessThan(ERROR_MAX + 40);
    expect(out.error).toContain('(truncated)');
  });

  it('a cancelled run is a failure too, not a silent success', async () => {
    const s = stub({ runs: [[run({ status: 'cancelled', error: 'cancelled by operator' })]] });

    const out = payload(await callTool(s).result);

    expect(out.status).toBe('failed');
    expect(out.run_id).toBe('run-1');
  });
});

// ---- Still running ---------------------------------------------------------

/**
 * Losing the run id here is the worst outcome this tool has: the user has paid
 * for a review that is still being produced and would have no way to ask for it.
 * Both branches therefore assert the exact id, not merely a truthy one.
 */
describe('run_agent_on_pr — still running', () => {
  const forever = [[run({ status: 'running' })]];

  it('cap elapsed → still_running with the run id and an instruction to read it later', async () => {
    const s = stub({ runs: forever });

    const out = payload(await callTool(s, fast({ timeoutMs: 5000 })).result);

    expect(out.status).toBe('still_running');
    expect(out.run_id).toBe('run-1');
    expect(out.run_id).not.toBe('');
    expect(out.next_step).toContain('get_findings');
    expect(out.next_step).toContain('run-1');
    // Re-running would start a SECOND paid review alongside the first.
    expect(out.next_step).toContain('Do NOT call run_agent_on_pr again');
    expect(out.verdict).toBeNull();
    expect(out.findings).toEqual([]);
  });

  it('the digest says still_running rather than implying a verdict', async () => {
    const s = stub({ runs: forever });

    const r = await callTool(s, fast({ timeoutMs: 5000 })).result;
    const text = r.content[0]?.type === 'text' ? r.content[0].text : '';

    expect(text.startsWith('still_running')).toBe(true);
  });

  it('host cancellation → still_running, and the server-side run is left alone', async () => {
    const controller = new AbortController();
    const s = stub({ runs: forever, onRuns: () => controller.abort() });

    const out = payload(await callTool(s, fast(), { signal: controller.signal }).result);

    expect(out.status).toBe('still_running');
    expect(out.run_id).toBe('run-1');
    expect(out.next_step).toContain('get_findings');
    // Nothing cancels the run: it keeps going and the caller collects it later.
    expect(s.cancelRun).not.toHaveBeenCalled();
    expect(s.calls.some((c) => /cancel/i.test(c))).toBe(false);
  });
});

// ---- Errors ----------------------------------------------------------------

/**
 * Failures that never produce a review: they come back as `isError` with a
 * catalogued message, which the SDK exempts from output-schema validation.
 */
describe('run_agent_on_pr — leads-forward errors', () => {
  it('an accepted POST that started no run is run_not_started, never a clean result', async () => {
    // `waitForRuns` answers `done` for an empty id list by design, so without the
    // handler's own guard this would be reported as a successful review.
    const s = stub({ start: started({ runs: [] }) });

    const text = errorText(await callTool(s).result);

    expect(text).toBe(errorMessages.run_not_started('General Reviewer', 482));
    expect(s.listRuns).not.toHaveBeenCalled();
    expect(s.listReviews).not.toHaveBeenCalled();
  });

  it('a 429 surfaces as run_rate_limited, mapped once in the endpoint layer', async () => {
    const s = stub({ start: toolError('run_rate_limited') });

    const text = errorText(await callTool(s).result);

    // Passed through unchanged — the handler must not re-map or re-word it.
    expect(text).toBe(errorMessages.run_rate_limited());
    expect(text).toContain('get_findings');
  });

  it('an unknown agent never reaches startReview, so nothing is charged', async () => {
    const s = stub();

    const r = await callTool(s, fast(), {}, { ...ARGS, agent: 'Nope Reviewer' }).result;

    expect(errorText(r)).toBe(errorMessages.agent_not_found('Nope Reviewer'));
    expect(s.startReview).not.toHaveBeenCalled();
  });

  it('a non-ToolError throw is replaced wholesale rather than leaking a stack trace', async () => {
    const s = stub({ start: new TypeError('fetch failed at line 42 of client.ts') });

    const text = errorText(await callTool(s).result);

    expect(text).not.toContain('client.ts');
    expect(text).toContain('call this tool again');
  });
});

// ---- Disabled agents -------------------------------------------------------

describe('run_agent_on_pr — disabled agent', () => {
  it('runs it anyway, as the API does, and says so in next_step', async () => {
    const s = stub({
      agents: [agent({ enabled: false })],
      reviews: [review()],
    });

    const out = payload(await callTool(s).result);

    expect(s.startReview).toHaveBeenCalled();
    expect(out.status).toBe('completed');
    expect(out.next_step).toContain('disabled');
  });
});

// ---- Progress notifications ------------------------------------------------

/**
 * Progress is what keeps a five-minute blocking call alive: hosts reset their
 * per-request idle timeout when one arrives. It is an optimisation, so the only
 * hard rules are that it is correlated with the token the request carried and
 * that a request WITHOUT a token gets no unsolicited notifications.
 */
describe('run_agent_on_pr — progress', () => {
  it('emits a progress notification carrying the request’s progress token', async () => {
    const s = stub();

    const call = callTool(s, fast(), { progressToken: 'tok-1' });
    await call.result;

    expect(call.notify).toHaveBeenCalled();
    const notification = call.notify.mock.calls[0]?.[0] as {
      method: string;
      params: { progressToken: unknown; total: unknown };
    };
    expect(notification.method).toBe('notifications/progress');
    expect(notification.params.progressToken).toBe('tok-1');
    expect(notification.params.total).toBe(300_000);
  });

  it('sends nothing when the request carried no progress token', async () => {
    const s = stub();

    const call = callTool(s);
    await call.result;

    expect(call.notify).not.toHaveBeenCalled();
  });

  it('a host that rejects the notification does not fail the review', async () => {
    const s = stub({ reviews: [review()] });
    const host = context({ progressToken: 7 });
    host.notify.mockRejectedValue(new Error('host does not do progress'));
    const handler = createRunAgentOnPrHandler({ endpoints: s.endpoints }, fast());

    const out = payload(await handler(ARGS, host.ctx));

    expect(out.status).toBe('completed');
  });
});
