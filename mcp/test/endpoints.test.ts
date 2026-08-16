import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Agent,
  ConventionSkillDraft,
  ConventionsView,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';
import { createEndpoints, endpoints as realEndpoints } from '../src/api/endpoints.js';
import { isToolError, type ToolError } from '../src/domain/errors.js';
import { API_BASE } from '../src/config.js';

/**
 * Typed factories. Every contract here has 9–17 fields and a test that spells
 * them all out hides the one field it is about.
 */
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

/** `strategy`, `ci_fail_on` and `repo_intel` are omitted on purpose — see the defaults test. */
function agent(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'agent-1',
    name: 'General Reviewer',
    description: 'reviews everything',
    provider: 'openai',
    model: 'gpt-5',
    system_prompt: 'you review code',
    enabled: true,
    version: 1,
    ...over,
  };
}

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

function runResponse(over: Partial<ReviewRunResponse> = {}): ReviewRunResponse {
  return {
    pr_id: 'pr-1',
    runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'General Reviewer' }],
    // Always empty on the wire — POST /pulls/:id/review is fire-and-forget.
    reviews: [],
    ...over,
  };
}

function conventionsView(over: Partial<ConventionsView> = {}): ConventionsView {
  return {
    run: {
      id: 'crun-1',
      repo_id: 'repo-1',
      status: 'done',
      sample_count: 30,
      candidate_count: 12,
      dropped_count: 2,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    candidates: [],
    ...over,
  };
}

function skillDraft(over: Partial<ConventionSkillDraft> = {}): ConventionSkillDraft {
  return {
    name: 'acme/payments-api conventions',
    description: 'house style',
    type: 'convention',
    enabled: true,
    body: '- Prefer X over Y (src/a.ts:12)',
    evidence_files: ['src/a.ts'],
    source_count: 3,
    repo_name: 'acme/payments-api',
    ...over,
  };
}

// ---- fetch stubbing --------------------------------------------------------

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

let calls: Array<{ url: string; init: RequestInit }>;

function stubFetch(handler: Handler): void {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

/** 200 with a JSON body. */
function ok(body: unknown): Handler {
  return () => new Response(JSON.stringify(body), { status: 200 });
}

/** A non-2xx carrying the API's error envelope. */
function fail(status: number, message = 'nope'): Handler {
  return () =>
    new Response(JSON.stringify({ error: { code: 'ERR', message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** Awaits a rejection and asserts it is a `ToolError`, returning it narrowed. */
async function rejection(p: Promise<unknown>): Promise<ToolError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!isToolError(e)) {
    throw new Error(`expected a ToolError, got: ${String(e)}`);
  }
  return e;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const api = realEndpoints;

/**
 * The endpoints layer is the package's contract boundary: everything downstream
 * assumes the shapes in `@devdigest/shared` are real. Two of these routes
 * (`GET /agents`, `GET /pulls/:id/reviews`) declare NO response schema
 * server-side, so nothing but the `.parse` here enforces them on the wire.
 * These pin that a valid body arrives typed, and that every other outcome — a
 * drifted shape, any non-2xx, a dead API — becomes one catalogued ToolError
 * rather than a crash three modules later.
 */
describe('endpoints — a valid response arrives parsed', () => {
  it('GET /repos 200 → Repo[]', async () => {
    stubFetch(ok([repo(), repo({ id: 'repo-2', full_name: 'globex/billing' })]));

    const repos = await api.listRepos();

    expect(repos).toHaveLength(2);
    expect(repos[0]?.full_name).toBe('acme/payments-api');
    expect(calls[0]?.url).toBe(`${API_BASE}/repos`);
  });

  it('GET /repos/:id/pulls 200 → PrMeta[], and a null id survives as null', async () => {
    stubFetch(ok([pull(), pull({ id: null, number: 483 })]));

    const pulls = await api.listPulls('repo-1');

    expect(pulls.map((p) => p.number)).toEqual([482, 483]);
    // The contract allows a null id (seen on GitHub, not imported). Dropping or
    // defaulting it here would hide `pr_not_imported` from the resolver.
    expect(pulls[1]?.id).toBeNull();
    expect(calls[0]?.url).toBe(`${API_BASE}/repos/repo-1/pulls`);
  });

  it('GET /agents 200 without the optional fields → schema defaults applied', async () => {
    stubFetch(ok([agent()]));

    const agents = await api.listAgents();

    // This route has no server-side response schema, so these three values exist
    // only because the client-side parse put them there.
    expect(agents[0]?.strategy).toBe('single-pass');
    expect(agents[0]?.ci_fail_on).toBe('critical');
    expect(agents[0]?.repo_intel).toBe(true);
  });

  it('GET /pulls/:id/runs 200 → RunSummary[] keeping the error text', async () => {
    stubFetch(ok([run({ status: 'failed', error: 'no API key configured' })]));

    const runs = await api.listRuns('pr-1');

    // `RunSummary.error` is the ONLY way to tell a failed run from a clean PR.
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.error).toBe('no API key configured');
  });

  it('GET /pulls/:id/reviews 200 → ReviewRecord[]', async () => {
    stubFetch(ok([review()]));

    const reviews = await api.listReviews('pr-1');

    expect(reviews[0]?.run_id).toBe('run-1');
    expect(calls[0]?.url).toBe(`${API_BASE}/pulls/pr-1/reviews`);
  });

  it('GET /repos/:id/conventions 200 with run: null → parsed, not rejected', async () => {
    stubFetch(ok(conventionsView({ run: null })));

    const view = await api.getConventions('repo-1');

    // `run: null` is the "never extracted" branch, a legitimate answer.
    expect(view.run).toBeNull();
    expect(view.candidates).toEqual([]);
  });

  it('GET /conventions/runs/:id/skill-draft 200 → ConventionSkillDraft', async () => {
    stubFetch(ok(skillDraft()));

    const draft = await api.getSkillDraft('crun-1');

    expect(draft.repo_name).toBe('acme/payments-api');
    expect(calls[0]?.url).toBe(`${API_BASE}/conventions/runs/crun-1/skill-draft`);
  });

  it('POST /pulls/:id/review 200 → run ids, and reviews is empty as the API always sends it', async () => {
    stubFetch(ok(runResponse()));

    const started = await api.startReview('pr-1', 'agent-1');

    expect(started.runs.map((r) => r.run_id)).toEqual(['run-1']);
    expect(started.reviews).toEqual([]);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ agentId: 'agent-1' }));
  });
});

/**
 * A drifted response is the failure mode a host makes likely: this package is
 * spawned by an editor and can easily be a `git pull` out of step with the API.
 * The parse must name the shape and the first offending path, because "restart
 * the API" is only actionable when the caller can see WHAT disagreed.
 */
describe('endpoints — a malformed body becomes contract_mismatch', () => {
  it('a review missing its findings array → contract_mismatch naming the path', async () => {
    const { findings: _dropped, ...withoutFindings } = review();
    stubFetch(ok([withoutFindings]));

    const err = await rejection(api.listReviews('pr-1'));

    expect(err.code).toBe('contract_mismatch');
    expect(err.message).toContain('ReviewRecord[]');
    expect(err.message).toContain('0.findings');
  });

  it('an object where an array was promised → contract_mismatch at the root', async () => {
    stubFetch(ok({ repos: [] }));

    const err = await rejection(api.listRepos());

    expect(err.code).toBe('contract_mismatch');
    expect(err.message).toContain('Repo[]');
    expect(err.message).toContain('(root)');
  });

  it('a wrong-typed field → contract_mismatch, not a silent coercion', async () => {
    stubFetch(ok([pull({ number: '482' } as unknown as Partial<PrMeta>)]));

    const err = await rejection(api.listPulls('repo-1'));

    expect(err.code).toBe('contract_mismatch');
    expect(err.message).toContain('0.number');
  });

  it('an unknown extra field → accepted, so an API that grows a column stays usable', async () => {
    stubFetch(ok([{ ...repo(), brand_new_column: 'whatever' }]));

    await expect(api.listRepos()).resolves.toHaveLength(1);
  });

  it('a 200 whose body is not JSON at all → contract_mismatch, never a raw parse error', async () => {
    stubFetch(() => new Response('not json', { status: 200 }));

    const err = await rejection(api.listAgents());

    expect(err.code).toBe('contract_mismatch');
  });
});

/**
 * Every non-2xx has to arrive as a catalogued, leads-forward message. The one
 * status that is NOT generic is 429 on the review route: the API's per-route
 * 10/min run limit is a different problem from its global 120/min limit, and has
 * a different next step.
 */
describe('endpoints — HTTP failures map to catalogued errors', () => {
  it('404 → api_error naming the status and pointing at the UI', async () => {
    stubFetch(fail(404, 'Pull request not found'));

    const err = await rejection(api.listPulls('repo-missing'));

    expect(err.code).toBe('api_error');
    expect(err.message).toContain('404');
    expect(err.message).toContain('Pull request not found');
    expect(err.message).toContain('Confirm');
  });

  it('422 → api_error telling the caller to re-check the arguments', async () => {
    stubFetch(fail(422, 'params/id must be a string'));

    const err = await rejection(api.startReview('pr-1', 'agent-1'));

    expect(err.code).toBe('api_error');
    expect(err.message).toContain('422');
    expect(err.message).toContain('Re-check');
  });

  it('429 on POST review → run_rate_limited, the 10/min run limit, not the global one', async () => {
    stubFetch(fail(429, 'Rate limit exceeded'));

    const err = await rejection(api.startReview('pr-1', 'agent-1'));

    expect(err.code).toBe('run_rate_limited');
    expect(err.message).toContain('10 per minute');
    expect(err.message).toContain('get_findings');
  });

  it('429 on a read → api_error, the global limit, with its own wait instruction', async () => {
    stubFetch(fail(429, 'Rate limit exceeded'));

    const err = await rejection(api.listRepos());

    expect(err.code).toBe('api_error');
    expect(err.message).toContain('429');
    expect(err.message).toContain('Wait a minute');
  });

  it('500 → api_error pointing at the API terminal and a restart', async () => {
    stubFetch(fail(500, 'boom'));

    const err = await rejection(api.listRuns('pr-1'));

    expect(err.code).toBe('api_error');
    expect(err.message).toContain('500');
    expect(err.message).toContain('./scripts/dev.sh');
  });

  it('fetch throws → api_unreachable naming the base URL and how to change it', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });

    const err = await rejection(api.getConventions('repo-1'));

    expect(err.code).toBe('api_unreachable');
    expect(err.message).toContain(API_BASE);
    expect(err.message).toContain('DEVDIGEST_API_BASE');
  });

  it('a host cancellation → propagates as an abort, never as "the API is down"', async () => {
    stubFetch(() => {
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      throw abort;
    });

    const e = await api.listRepos().then(
      () => null,
      (err: unknown) => err,
    );

    expect(isToolError(e)).toBe(false);
    expect((e as Error).name).toBe('AbortError');
  });
});

