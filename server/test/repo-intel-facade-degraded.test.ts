import { describe, it, expect, vi } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { RepoBasics } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * T1.4 — Facade degraded contract (acceptance #10).
 *
 * When `repoIntelEnabled=false` (opt-out; the default is now ON), every facade
 * method MUST return a safe degraded value WITHOUT throwing. Consumers (run-executor,
 * blast, hooks) downgrade to their pre-T1.3 behavior on these returns; if any
 * method threw or returned malformed shape, every consumer would crash.
 *
 * No Postgres, no clone. The service's `repo` (RepoIntelRepository) is patched
 * to return null/[] so we exercise the degraded paths cleanly.
 */

function buildDegradedService(opts: {
  flag: boolean;
  basics?: RepoBasics | null;
  indexStateRow?: IndexState | null;
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flag },
    db: {} as never,
    // codeIndex is reached by getBlastRadius; we stub minimal behaviour.
    codeIndex: {
      symbols: async () => [],
      references: async () => [],
    } as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => opts.basics ?? null,
    tryGetIndexState: async () => opts.indexStateRow ?? null,
    getCachedSymbols: async () => [],
    getCachedSymbolsForFiles: async () => [],
    getCachedReferencesTo: async () => [],
  };
  return svc;
}

describe('RepoIntel facade — degraded contract (flag off)', () => {
  it('getUnresolvedReferences → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getBlastRadius → degraded-but-valid shape (never throws)', async () => {
    const svc = buildDegradedService({ flag: false, basics: null });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    // Shape (every key present, arrays where arrays go) — consumers assume this.
    expect(Array.isArray(blast.changedSymbols)).toBe(true);
    expect(Array.isArray(blast.callers)).toBe(true);
    expect(Array.isArray(blast.impactedEndpoints)).toBe(true);
    expect(blast.degraded).toBe(true);
    // reason is one of the documented DegradedReason values
    expect(['flag_off', 'no_data', 'index_failed', 'index_partial', 'repo_too_large'])
      .toContain(blast.reason);
  });

  it('getIndexState → degraded row (never throws) when no row exists', async () => {
    const svc = buildDegradedService({ flag: false, indexStateRow: null });
    const state = await svc.getIndexState('r1');
    // Always-present fields the UI / dashboard rely on (client bind).
    expect(state.repoId).toBe('r1');
    expect(state.status).toBe('degraded');
    expect(state.filesIndexed).toBe(0);
    expect(state.filesSkipped).toBe(0);
    expect(state.lastIndexedSha).toBe(''); // empty string, not undefined — JSON-safe
    expect(state.indexerVersion).toBeGreaterThanOrEqual(1);
    expect(state.updatedAt instanceof Date).toBe(true);
    expect(state.degraded).toBe(true);
  });

  it('getRepoMap → degraded ({ text:"", tokens:0, cached:false, degraded:true })', async () => {
    const svc = buildDegradedService({ flag: false });
    const map = await svc.getRepoMap('r1');
    expect(map.text).toBe('');
    expect(map.tokens).toBe(0);
    expect(map.cached).toBe(false);
    expect(map.degraded).toBe(true);
  });

  it('getFileRank / getSymbolsInFiles / getConventionSamples / getTopFilesByRank / getCriticalPaths → []', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getFileRank('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getSymbolsInFiles('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getConventionSamples('r1', 12)).resolves.toEqual([]);
    await expect(svc.getTopFilesByRank('r1', 7)).resolves.toEqual([]);
    await expect(svc.getCriticalPaths('r1')).resolves.toEqual([]);
  });

  it('indexRepo / refreshIndex → degraded T1 skeleton (never throws)', async () => {
    const svc = buildDegradedService({ flag: false });
    const a = await svc.indexRepo('r1');
    const b = await svc.refreshIndex('r1');
    expect(a.status).toBe('degraded');
    expect(b.status).toBe('degraded');
    expect(a.filesIndexed).toBe(0);
    expect(b.filesIndexed).toBe(0);
  });
});

