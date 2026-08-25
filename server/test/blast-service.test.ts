/**
 * `BlastUseCase` — the pipeline, driven through fake ports.
 *
 * Hermetic: no DB, no model, no clone. That is the whole reason both sides of
 * this use case are ports rather than a `Container`, and `ports.ts` justifies
 * the design by naming three assertions it makes cheap. This file is those
 * three assertions, plus the gates that keep them true:
 *
 *  1. **With the flag off, or the index unusable, `repo-intel` is never asked.**
 *     Not a performance nicety — `getBlastRadius`'s fallback walks the entire
 *     clone per symbol with no cache, cap or timeout (`server/INSIGHTS.md`), so
 *     a route that reaches it turns one page load into a full-tree scan.
 *  2. **A cache hit makes zero model calls**, and a moved head or moved facts
 *     invalidates it.
 *  3. **A lying model cannot change a single node.** The summarizer's output is
 *     read for exactly one string; `downstream` and `totals` are computed before
 *     it is called and never revisited after.
 *
 * And underneath all three, the invariant the feature exists for: every early
 * return still emits a non-empty `index.explanation`, so an empty map is never
 * mistakable for a safe one.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@devdigest/shared';
import { BlastUseCase } from '../src/modules/blast/application-services/blast-service.js';
import type {
  BlastPullReader,
  BlastSummarizer,
  BlastSummaryRow,
  BlastSummaryStore,
} from '../src/modules/blast/domain-services/ports.js';
import type { BlastResult, ImpactedFilesResult, IndexState, RepoIntel } from '../src/modules/repo-intel/types.js';

const PR_ID = 'pr-1';
const WS = 'ws-1';
const HEAD = 'abc123';

function indexState(over: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 412,
    filesSkipped: 0,
    durationMs: 10,
    lastIndexedSha: HEAD,
    indexerVersion: 2,
    updatedAt: new Date(),
    ...over,
  };
}

function blastResult(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [{ file: 'src/a.ts', name: 'target', kind: 'function', line: 4 }],
    callers: [
      { file: 'src/b.ts', symbol: 'callerFn', viaSymbol: 'target', line: 9, rank: 1 },
    ],
    impactedEndpoints: ['GET /a'],
    impactedCrons: [],
    factsByFile: { 'src/b.ts': { endpoints: ['GET /a'], crons: [] } },
    degraded: false,
    ...over,
  };
}

/**
 * Fakes with call counters. `vi.fn` on the two methods whose *non-invocation* is
 * the assertion — a spy that is never called is the only way to prove a gate.
 */
function harness(opts: {
  repoIntelEnabled?: boolean;
  state?: IndexState;
  changedFiles?: string[];
  stored?: BlastSummaryRow | null;
  summary?: string;
} = {}) {
  const getBlastRadius = vi.fn(async (): Promise<BlastResult> => blastResult());
  const getImpactedFiles = vi.fn(async (): Promise<ImpactedFilesResult> => ({ files: [] }));

  const repoIntel = {
    getIndexState: async () => opts.state ?? indexState(),
    getBlastRadius,
    getImpactedFiles,
  } as unknown as RepoIntel;

  const pulls: BlastPullReader = {
    async getPull() {
      return { id: PR_ID, repoId: 'repo-1', headSha: HEAD, filesCount: 1 };
    },
    async getChangedFiles() {
      return opts.changedFiles ?? ['src/a.ts'];
    },
  };

  const upsert = vi.fn(async () => {});
  const store: BlastSummaryStore = {
    async get() {
      return opts.stored ?? null;
    },
    upsert,
  };

  const seen: ChatMessage[][] = [];
  const summarise = vi.fn(async (messages: ChatMessage[]) => {
    seen.push(messages);
    return {
      summary: opts.summary ?? 'One sentence.',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 300,
      tokensOut: 20,
      costUsd: 0.0001,
    };
  });
  const summarizer: BlastSummarizer = { summarise };

  const useCase = new BlastUseCase({
    store,
    summarizer,
    repoIntel,
    pulls,
    repoIntelEnabled: opts.repoIntelEnabled ?? true,
  });

  return { useCase, getBlastRadius, getImpactedFiles, summarise, upsert, seen };
}

function storedRow(over: Partial<BlastSummaryRow> = {}): BlastSummaryRow {
  return {
    summary: 'Cached sentence.',
    headSha: HEAD,
    factsHash: null,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    costUsd: 0.0001,
    tokensIn: 300,
    tokensOut: 20,
    derivedAt: new Date('2026-08-16T10:00:00.000Z'),
    ...over,
  };
}