/**
 * Path segments include `agentId`, which can be a raw string a calling model
 * invented. An unencoded `../` would re-target the request at a different route
 * entirely — encoding is what keeps a bad argument a 404 instead of a call to
 * something else.
 */
describe('endpoints — request shaping', () => {
  it('an id containing a slash → percent-encoded, so it cannot escape its segment', async () => {
    stubFetch(ok([]));

    await api.listPulls('../../agents');

    expect(calls[0]?.url).toBe(`${API_BASE}/repos/..%2F..%2Fagents/pulls`);
    expect(calls[0]?.url).not.toContain('/agents/pulls');
  });

  it('a signal → passed straight through to fetch', async () => {
    stubFetch(ok([]));
    const controller = new AbortController();

    await api.listRuns('pr-1', { signal: controller.signal });

    expect(calls[0]?.init.signal).toBe(controller.signal);
  });

  it('no signal → no signal key, so an explicit undefined never reaches fetch', async () => {
    stubFetch(ok([]));

    await api.listRuns('pr-1');

    expect('signal' in (calls[0]?.init ?? {})).toBe(false);
  });

  it('a GET → no JSON content-type, which would trip the API’s empty-body check', async () => {
    stubFetch(ok([]));

    await api.listRepos();

    expect(calls[0]?.init.headers).toBeUndefined();
    expect(calls[0]?.init.body).toBeUndefined();
  });
});

