import { describe, it, expect } from 'vitest';
import { assembleDownstream } from '../src/modules/blast/domain-services/assemble.js';
import type { BlastCallerRow, BlastResult, ImpactedFileRow } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic — pure function, no DB, no model.
 *
 * The load-bearing test in this file is "caps at 20 PER SYMBOL": a flat
 * `sort().slice(20)` over all callers used to drop every caller of the second
 * and later symbols as soon as the first symbol was popular.
 */

function caller(over: Partial<BlastCallerRow> = {}): BlastCallerRow {
  return { file: 'src/a.ts', symbol: 'callerFn', viaSymbol: 'target', line: 1, rank: 0, ...over };
}

function blastResult(over: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    impactedCrons: [],
    degraded: false,
    ...over,
  };
}

describe('assembleDownstream — per-symbol caller cap', () => {
  it('keeps exactly 20 of 21 callers on one symbol and reports the true count', () => {
    const callers = Array.from({ length: 21 }, (_, i) =>
      caller({ file: `src/c${String(i).padStart(2, '0')}.ts`, viaSymbol: 'hot', rank: 100 - i }),
    );
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/hot.ts', name: 'hot', kind: 'function', line: 3 }],
        callers,
      }),
      [],
    );

    const row = result.downstream.find((d) => d.symbol === 'hot');
    expect(row?.callers).toHaveLength(20);
    expect(row?.caller_count).toBe(21);
    expect(row?.truncated).toBe(true);
  });

  /**
   * Regression, and the reason the facade must not pre-cap.
   *
   * The cap is a DISPLAY rule. Attribution is not: an endpoint reachable only
   * through the 21st-ranked caller is still genuinely downstream of this change,
   * and dropping it would under-report impact while the card cheerfully showed a
   * complete-looking chip row. When `repo-intel` capped before returning, this
   * was unfixable here — the caller simply was not in the data. It now returns
   * every resolved caller and this ring slices, so both facts survive.
   */
  it('attributes an endpoint reachable only via a caller beyond the cap', () => {
    const callers = Array.from({ length: 21 }, (_, i) =>
      caller({ file: `src/c${String(i).padStart(2, '0')}.ts`, viaSymbol: 'hot', rank: 100 - i }),
    );
    const buried = callers[20]!.file;

    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/hot.ts', name: 'hot', kind: 'function', line: 3 }],
        callers,
        factsByFile: { [buried]: { endpoints: ['GET /only-via-caller-21'], crons: [] } },
      }),
      [],
    );

    const row = result.downstream.find((d) => d.symbol === 'hot');
    // The caller itself is correctly cut from the display list…
    expect(row?.callers.map((c) => c.file)).not.toContain(buried);
    // …but what it reaches is not.
    expect(row?.endpoints_affected).toContain('GET /only-via-caller-21');
  });

  it('does NOT starve a second symbol when the first one is over the cap', () => {
    // The regression: a global cap ate all five of `cold`'s callers.
    const hot = Array.from({ length: 21 }, (_, i) =>
      caller({ file: `src/hot${i}.ts`, viaSymbol: 'hot', rank: 500 + i }),
    );
    const cold = Array.from({ length: 5 }, (_, i) =>
      caller({ file: `src/cold${i}.ts`, viaSymbol: 'cold', rank: 1 }),
    );

    const result = assembleDownstream(
      blastResult({
        changedSymbols: [
          { file: 'src/hot.ts', name: 'hot', kind: 'function', line: 1 },
          { file: 'src/cold.ts', name: 'cold', kind: 'function', line: 2 },
        ],
        callers: [...hot, ...cold],
      }),
      [],
    );

    expect(result.downstream.find((d) => d.symbol === 'hot')?.callers).toHaveLength(20);
    expect(result.downstream.find((d) => d.symbol === 'cold')?.callers).toHaveLength(5);
    expect(result.downstream.find((d) => d.symbol === 'cold')?.truncated).toBe(false);
  });

  it('at exactly 20 callers, nothing is truncated', () => {
    const callers = Array.from({ length: 20 }, (_, i) =>
      caller({ file: `src/c${i}.ts`, viaSymbol: 'edge' }),
    );
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/edge.ts', name: 'edge', kind: 'function', line: 1 }],
        callers,
      }),
      [],
    );
    const row = result.downstream[0];
    expect(row?.callers).toHaveLength(20);
    expect(row?.caller_count).toBe(20);
    expect(row?.truncated).toBe(false);
  });

  it('totals.callers reports the PRE-cap sum, not the displayed count', () => {
    const callers = Array.from({ length: 25 }, (_, i) =>
      caller({ file: `src/c${i}.ts`, viaSymbol: 'hot' }),
    );
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/hot.ts', name: 'hot', kind: 'function', line: 1 }],
        callers,
      }),
      [],
    );
    expect(result.totals.callers).toBe(25);
  });
});

