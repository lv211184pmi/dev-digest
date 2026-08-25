import { describe, expect, it, vi } from 'vitest';
import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../src/api/endpoints.js';
import { isToolError, type ToolError } from '../src/domain/errors.js';
import {
  createPrCache,
  resolveAgent,
  resolvePr,
  resolveRepo,
  PR_CACHE_TTL_MS,
  type ResolvedRepo,
} from '../src/domain/resolve.js';

/**
 * Typed factories — `Repo` has 9 fields, `PrMeta` 11 and `Agent` 12, and a test
 * that spells them all out hides the one field it is about.
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

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
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

const ACME: ResolvedRepo = { id: 'repo-1', fullName: 'acme/payments-api' };

// ---- the Endpoints stub ----------------------------------------------------

interface StubParts {
  repos?: Repo[];
  /** A function form lets a test change the answer between two calls. */
  pulls?: PrMeta[] | (() => PrMeta[]);
  agents?: Agent[];
}

/**
 * Only the three methods the resolvers may touch are implemented. The cast is
 * deliberate: a resolver that reached for `startReview` would throw here loudly
 * rather than quietly pass a test it has no business passing.
 */
function stub(parts: StubParts = {}) {
  const listRepos = vi.fn(async (_opts?: CallOptions): Promise<Repo[]> => parts.repos ?? []);
  const listPulls = vi.fn(
    async (_repoId: string, _opts?: CallOptions): Promise<PrMeta[]> =>
      typeof parts.pulls === 'function' ? parts.pulls() : (parts.pulls ?? []),
  );
  const listAgents = vi.fn(async (_opts?: CallOptions): Promise<Agent[]> => parts.agents ?? []);

  const endpoints = { listRepos, listPulls, listAgents } as unknown as Endpoints;
  return { endpoints, listRepos, listPulls, listAgents };
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

/**
 * Repo resolution is the first thing every tool but `list_agents` does, so a
 * wrong answer here is charged to the wrong repository. These pin that matching
 * is exact (never a prefix), that `owner/name` beats a bare name, and above all
 * that a bare name matching two repos is REPORTED — guessing would review the
 * wrong codebase with no way for the caller to notice.
 */
describe('resolveRepo — flat repo argument to a uuid', () => {
  it('no repos imported → repo_not_found saying none exist yet', async () => {
    const { endpoints } = stub({ repos: [] });

    const err = await rejection(resolveRepo(endpoints, 'acme/payments-api'));

    expect(err.code).toBe('repo_not_found');
    expect(err.message).toContain('none yet');
    expect(err.message).toContain('import');
  });

  it('exact "owner/name" → that repo, whatever the caller capitalised', async () => {
    const { endpoints } = stub({ repos: [repo(), repo({ id: 'repo-2', full_name: 'globex/billing' })] });

    const resolved = await resolveRepo(endpoints, '  ACME/Payments-API  ');

    expect(resolved).toEqual({ id: 'repo-1', fullName: 'acme/payments-api' });
  });

  it('a bare name matching one repo → that repo, carrying the full name back', async () => {
    const { endpoints } = stub({ repos: [repo(), repo({ id: 'repo-2', name: 'billing', full_name: 'globex/billing' })] });

    const resolved = await resolveRepo(endpoints, 'billing');

    expect(resolved).toEqual({ id: 'repo-2', fullName: 'globex/billing' });
  });

  it('a bare name matching two repos → repo_ambiguous listing both full names', async () => {
    const { endpoints } = stub({
      repos: [
        repo({ id: 'repo-1', owner: 'acme', full_name: 'acme/payments-api' }),
        repo({ id: 'repo-2', owner: 'globex', full_name: 'globex/payments-api' }),
      ],
    });

    const err = await rejection(resolveRepo(endpoints, 'payments-api'));

    expect(err.code).toBe('repo_ambiguous');
    expect(err.message).toContain('acme/payments-api');
    expect(err.message).toContain('globex/payments-api');
    expect(err.message).toContain('"owner/name"');
  });

  it('an "owner/name" that also collides on the bare name → the full name wins, no ambiguity', async () => {
    const { endpoints } = stub({
      repos: [
        repo({ id: 'repo-1', owner: 'acme', full_name: 'acme/payments-api' }),
        repo({ id: 'repo-2', owner: 'globex', full_name: 'globex/payments-api' }),
      ],
    });

    await expect(resolveRepo(endpoints, 'globex/payments-api')).resolves.toEqual({
      id: 'repo-2',
      fullName: 'globex/payments-api',
    });
  });

  it('a name that is only a prefix of a real repo → repo_not_found, never a fuzzy hit', async () => {
    const { endpoints } = stub({ repos: [repo({ name: 'payments-api-legacy', full_name: 'acme/payments-api-legacy' })] });

    const err = await rejection(resolveRepo(endpoints, 'payments-api'));

    expect(err.code).toBe('repo_not_found');
    expect(err.message).toContain('acme/payments-api-legacy');
  });

  it('an empty string → repo_not_found listing what does exist', async () => {
    const { endpoints } = stub({ repos: [repo()] });

    const err = await rejection(resolveRepo(endpoints, '   '));

    expect(err.code).toBe('repo_not_found');
    expect(err.message).toContain('acme/payments-api');
  });

  it('a host cancellation signal → handed to the endpoint call', async () => {
    const { endpoints, listRepos } = stub({ repos: [repo()] });
    const controller = new AbortController();

    await resolveRepo(endpoints, 'acme/payments-api', { signal: controller.signal });

    expect(listRepos).toHaveBeenCalledWith({ signal: controller.signal });
  });
});

/**
 * `GET /repos/:id/pulls` re-syncs from GitHub on every call, so this resolver is
 * the one place in the package where a cache is a correctness-adjacent concern:
 * without it a `run_agent_on_pr` → `get_findings` sequence triggers three syncs.
 * These pin the cache in both directions — a hit skips the sync, and a MISS is
 * never remembered, because a PR imported a minute later has to resolve.
 */
describe('resolvePr — PR number to a uuid, memoized', () => {
  it('a PR that exists → its id and the number echoed back', async () => {
    const { endpoints } = stub({ pulls: [pull(), pull({ id: 'pr-2', number: 483 })] });

    const resolved = await resolvePr(endpoints, ACME, 483, { cache: createPrCache() });

    expect(resolved).toEqual({ id: 'pr-2', number: 483 });
  });

  it('a PR nobody imported → pr_not_found with the 10 most recent numbers, newest first', async () => {
    const pulls = Array.from({ length: 12 }, (_, i) => pull({ id: `pr-${i}`, number: 100 + i }));
    const { endpoints } = stub({ pulls });

    const err = await rejection(resolvePr(endpoints, ACME, 999, { cache: createPrCache() }));

    expect(err.code).toBe('pr_not_found');
    expect(err.message).toContain('#999');
    expect(err.message).toContain('acme/payments-api');
    expect(err.message).toContain('111, 110, 109');
    // 12 pulls, 10 listed: the two oldest are dropped, not the two newest.
    expect(err.message).not.toContain('101');
    expect(err.message).not.toContain('100,');
  });

  it('a PR seen on GitHub but never imported (id: null) → pr_not_imported, a different next step', async () => {
    const { endpoints } = stub({ pulls: [pull({ id: null, number: 483 })] });

    const err = await rejection(resolvePr(endpoints, ACME, 483, { cache: createPrCache() }));

    // Distinguishing these two matters: "import it" is actionable, "it does not
    // exist" is not, and the PR is right there in the DevDigest UI.
    expect(err.code).toBe('pr_not_imported');
    expect(err.message).toContain('#483');
    expect(err.message).toContain('has not been imported');
  });

  it('the same PR twice inside the TTL → one sync, not two', async () => {
    const { endpoints, listPulls } = stub({ pulls: [pull()] });
    const cache = createPrCache();
    let t = 1_000;

    const first = await resolvePr(endpoints, ACME, 482, { cache, now: () => t });
    t += PR_CACHE_TTL_MS - 1;
    const second = await resolvePr(endpoints, ACME, 482, { cache, now: () => t });

    expect(second).toEqual(first);
    expect(listPulls).toHaveBeenCalledTimes(1);
  });

  it('the same PR once the TTL has elapsed → re-synced, so a re-imported PR is not stale forever', async () => {
    const { endpoints, listPulls } = stub({ pulls: [pull()] });
    const cache = createPrCache();
    let t = 1_000;

    await resolvePr(endpoints, ACME, 482, { cache, now: () => t });
    // Exactly AT the expiry instant, not past it — the boundary is the case a
    // `>` instead of a `>=` would get wrong.
    t += PR_CACHE_TTL_MS;
    await resolvePr(endpoints, ACME, 482, { cache, now: () => t });

    expect(listPulls).toHaveBeenCalledTimes(2);
  });

  it('the same number in a different repo → its own entry, never the first repo’s id', async () => {
    const { endpoints, listPulls } = stub({
      pulls: () => [pull({ id: 'pr-shared-number' })],
    });
    const cache = createPrCache();

    const a = await resolvePr(endpoints, ACME, 482, { cache, now: () => 1_000 });
    const b = await resolvePr(
      endpoints,
      { id: 'repo-2', fullName: 'globex/billing' },
      482,
      { cache, now: () => 1_000 },
    );

    expect(a.id).toBe('pr-shared-number');
    expect(b.id).toBe('pr-shared-number');
    expect(listPulls).toHaveBeenCalledTimes(2);
    expect(listPulls).toHaveBeenNthCalledWith(1, 'repo-1', {});
    expect(listPulls).toHaveBeenNthCalledWith(2, 'repo-2', {});
  });

  it('a not-found miss → not cached, so the PR resolves as soon as it is imported', async () => {
    let imported: PrMeta[] = [];
    const { endpoints, listPulls } = stub({ pulls: () => imported });
    const cache = createPrCache();
    const now = () => 1_000;

    const err = await rejection(resolvePr(endpoints, ACME, 482, { cache, now }));
    imported = [pull()];
    const resolved = await resolvePr(endpoints, ACME, 482, { cache, now });

    expect(err.code).toBe('pr_not_found');
    expect(resolved).toEqual({ id: 'pr-1', number: 482 });
    expect(listPulls).toHaveBeenCalledTimes(2);
  });

  it('a not-imported miss → also not cached, so importing it in the UI is enough', async () => {
    let pulls: PrMeta[] = [pull({ id: null })];
    const { endpoints } = stub({ pulls: () => pulls });
    const cache = createPrCache();
    const now = () => 1_000;

    const err = await rejection(resolvePr(endpoints, ACME, 482, { cache, now }));
    pulls = [pull({ id: 'pr-1' })];

    expect(err.code).toBe('pr_not_imported');
    await expect(resolvePr(endpoints, ACME, 482, { cache, now })).resolves.toEqual({
      id: 'pr-1',
      number: 482,
    });
  });

  it('an empty pull list → pr_not_found saying none are imported yet', async () => {
    const { endpoints } = stub({ pulls: [] });

    const err = await rejection(resolvePr(endpoints, ACME, 482, { cache: createPrCache() }));

    expect(err.code).toBe('pr_not_found');
    expect(err.message).toContain('none yet');
  });

  it('a host cancellation signal → handed to the endpoint call', async () => {
    const { endpoints, listPulls } = stub({ pulls: [pull()] });
    const controller = new AbortController();

    await resolvePr(endpoints, ACME, 482, {
      cache: createPrCache(),
      signal: controller.signal,
    });

    expect(listPulls).toHaveBeenCalledWith('repo-1', { signal: controller.signal });
  });
});

/**
 * `agents.name` has NO unique constraint — the seeder de-dupes by hand, so any
 * workspace built another way can hold two "Security Reviewer"s. Resolving to
 * the first would start (and charge for) an LLM run on the wrong reviewer with
 * nothing in the response to show it happened. These pin that the collision is
 * reported with the ids needed to break it, and that `enabled: false` does NOT
 * block — the API runs a disabled agent that is asked for by id.
 */
describe('resolveAgent — agent name to a uuid', () => {
  it('one agent with that name → it, matched case-insensitively', async () => {
    const { endpoints } = stub({ agents: [agent(), agent({ id: 'agent-2', name: 'Security Reviewer' })] });

    const resolved = await resolveAgent(endpoints, 'security reviewer');

    expect(resolved).toEqual({
      id: 'agent-2',
      name: 'Security Reviewer',
      enabled: true,
      note: null,
    });
  });

  it('no agent with that name → agent_not_found pointing at list_agents', async () => {
    const { endpoints } = stub({ agents: [agent()] });

    const err = await rejection(resolveAgent(endpoints, 'Nope Reviewer'));

    expect(err.code).toBe('agent_not_found');
    expect(err.message).toContain('list_agents');
  });

  it('no agents configured at all → agent_not_found, not a crash on an empty list', async () => {
    const { endpoints } = stub({ agents: [] });

    const err = await rejection(resolveAgent(endpoints, 'General Reviewer'));

    expect(err.code).toBe('agent_not_found');
  });

  it('two agents sharing a name → agent_ambiguous listing name — model — id', async () => {
    const { endpoints } = stub({
      agents: [
        agent({ id: 'id-one', name: 'Security Reviewer', model: 'gpt-5' }),
        agent({ id: 'id-two', name: 'Security Reviewer', model: 'claude-opus-4' }),
      ],
    });

    const err = await rejection(resolveAgent(endpoints, 'Security Reviewer'));

    expect(err.code).toBe('agent_ambiguous');
    expect(err.message).toContain('Security Reviewer — gpt-5 — id-one');
    expect(err.message).toContain('Security Reviewer — claude-opus-4 — id-two');
    // The ONLY way out of the collision, so the message has to say it.
    expect(err.message).toContain('Pass the id');
  });

  it('a uuid → used directly, but the response still carries the agent’s real name', async () => {
    const id = 'a1b2c3d4-0000-4000-8000-00000000beef';
    const { endpoints, listAgents } = stub({ agents: [agent(), agent({ id, name: 'Security Reviewer' })] });

    const resolved = await resolveAgent(endpoints, id.toUpperCase());

    // The list call is what buys the semantic name — printing a bare uuid back
    // at the model is the thing principle #3 is trying to avoid.
    expect(listAgents).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({ id, name: 'Security Reviewer', enabled: true, note: null });
  });

  it('a uuid nobody in the workspace claims → passed through with a note, not rejected', async () => {
    const id = 'a1b2c3d4-0000-4000-8000-0000deadbeef';
    const { endpoints } = stub({ agents: [agent()] });

    const resolved = await resolveAgent(endpoints, id);

    expect(resolved.id).toBe(id);
    expect(resolved.note).toContain('list_agents');
  });

  it('a disabled agent → resolves anyway, flagged, because the API runs it regardless', async () => {
    const { endpoints } = stub({ agents: [agent({ id: 'agent-off', name: 'Retired Reviewer', enabled: false })] });

    const resolved = await resolveAgent(endpoints, 'Retired Reviewer');

    // `reviews/service.ts` never checks `enabled`, so refusing here would block
    // something DevDigest is happy to do — and charge nothing for the refusal.
    expect(resolved.id).toBe('agent-off');
    expect(resolved.enabled).toBe(false);
    expect(resolved.note).toContain('disabled');
  });

  it('a host cancellation signal → handed to the endpoint call', async () => {
    const { endpoints, listAgents } = stub({ agents: [agent()] });
    const controller = new AbortController();

    await resolveAgent(endpoints, 'General Reviewer', { signal: controller.signal });

    expect(listAgents).toHaveBeenCalledWith({ signal: controller.signal });
  });
});
