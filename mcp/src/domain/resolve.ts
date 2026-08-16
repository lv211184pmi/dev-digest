/**
 * Flat-argument resolution — design principle #2, "flat arguments".
 *
 * Every tool takes scalars a model can hold in its head: a repo as
 * `"owner/name"`, a PR as its GitHub number, an agent as its NAME. The API,
 * meanwhile, addresses everything by uuid. This module is the only place that
 * translation happens, so a wrong argument produces one catalogued,
 * leads-forward error instead of a 404 three calls later.
 *
 * Three rules shape the code below:
 *
 * 1. **Ambiguity is reported, never guessed.** Two repos can share a bare name
 *    and two agents can share a name outright — `agents.name` has no unique
 *    constraint in the DB and the seeder de-dupes by hand, so a workspace built
 *    any other way reaches this legitimately. Picking "the first one" would run
 *    the wrong reviewer and charge for it.
 * 2. **`resolvePr` memoizes, the others do not.** `GET /repos/:id/pulls`
 *    re-syncs from GitHub on every call and back-fills up to 10 PRs, so a
 *    `run_agent_on_pr` → `get_findings` sequence would otherwise trigger three
 *    syncs for one PR. `GET /repos` and `GET /agents` are cheap local reads.
 * 3. **A miss is never cached.** A PR imported a minute after a failed lookup
 *    has to resolve; a negative cache would make it invisible for the TTL, and
 *    the error we just told the caller to fix would come back unchanged after
 *    they fixed it.
 *
 * The `Endpoints` object is a parameter rather than an import so callers and
 * tests can hand in a stub. The clock is injectable for the same reason: TTL
 * behaviour is testable without waiting a minute.
 */

import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../api/endpoints.js';
import { toolError, type AgentChoice } from './errors.js';

// ---- Resolved shapes -------------------------------------------------------
// Each carries the SEMANTIC name alongside the id, so a tool response can talk
// about `acme/payments-api` and `Security Reviewer` while the HTTP calls under
// it use uuids. Principle #3's "return names, not uuids" starts here.

export interface ResolvedRepo {
  /** Repository uuid — the `:repoId` path segment. */
  id: string;
  /** `owner/name`, exactly as the API spells it. Safe to print. */
  fullName: string;
}

export interface ResolvedPr {
  /** Pull-request uuid — the `:prId` path segment. Never null; see `pr_not_imported`. */
  id: string;
  /** The GitHub number the caller passed, echoed for response building. */
  number: number;
}

export interface ResolvedAgent {
  /** Agent uuid — what `POST /pulls/:id/review` wants in its body. */
  id: string;
  /** The agent's display name. Safe to print, and what `list_agents` returns. */
  name: string;
  /**
   * `false` does NOT mean the agent will not run: `reviews/service.ts` does not
   * check this flag, so a disabled agent addressed explicitly really does
   * execute and really does cost money. Surfaced, not enforced.
   */
  enabled: boolean;
  /**
   * A caller-facing remark about HOW this resolved, or null when nothing was
   * surprising. Tools append it to `next_step`. Never an error — resolution
   * succeeded.
   */
  note: string | null;
}

// ---- Options ---------------------------------------------------------------

export interface ResolveOptions {
  /** Host cancellation, passed straight through to the underlying fetch. */
  signal?: AbortSignal;
}

export interface ResolvePrOptions extends ResolveOptions {
  /** Injected for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injected for tests. Defaults to a process-wide cache shared by all callers. */
  cache?: PrCache;
}

// ---- The PR cache ----------------------------------------------------------

/** Long enough to cover one tool sequence, short enough that a fresh import shows up. */
export const PR_CACHE_TTL_MS = 60_000;

/**
 * Entries kept before a write sweeps the expired ones. A host session resolving
 * hundreds of PRs would otherwise grow the map for the life of the process;
 * nothing here is large enough to justify a real LRU.
 */
const PR_CACHE_SWEEP_AT = 256;

export interface PrCache {
  /** The cached pr id, or undefined when absent or expired as of `now`. */
  get(repoId: string, prNumber: number, now: number): string | undefined;
  /** Records a SUCCESSFUL resolution. Callers must never call this for a miss. */
  set(repoId: string, prNumber: number, prId: string, now: number): void;
  /** Entries held, expired or not. Diagnostics and tests only. */
  readonly size: number;
}

