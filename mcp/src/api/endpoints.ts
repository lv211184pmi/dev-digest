/**
 * One function per DevDigest API call, each validating the response against the
 * `@devdigest/shared` contract before anything downstream sees it.
 *
 * WHY VALIDATE A RESPONSE WE CONTROL: two of these routes — `GET /agents` and
 * `GET /pulls/:id/reviews` — declare no response schema on the Fastify side, so
 * nothing enforces their shape on the wire. The rest are only as correct as the
 * server build the host happens to be running against; this package is spawned
 * by an MCP host and can trivially be a `git pull` ahead of or behind the API.
 * A `.parse` here turns "undefined is not an object" three modules later into
 * one `contract_mismatch` that tells the caller to restart the API.
 *
 * SECURITY: every interpolated path segment goes through `encodeURIComponent`.
 * `agentId` in particular can be a raw string the calling model invented, and a
 * `../` in a path segment would otherwise re-target the request at a different
 * route.
 *
 * INJECTABILITY: `createEndpoints()` returns a plain object behind the
 * `Endpoints` interface so the tool handlers in later steps can be handed a stub
 * and tested without a fetch mock at all.
 */

import { z } from 'zod';
import {
  Agent,
  ConventionSkillDraft,
  ConventionsView,
  PrBlastRecord,
  PrMeta,
  Repo,
  ReviewRecord,
  ReviewRunResponse,
  RunSummary,
} from '@devdigest/shared';
import { request, type RequestOptions } from './client.js';
import { isToolError, toolError } from '../domain/errors.js';

/** Per-call knobs every endpoint accepts. Host cancellation is the only one. */
export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * The transport seam. Defaulted to the real `request`; swapping it is how a test
 * or a later caller intercepts HTTP without touching global `fetch`.
 */
export type RequestFn = <T>(path: string, init?: RequestOptions) => Promise<T>;

export interface EndpointDeps {
  request?: RequestFn;
}

/** The API surface this MCP server uses. Everything else on :3001 is out of scope. */
export interface Endpoints {
  /** `GET /repos` — every repository imported into the local workspace. */
  listRepos(opts?: CallOptions): Promise<Repo[]>;
  /**
   * `GET /repos/:repoId/pulls` — NOTE: this route re-syncs from GitHub on every
   * call and back-fills up to 10 PRs, so it is slow and rate-relevant. Callers
   * memoize; this function never does, because caching a miss would make a
   * newly-imported PR permanently invisible.
   */
  listPulls(repoId: string, opts?: CallOptions): Promise<PrMeta[]>;
  /** `GET /agents` — no response schema server-side; the parse here is the contract. */
  listAgents(opts?: CallOptions): Promise<Agent[]>;
  /**
   * `POST /pulls/:prId/review` — fire-and-forget. `reviews` is ALWAYS `[]`
   * regardless of what the contract's doc comment claims; the run ids in `runs`
   * are the only usable result. Rate-limited to 10/min.
   */
  startReview(prId: string, agentId: string, opts?: CallOptions): Promise<ReviewRunResponse>;
  /** `GET /pulls/:prId/runs` — every run for the PR, any status. */
  listRuns(prId: string, opts?: CallOptions): Promise<RunSummary[]>;
  /** `GET /pulls/:prId/reviews` — no response schema server-side. */
  listReviews(prId: string, opts?: CallOptions): Promise<ReviewRecord[]>;
  /**
   * `GET /pulls/:prId/blast` — the deterministic impact map. Deliberately the
   * GET, never the POST: the POST re-derives the LLM sentence and spends money,
   * and no read-only tool may do that. A PR whose summary was never derived
   * still answers 200 here with `summary: null` and a complete node map.
   */
  getBlastRadius(prId: string, opts?: CallOptions): Promise<PrBlastRecord>;
  /** `GET /repos/:repoId/conventions` — `run` is null before the first extraction. */
  getConventions(repoId: string, opts?: CallOptions): Promise<ConventionsView>;
  /** `GET /conventions/runs/:runId/skill-draft` — the accepted rules as markdown. */
  getSkillDraft(runId: string, opts?: CallOptions): Promise<ConventionSkillDraft>;
  /** `GET /health` — a probe, so it reports rather than throws. */
  health(opts?: CallOptions): Promise<boolean>;
}

