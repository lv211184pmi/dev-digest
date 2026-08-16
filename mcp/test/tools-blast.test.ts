/**
 * `get_blast_radius` — the impact map tool.
 *
 * What these tests are actually defending is one property, and it is a safety
 * property rather than a correctness one: **an unknown answer must never be
 * reportable as an empty one.** A model handed `changed_symbols: []` concludes
 * "nothing is affected, merge it". If the real cause was an unindexed repo,
 * that conclusion is wrong in the most expensive possible direction. So the
 * suite spends most of its weight on the three coverage states and on the
 * projection keeping `caller_count` honest, and comparatively little on the
 * happy path.
 *
 * Hermetic, like every test here: the SDK is never instantiated and `fetch` is
 * never reached. Tools are driven through their REGISTRAR so the registration
 * config (name, approved description, annotations, output schema) is asserted
 * too, matching `tools-conventions.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import type { PrBlastRecord, PrMeta, Repo } from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../src/api/endpoints.js';
import { BLAST_CALLERS_MAX, BLAST_SYMBOLS_MAX } from '../src/config.js';
import {
  GET_BLAST_RADIUS_DESCRIPTION,
  GET_BLAST_RADIUS_TITLE,
} from '../src/tools/descriptions.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RecordedTool {
  name: string;
  config: Record<string, unknown>;
  handler: (args: never, ctx: never) => Promise<{
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
  }>;
}

function recordingServer() {
  const tools: RecordedTool[] = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>, handler: RecordedTool['handler']) {
      tools.push({ name, config, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
}

const CTX = { mcpReq: { signal: undefined } } as never;

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
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/rate-limit-public',
    base: 'main',
    head_sha: 'abc123',
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: 'needs_review',
    ...over,
  };
}

/** A full-coverage record shaped like the screenshot's example PR. */
function record(over: Partial<PrBlastRecord> = {}): PrBlastRecord {
  return {
    pr_id: 'pr-1',
    changed_symbols: [
      { name: 'rateLimit', file: 'src/middleware/rate-limit.ts', kind: 'function', line: 12 },
      { name: 'bucketKey', file: 'src/middleware/rate-limit.ts', kind: 'function', line: 48 },
    ],
    downstream: [
      {
        symbol: 'rateLimit',
        callers: [
          { name: 'registerPublicRoutes', file: 'src/api/public/index.ts', line: 23 },
          { name: 'webhookRoutes', file: 'src/api/public/webhooks.ts', line: 45 },
        ],
        endpoints_affected: ['GET /api/public/items', 'POST /api/public/webhooks'],
        crons_affected: ['reset-rate-buckets (hourly)'],
        caller_count: 4,
        truncated: false,
      },
      {
        symbol: 'bucketKey',
        callers: [{ name: 'rateLimit', file: 'src/middleware/rate-limit.ts', line: 19 }],
        endpoints_affected: [],
        crons_affected: [],
        caller_count: 2,
        truncated: false,
      },
    ],
    summary: 'Rate limiting now sits in front of three public endpoints and one hourly job.',
    index: {
      state: 'full',
      reason: null,
      explanation: '',
      indexed_files: 412,
      files_covered: ['src/middleware/rate-limit.ts'],
      files_not_covered: [],
    },
    totals: { symbols: 2, callers: 6, endpoints: 3, crons: 1 },
    head_sha: 'abc123',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    cost_usd: 0.0001,
    tokens_in: 300,
    tokens_out: 40,
    derived_at: '2026-08-16T10:00:00.000Z',
    is_stale: false,
    ...over,
  };
}

interface StubParts {
  repos?: Repo[];
  pulls?: PrMeta[];
  blast?: PrBlastRecord;
}

function stubEndpoints(parts: StubParts = {}) {
  const calls = {
    listRepos: vi.fn<(opts?: CallOptions) => void>(),
    listPulls: vi.fn<(repoId: string, opts?: CallOptions) => void>(),
    getBlastRadius: vi.fn<(prId: string, opts?: CallOptions) => void>(),
  };

  const endpoints = {
    async listRepos(opts?: CallOptions) {
      calls.listRepos(opts);
      return parts.repos ?? [repo()];
    },
    async listPulls(repoId: string, opts?: CallOptions) {
      calls.listPulls(repoId, opts);
      return parts.pulls ?? [pull()];
    },
    async getBlastRadius(prId: string, opts?: CallOptions) {
      calls.getBlastRadius(prId, opts);
      return parts.blast ?? record();
    },
  } as unknown as Endpoints;

  return { endpoints, calls };
}