/**
 * A tiny TTL map. Not exported as a class because the only thing a caller can
 * usefully do with it is hand it back to `resolvePr`.
 */
export function createPrCache(ttlMs: number = PR_CACHE_TTL_MS): PrCache {
  const entries = new Map<string, { prId: string; expiresAt: number }>();

  return {
    get(repoId, prNumber, now) {
      const key = cacheKey(repoId, prNumber);
      const hit = entries.get(key);
      if (hit === undefined) return undefined;
      // `>=` on purpose: an entry written at t with a 60s TTL is stale AT
      // t+60s, not one millisecond later.
      if (now >= hit.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return hit.prId;
    },

    set(repoId, prNumber, prId, now) {
      if (entries.size >= PR_CACHE_SWEEP_AT) {
        for (const [key, entry] of entries) {
          if (now >= entry.expiresAt) entries.delete(key);
        }
      }
      entries.set(cacheKey(repoId, prNumber), { prId, expiresAt: now + ttlMs });
    },

    get size() {
      return entries.size;
    },
  };
}

/** `\0` because a repo uuid cannot contain it, so no two keys can collide. */
function cacheKey(repoId: string, prNumber: number): string {
  return `${repoId}\0${prNumber}`;
}

/** Shared by every caller that does not inject one — the point is reuse across tools. */
const defaultPrCache = createPrCache();

// ---- Repo ------------------------------------------------------------------

/**
 * `"owner/name"` (or an unambiguous bare name) → the repo's uuid.
 *
 * Matching is case-insensitive and exact — never a prefix or a substring. A
 * partial match that picked `acme/payments-api-legacy` for `payments-api` would
 * be a silent wrong answer, and the caller has no way to see it happened.
 */
export async function resolveRepo(
  endpoints: Endpoints,
  repo: string,
  opts: ResolveOptions = {},
): Promise<ResolvedRepo> {
  const repos = await endpoints.listRepos(call(opts));
  const wanted = normalize(repo);

  // Full name first: it is the most specific form a caller can give, so a hit
  // here ends the search even if some other repo shares the bare name.
  const byFullName = repos.filter((r) => normalize(r.full_name) === wanted);
  const exact = byFullName[0];
  if (exact !== undefined) {
    // Two repos with the identical full name are indistinguishable to a caller
    // — there is no more specific string to ask for — so reporting ambiguity
    // here would name no next step. Deterministic first wins instead.
    return toResolvedRepo(exact);
  }

  const byName = repos.filter((r) => normalize(r.name) === wanted);
  if (byName.length > 1) {
    throw toolError(
      'repo_ambiguous',
      repo,
      byName.map((r) => r.full_name),
    );
  }

  const bare = byName[0];
  if (bare !== undefined) return toResolvedRepo(bare);

  throw toolError(
    'repo_not_found',
    repo,
    repos.map((r) => r.full_name),
  );
}

function toResolvedRepo(r: Repo): ResolvedRepo {
  return { id: r.id, fullName: r.full_name };
}

// ---- Pull request ----------------------------------------------------------

/**
 * A GitHub PR number → the pull request's uuid, memoized for
 * `PR_CACHE_TTL_MS`.
 *
 * Takes the `ResolvedRepo` rather than a bare id because both failure messages
 * name the repository, and a message that named a uuid would be unusable — the
 * caller passed `"acme/payments-api"` and can only act on that.
 *
 * `PrMeta.id` is genuinely nullable (`z.string().nullish()`): the list route
 * reports pull requests it saw on GitHub but has not imported, and those have
 * no row to review against. That is `pr_not_imported`, a different next step
 * from "this PR does not exist".
 */
export async function resolvePr(
  endpoints: Endpoints,
  repo: ResolvedRepo,
  prNumber: number,
  opts: ResolvePrOptions = {},
): Promise<ResolvedPr> {
  const cache = opts.cache ?? defaultPrCache;
  // Read once and reuse for the write: the fetch below can take seconds, and a
  // single instant keeps the TTL reasoning (and its test) unambiguous.
  const now = (opts.now ?? Date.now)();

  const cached = cache.get(repo.id, prNumber, now);
  if (cached !== undefined) return { id: cached, number: prNumber };

  const pulls = await endpoints.listPulls(repo.id, call(opts));
  const match = pulls.find((p) => p.number === prNumber);

  if (match === undefined) {
    throw toolError('pr_not_found', prNumber, repo.fullName, recentNumbers(pulls));
  }
  if (match.id == null) {
    throw toolError('pr_not_imported', prNumber, repo.fullName);
  }

  // Successes only. Both throws above skipped this line on purpose.
  cache.set(repo.id, prNumber, match.id, now);
  return { id: match.id, number: prNumber };
}

/** The 10 highest numbers, newest first — enough to recognise the range, not a dump. */
function recentNumbers(pulls: PrMeta[]): number[] {
  return [...new Set(pulls.map((p) => p.number))].sort((a, b) => b - a).slice(0, 10);
}

// ---- Agent -----------------------------------------------------------------

/** Canonical 8-4-4-4-12 hex. Version-agnostic: the DB's ids are all we care about. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An agent NAME (or an id) → the agent's uuid, plus its real name.
 *
 * `list_agents` is always called, even for an id: a tool response saying
 * "Security Reviewer" is worth one cheap local read over a response saying
 * `7f3c…`. It also lets an id that is not in the workspace be reported instead
 * of silently POSTed.
 *
 * Two agents CAN share a name — `agents.name` carries no unique constraint and
 * the seeder de-dupes manually — so a collision is a reportable ambiguity, not
 * a "take the first". Running the wrong reviewer costs an LLM call.
 */
export async function resolveAgent(
  endpoints: Endpoints,
  agent: string,
  opts: ResolveOptions = {},
): Promise<ResolvedAgent> {
  const agents = await endpoints.listAgents(call(opts));
  const input = agent.trim();
  const wanted = normalize(agent);
  const looksLikeId = UUID_PATTERN.test(input);

  if (looksLikeId) {
    const byId = agents.find((a) => normalize(a.id) === wanted);
    if (byId !== undefined) return toResolvedAgent(byId);
  }

  // Still tried for a uuid-shaped input: nothing stops an agent from being
  // NAMED like a uuid, and falling through costs one array scan.
  const matches = agents.filter((a) => normalize(a.name) === wanted);
  if (matches.length > 1) {
    throw toolError('agent_ambiguous', agent, matches.map(toAgentChoice));
  }

  const only = matches[0];
  if (only !== undefined) return toResolvedAgent(only);

  if (looksLikeId) return unlistedAgent(input);

  throw toolError('agent_not_found', agent);
}

function toResolvedAgent(a: Agent): ResolvedAgent {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    note: a.enabled ? null : disabledNote(a.name),
  };
}

