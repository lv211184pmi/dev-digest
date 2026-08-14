import { describe, it, expect } from 'vitest';
import {
  sanitizeRule,
  deriveSkillName,
  collectEvidenceFiles,
  orderCandidates,
  renderConventionsSkillBody,
  type MergeCandidate,
} from '../src/modules/conventions/domain-services/merge.js';

function candidate(overrides: Partial<MergeCandidate> = {}): MergeCandidate {
  return {
    category: 'error_handling',
    rule: 'Domain errors extend AppError with a stable code.',
    confidence: 0.9,
    evidencePath: 'src/api/users.ts',
    evidenceStartLine: 23,
    ...overrides,
  };
}

describe('conventions merge — sanitizeRule / deriveSkillName / body render', () => {
  it('sanitizeRule collapses newlines, strips leading heading + backticks, caps at 300', () => {
    expect(sanitizeRule('# Use `AppError`\nfor every\ndomain error')).toBe(
      'Use AppError for every domain error',
    );
    const long = 'x'.repeat(400);
    expect(sanitizeRule(long)).toHaveLength(300);
  });

  it('deriveSkillName slugifies the repo name and appends -conventions', () => {
    expect(deriveSkillName('payments-api')).toBe('payments-api-conventions');
    expect(deriveSkillName('acme/Payments_API')).toBe('payments-api-conventions');
  });

  it('collectEvidenceFiles dedupes and sorts', () => {
    const files = collectEvidenceFiles([
      candidate({ evidencePath: 'src/b.ts' }),
      candidate({ evidencePath: 'src/a.ts' }),
      candidate({ evidencePath: 'src/b.ts' }),
    ]);
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('orderCandidates sorts by category enum order, then confidence desc, then path asc — deterministic across shuffled input', () => {
    const a = candidate({ category: 'naming', confidence: 0.5, evidencePath: 'z.ts' });
    const b = candidate({ category: 'naming', confidence: 0.9, evidencePath: 'a.ts' });
    const c = candidate({ category: 'testing', confidence: 0.99, evidencePath: 'a.ts' });
    const orderedA = orderCandidates([a, b, c]);
    const orderedB = orderCandidates([c, a, b]);
    const orderedC = orderCandidates([b, c, a]);
    expect(orderedA).toEqual([b, a, c]); // naming(0.9) < naming(0.5) < testing
    expect(orderedA).toEqual(orderedB);
    expect(orderedA).toEqual(orderedC);
  });

  it('renders a deterministic body — snapshot shape', () => {
    const body = renderConventionsSkillBody('acme/payments-api', [
      candidate({ category: 'naming', rule: 'Use camelCase for variables.', evidencePath: 'src/a.ts', evidenceStartLine: 5 }),
      candidate({ category: 'testing', rule: 'Hermetic tests avoid the DB.', evidencePath: 'src/b.ts', evidenceStartLine: 10 }),
    ]);
    expect(body).toBe(
      [
        '# payments-api-conventions',
        '',
        'Extracted conventions for acme/payments-api.',
        '',
        '## use-camelcase-for-variables',
        '',
        'Use camelCase for variables.',
        '',
        'Detected in `src/a.ts:5`',
        '',
        '## hermetic-tests-avoid-the-db',
        '',
        'Hermetic tests avoid the DB.',
        '',
        'Detected in `src/b.ts:10`',
      ].join('\n'),
    );
  });

  it('renders no code snippets in the body — only the rule sentence and the citation', () => {
    const body = renderConventionsSkillBody('acme/x', [
      candidate({ rule: 'Never log secrets.', evidencePath: 'src/x.ts', evidenceStartLine: 1 }),
    ]);
    expect(body).not.toContain('```');
  });

  it('dedupes slugs when two rules sanitize to the same text', () => {
    const body = renderConventionsSkillBody('acme/x', [
      candidate({ rule: 'Use camelCase.', evidencePath: 'a.ts', evidenceStartLine: 1 }),
      candidate({ rule: 'Use camelCase.', category: 'typing', evidencePath: 'b.ts', evidenceStartLine: 2 }),
    ]);
    expect(body).toContain('## use-camelcase');
    expect(body).toContain('## use-camelcase-2');
  });
});
