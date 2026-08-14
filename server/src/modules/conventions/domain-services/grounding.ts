import type { DroppedConvention, GroundedConvention, RawConventionCandidate } from '../domain-model/candidate.js';
import type { SampledFile } from './sampling.js';

/**
 * The grounding verifier — PURE. It never reads the clone; it consults only
 * the `SampledFile[]` already in memory (the same bytes that were put in the
 * prompt). That is also the security property: a model-supplied path is
 * never turned into a filesystem path.
 *
 * First failure wins; a dropped candidate is never persisted.
 */

const MIN_SNIPPET_CHARS = 8;
const SNIPPET_SEARCH_RADIUS = 3;
const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 6;

export interface GroundingResult {
  kept: GroundedConvention[];
  dropped: DroppedConvention[];
}

export function groundConventions(
  candidates: RawConventionCandidate[],
  sampled: SampledFile[],
): GroundingResult {
  const kept: GroundedConvention[] = [];
  const dropped: DroppedConvention[] = [];
  const seenRules = new Set<string>();

  for (const candidate of candidates) {
    const outcome = validate(candidate, sampled, seenRules);
    if (typeof outcome === 'string') {
      dropped.push({ candidate, reason: outcome });
      continue;
    }

    const { file, line } = outcome;
    const start = Math.max(1, line - WINDOW_BEFORE);
    const end = Math.min(file.lines.length, line + WINDOW_AFTER);

    kept.push({
      category: candidate.category,
      rule: candidate.rule,
      confidence: clamp01(candidate.confidence),
      evidencePath: file.path,
      evidenceSnippet: file.lines.slice(start - 1, end).join('\n'),
      evidenceStartLine: start,
      evidenceEndLine: end,
    });
    seenRules.add(normalizeRule(candidate.rule));
  }

  return { kept, dropped };
}

/** Returns a drop reason, or the resolved file + line when the candidate passes. */
function validate(
  candidate: RawConventionCandidate,
  sampled: SampledFile[],
  seenRules: Set<string>,
): string | { file: SampledFile; line: number } {
  const rule = candidate.rule?.trim() ?? '';
  if (rule.length < 8) return 'rule too short';
  if (seenRules.has(normalizeRule(rule))) return 'duplicate rule';

  const path = candidate.evidence?.file ?? '';
  const exact = sampled.find((f) => f.path === path);
  const suffixMatches = exact ? [] : sampled.filter((f) => f.path.endsWith('/' + path));
  const file = exact ?? (suffixMatches.length === 1 ? suffixMatches[0] : undefined);
  if (!file) {
    return suffixMatches.length > 1 ? 'evidence path ambiguous among sampled set' : 'evidence path not in sampled set';
  }

  const line = candidate.evidence.line;
  if (!Number.isInteger(line) || line < 1 || line > file.lines.length) {
    return 'evidence line out of range';
  }

  const normalizedSnippet = (candidate.evidence.snippet ?? '').replace(/\s+/g, ' ').trim();
  if (normalizedSnippet.length >= MIN_SNIPPET_CHARS) {
    const windowStart = Math.max(1, line - SNIPPET_SEARCH_RADIUS);
    const windowEnd = Math.min(file.lines.length, line + SNIPPET_SEARCH_RADIUS);
    const found = file.lines
      .slice(windowStart - 1, windowEnd)
      // Whitespace-normalized only — case is preserved, identifier case is
      // exactly what a naming convention is about.
      .some((l) => l.replace(/\s+/g, ' ').trim().includes(normalizedSnippet));
    if (!found) return 'snippet not found near cited line';
  }

  return { file, line };
}

function normalizeRule(rule: string): string {
  return rule.toLowerCase().replace(/\s+/g, ' ').trim();
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