describe('RepoIntel facade — degraded contract (flag on, but no data)', () => {
  it('getCallerSignatures with no clone → [] (graceful degrade, no throw)', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: null } });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getUnresolvedReferences with no clone → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: null } });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures with empty changedFiles → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: '/tmp' } });
    await expect(svc.getCallerSignatures('r1', [])).resolves.toEqual([]);
  });
});

/**
 * getCallerSignatures — persistent-index-only contract.
 *
 * Regression coverage for the hang reported against a large monorepo review:
 * the old implementation called `container.codeIndex.references()` (a full
 * recursive read-every-file-in-the-repo walk, once per declared symbol) on
 * EVERY review, indexed repo or not. That made a review of a large repo do a
 * full-tree scan with no cap and no timeout. `getCallerSignatures` must now
 * serve exclusively from the persistent `symbols`/`references` tables — same
 * as `getRepoMap`/`getFileRank` — and must NEVER reach `codeIndex.references`.
 */
describe('RepoIntel facade — getCallerSignatures persistent-index-only', () => {
  function buildPersistentService(opts: {
    indexStateRow: IndexState | null;
    symbolRows?: { path: string; name: string; kind: string; line: number; endLine: number | null; exported: boolean; signature: string | null }[];
    callerRows?: { fromPath: string; toSymbol: string; line: number; rank: number }[];
  }) {
    const referencesSpy = vi.fn(async () => []);
    const container = {
      config: { repoIntelEnabled: true },
      db: {} as never,
      codeIndex: { symbols: async () => [], references: referencesSpy } as never,
    } as never;
    const svc = new RepoIntelService(container);
    (svc as unknown as { repo: Record<string, unknown> }).repo = {
      getRepoBasics: async () => ({ id: 'r1', owner: 'a', name: 'b', clonePath: '/repo' }),
      tryGetIndexState: async () => opts.indexStateRow,
      getSymbolRows: async (_repoId: string, paths: string[]) =>
        (opts.symbolRows ?? []).filter((s) => paths.includes(s.path)),
      getResolvedCallers: async () => opts.callerRows ?? [],
    };
    return { svc, referencesSpy };
  }

  const baseState: IndexState = {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 100,
    filesSkipped: 0,
    durationMs: 1000,
    lastIndexedSha: 'abc123',
    indexerVersion: 1,
    updatedAt: new Date(),
  };

  it('never calls codeIndex.references — no live full-repo walk when unindexed', async () => {
    const { svc, referencesSpy } = buildPersistentService({ indexStateRow: null });
    await expect(svc.getCallerSignatures('r1', ['src/api/public.ts'])).resolves.toEqual([]);
    expect(referencesSpy).not.toHaveBeenCalled();
  });

  it('never calls codeIndex.references — serves callers from the persistent index instead', async () => {
    const { svc, referencesSpy } = buildPersistentService({
      indexStateRow: baseState,
      symbolRows: [
        {
          path: 'src/api/public.ts',
          name: 'handler',
          kind: 'function',
          line: 5,
          endLine: 10,
          exported: true,
          signature: 'function handler(req)',
        },
        {
          path: 'src/callers/consumer.ts',
          name: 'run',
          kind: 'function',
          line: 1,
          endLine: 20,
          exported: true,
          signature: 'function run()',
        },
      ],
      callerRows: [{ fromPath: 'src/callers/consumer.ts', toSymbol: 'handler', line: 8, rank: 42 }],
    });

    const rows = await svc.getCallerSignatures('r1', ['src/api/public.ts']);

    expect(rows).toEqual([
      { file: 'src/callers/consumer.ts', symbol: 'run', signature: 'function run()', rank: 42 },
    ]);
    expect(referencesSpy).not.toHaveBeenCalled();
  });

  it('degrades to [] when the index exists but has no usable status (never falls back to a live scan)', async () => {
    const { svc, referencesSpy } = buildPersistentService({
      indexStateRow: { ...baseState, status: 'failed' },
    });
    await expect(svc.getCallerSignatures('r1', ['src/api/public.ts'])).resolves.toEqual([]);
    expect(referencesSpy).not.toHaveBeenCalled();
  });
});