/**
 * `health` is a probe: its caller is code choosing which message to show, so a
 * probe that throws just moves the decision. A cancellation is still not a
 * health verdict.
 */
describe('endpoints — health reports rather than throws', () => {
  it('200 → true', async () => {
    stubFetch(ok({ status: 'ok' }));

    await expect(api.health()).resolves.toBe(true);
  });

  it('the API is down → false, not a throw', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed');
    });

    await expect(api.health()).resolves.toBe(false);
  });

  it('a host cancellation → still throws, because that is not a health verdict', async () => {
    stubFetch(() => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      throw abort;
    });

    await expect(api.health()).rejects.toThrow('aborted');
  });
});

/**
 * Later steps hand the tool handlers a stubbed `Endpoints`, so the object has to
 * be substitutable at both seams: the whole object, and the transport under it.
 */
describe('createEndpoints — the injection seam', () => {
  it('an injected request → used instead of fetch, still validated', async () => {
    stubFetch(ok([repo({ id: 'from-network' })]));
    const injected = createEndpoints({
      request: async () => [repo({ id: 'from-stub' })] as never,
    });

    const repos = await injected.listRepos();

    expect(repos[0]?.id).toBe('from-stub');
    expect(calls).toHaveLength(0);
  });

  it('an injected request returning a drifted body → still contract_mismatch', async () => {
    const injected = createEndpoints({ request: async () => ({ nope: true }) as never });

    const err = await rejection(injected.listAgents());

    expect(err.code).toBe('contract_mismatch');
    expect(err.message).toContain('Agent[]');
  });
});
