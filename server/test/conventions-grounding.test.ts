import { describe, it, expect } from 'vitest';
import { groundConventions } from '../src/modules/conventions/domain-services/grounding.js';
import type { SampledFile } from '../src/modules/conventions/domain-services/sampling.js';
import type { RawConventionCandidate } from '../src/modules/conventions/domain-model/candidate.js';

function file(path: string, lines: string[]): SampledFile {
  return { path, kind: 'source', lines, truncated: false };
}

function candidate(overrides: Partial<RawConventionCandidate> = {}): RawConventionCandidate {
  return {
    category: 'error_handling',
    rule: 'Domain errors extend AppError with a stable code.',
    evidence: { file: 'src/api/users.ts', line: 2, snippet: 'export class NotFoundError' },
    confidence: 0.9,
    ...overrides,
  };
}

describe('conventions grounding — groundConventions', () => {
  it('exact-path hit is kept', () => {
    const sampled = [file('src/api/users.ts', ['a', 'export class NotFoundError extends AppError {', 'c'])];
    const { kept, dropped } = groundConventions([candidate()], sampled);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidencePath).toBe('src/api/users.ts');
  });

  it('unique-suffix hit is kept when the model drops a leading path segment', () => {
    const sampled = [file('src/api/users.ts', ['a', 'export class NotFoundError extends AppError {', 'c'])];
    const c = candidate({ evidence: { file: 'api/users.ts', line: 2, snippet: 'export class NotFoundError' } });
    const { kept } = groundConventions([c], sampled);
    expect(kept).toHaveLength(1);
  });

  it('ambiguous suffix match is dropped', () => {
    const sampled = [
      file('pkg-a/api/users.ts', ['x', 'export class NotFoundError extends AppError {', 'z']),
      file('pkg-b/api/users.ts', ['x', 'export class NotFoundError extends AppError {', 'z']),
    ];
    const c = candidate({ evidence: { file: 'api/users.ts', line: 2, snippet: 'export class NotFoundError' } });
    const { kept, dropped } = groundConventions([c], sampled);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toMatch(/ambiguous/);
  });

  it('line 0 is dropped (out of range)', () => {
    const sampled = [file('a.ts', ['x', 'y'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 0, snippet: 'irrelevant snippet' } });
    const { dropped } = groundConventions([c], sampled);
    expect(dropped[0]!.reason).toMatch(/out of range/);
  });

  it('line beyond the (truncated) file length is dropped', () => {
    const sampled = [file('a.ts', ['x', 'y'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 99, snippet: 'irrelevant snippet' } });
    const { dropped } = groundConventions([c], sampled);
    expect(dropped[0]!.reason).toMatch(/out of range/);
  });

  it('tab-vs-space snippet is kept (whitespace normalized)', () => {
    const sampled = [file('a.ts', ['export\tconst\tx = 1;'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 1, snippet: 'export const x = 1;' } });
    const { kept, dropped } = groundConventions([c], sampled);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it('an absent snippet (not present near the line) is dropped', () => {
    const sampled = [file('a.ts', ['completely unrelated content here'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 1, snippet: 'this text does not appear' } });
    const { dropped } = groundConventions([c], sampled);
    expect(dropped[0]!.reason).toMatch(/snippet/);
  });

  it('a 1-char snippet is kept — the length check is skipped, not enforced', () => {
    const sampled = [file('a.ts', ['}'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 1, snippet: '}' } });
    const { kept, dropped } = groundConventions([c], sampled);
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  it('duplicate rule text keeps only the first occurrence', () => {
    const sampled = [file('a.ts', ['line one', 'line two'])];
    const c1 = candidate({ evidence: { file: 'a.ts', line: 1, snippet: 'line one' } });
    const c2 = candidate({ evidence: { file: 'a.ts', line: 2, snippet: 'line two' } });
    const { kept, dropped } = groundConventions([c1, c2], sampled);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toMatch(/duplicate/);
  });

  it('the evidence window clamps at line 1 and at EOF', () => {
    const sampled = [file('a.ts', ['l1', 'l2', 'l3'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 1, snippet: 'l1' } });
    const { kept } = groundConventions([c], sampled);
    expect(kept[0]!.evidenceStartLine).toBe(1);
    expect(kept[0]!.evidenceEndLine).toBe(3); // clamped to EOF, not line+6=7
  });

  it('a path-traversal citation is dropped (never matches the sampled set)', () => {
    const sampled = [file('src/index.ts', ['x'])];
    const c = candidate({ evidence: { file: '../../etc/passwd', line: 1, snippet: 'root:x:0:0' } });
    const { kept, dropped } = groundConventions([c], sampled);
    expect(kept).toHaveLength(0);
    expect(dropped[0]!.reason).toMatch(/not in sampled set/);
  });

  it('evidence snippet/window is rebuilt from the real sampled file, never the model text', () => {
    const sampled = [file('a.ts', ['real line 1', 'real line 2', 'real line 3'])];
    const c = candidate({
      evidence: { file: 'a.ts', line: 2, snippet: 'real line 2' },
    });
    const { kept } = groundConventions([c], sampled);
    expect(kept[0]!.evidenceSnippet).toBe('real line 1\nreal line 2\nreal line 3');
  });

  it('confidence is clamped to [0,1]', () => {
    const sampled = [file('a.ts', ['x'])];
    const c = candidate({ evidence: { file: 'a.ts', line: 1, snippet: '' }, confidence: 1.5 });
    const { kept } = groundConventions([c], sampled);
    expect(kept[0]!.confidence).toBe(1);
  });
});
