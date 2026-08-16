import { describe, it, expect } from 'vitest';
import type { FindingRecord, ReviewRecord } from '@devdigest/shared';
import { formatReviewDigest, projectReview } from '../src/domain/project.js';
import { DEFAULT_MAX_FINDINGS, RATIONALE_MAX, SUMMARY_MAX } from '../src/config.js';

/**
 * Local typed factories: the API shape has 17 finding fields and 12 review
 * fields, and a test that spells them all out hides the one field it is about.
 */
function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'f-1',
    review_id: 'rev-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: 'do this instead',
    confidence: 0.9,
    kind: 'finding',
    scope: 'in_scope',
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'General Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'a summary',
    score: 42,
    model: 'test-model',
    grounding: null,
    created_at: '2026-01-01T00:00:00.000Z',
    findings: [],
    ...over,
  } as ReviewRecord;
}

function findings(n: number, over: Partial<FindingRecord> = {}): FindingRecord[] {
  return Array.from({ length: n }, (_, i) =>
    finding({ id: `f-${i}`, title: `finding ${i}`, start_line: i + 1, ...over }),
  );
}

/**
 * The projection is the whole point of the tool layer: a raw review response is
 * tens of thousands of tokens. These pin what survives — 8 of 17 finding
 * fields, truncated free text, and a hard cap — and that the numbers the model
 * reads (`counts`, `total_findings`) describe the review, not the capped slice.
 */
