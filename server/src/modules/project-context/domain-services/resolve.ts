import type {
  ProjectContextDocType,
  ProjectContextInjected,
  ProjectContextStatus,
} from '@devdigest/shared';
import { MAX_CONTEXT_TOKENS, MAX_DOC_CHARS } from '../domain-model/constants.js';

/**
 * One document to resolve, already read from the clone and already ordered:
 * agent rows first (in their own attachment `order`), then skill rows in
 * `(skill link order, doc order)` — `resolveProjectContext` preserves the
 * array's position, it does not re-sort by the `order` field (that field is
 * carried through only for the caller's own bookkeeping / debugging).
 *
 * `text` is `null` for a document that was never readable (missing file,
 * rejected path, unreadable clone); `repoMatches` is `false` only for a
 * skill-inherited row attached under a repo other than the one this run is
 * reviewing (R19) — the agent's own attachments are always fetched scoped to
 * this repo already, so they are never `false`.
 */
export interface Candidate {
  path: string;
  type: ProjectContextDocType;
  order: number;
  /** The linked skill's name this document is inherited from, or `null` for
   *  a document attached directly to the agent. */
  inheritedFrom: string | null;
  repoMatches: boolean;
  text: string | null;
}

export interface ResolvedProjectContext {
  /** `{path, text}` for `included`/`truncated` documents only, in order —
   *  what `reviewPullRequest`'s `specs` slot receives. */
  specs: Array<{ path: string; text: string }>;
  /** Every resolved candidate, including every skipped one — what
   *  `RunTrace.project_context` persists. */
  injected: ProjectContextInjected[];
  /** `included`/`truncated` paths only, in order — `RunTrace.specs_read`. */
  specsRead: string[];
}

/**
 * Pure resolution: dedup by path, apply the per-document truncation cap and
 * the per-run token budget, and produce a status for every candidate. No
 * I/O — `candidates` is already read and `countTokens` is injected, so this
 * is hermetic (`container.tokenizer.count` in production,
 * `t => Math.ceil(t.length / 4)` in tests, so budget-boundary tests are exact
 * arithmetic rather than tiktoken's).
 *
 * Never throws: every input shape (including `text: null` and
 * `repoMatches: false`) maps to a `ProjectContextStatus`, never to an
 * exception — a bad document is a recorded status, not a failed run (AC 18).
 */
export function resolveProjectContext(
  candidates: Candidate[],
  countTokens: (text: string) => number,
): ResolvedProjectContext {
  const deduped = dedupeByPath(candidates);

  const specs: Array<{ path: string; text: string }> = [];
  const injected: ProjectContextInjected[] = [];
  const specsRead: string[] = [];
  let accumulatedTokens = 0;

  for (const candidate of deduped) {
    const { path, type, inheritedFrom, repoMatches, text } = candidate;
    let status: ProjectContextStatus;
    let tokens = 0;

    if (!repoMatches) {
      // Only reachable for a skill-inherited row (R19) — the agent's own
      // rows are fetched pre-scoped to this repo and are never `false`.
      status = 'skipped_other_repo';
    } else if (text === null) {
      status = 'skipped_missing';
    } else if (text.trim().length === 0) {
      status = 'skipped_empty';
    } else if (accumulatedTokens >= MAX_CONTEXT_TOKENS) {
      // The budget only grows, so once it is at/over the cap every remaining
      // real document is skipped too, without re-checking (AC 17).
      status = 'skipped_budget';
    } else {
      const truncated = text.length > MAX_DOC_CHARS;
      const injectedText = truncated ? text.slice(0, MAX_DOC_CHARS) : text;
      // Token count of the text as injected, never of the original — a
      // truncated document must not count its discarded tail against the
      // run budget.
      tokens = countTokens(injectedText);
      accumulatedTokens += tokens;
      status = truncated ? 'truncated' : 'included';
      specs.push({ path, text: injectedText });
      specsRead.push(path);
    }

    injected.push({ path, type, tokens, status, inherited_from: inheritedFrom });
  }

  return { specs, injected, specsRead };
}

/**
 * First occurrence wins its position (R9); a later duplicate is dropped
 * entirely — it is the same document, so it produces no `injected` row of
 * its own (the row that survives is whichever occurrence came first in the
 * already-ordered input).
 */
function dedupeByPath(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    out.push(candidate);
  }
  return out;
}
