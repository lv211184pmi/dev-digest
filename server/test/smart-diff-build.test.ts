import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, type SmartDiffInputFile, type SmartDiffInputFinding } from '../src/modules/reviews/smart-diff/build.js';

function file(path: string, additions = 0, deletions = 0): SmartDiffInputFile {
  return { path, additions, deletions };
}

function finding(
  overrides: Partial<SmartDiffInputFinding> & Pick<SmartDiffInputFinding, 'id' | 'file'>,
): SmartDiffInputFinding {
  return {
    severity: 'WARNING',
    startLine: 1,
    endLine: 1,
    dismissed: false,
    ...overrides,
  };
}

describe('buildSmartDiff', () => {
  it('zero files → empty groups, too_big false, no crash', () => {
    const out = buildSmartDiff({ files: [], findings: [] });
    expect(out.groups).toEqual([]);
    expect(out.split_suggestion.too_big).toBe(false);
    expect(out.split_suggestion.total_lines).toBe(0);
    expect(out.split_suggestion.proposed_splits).toEqual([]);
  });

  it('zero findings falls through to size-then-path ordering', () => {
    const out = buildSmartDiff({
      files: [file('src/small.ts', 1, 0), file('src/big.ts', 10, 0), file('src/tie-a.ts', 5, 0), file('src/tie-b.ts', 5, 0)],
      findings: [],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toEqual(['src/big.ts', 'src/tie-a.ts', 'src/tie-b.ts', 'src/small.ts']);
  });

  it('findings pin files to the top of their own group, CRITICAL before WARNING', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 1, 0), file('src/b.ts', 1, 0), file('src/c.ts', 100, 0)],
      findings: [
        finding({ id: 'f1', file: 'src/b.ts', severity: 'WARNING' }),
        finding({ id: 'f2', file: 'src/a.ts', severity: 'CRITICAL' }),
      ],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    // both findings-carrying files precede the large no-findings file; CRITICAL first
    expect(core.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('dismissed findings are excluded; accepted (non-dismissed) are kept', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 1, 0)],
      findings: [
        finding({ id: 'f1', file: 'src/a.ts', severity: 'CRITICAL', dismissed: true }),
        finding({ id: 'f2', file: 'src/a.ts', severity: 'WARNING', dismissed: false }),
      ],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.findings).toHaveLength(1);
    expect(core.files[0]!.findings[0]!.finding_id).toBe('f2');
  });

  it('an orphan finding (file absent from the PR files) is dropped without crashing', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 1, 0)],
      findings: [finding({ id: 'f1', file: 'src/does-not-exist.ts', severity: 'CRITICAL' })],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files).toHaveLength(1);
    expect(core.files[0]!.findings).toEqual([]);
  });

  it('normalizes ./src/a.ts to src/a.ts', () => {
    const out = buildSmartDiff({ files: [file('./src/a.ts', 1, 0)], findings: [] });
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.path).toBe('src/a.ts');
  });

  it('clamps end_line to start_line when end_line < start_line', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 1, 0)],
      findings: [finding({ id: 'f1', file: 'src/a.ts', startLine: 10, endLine: 3 })],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.findings[0]!.end_line).toBe(10);
  });

  it('too_big is false at exactly 400 core+wiring lines and true at 401', () => {
    const exactly400 = buildSmartDiff({ files: [file('src/a.ts', 400, 0)], findings: [] });
    expect(exactly400.split_suggestion.too_big).toBe(false);
    expect(exactly400.split_suggestion.total_lines).toBe(400);

    const at401 = buildSmartDiff({ files: [file('src/a.ts', 401, 0)], findings: [] });
    expect(at401.split_suggestion.too_big).toBe(true);
    expect(at401.split_suggestion.total_lines).toBe(401);
  });

  it('boilerplate lines are excluded from total_lines', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 100, 0), file('pnpm-lock.yaml', 5000, 2000)],
      findings: [],
    });
    expect(out.split_suggestion.total_lines).toBe(100);
  });

  it('proposed_splits is empty with one bucket, populated with two', () => {
    const oneBucket = buildSmartDiff({
      files: [file('src/billing/a.ts', 1, 0), file('src/billing/b.ts', 1, 0)],
      findings: [],
    });
    expect(oneBucket.split_suggestion.proposed_splits).toEqual([]);

    const twoBuckets = buildSmartDiff({
      files: [file('src/billing/a.ts', 1, 0), file('src/auth/b.ts', 1, 0)],
      findings: [],
    });
    expect(twoBuckets.split_suggestion.proposed_splits).toHaveLength(2);
    const names = twoBuckets.split_suggestion.proposed_splits.map((s) => s.name).sort();
    expect(names).toEqual(['auth', 'billing']);
  });

  it('tiebreak level 3: same top severity, count at that severity descending', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 2, 0), file('src/b.ts', 2, 0)],
      findings: [
        // both files' top severity is WARNING (no CRITICAL on either) — the
        // comparator must fall through to count-at-top-severity, not additions.
        finding({ id: 'f1', file: 'src/a.ts', severity: 'WARNING', startLine: 1 }),
        finding({ id: 'f2', file: 'src/b.ts', severity: 'WARNING', startLine: 1 }),
        finding({ id: 'f3', file: 'src/b.ts', severity: 'WARNING', startLine: 2 }),
      ],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    // src/b.ts has 2 WARNINGs vs src/a.ts's 1 — descending count puts b first
    // even though both files have identical additions/deletions and path b > a.
    expect(core.files.map((f) => f.path)).toEqual(['src/b.ts', 'src/a.ts']);
  });

  it('tiebreak level 5: path compares by byte order, not locale collation', () => {
    const out = buildSmartDiff({
      files: [file('src/apple.ts', 1, 0), file('src/Zebra.ts', 1, 0)],
      findings: [],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    // Byte order: 'Z' (0x5A) < 'a' (0x61), so Zebra sorts first. A locale
    // collator would put 'apple' before 'Zebra' (case-insensitive dictionary
    // order) — this pins the deliberate byte-comparison choice.
    expect(core.files.map((f) => f.path)).toEqual(['src/Zebra.ts', 'src/apple.ts']);
  });

  it('proposed_splits buckets only core+wiring files — a boilerplate file in its own dir does not become a third bucket', () => {
    const out = buildSmartDiff({
      files: [file('src/billing/a.ts', 1, 0), file('src/auth/b.ts', 1, 0), file('docs/readme.md', 1, 0)],
      findings: [],
    });
    expect(out.split_suggestion.total_lines).toBe(2); // docs/readme.md (boilerplate) excluded
    const names = out.split_suggestion.proposed_splits.map((s) => s.name).sort();
    expect(names).toEqual(['auth', 'billing']);
  });

  it('finding_lines is deduped and ascending', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 1, 0)],
      findings: [
        finding({ id: 'f1', file: 'src/a.ts', severity: 'WARNING', startLine: 20, endLine: 20 }),
        finding({ id: 'f2', file: 'src/a.ts', severity: 'CRITICAL', startLine: 5, endLine: 5 }),
        finding({ id: 'f3', file: 'src/a.ts', severity: 'SUGGESTION', startLine: 5, endLine: 6 }),
      ],
    });
    const core = out.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([5, 20]);
  });

  it('produces output that parses as SmartDiff', () => {
    const out = buildSmartDiff({
      files: [file('src/a.ts', 10, 2), file('pnpm-lock.yaml', 500, 100), file('server/src/app.ts', 3, 0)],
      findings: [finding({ id: 'f1', file: 'src/a.ts', severity: 'CRITICAL', startLine: 4, endLine: 4 })],
    });
    expect(() => SmartDiff.parse(out)).not.toThrow();
  });
});
