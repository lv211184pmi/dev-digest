import type { ConventionCandidate, ConventionRun } from '@devdigest/shared';
import type { ConventionRow, ConventionRunRow } from '../../db/rows.js';

/**
 * Pure DB row ⇄ DTO mapping for the conventions module. Mirrors
 * `modules/skills/helpers.ts:11` (`toSkillDto`) — the application service
 * returns these DTOs directly, so routes stay a thin pass-through.
 */

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    run_id: row.runId,
    category: row.category as ConventionCandidate['category'],
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
    created_at: row.createdAt.toISOString(),
  };
}

export function toConventionRunDto(row: ConventionRunRow): ConventionRun {
  return {
    id: row.id,
    repo_id: row.repoId,
    status: row.status as ConventionRun['status'],
    sample_count: row.sampleCount,
    candidate_count: row.candidateCount,
    dropped_count: row.droppedCount,
    provider: row.provider,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    skill_id: row.skillId,
    error: row.error,
    created_at: row.createdAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}