describe('projectReview — concise payload', () => {
  it('review with zero findings → completed, approve, empty counts, not truncated', () => {
    const r = projectReview([review({ verdict: 'approve', score: 95, findings: [] })]);

    expect(r.status).toBe('completed');
    expect(r.verdict).toBe('approve');
    expect(r.counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(r.findings).toEqual([]);
    expect(r.total_findings).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.next_step).toBeNull();
  });

  it('a finding keeps 8 fields → no id, review_id, confidence, kind, scope or timestamps', () => {
    const r = projectReview([review({ findings: [finding()] })]);

    expect(r.findings[0]).toEqual({
      severity: 'WARNING',
      category: 'bug',
      title: 'a finding',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
      rationale: 'because',
      suggestion: 'do this instead',
    });
  });

  it('25 findings → capped, truncated true, total_findings 25 (the real count)', () => {
    const r = projectReview([review({ findings: findings(25) })]);

    expect(r.findings).toHaveLength(DEFAULT_MAX_FINDINGS);
    expect(r.truncated).toBe(true);
    expect(r.total_findings).toBe(25);
  });

  it('25 findings, maxFindings 20 → 20 returned, counts still describe all 25', () => {
    const r = projectReview([review({ findings: findings(25, { severity: 'CRITICAL' }) })], {}, 20);

    expect(r.findings).toHaveLength(20);
    expect(r.counts.CRITICAL).toBe(25);
    expect(r.total_findings).toBe(25);
  });

  it('exactly maxFindings findings → not truncated (boundary)', () => {
    const r = projectReview([review({ findings: findings(3) })], {}, 3);

    expect(r.findings).toHaveLength(3);
    expect(r.truncated).toBe(false);
    expect(r.total_findings).toBe(3);
  });

  it('dismissed finding → excluded from the list AND from the counts', () => {
    const r = projectReview([
      review({
        findings: [
          finding({ id: 'kept', severity: 'CRITICAL' }),
          finding({ id: 'gone', severity: 'CRITICAL', dismissed_at: '2026-01-02T00:00:00.000Z' }),
        ],
      }),
    ]);

    expect(r.findings.map((f) => f.title)).toEqual(['a finding']);
    expect(r.findings).toHaveLength(1);
    expect(r.counts.CRITICAL).toBe(1);
    expect(r.total_findings).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('mixed severities and files → CRITICAL first, then file, then start_line', () => {
    const r = projectReview([
      review({
        findings: [
          finding({ severity: 'SUGGESTION', file: 'src/a.ts', start_line: 1 }),
          finding({ severity: 'CRITICAL', file: 'src/z.ts', start_line: 5 }),
          finding({ severity: 'CRITICAL', file: 'src/a.ts', start_line: 9 }),
          finding({ severity: 'CRITICAL', file: 'src/a.ts', start_line: 2 }),
          finding({ severity: 'WARNING', file: 'src/b.ts', start_line: 1 }),
        ],
      }),
    ]);

    expect(r.findings.map((f) => `${f.severity} ${f.file}:${f.start_line}`)).toEqual([
      'CRITICAL src/a.ts:2',
      'CRITICAL src/a.ts:9',
      'CRITICAL src/z.ts:5',
      'WARNING src/b.ts:1',
      'SUGGESTION src/a.ts:1',
    ]);
  });
});

/**
 * `rationale` is unbounded LLM markdown and the single largest token risk in
 * the payload, so truncation is a correctness property, not cosmetics. A null
 * `suggestion` must stay null — an empty string would read as "the reviewer
 * suggested nothing", which is a different claim.
 */
describe('projectReview — truncation of free text', () => {
  it('5000-char rationale → truncated to RATIONALE_MAX with an ellipsis', () => {
    const r = projectReview([review({ findings: [finding({ rationale: 'x'.repeat(5000) })] })]);

    const rationale = r.findings[0]?.rationale ?? '';
    expect(rationale).toHaveLength(RATIONALE_MAX);
    expect(rationale.endsWith('…')).toBe(true);
  });

  it('short rationale → passed through unchanged', () => {
    const r = projectReview([review({ findings: [finding({ rationale: 'short' })] })]);

    expect(r.findings[0]?.rationale).toBe('short');
  });

  it('null suggestion → survives as null, not an empty string', () => {
    const r = projectReview([review({ findings: [finding({ suggestion: null })] })]);

    expect(r.findings[0]?.suggestion).toBeNull();
  });

  it('long summary → truncated to SUMMARY_MAX; null summary stays null', () => {
    const long = projectReview([review({ summary: 'y'.repeat(5000) })]);
    expect(long.summary ?? '').toHaveLength(SUMMARY_MAX);

    const none = projectReview([review({ summary: null })]);
    expect(none.summary).toBeNull();
  });
});

/**
 * `/pulls/:id/reviews` guarantees no ordering, and an agent's name is not
 * unique per run. Selection therefore filters and compares `created_at` — it
 * never indexes into the array. These are the traps that make a caller read a
 * stale run's findings while believing they are the new ones.
 */
describe('projectReview — selecting which review answers', () => {
  it('two reviews for one agent → the newest created_at wins, whatever the order', () => {
    const older = review({
      id: 'old',
      run_id: 'run-old',
      created_at: '2026-01-01T00:00:00.000Z',
      findings: [finding({ id: 'old-f' })],
    });
    const newer = review({
      id: 'new',
      run_id: 'run-new',
      created_at: '2026-03-09T12:00:00.000Z',
      findings: [],
    });

    expect(projectReview([older, newer]).run_id).toBe('run-new');
    expect(projectReview([newer, older]).run_id).toBe('run-new');
    expect(projectReview([newer, older]).total_findings).toBe(0);
  });

  it('run_id selector → matches that run even when it is LAST in the array', () => {
    const decoy = review({
      id: 'decoy',
      run_id: 'run-decoy',
      created_at: '2026-05-01T00:00:00.000Z',
      findings: [finding({ id: 'decoy-f', title: 'decoy finding' })],
    });
    const target = review({
      id: 'target',
      run_id: 'run-target',
      created_at: '2026-01-01T00:00:00.000Z',
      findings: [finding({ id: 'target-f', title: 'target finding' })],
    });

    const r = projectReview([decoy, target], { runId: 'run-target' });

    expect(r.run_id).toBe('run-target');
    expect(r.findings.map((f) => f.title)).toEqual(['target finding']);
  });

  it('run_id selector wins over agentName when both are given', () => {
    const byOther = review({ run_id: 'run-target', agent_name: 'Security Reviewer' });
    const byNamed = review({ run_id: 'run-other', agent_name: 'General Reviewer' });

    const r = projectReview([byNamed, byOther], {
      runId: 'run-target',
      agentName: 'General Reviewer',
    });

    expect(r.agent).toBe('Security Reviewer');
  });

  it('agentName selector → that agent only, case-insensitively, newest first', () => {
    const other = review({
      run_id: 'run-perf',
      agent_name: 'Performance Reviewer',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    const wantedOld = review({
      run_id: 'run-sec-old',
      agent_name: 'Security Reviewer',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const wantedNew = review({
      run_id: 'run-sec-new',
      agent_name: 'Security Reviewer',
      created_at: '2026-02-01T00:00:00.000Z',
    });

    const r = projectReview([other, wantedNew, wantedOld], { agentName: 'security reviewer' });

    expect(r.run_id).toBe('run-sec-new');
    expect(r.agent).toBe('Security Reviewer');
  });

  it("a newer 'summary' → the agent's 'review' still answers (a summary has no findings)", () => {
    const full = review({
      run_id: 'run-review',
      kind: 'review',
      created_at: '2026-01-01T00:00:00.000Z',
      findings: [finding()],
    });
    const rollup = review({
      run_id: 'run-summary',
      kind: 'summary',
      created_at: '2026-04-01T00:00:00.000Z',
      findings: [],
    });

    const r = projectReview([rollup, full]);

    expect(r.run_id).toBe('run-review');
    expect(r.total_findings).toBe(1);
  });
});

/**
 * Nothing matched is an answer, not an exception: the payload stays the same
 * shape and carries the imperative next step, per the leads-forward rule.
 */
describe('projectReview — nothing to project', () => {
  it('empty reviews array → not_reviewed pointing at run_agent_on_pr', () => {
    const r = projectReview([]);

    expect(r.status).toBe('not_reviewed');
    expect(r.verdict).toBeNull();
    expect(r.counts).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
    expect(r.total_findings).toBe(0);
    expect(r.next_step).toContain('run_agent_on_pr');
  });

  it('unknown run_id → not_reviewed naming that run and echoing it back', () => {
    const r = projectReview([review()], { runId: 'run-missing' });

    expect(r.status).toBe('not_reviewed');
    expect(r.run_id).toBe('run-missing');
    expect(r.next_step).toContain('run-missing');
  });

  it('unknown agent name → not_reviewed naming that agent', () => {
    const r = projectReview([review()], { agentName: 'Nope Reviewer' });

    expect(r.status).toBe('not_reviewed');
    expect(r.agent).toBe('Nope Reviewer');
    expect(r.next_step).toContain('Nope Reviewer');
  });
});

/**
 * The digest is the only thing a human reading the transcript sees, so it
 * states the verdict, the score and what the counts were BEFORE the cap.
 */
describe('formatReviewDigest — one-line human summary', () => {
  it('findings present → verdict, score, non-zero counts, total', () => {
    const r = projectReview([
      review({
        verdict: 'request_changes',
        score: 42,
        findings: [
          ...findings(3, { severity: 'CRITICAL' }),
          ...findings(5, { severity: 'WARNING', file: 'src/b.ts' }),
        ],
      }),
    ]);

    expect(formatReviewDigest(r)).toBe(
      'request_changes · score 42 · 3 CRITICAL, 5 WARNING — 8 findings',
    );
  });

  it('no findings → "no findings", and zero severities are omitted', () => {
    const r = projectReview([review({ verdict: 'approve', score: 95, findings: [] })]);

    expect(formatReviewDigest(r)).toBe('approve · score 95 — no findings');
  });

  it('capped → says how many of how many are shown', () => {
    const r = projectReview([review({ verdict: 'comment', score: 60, findings: findings(25) })], {}, 20);

    expect(formatReviewDigest(r)).toBe(
      'comment · score 60 · 25 WARNING — showing 20 of 25 findings',
    );
  });

  it('not_reviewed → the status and its next step, no verdict line', () => {
    const digest = formatReviewDigest(projectReview([]));

    expect(digest.startsWith('not_reviewed —')).toBe(true);
    expect(digest).toContain('run_agent_on_pr');
  });
});