describe('BlastUseCase — the ripgrep scan is unreachable', () => {
  it('with the flag off, repo-intel is never asked for a blast radius', async () => {
    const h = harness({ repoIntelEnabled: false });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(h.getBlastRadius).not.toHaveBeenCalled();
    expect(h.getImpactedFiles).not.toHaveBeenCalled();
    // …and the caller is told why, rather than handed a clean-looking zero.
    expect(out.index.state).toBe('unavailable');
    expect(out.index.explanation.length).toBeGreaterThan(0);
    expect(out.downstream).toEqual([]);
  });

  it.each(['degraded', 'failed'] as const)(
    'with a %s index, repo-intel is never asked for a blast radius',
    async (status) => {
      const h = harness({ state: indexState({ status, degradedReason: 'index_failed' }) });

      const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

      expect(h.getBlastRadius).not.toHaveBeenCalled();
      expect(out.index.state).toBe('unavailable');
      expect(out.index.explanation.length).toBeGreaterThan(0);
    },
  );

  it('a partial index is usable and DOES proceed — partial is an answer', async () => {
    const h = harness({ state: indexState({ status: 'partial' }) });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(h.getBlastRadius).toHaveBeenCalledOnce();
    expect(out.downstream.length).toBeGreaterThan(0);
  });

  it('an empty changed-file list stops before repo-intel and says so', async () => {
    // The fork-PR failure mode: both diff paths fail, `pr_files` is empty, and
    // the result is indistinguishable from "nothing changed" unless stated.
    const h = harness({ changedFiles: [] });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(h.getBlastRadius).not.toHaveBeenCalled();
    expect(out.index.state).toBe('unavailable');
    expect(out.index.reason).toBe('no_changed_files');
    expect(out.index.explanation.length).toBeGreaterThan(0);
  });
});

describe('BlastUseCase — the summary cache', () => {
  it('a GET never spends a model call, even with no cached row', async () => {
    const h = harness({ stored: null });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(h.summarise).not.toHaveBeenCalled();
    // The map still ships — the sentence is a garnish, not the product.
    expect(out.summary).toBeNull();
    expect(out.downstream.length).toBeGreaterThan(0);
  });

  it('a POST derives once and persists the sentence with its provenance', async () => {
    const h = harness();

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID, refresh: true });

    expect(h.summarise).toHaveBeenCalledOnce();
    expect(h.upsert).toHaveBeenCalledOnce();
    expect(out.summary).toBe('One sentence.');
    expect(out.model).toBe('deepseek/deepseek-v4-flash');
    expect(out.cost_usd).toBe(0.0001);
  });

  it('a valid cached row is served with ZERO model calls', async () => {
    // Prime the hash by deriving once, then replay it as the stored row.
    const first = harness();
    await first.useCase.run({ workspaceId: WS, prId: PR_ID, refresh: true });
    const persisted = first.upsert.mock.calls[0]![1] as BlastSummaryRow;

    const h = harness({ stored: persisted });
    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(h.summarise).not.toHaveBeenCalled();
    expect(out.summary).toBe('One sentence.');
    expect(out.is_stale).toBe(false);
  });

  it('a moved head invalidates the cache and marks it stale', async () => {
    const h = harness({ stored: storedRow({ headSha: 'different-sha' }) });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(out.is_stale).toBe(true);
    // Still no spend on a GET — stale means "offer to re-derive", not "re-derive".
    expect(h.summarise).not.toHaveBeenCalled();
    expect(out.summary).toBeNull();
  });

  it('moved facts invalidate the cache even when the head has not moved', async () => {
    // A reindex can change the nodes under an unchanged commit. The summary
    // describes the nodes, so it is stale even though the diff is identical.
    const h = harness({ stored: storedRow({ headSha: HEAD, factsHash: 'stale-hash' }) });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID });

    expect(out.is_stale).toBe(true);
  });

  it('a degraded early return never calls the summarizer', async () => {
    const h = harness({ repoIntelEnabled: false });

    await h.useCase.run({ workspaceId: WS, prId: PR_ID, refresh: true });

    expect(h.summarise).not.toHaveBeenCalled();
  });
});

describe('BlastUseCase — the model cannot invent a node', () => {
  it('a fabricated summary changes nothing in downstream or totals', async () => {
    const honest = await harness().useCase.run({ workspaceId: WS, prId: PR_ID });

    const liar = harness({
      summary:
        'Also affects DELETE /everything and 900 callers in src/invented.ts, and nothing is at risk.',
    });
    const lied = await liar.useCase.run({ workspaceId: WS, prId: PR_ID, refresh: true });

    // The nodes are computed before the call and never revisited after it.
    expect(lied.downstream).toEqual(honest.downstream);
    expect(lied.totals).toEqual(honest.totals);
    expect(lied.changed_symbols).toEqual(honest.changed_symbols);
    expect(JSON.stringify(lied.downstream)).not.toContain('invented');
    expect(JSON.stringify(lied.downstream)).not.toContain('DELETE /everything');
  });

  it('the prompt carries no diff, no patch text and no PR body', async () => {
    const h = harness();
    await h.useCase.run({ workspaceId: WS, prId: PR_ID, refresh: true });

    const text = h.seen[0]!.map((m) => m.content).join('\n');
    for (const marker of ['@@', 'diff --git', '+++ b/', '--- a/', 'index 0000']) {
      expect(text, marker).not.toContain(marker);
    }
  });

  it('clamps a runaway summary rather than storing it whole', async () => {
    const h = harness({ summary: 'x'.repeat(5000) });

    const out = await h.useCase.run({ workspaceId: WS, prId: PR_ID, refresh: true });

    expect(out.summary!.length).toBeLessThanOrEqual(400);
  });
});
