import { createHash } from 'node:crypto';
import type { ChangedSymbol, PrBlastRecord } from '@devdigest/shared';
import { NotFoundError } from '../../../platform/errors.js';
import type { RepoIntel } from '../../repo-intel/types.js';
import type { BlastNodes, IndexStatsShape } from '../domain-model/types.js';
import { MAX_SUMMARY_CHARS } from '../domain-model/constants.js';
import { assembleDownstream } from '../domain-services/assemble.js';
import { buildCoverage } from '../domain-services/coverage.js';
import { canonicalFacts } from '../domain-services/canonical.js';
import { buildSummaryMessages } from '../domain-services/render.js';
import type {
  BlastPullReader,
  BlastSummarizer,
  BlastSummaryRow,
  BlastSummaryStore,
} from '../domain-services/ports.js';

/**
 * The blast-radius use case: `prId` -> `PrBlastRecord`.
 *
 * Two invariants are enforced HERE rather than trusted downstream:
 *
 *  1. **The ripgrep full-tree scan is unreachable.** `container.codeIndex`'s
 *     `.symbols()` / `.references()` walk the entire clone per call with no
 *     cache, cap or timeout (server/INSIGHTS.md). Two gates below — the feature
 *     flag, then the index status — mean `getBlastRadius` is only ever called in
 *     the state where its persistent path is guaranteed to answer. repo-intel
 *     also carries its own permanent guard; this is the belt to that's braces.
 *
 *  2. **Missing data never degrades to an empty array.** Every early return
 *     still produces a valid record whose `index` block says what was missing
 *     and why. `downstream: []` is only ever emitted alongside an honest
 *     `index.state`, so the UI can never render "nothing found" as "nothing
 *     is impacted".
 *
 * Dependencies are injected as PORTS, never a `Container`, so the whole thing
 * runs in a hermetic test with no DB and no model.
 */

export interface BlastUseCaseDeps {
  store: BlastSummaryStore;
  summarizer: BlastSummarizer;
  repoIntel: RepoIntel;
  pulls: BlastPullReader;
  repoIntelEnabled: boolean;
}

export interface BlastRunArgs {
  workspaceId: string;
  prId: string;
  /** POST: always re-derive the sentence. GET: reuse a valid cached one. */
  refresh?: boolean;
}

export class BlastUseCase {
  constructor(private readonly deps: BlastUseCaseDeps) {}

  async run(args: BlastRunArgs): Promise<PrBlastRecord> {
    const { workspaceId, prId, refresh = false } = args;
    const { store, summarizer, repoIntel, pulls, repoIntelEnabled } = this.deps;

    const pull = await pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const stored = await store.get(prId);

    // --- Gate 1: the feature flag -------------------------------------------
    if (!repoIntelEnabled) {
      return this.degraded({ prId, pull, stored, reason: 'flag_off', changedFiles: [] });
    }

    // --- Gate 2: the index must be able to answer ---------------------------
    const indexState = await repoIntel.getIndexState(pull.repoId);
    const usable = indexState.status === 'full' || indexState.status === 'partial';
    if (!usable) {
      return this.degraded({
        prId,
        pull,
        stored,
        reason: indexState.degradedReason ?? 'no_data',
        indexStatus: indexState.status,
        indexedFiles: indexState.filesIndexed,
        changedFiles: [],
      });
    }

    // --- Changed files -------------------------------------------------------
    const changedFiles = await pulls.getChangedFiles(prId);
    if (changedFiles.length === 0) {
      // A fork PR whose diff failed to load produces exactly this, and it is
      // indistinguishable from "nothing changed" unless we say so out loud.
      return this.degraded({
        prId,
        pull,
        stored,
        reason: 'no_changed_files',
        indexStatus: indexState.status,
        indexedFiles: indexState.filesIndexed,
        changedFiles: [],
      });
    }

    // Both gates passed: the persistent path is guaranteed, ripgrep unreachable.
    const blast = await repoIntel.getBlastRadius(pull.repoId, changedFiles);
    const impacted = await repoIntel.getImpactedFiles(pull.repoId, changedFiles);

    const { downstream, totals } = assembleDownstream(blast, impacted.files);

    const changedSymbols: ChangedSymbol[] = blast.changedSymbols.map((s) => ({
      name: s.name,
      file: s.file,
      kind: s.kind,
      line: s.line,
    }));

    const index = buildCoverage({
      indexStatus: indexState.status,
      degradedReason: blast.degraded ? (blast.reason ?? 'index_partial') : null,
      changedFiles,
      indexedSymbolFiles: [...new Set(blast.changedSymbols.map((s) => s.file))],
      indexedFiles: indexState.filesIndexed,
      prFilesCount: changedFiles.length,
      pullFilesCount: pull.filesCount,
      stats: asStats(indexState),
    });

    const factsHash = hashFacts(canonicalFacts({ changedSymbols, downstream, index }));

    // --- The one LLM call, and only when the cache cannot answer -------------
    const cacheValid =
      stored !== null && stored.headSha === pull.headSha && stored.factsHash === factsHash;

    let row: BlastSummaryRow | null = cacheValid ? stored : null;

    if (refresh || !cacheValid) {
      if (refresh) {
        const nodes = toNodes(changedSymbols, downstream, totals, index.state);
        const result = await summarizer.summarise(buildSummaryMessages(nodes));
        row = {
          // Clamped: the model is asked for 1-2 sentences, this is the backstop.
          summary: result.summary.trim().slice(0, MAX_SUMMARY_CHARS),
          headSha: pull.headSha,
          factsHash,
          provider: result.provider,
          model: result.model,
          // `null`, never 0 — an unpriced model is unknown cost, not free.
          costUsd: result.costUsd,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          derivedAt: new Date(),
        };
        await store.upsert(prId, row);
      } else {
        // GET with a stale or absent row: ship the map with no sentence rather
        // than spending a model call the caller did not ask for.
        row = null;
      }
    }

    return {
      pr_id: prId,
      changed_symbols: changedSymbols,
      downstream,
      totals,
      index,
      summary: row?.summary ?? null,
      head_sha: row?.headSha ?? null,
      provider: row?.provider ?? null,
      model: row?.model ?? null,
      cost_usd: row?.costUsd ?? null,
      tokens_in: row?.tokensIn ?? null,
      tokens_out: row?.tokensOut ?? null,
      derived_at: row?.derivedAt?.toISOString() ?? null,
      is_stale: stored !== null && !cacheValid,
    };
  }

