import type { BlastIndexInfo, ChangedSymbol, DownstreamImpact } from '@devdigest/shared';

/**
 * A deterministic canonical STRING of the computed node set — the input to the
 * summary cache key.
 *
 * Why a string and not a hash: `domain-services` may not import `node:*` (see
 * `.claude/skills/onion-architecture`), so `createHash` cannot live in this
 * ring. The application service hashes what this returns, exactly as
 * `reviews/intent/service.ts` does. Splitting it this way is what keeps the
 * canonicalisation rules unit-testable with no crypto and no I/O.
 *
 * What goes in: only things that, if they changed, would make the cached
 * sentence WRONG. What stays out: timestamps, the head sha (tracked separately
 * as its own cache-key column), costs, provider/model, and the summary itself.
 */

export interface CanonicalFactsInput {
  changedSymbols: ChangedSymbol[];
  downstream: DownstreamImpact[];
  index: Pick<BlastIndexInfo, 'state'>;
}

export function canonicalFacts(input: CanonicalFactsInput): string {
  const symbols = input.changedSymbols
    .map((s) => `${s.file}:${s.line}:${s.kind}:${s.name}`)
    .sort();

  const downstream = input.downstream
    .map((d) => {
      const callers = d.callers.map((c) => `${c.file}:${c.line}:${c.name}`).sort();
      return {
        symbol: d.symbol,
        // `caller_count`, not the capped list length: a symbol going from 20 to
        // 400 callers changes the impact story even though the shown list does
        // not move, and the sentence quotes counts.
        caller_count: d.caller_count,
        callers,
        endpoints: [...d.endpoints_affected].sort(),
        crons: [...d.crons_affected].sort(),
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // The index state belongs in the key: the same nodes seen through a `partial`
  // index deserve a differently-hedged sentence than through a `full` one.
  return JSON.stringify({ state: input.index.state, symbols, downstream });
}
