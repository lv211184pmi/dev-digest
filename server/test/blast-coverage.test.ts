import { describe, it, expect } from 'vitest';
import { buildCoverage } from '../src/modules/blast/domain-services/coverage.js';
import type { CoverageInput } from '../src/modules/blast/domain-model/types.js';
import type { DegradedReason, IndexStatus } from '../src/modules/repo-intel/types.js';

/** Hermetic — pure function, no DB. */

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    indexStatus: 'full',
    degradedReason: null,
    changedFiles: ['src/a.ts'],
    indexedSymbolFiles: ['src/a.ts'],
    indexedFiles: 100,
    prFilesCount: 1,
    pullFilesCount: 1,
    ...over,
  };
}

describe('buildCoverage — THE invariant', () => {
  const statuses: Array<IndexStatus | null> = ['full', 'partial', 'degraded', 'failed', null];
  const reasons: Array<DegradedReason | null> = [
    'flag_off',
    'index_failed',
    'index_partial',
    'repo_too_large',
    'no_data',
    null,
  ];

  // This is a PROPERTY, not a case list: whatever combination of status and
  // reason arrives, a non-full state must always be able to explain itself.
  // An empty impact map with no explanation reads as "this change is safe".
  for (const indexStatus of statuses) {
    for (const degradedReason of reasons) {
      it(`state !== 'full' always has a non-empty explanation (status=${indexStatus}, reason=${degradedReason})`, () => {
        const result = buildCoverage(
          input({ indexStatus, degradedReason, indexedSymbolFiles: [] }),
        );
        if (result.state !== 'full') {
          expect(result.explanation.trim()).not.toBe('');
        }
      });
    }
  }

  it('holds for an empty changed-file list too', () => {
    const result = buildCoverage(
      input({ changedFiles: [], indexedSymbolFiles: [], prFilesCount: 0 }),
    );
    expect(result.state).toBe('unavailable');
    expect(result.explanation.trim()).not.toBe('');
  });
});

describe('buildCoverage — files_not_covered names the misses', () => {
  it('puts an unparseable language in files_not_covered and explains why', () => {
    const result = buildCoverage(
      input({
        changedFiles: ['src/a.ts', 'scripts/migrate.py'],
        indexedSymbolFiles: ['src/a.ts'],
      }),
    );
    expect(result.files_not_covered).toEqual(['scripts/migrate.py']);
    expect(result.files_covered).toEqual(['src/a.ts']);
    expect(result.state).toBe('partial');
    expect(result.explanation).toContain('scripts/migrate.py');
    expect(result.explanation.toLowerCase()).toContain('does not parse');
  });

  it('distinguishes a supported file that is simply absent from the index', () => {
    const result = buildCoverage(
      input({
        changedFiles: ['src/a.ts', 'src/brand-new.ts'],
        indexedSymbolFiles: ['src/a.ts'],
      }),
    );
    expect(result.files_not_covered).toEqual(['src/brand-new.ts']);
    expect(result.explanation).toContain('no symbols in the index');
  });

  it('a fully covered, fully indexed PR is `full` with no explanation', () => {
    const result = buildCoverage(input());
    expect(result.state).toBe('full');
    expect(result.explanation).toBe('');
    expect(result.reason).toBeNull();
    expect(result.files_not_covered).toEqual([]);
  });
});

describe('buildCoverage — degradation sources', () => {
  it('an unindexed repo is `unavailable`, never an empty "no impact"', () => {
    const result = buildCoverage(
      input({ indexStatus: null, degradedReason: 'no_data', indexedSymbolFiles: [], indexedFiles: 0 }),
    );
    expect(result.state).toBe('unavailable');
    expect(result.explanation).toContain('not been indexed');
  });

  it('reports the >100-file GitHub truncation', () => {
    const result = buildCoverage(input({ prFilesCount: 100, pullFilesCount: 137 }));
    expect(result.explanation).toContain('137');
    expect(result.explanation).toContain('100');
    expect(result.state).not.toBe('full');
  });

  it('surfaces the 5000-file index bound', () => {
    const result = buildCoverage(
      input({ indexStatus: 'partial', stats: { bounded: 1200 } }),
    );
    expect(result.explanation).toContain('1200');
    expect(result.state).toBe('partial');
  });

  it('surfaces skipped-too-large, soft budget, graph failure and parse errors', () => {
    const result = buildCoverage(
      input({
        indexStatus: 'partial',
        stats: {
          skippedTooLarge: 4,
          softBudgetReached: true,
          graphFailed: 'boom',
          parseDegraded: [{ file: 'src/x.ts', reason: 'syntax' }],
        },
      }),
    );
    expect(result.explanation).toContain('4 file(s) were skipped');
    expect(result.explanation).toContain('time budget');
    expect(result.explanation).toContain('import graph');
    expect(result.explanation).toContain('failed to parse');
  });

  it('`no_changed_files` is unavailable and says so', () => {
    const result = buildCoverage(
      input({ changedFiles: [], indexedSymbolFiles: [], degradedReason: 'no_changed_files', prFilesCount: 0 }),
    );
    expect(result.state).toBe('unavailable');
    expect(result.reason).toBe('no_changed_files');
    expect(result.explanation).toContain('No changed files');
  });

  it('an indexed repo covering none of the changed files is unavailable, not partial', () => {
    const result = buildCoverage(
      input({ changedFiles: ['docs/readme.md'], indexedSymbolFiles: [] }),
    );
    expect(result.state).toBe('unavailable');
    expect(result.files_not_covered).toEqual(['docs/readme.md']);
    expect(result.explanation.trim()).not.toBe('');
  });
});