  /**
   * A degraded-but-valid record. Note what this deliberately does NOT do: it
   * never calls the summarizer, and it never presents its empty `downstream`
   * without an `index` block explaining the emptiness.
   */
  private degraded(args: {
    prId: string;
    pull: { headSha: string; filesCount: number };
    stored: BlastSummaryRow | null;
    reason: string;
    indexStatus?: 'full' | 'partial' | 'degraded' | 'failed';
    indexedFiles?: number;
    changedFiles: string[];
  }): PrBlastRecord {
    const index = buildCoverage({
      indexStatus: args.indexStatus ?? null,
      degradedReason: args.reason,
      changedFiles: args.changedFiles,
      indexedSymbolFiles: [],
      indexedFiles: args.indexedFiles ?? 0,
      prFilesCount: args.changedFiles.length,
      pullFilesCount: args.pull.filesCount,
    });

    return {
      pr_id: args.prId,
      changed_symbols: [],
      downstream: [],
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      index,
      summary: null,
      head_sha: null,
      provider: null,
      model: null,
      cost_usd: null,
      tokens_in: null,
      tokens_out: null,
      derived_at: null,
      // A stored sentence describes nodes we can no longer compute — stale.
      is_stale: args.stored !== null,
    };
  }
}

/**
 * SHA-256 of the canonical string. Hashing lives here, in an application
 * service, because `domain-services` may not import `node:*` — same split as
 * `reviews/intent/service.ts`.
 */
function hashFacts(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/** `repo_index_state.stats` is untyped jsonb; narrow it defensively. */
function asStats(state: unknown): IndexStatsShape | undefined {
  if (typeof state !== 'object' || state === null) return undefined;
  const stats = (state as { stats?: unknown }).stats;
  if (typeof stats !== 'object' || stats === null) return undefined;
  return stats as IndexStatsShape;
}

/** Project the assembled record down to the ONLY thing the model is shown. */
function toNodes(
  changedSymbols: ChangedSymbol[],
  downstream: PrBlastRecord['downstream'],
  totals: PrBlastRecord['totals'],
  indexState: BlastNodes['indexState'],
): BlastNodes {
  return {
    symbols: changedSymbols.map((s) => ({
      name: s.name,
      file: s.file,
      line: s.line,
      kind: s.kind,
    })),
    callers: downstream.flatMap((d) =>
      d.callers.map((c) => ({
        symbol: c.name,
        file: c.file,
        line: c.line,
        viaSymbol: d.symbol,
      })),
    ),
    endpoints: [...new Set(downstream.flatMap((d) => d.endpoints_affected))].sort(),
    crons: [...new Set(downstream.flatMap((d) => d.crons_affected))].sort(),
    totals,
    indexState,
  };
}