// ---- Response schemas ------------------------------------------------------
// Named so a `contract_mismatch` message can say which shape disagreed. The
// array wrappers are built once at module load, not per call.

const Repos = z.array(Repo);
const Pulls = z.array(PrMeta);
const Agents = z.array(Agent);
const Runs = z.array(RunSummary);
const Reviews = z.array(ReviewRecord);

/**
 * Validates one response, converting a `ZodError` into the catalogued
 * `contract_mismatch` carrying the FIRST issue's path and message.
 *
 * `safeParse` rather than `parse`: a raw `ZodError` escaping into a tool handler
 * would be reported as an unexpected internal failure, which is both wrong and
 * unactionable — the caller cannot fix a schema drift they cannot see named.
 */
// Generic over the SCHEMA, not over its type: `Agent` carries `.default()`s, so
// its input and output types differ, and a `z.ZodType<T>` parameter would pin T
// to the input — the one without the defaults applied.
function validate<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  schemaName: string,
): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const where = issue === undefined ? '(no issue reported)' : describeIssue(issue);
  throw toolError('contract_mismatch', schemaName, where);
}

/**
 * `path` is a Zod key path — our own field names, never response data — so it is
 * safe to interpolate. `message` is Zod's own English text, likewise ours.
 */
function describeIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  return `${path}: ${issue.message}`;
}

/** Path segments are ids, but `agentId` can be model-authored. Encode all of them. */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/** `{ signal }` only when there is one — an explicit `undefined` is not the same. */
function pass(opts: CallOptions | undefined): RequestOptions {
  return opts?.signal ? { signal: opts.signal } : {};
}

/**
 * Builds the endpoint object. Call it with no arguments for the real API; pass a
 * `request` to intercept the transport.
 */
export function createEndpoints(deps: EndpointDeps = {}): Endpoints {
  const call: RequestFn = deps.request ?? request;

  return {
    async listRepos(opts) {
      return validate(Repos, await call('/repos', pass(opts)), 'Repo[]');
    },

    async listPulls(repoId, opts) {
      const body = await call(`/repos/${seg(repoId)}/pulls`, pass(opts));
      return validate(Pulls, body, 'PrMeta[]');
    },

    async listAgents(opts) {
      return validate(Agents, await call('/agents', pass(opts)), 'Agent[]');
    },

    async startReview(prId, agentId, opts) {
      const body = await call(`/pulls/${seg(prId)}/review`, {
        ...pass(opts),
        method: 'POST',
        body: { agentId },
        // The per-route 10/min limit is a different problem from the API's
        // global 120/min one, and has a different next step: wait, or read the
        // run that is already in flight. The generic mapping cannot know that.
        mapStatus: (status) => (status === 429 ? toolError('run_rate_limited') : undefined),
      });
      return validate(ReviewRunResponse, body, 'ReviewRunResponse');
    },

    async listRuns(prId, opts) {
      const body = await call(`/pulls/${seg(prId)}/runs`, pass(opts));
      return validate(Runs, body, 'RunSummary[]');
    },

    async listReviews(prId, opts) {
      const body = await call(`/pulls/${seg(prId)}/reviews`, pass(opts));
      return validate(Reviews, body, 'ReviewRecord[]');
    },

    async getBlastRadius(prId, opts) {
      const body = await call(`/pulls/${seg(prId)}/blast`, pass(opts));
      return validate(PrBlastRecord, body, 'PrBlastRecord');
    },

    async getConventions(repoId, opts) {
      const body = await call(`/repos/${seg(repoId)}/conventions`, pass(opts));
      return validate(ConventionsView, body, 'ConventionsView');
    },

    async getSkillDraft(runId, opts) {
      const body = await call(`/conventions/runs/${seg(runId)}/skill-draft`, pass(opts));
      return validate(ConventionSkillDraft, body, 'ConventionSkillDraft');
    },

    /**
     * Liveness only. Returns `false` rather than throwing, because the single
     * caller of a probe is code deciding which message to show — a probe that
     * throws just moves that decision. A host cancellation is NOT a health
     * verdict, so an `AbortError` still propagates.
     */
    async health(opts) {
      try {
        await call('/health', pass(opts));
        return true;
      } catch (e) {
        if (isToolError(e)) return false;
        throw e;
      }
    },
  };
}

/** The real API. Tool modules take an `Endpoints` parameter defaulting to this. */
export const endpoints: Endpoints = createEndpoints();