describe('assembleDownstream — ordering', () => {
  it('sorts callers by rank descending', () => {
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/t.ts', name: 'target', kind: 'function', line: 1 }],
        callers: [
          caller({ file: 'src/low.ts', rank: 1 }),
          caller({ file: 'src/high.ts', rank: 99 }),
          caller({ file: 'src/mid.ts', rank: 50 }),
        ],
      }),
      [],
    );
    expect(result.downstream[0]?.callers.map((c) => c.file)).toEqual([
      'src/high.ts',
      'src/mid.ts',
      'src/low.ts',
    ]);
  });

  it('breaks rank ties deterministically by file then line', () => {
    const input = blastResult({
      changedSymbols: [{ file: 'src/t.ts', name: 'target', kind: 'function', line: 1 }],
      callers: [
        caller({ file: 'src/b.ts', rank: 5, line: 9 }),
        caller({ file: 'src/a.ts', rank: 5, line: 4 }),
        caller({ file: 'src/a.ts', rank: 5, line: 2 }),
      ],
    });
    const first = assembleDownstream(input, []);
    // Same input reversed must produce the same output, or the facts hash
    // would change between two identical requests.
    const second = assembleDownstream(
      { ...input, callers: [...input.callers].reverse() },
      [],
    );
    expect(first.downstream[0]?.callers).toEqual([
      { name: 'callerFn', file: 'src/a.ts', line: 2 },
      { name: 'callerFn', file: 'src/a.ts', line: 4 },
      { name: 'callerFn', file: 'src/b.ts', line: 9 },
    ]);
    expect(second).toEqual(first);
  });
});

describe('assembleDownstream — corner cases', () => {
  it('zero symbols yields no rows and zeroed totals', () => {
    const result = assembleDownstream(blastResult(), []);
    expect(result.downstream).toEqual([]);
    expect(result.totals).toEqual({ symbols: 0, callers: 0, endpoints: 0, crons: 0 });
  });

  it('a changed symbol with zero callers still gets a row', () => {
    // "Declared, nothing calls it" is a real answer and must not be dropped.
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/lonely.ts', name: 'lonely', kind: 'function', line: 7 }],
      }),
      [],
    );
    expect(result.downstream).toHaveLength(1);
    expect(result.downstream[0]?.symbol).toBe('lonely');
    expect(result.downstream[0]?.caller_count).toBe(0);
    expect(result.downstream[0]?.truncated).toBe(false);
  });

  it('a single caller is both first and last', () => {
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/t.ts', name: 'target', kind: 'function', line: 1 }],
        callers: [caller({ file: 'src/only.ts', line: 42 })],
      }),
      [],
    );
    expect(result.downstream[0]?.callers).toEqual([
      { name: 'callerFn', file: 'src/only.ts', line: 42 },
    ]);
    expect(result.totals.callers).toBe(1);
  });

  it('a depth-2 cycle visits nothing twice', () => {
    // A imports B, B imports A. The crawl already deduped; assembly must not
    // reintroduce a duplicate endpoint through double attribution.
    const impacted: ImpactedFileRow[] = [
      { file: 'src/a.ts', depth: 1, endpoints: ['GET /a'], crons: [] },
      { file: 'src/b.ts', depth: 2, endpoints: ['GET /a', 'GET /b'], crons: [] },
    ];
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/a.ts', name: 'target', kind: 'function', line: 1 }],
        callers: [caller({ file: 'src/b.ts' })],
      }),
      impacted,
    );
    expect(result.downstream[0]?.endpoints_affected).toEqual(['GET /a', 'GET /b']);
    expect(result.totals.endpoints).toBe(2);
  });

  it('attributes endpoints from ALL callers, including ones past the cap', () => {
    // Truncating the DISPLAY list must not silently drop a downstream endpoint.
    const callers = Array.from({ length: 21 }, (_, i) =>
      caller({ file: `src/c${String(i).padStart(2, '0')}.ts`, rank: 100 - i }),
    );
    const factsByFile = Object.fromEntries(
      callers.map((c, i) => [c.file, { endpoints: [`GET /e${i}`], crons: [] }]),
    );
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/t.ts', name: 'target', kind: 'function', line: 1 }],
        callers,
        factsByFile,
      }),
      [],
    );
    expect(result.downstream[0]?.callers).toHaveLength(20);
    expect(result.downstream[0]?.endpoints_affected).toHaveLength(21);
  });

  it('dedupes and sorts endpoint and cron strings', () => {
    const result = assembleDownstream(
      blastResult({
        changedSymbols: [{ file: 'src/t.ts', name: 'target', kind: 'function', line: 1 }],
        callers: [caller({ file: 'src/x.ts' }), caller({ file: 'src/y.ts', line: 2 })],
        factsByFile: {
          'src/x.ts': { endpoints: ['POST /z', 'GET /a'], crons: ['0 * * * *'] },
          'src/y.ts': { endpoints: ['GET /a'], crons: ['0 * * * *', '@daily'] },
        },
      }),
      [],
    );
    expect(result.downstream[0]?.endpoints_affected).toEqual(['GET /a', 'POST /z']);
    // localeCompare order, whatever it is, as long as it is STABLE — the facts
    // hash only needs reproducibility, not a particular collation.
    expect(result.downstream[0]?.crons_affected).toEqual(
      ['0 * * * *', '@daily'].sort((a, b) => a.localeCompare(b)),
    );
    expect(result.downstream[0]?.crons_affected).toHaveLength(2);
  });
});
