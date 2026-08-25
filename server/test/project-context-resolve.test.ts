import { describe, it, expect } from 'vitest';
import {
  resolveProjectContext,
  type Candidate,
} from '../src/modules/project-context/domain-services/resolve.js';
import { MAX_DOC_CHARS } from '../src/modules/project-context/domain-model/constants.js';

/**
 * Hermetic — `resolveProjectContext` is a pure function, no DB, no I/O.
 *
 * `countTokens` stubs production's `container.tokenizer.count` with the same
 * `ceil(chars / 4)` heuristic the discovery side already uses, so the
 * budget/cap-boundary assertions below are exact arithmetic rather than
 * tiktoken's real BPE counts.
 */
const countTokens = (t: string) => Math.ceil(t.length / 4);

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    path: 'docs/a.md',
    type: 'docs',
    order: 0,
    inheritedFrom: null,
    repoMatches: true,
    text: 'hello world',
    ...over,
  };
}

describe('resolveProjectContext', () => {
  it('two agent documents plus one inherited, in order, all included; specsRead matches', () => {
    const candidates: Candidate[] = [
      candidate({ path: 'docs/a.md', order: 0, text: 'a'.repeat(40) }),
      candidate({ path: 'specs/b.md', order: 1, text: 'b'.repeat(40) }),
      candidate({
        path: 'docs/skill-doc.md',
        order: 0,
        inheritedFrom: 'lint-rules',
        text: 'c'.repeat(40),
      }),
    ];

    const result = resolveProjectContext(candidates, countTokens);

    expect(result.injected.map((i) => i.path)).toEqual([
      'docs/a.md',
      'specs/b.md',
      'docs/skill-doc.md',
    ]);
    expect(result.injected.every((i) => i.status === 'included')).toBe(true);
    expect(result.injected[0]?.inherited_from).toBeNull();
    expect(result.injected[2]?.inherited_from).toBe('lint-rules');
    expect(result.specsRead).toEqual(['docs/a.md', 'specs/b.md', 'docs/skill-doc.md']);
    expect(result.specs).toEqual([
      { path: 'docs/a.md', text: 'a'.repeat(40) },
      { path: 'specs/b.md', text: 'b'.repeat(40) },
      { path: 'docs/skill-doc.md', text: 'c'.repeat(40) },
    ]);
  });

  it('dedup: the same path attached directly and via a skill yields ONE row, at the agent position, inherited_from null', () => {
    const candidates: Candidate[] = [
      candidate({ path: 'docs/shared.md', order: 0, inheritedFrom: null, text: 'agent text' }),
      candidate({
        path: 'docs/shared.md',
        order: 0,
        inheritedFrom: 'lint-rules',
        text: 'skill text',
      }),
    ];

    const result = resolveProjectContext(candidates, countTokens);

    expect(result.injected).toHaveLength(1);
    expect(result.injected[0]).toMatchObject({
      path: 'docs/shared.md',
      inherited_from: null,
      status: 'included',
    });
    expect(result.specs).toEqual([{ path: 'docs/shared.md', text: 'agent text' }]);
  });

  describe('the run budget boundary (8,000 tokens)', () => {
    it('an accumulated total of exactly 8,000 skips the very next document', () => {
      // Each doc is exactly MAX_DOC_CHARS long -> exactly MAX_DOC_TOKENS (2000)
      // tokens each under the stub. Four of them exhaust the 8,000 budget.
      const candidates: Candidate[] = Array.from({ length: 5 }, (_, i) =>
        candidate({ path: `docs/doc-${i}.md`, order: i, text: 'x'.repeat(MAX_DOC_CHARS) }),
      );

      const result = resolveProjectContext(candidates, countTokens);

      expect(result.injected.map((i) => i.status)).toEqual([
        'included',
        'included',
        'included',
        'included',
        'skipped_budget',
      ]);
    });

    it('the document that crosses the threshold (not landing exactly on it) is still injected', () => {
      // 3,300 chars -> 825 tokens each. After 9 docs: 7,425 (< 8,000,
      // included). The 10th pushes the total to 8,250 — over the budget —
      // and is still injected; only the 11th is skipped.
      const candidates: Candidate[] = Array.from({ length: 11 }, (_, i) =>
        candidate({ path: `docs/doc-${i}.md`, order: i, text: 'x'.repeat(3300) }),
      );

      const result = resolveProjectContext(candidates, countTokens);

      const statuses = result.injected.map((i) => i.status);
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill('included'));
      expect(statuses[10]).toBe('skipped_budget');
    });

    it('a single document larger than the whole run budget is truncated and still injected — never starving the list', () => {
      const huge = candidate({ path: 'docs/huge.md', text: 'z'.repeat(MAX_DOC_CHARS * 5) });

      const result = resolveProjectContext([huge], countTokens);

      expect(result.injected[0]).toMatchObject({
        path: 'docs/huge.md',
        status: 'truncated',
        tokens: MAX_DOC_CHARS / 4,
      });
      expect(result.specs[0]?.text.length).toBe(MAX_DOC_CHARS);
    });
  });

  it('the per-document cap boundary: MAX_DOC_CHARS + 1 truncates, exactly MAX_DOC_CHARS is included', () => {
    const overCap = candidate({ path: 'docs/over.md', order: 0, text: 'x'.repeat(MAX_DOC_CHARS + 1) });
    const atCap = candidate({ path: 'docs/at.md', order: 1, text: 'y'.repeat(MAX_DOC_CHARS) });

    const result = resolveProjectContext([overCap, atCap], countTokens);

    expect(result.injected[0]).toMatchObject({ path: 'docs/over.md', status: 'truncated' });
    expect(result.specs[0]?.text.length).toBe(MAX_DOC_CHARS);
    expect(result.injected[1]).toMatchObject({ path: 'docs/at.md', status: 'included' });
    expect(result.specs[1]?.text.length).toBe(MAX_DOC_CHARS);
  });

  it('null text -> skipped_missing; whitespace-only text -> skipped_empty; repoMatches:false -> skipped_other_repo', () => {
    const missing = candidate({ path: 'docs/missing.md', order: 0, text: null });
    const empty = candidate({ path: 'docs/empty.md', order: 1, text: '   \n  ' });
    const otherRepo = candidate({
      path: 'docs/other.md',
      order: 2,
      repoMatches: false,
      inheritedFrom: 'lint-rules',
      text: 'irrelevant — never reached because repoMatches is false',
    });

    const result = resolveProjectContext([missing, empty, otherRepo], countTokens);

    expect(result.injected.map((i) => i.status)).toEqual([
      'skipped_missing',
      'skipped_empty',
      'skipped_other_repo',
    ]);
    expect(result.injected.every((i) => i.tokens === 0)).toBe(true);
    expect(result.specs).toEqual([]);
    expect(result.specsRead).toEqual([]);
  });

  it('empty candidates -> three empty outputs', () => {
    const result = resolveProjectContext([], countTokens);
    expect(result).toEqual({ specs: [], injected: [], specsRead: [] });
  });
});