/**
 * Registers the tool over a stub and calls it once.
 *
 * `resolvePr` memoizes PR lookups in a module-level cache keyed by
 * (repoId, prNumber), so every test that must actually hit `listPulls` passes a
 * distinct PR number. Sharing 482 across tests would make assertion order
 * matter, which is exactly the kind of coupling that makes a suite rot.
 */
async function callBlast(parts: StubParts = {}, prNumber = 482) {
  const { server, tools } = recordingServer();
  // The stub's PR list must contain the number under test, or resolution fails
  // before the blast route is ever reached. A caller that supplies its own
  // `pulls` (e.g. the not-imported case) keeps it.
  const { endpoints, calls } = stubEndpoints({
    pulls: parts.pulls ?? [pull({ number: prNumber })],
    ...parts,
  });
  registerGetBlastRadius(server, { endpoints });
  const tool = tools[0]!;
  const result = await tool.handler(
    { repo: 'acme/payments-api', pr: prNumber } as never,
    CTX,
  );
  return { tool, result, calls };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registerGetBlastRadius — registration', () => {
  it('registers under the fixed name, with the approved text and an output schema', () => {
    const { server, tools } = recordingServer();
    registerGetBlastRadius(server, { endpoints: stubEndpoints().endpoints });

    const tool = tools[0]!;
    expect(tool.name).toBe('get_blast_radius');
    // Byte-identity, not "contains": the description is approved verbatim text.
    expect(tool.config.title).toBe(GET_BLAST_RADIUS_TITLE);
    expect(tool.config.description).toBe(GET_BLAST_RADIUS_DESCRIPTION);
    expect(tool.config.inputSchema).toBeDefined();
    // It returns a real payload now, so it must describe one.
    expect(tool.config.outputSchema).toBeDefined();
  });

  it('is read-only — it must never trigger a summary derivation', () => {
    const { server, tools } = recordingServer();
    registerGetBlastRadius(server, { endpoints: stubEndpoints().endpoints });

    expect(tools[0]!.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

describe('get_blast_radius — a fully indexed PR', () => {
  it('returns the map with downstream pre-joined onto each changed symbol', async () => {
    const { result } = await callBlast({}, 1001);

    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as never as {
      repo: string;
      pr: number;
      summary: string | null;
      changed_symbols: { symbol: string; callers: unknown[]; endpoints_affected: string[] }[];
    };

    expect(out.repo).toBe('acme/payments-api');
    expect(out.pr).toBe(1001);
    expect(out.changed_symbols).toHaveLength(2);

    // The join is the point: the server sends two parallel arrays, and making
    // the model line them up by name is a step it sometimes gets wrong.
    const rateLimit = out.changed_symbols[0]!;
    expect(rateLimit.symbol).toBe('rateLimit');
    expect(rateLimit.callers).toHaveLength(2);
    expect(rateLimit.endpoints_affected).toEqual([
      'GET /api/public/items',
      'POST /api/public/webhooks',
    ]);
  });

  it('drops LLM provenance the caller cannot act on', async () => {
    const { result } = await callBlast({}, 1002);
    const out = result.structuredContent as Record<string, unknown>;

    for (const dropped of [
      'pr_id',
      'head_sha',
      'provider',
      'model',
      'cost_usd',
      'tokens_in',
      'tokens_out',
      'derived_at',
      'is_stale',
    ]) {
      expect(out, dropped).not.toHaveProperty(dropped);
    }
  });

  it('reads the GET route, never the money-spending POST', async () => {
    const { calls } = await callBlast({}, 1003);
    expect(calls.getBlastRadius).toHaveBeenCalledWith('pr-1', expect.anything());
  });

  it('the digest leads with the counts and carries the summary', async () => {
    const { result } = await callBlast({}, 1004);
    const text = result.content[0]?.text ?? '';

    expect(text).toContain('acme/payments-api#1004');
    expect(text).toContain('2 changed symbols');
    expect(text).toContain('6 callers');
    expect(text).toContain('3 endpoints');
    expect(text).toContain('1 cron/job');
    expect(text).toContain('Rate limiting now sits in front');
    expect(text).not.toContain('PARTIAL');
  });

  it('a symbol with no downstream entry survives with empty lists', async () => {
    const orphan = record({
      changed_symbols: [{ name: 'unused', file: 'src/util.ts', kind: 'function', line: 3 }],
      downstream: [],
      totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
    });
    const { result } = await callBlast({ blast: orphan }, 1005);
    const out = result.structuredContent as never as {
      changed_symbols: { symbol: string; caller_count: number; callers: unknown[] }[];
    };

    // "Changed, and nothing visible calls it" is a real finding. Dropping the
    // row would silently shorten the map — indistinguishable from a miss.
    expect(out.changed_symbols).toHaveLength(1);
    expect(out.changed_symbols[0]!.symbol).toBe('unused');
    expect(out.changed_symbols[0]!.callers).toEqual([]);
    expect(out.changed_symbols[0]!.caller_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Coverage — the safety property
// ---------------------------------------------------------------------------

describe('get_blast_radius — index coverage is never masked', () => {
  it('an unusable index is an ERROR, not an empty map', async () => {
    const unavailable = record({
      changed_symbols: [],
      downstream: [],
      summary: null,
      index: {
        state: 'unavailable',
        reason: 'no_data',
        explanation: 'This repository has not been indexed yet.',
        indexed_files: 0,
        files_covered: [],
        files_not_covered: ['src/middleware/rate-limit.ts'],
      },
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    });

    const { result } = await callBlast({ blast: unavailable }, 1006);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    // The server's own explanation is passed through, not re-invented.
    expect(text).toContain('has not been indexed yet');
    // And the message states outright that this is not an all-clear.
    expect(text).toMatch(/not.*the same as|all-clear/i);
    expect(text).toContain('Re-analyze');
    // No structured payload at all — there is nothing truthful to put in one.
    expect(result.structuredContent).toBeUndefined();
  });

  it('an unimported file list gets its own error, not "re-analyze the repo"', async () => {
    // Same `unavailable` state, different cause and a different fix. The index
    // may be perfectly healthy — sending this caller to rebuild it would be a
    // wrong next step in a catalogue whose whole design rule is leading forward.
    const noFiles = record({
      changed_symbols: [],
      downstream: [],
      summary: null,
      index: {
        state: 'unavailable',
        reason: 'no_changed_files',
        explanation: 'No changed files have been imported for this pull request yet.',
        indexed_files: 412,
        files_covered: [],
        files_not_covered: [],
      },
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    });

    const { result } = await callBlast({ blast: noFiles }, 1015);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toMatch(/has not imported the changed files/i);
    expect(text).not.toContain('Re-analyze');
    // And it still refuses to read as "this PR changes nothing".
    expect(text).toMatch(/NOT "the PR changes nothing"/i);
  });

  it('a partial index still returns its map, flagged and explained', async () => {
    const partial = record({
      index: {
        state: 'partial',
        reason: 'index_partial',
        explanation:
          '2 changed file(s) are in languages the index does not parse: main.go, worker.py.',
        indexed_files: 412,
        files_covered: ['src/middleware/rate-limit.ts'],
        files_not_covered: ['main.go', 'worker.py'],
      },
    });

    const { result } = await callBlast({ blast: partial }, 1007);

    // Partial is NOT an error: a partial answer is still an answer.
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as never as {
      index: { state: string; explanation: string; files_not_covered: string[] };
      changed_symbols: unknown[];
    };
    expect(out.index.state).toBe('partial');
    expect(out.index.files_not_covered).toEqual(['main.go', 'worker.py']);
    expect(out.changed_symbols).toHaveLength(2);

    // The digest must say so FIRST — it is the part a model acts on without
    // reading the structured payload.
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('PARTIAL');
    expect(text).toContain('main.go');
  });

  it('carries the coverage block on the happy path too, so "full" is explicit', async () => {
    const { result } = await callBlast({}, 1008);
    const out = result.structuredContent as never as { index: { state: string } };
    expect(out.index.state).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// Caps and honesty about them
// ---------------------------------------------------------------------------

describe('get_blast_radius — truncation stays visible', () => {
  it('reports the pre-cap caller total, not the returned length', async () => {
    const capped = record({
      changed_symbols: [{ name: 'hot', file: 'src/hot.ts', kind: 'function', line: 1 }],
      downstream: [
        {
          symbol: 'hot',
          callers: Array.from({ length: 20 }, (_, i) => ({
            name: `c${i}`,
            file: `src/c${i}.ts`,
            line: i + 1,
          })),
          endpoints_affected: [],
          crons_affected: [],
          caller_count: 137,
          truncated: true,
        },
      ],
    });

    const { result } = await callBlast({ blast: capped }, 1009);
    const out = result.structuredContent as never as {
      changed_symbols: { callers: unknown[]; caller_count: number; truncated: boolean }[];
    };

    const sym = out.changed_symbols[0]!;
    // Tighter than the server's 20: a model pays tokens for every row and acts
    // on the top few, so the tool lists 5 and reports the true total beside it.
    expect(sym.callers).toHaveLength(BLAST_CALLERS_MAX);
    expect(sym.caller_count).toBe(137);
    expect(sym.truncated).toBe(true);
  });

  it('flags truncation even when only the tool did the cutting', () => {
    // The server may return 8 callers with `truncated: false` (it found exactly
    // 8). Listing 5 of them still hides three, so the flag must flip here.
    const eight = record({
      changed_symbols: [{ name: 'mid', file: 'src/mid.ts', kind: 'function', line: 1 }],
      downstream: [
        {
          symbol: 'mid',
          callers: Array.from({ length: 8 }, (_, i) => ({
            name: `c${i}`,
            file: `src/c${i}.ts`,
            line: i + 1,
          })),
          endpoints_affected: [],
          crons_affected: [],
          caller_count: 8,
          truncated: false,
        },
      ],
    });

    return callBlast({ blast: eight }, 1014).then(({ result }) => {
      const out = result.structuredContent as never as {
        changed_symbols: { callers: unknown[]; caller_count: number; truncated: boolean }[];
      };
      expect(out.changed_symbols[0]!.callers).toHaveLength(BLAST_CALLERS_MAX);
      expect(out.changed_symbols[0]!.caller_count).toBe(8);
      expect(out.changed_symbols[0]!.truncated).toBe(true);
    });
  });

  it('caps the symbol list and says it did', async () => {
    const many = record({
      changed_symbols: Array.from({ length: BLAST_SYMBOLS_MAX + 5 }, (_, i) => ({
        name: `sym${i}`,
        file: `src/f${i}.ts`,
        kind: 'function',
        line: 1,
      })),
      downstream: [],
    });

    const { result } = await callBlast({ blast: many }, 1010);
    const out = result.structuredContent as never as {
      changed_symbols: unknown[];
      truncated: boolean;
    };

    expect(out.changed_symbols).toHaveLength(BLAST_SYMBOLS_MAX);
    expect(out.truncated).toBe(true);
    expect(result.content[0]?.text).toContain('truncated');
  });

  it('an API that omits caller_count still never under-reports it', async () => {
    // Guards the `?? impact.callers.length` fallback: against an older server
    // the invariant `caller_count >= callers.length` must still hold, because a
    // 0 there would read as "no callers" next to a populated caller list.
    const legacy = record({
      changed_symbols: [{ name: 'x', file: 'src/x.ts', kind: 'function', line: 1 }],
      downstream: [
        {
          symbol: 'x',
          callers: [{ name: 'a', file: 'src/a.ts', line: 2 }],
          endpoints_affected: [],
          crons_affected: [],
          caller_count: undefined,
          truncated: undefined,
        } as never,
      ],
    });

    const { result } = await callBlast({ blast: legacy }, 1011);
    const out = result.structuredContent as never as {
      changed_symbols: { caller_count: number; callers: unknown[] }[];
    };
    expect(out.changed_symbols[0]!.caller_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Resolution failures
// ---------------------------------------------------------------------------

describe('get_blast_radius — resolution', () => {
  it('an unknown repo never reaches the blast route', async () => {
    const { result, calls } = await callBlast({ repos: [] }, 1012);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('acme/payments-api');
    expect(calls.getBlastRadius).not.toHaveBeenCalled();
  });

  it('a PR that is not imported never reaches the blast route', async () => {
    const { result, calls } = await callBlast({ pulls: [] }, 1013);

    expect(result.isError).toBe(true);
    expect(calls.getBlastRadius).not.toHaveBeenCalled();
  });
});
