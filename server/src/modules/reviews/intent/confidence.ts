import type { IntentConfidence, IntentSource } from '@devdigest/shared';

/**
 * Confidence is DERIVED from which sources actually resolved — never read off
 * the model. `Intent` (the structured-output schema) has no `confidence` field
 * at all, so it cannot be self-reported; see `reviewer-core/INSIGHTS.md:32-40`
 * ("a citation check is verifiable where a self-reported confidence is not").
 *
 * Deterministic and pure: one function to retune if the rule changes.
 */
export function deriveConfidence(sources: IntentSource[]): IntentConfidence {
  const bodyUsed = sources.some((s) => s.kind === 'pr_body' && s.status === 'used');
  const issueUsed = sources.some((s) => s.kind === 'linked_issue' && s.status === 'used');
  const anyMissing = sources.some((s) => s.status === 'unavailable' || s.status === 'unresolved');

  // No description and no reachable ticket: we classified from the file list
  // and the title alone. An empty source list lands here too.
  if (!bodyUsed && !issueUsed) return 'low';
  if (bodyUsed && !anyMissing) return 'high';
  return 'medium';
}

/**
 * The sources that did NOT make it, for the UI's "why is this thin?" line.
 * Kept next to the rule that consumes them so the two cannot drift.
 */
export function missingSources(sources: IntentSource[]): IntentSource[] {
  return sources.filter((s) => s.status !== 'used');
}
