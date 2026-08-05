import { CONVENTION_CATEGORIES, type ConventionCategoryValue } from '../domain-model/constants.js';

/**
 * Server-side skill-body merge — PURE. Rendering happens here so the
 * markdown-shape rule exists in exactly one language; the client only edits
 * whatever this produces.
 */

export interface MergeCandidate {
  category: ConventionCategoryValue;
  rule: string;
  confidence: number;
  evidencePath: string;
  evidenceStartLine: number;
}

const MAX_RULE_CHARS = 300;

/** Collapse newlines, strip a leading heading marker + backtick fences, cap length. */
export function sanitizeRule(rule: string): string {
  const collapsed = rule.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  const stripped = collapsed.replace(/^#+\s*/, '').replace(/`+/g, '');
  return stripped.length > MAX_RULE_CHARS ? stripped.slice(0, MAX_RULE_CHARS).trimEnd() : stripped;
}

/** `"payments-api"` (or `"acme/payments-api"`) → `"payments-api-conventions"`. */
export function deriveSkillName(repoName: string): string {
  const base = repoName.includes('/') ? repoName.split('/').pop()! : repoName;
  const slug = slugify(base) || 'repo';
  return `${slug}-conventions`;
}

/** `[...new Set(paths)].sort()` — the evidence surfaced on the Skill row. */
export function collectEvidenceFiles(candidates: MergeCandidate[]): string[] {
  return [...new Set(candidates.map((c) => c.evidencePath))].sort();
}

/**
 * Deterministic order: category enum order → confidence desc → path asc, so
 * the same accepted set always produces a byte-identical body regardless of
 * fetch/insert order.
 */
export function orderCandidates<T extends { category: ConventionCategoryValue; confidence: number; evidencePath: string }>(
  candidates: T[],
): T[] {
  const categoryRank = new Map(CONVENTION_CATEGORIES.map((c, i) => [c, i]));
  return [...candidates].sort((a, b) => {
    const catDiff = (categoryRank.get(a.category) ?? 99) - (categoryRank.get(b.category) ?? 99);
    if (catDiff !== 0) return catDiff;
    const confDiff = b.confidence - a.confidence;
    if (confDiff !== 0) return confDiff;
    return a.evidencePath.localeCompare(b.evidencePath);
  });
}

/** `# <name>` H1, one intro line, then one `## <slug>` section per candidate. No code. */
export function renderConventionsSkillBody(repoFullName: string, candidates: MergeCandidate[]): string {
  const name = deriveSkillName(repoFullName);
  const ordered = orderCandidates(candidates);
  const usedSlugs = new Set<string>();

  const sections = ordered.map((c) => {
    const rule = sanitizeRule(c.rule);
    const slug = uniqueSlug(rule, usedSlugs);
    return `## ${slug}\n\n${rule}\n\nDetected in \`${c.evidencePath}:${c.evidenceStartLine}\``;
  });

  const header = `# ${name}\n\nExtracted conventions for ${repoFullName}.`;
  return [header, ...sections].join('\n\n');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(text: string, used: Set<string>): string {
  const base = slugify(text) || 'rule';
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}
