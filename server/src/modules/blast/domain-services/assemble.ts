import type { BlastTotals, DownstreamImpact } from '@devdigest/shared';
import type { BlastResult, ImpactedFileRow } from '../../repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL } from '../domain-model/constants.js';

/**
 * Deterministic assembly: repo-intel rows -> the downstream node list + totals.
 *
 * PURE. Same input, same output, every time — the facts hash that keys the
 * summary cache is computed over this result, so any nondeterminism here
 * (unsorted arrays, Map iteration leaking in, a rank tie resolving differently)
 * would silently invalidate the cache on every request.
 *
 * Two rules this file exists to enforce:
 *
 *  1. The caller cap is PER SYMBOL, not global. `caller_count` always reports
 *     the true pre-cap total, so the UI's "N callers" is honest even when only
 *     20 are listed.
 *  2. Endpoint/cron attribution is FILE-GRANULAR and deliberately broad. The
 *     index knows which file declares an endpoint, never which handler, so an
 *     endpoint is attributed to every changed symbol that reaches its file.
 *     UI copy says "potentially touched" for exactly this reason.
 */

export interface AssembledBlast {
  downstream: DownstreamImpact[];
  totals: BlastTotals;
}

/** Sorted + deduped, so two runs over the same nodes hash identically. */
function uniqSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function assembleDownstream(
  blast: BlastResult,
  impacted: ImpactedFileRow[],
): AssembledBlast {
  const factsByFile = blast.factsByFile ?? {};
  const impactedByFile = new Map(impacted.map((row) => [row.file, row]));

  // Group callers by the changed symbol they reach.
  const callersBySymbol = new Map<string, typeof blast.callers>();
  for (const caller of blast.callers) {
    const group = callersBySymbol.get(caller.viaSymbol);
    if (group) group.push(caller);
    else callersBySymbol.set(caller.viaSymbol, [caller]);
  }

  // Every changed symbol gets a row, including ones with no callers at all —
  // "declared, nothing calls it" is a real answer and must not be dropped.
  const symbolNames = uniqSorted([
    ...blast.changedSymbols.map((s) => s.name),
    ...callersBySymbol.keys(),
  ]);
  const declFileBySymbol = new Map(blast.changedSymbols.map((s) => [s.name, s.file]));

  const downstream: DownstreamImpact[] = [];
  let totalCallers = 0;
  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();

  for (const symbol of symbolNames) {
    const group = [...(callersBySymbol.get(symbol) ?? [])];

    // Rank desc, then file/line asc as a stable tiebreak. Without the tiebreak
    // two equal-rank callers could swap places between runs and change the hash.
    group.sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line);

    const callerCount = group.length;
    totalCallers += callerCount;
    const kept = group.slice(0, MAX_CALLERS_PER_SYMBOL);

    // Endpoints/crons reachable from this symbol: the facts of its callers'
    // files, plus the facts of anything the reverse crawl found downstream of
    // its own declaration file.
    const endpoints = new Set<string>();
    const crons = new Set<string>();

    const attributeFile = (file: string): void => {
      const facts = factsByFile[file];
      if (facts) {
        for (const e of facts.endpoints) endpoints.add(e);
        for (const c of facts.crons) crons.add(c);
      }
      const row = impactedByFile.get(file);
      if (row) {
        for (const e of row.endpoints) endpoints.add(e);
        for (const c of row.crons) crons.add(c);
      }
    };

    // Attribute from every caller found, not just the 20 kept — truncating the
    // display list must not silently drop a downstream endpoint.
    for (const caller of group) attributeFile(caller.file);

    const declFile = declFileBySymbol.get(symbol);
    if (declFile) attributeFile(declFile);

    const endpointsAffected = uniqSorted(endpoints);
    const cronsAffected = uniqSorted(crons);
    for (const e of endpointsAffected) allEndpoints.add(e);
    for (const c of cronsAffected) allCrons.add(c);

    downstream.push({
      symbol,
      callers: kept.map((c) => ({ name: c.symbol, file: c.file, line: c.line })),
      endpoints_affected: endpointsAffected,
      crons_affected: cronsAffected,
      caller_count: callerCount,
      truncated: callerCount > kept.length,
    });
  }

  return {
    downstream,
    totals: {
      symbols: blast.changedSymbols.length,
      // Pre-cap sum: the header stat must not under-report by 20 per symbol.
      callers: totalCallers,
      endpoints: allEndpoints.size,
      crons: allCrons.size,
    },
  };
}