function toAgentChoice(a: Agent): AgentChoice {
  return { name: a.name, model: a.model, id: a.id };
}

/**
 * Disabled is a UI state, not a guard. `reviews/service.ts` starts a run for
 * whatever agent id it is handed, so blocking here would refuse something the
 * API is happy to do — and the caller asked for this agent by name.
 */
function disabledNote(name: string): string {
  return (
    `Note: the agent '${name}' is marked disabled in DevDigest. DevDigest runs a disabled agent ` +
    'anyway when it is asked for by name or id, so this call proceeded and cost the same as any ' +
    'other run. Enable it in DevDigest → Agents if you want it to show as active.'
  );
}

/**
 * An id-shaped argument nobody claims. Passed through rather than rejected: a
 * caller holding an id got it from somewhere, and the API is the authority on
 * whether it exists. The note is what turns the eventual 404 into something the
 * caller can act on.
 */
function unlistedAgent(id: string): ResolvedAgent {
  return {
    id,
    name: id,
    enabled: true,
    note:
      `Note: no agent with id '${id}' is listed in this workspace, so the id was passed to ` +
      'DevDigest unchanged. If the run fails, call list_agents and use one of the `name` values ' +
      'it returns.',
  };
}

// ---- Shared helpers --------------------------------------------------------

/** Case- and whitespace-insensitive. Models quote arguments inconsistently. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** `{ signal }` only when there is one — mirrors `endpoints.ts`. */
function call(opts: ResolveOptions): CallOptions {
  return opts.signal ? { signal: opts.signal } : {};
}
