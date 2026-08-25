import type { BlastIndexInfo } from '@devdigest/shared';
import type { CoverageInput } from '../domain-model/types.js';
import { SUPPORTED_EXT, MAX_INDEXED_FILES } from '../../repo-intel/constants.js';

/**
 * "How much of this PR could the index actually see?"
 *
 * THE load-bearing invariant of this feature: whenever `state !== 'full'` the
 * returned `explanation` is NON-EMPTY. An empty impact map with no explanation
 * reads exactly like "this change is safe", and that is the failure mode the
 * whole blast feature exists to prevent — so a missing explanation is a bug,
 * not a cosmetic gap, and `blast-coverage.test.ts` asserts it as a property
 * over every status/reason combination rather than case by case.
 *
 * PURE: primitives in, one DTO out. No DB row, no `node:*`.
 */

/** Human text for the machine reasons repo-intel and this module produce. */
const REASON_TEXT: Record<string, string> = {
  flag_off: 'Repository intelligence is turned off for this deployment.',
  index_failed: 'The last indexing run for this repository failed.',
  index_partial: 'This repository is only partially indexed.',
  repo_too_large: 'This repository is too large to index completely.',
  no_data: 'This repository has not been indexed yet.',
  no_changed_files: 'No changed files have been imported for this pull request yet.',
};

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

function isSupported(path: string): boolean {
  return (SUPPORTED_EXT as readonly string[]).includes(extensionOf(path));
}

/** "a.ts, b.ts and 3 more" — bounded so the sentence stays readable. */
function nameList(files: string[], max = 3): string {
  if (files.length <= max) return files.join(', ');
  return `${files.slice(0, max).join(', ')} and ${files.length - max} more`;
}

export function buildCoverage(input: CoverageInput): BlastIndexInfo {
  const {
    indexStatus,
    degradedReason,
    changedFiles,
    indexedSymbolFiles,
    indexedFiles,
    prFilesCount,
    pullFilesCount,
    stats,
  } = input;

  const indexed = new Set(indexedSymbolFiles);
  const filesCovered = changedFiles.filter((f) => indexed.has(f)).sort();
  const filesNotCovered = changedFiles.filter((f) => !indexed.has(f)).sort();

  // GitHub's file list is a single un-paginated page of 100, so a PR over that
  // has changed files we never imported and therefore never looked up. They are
  // absent from `changedFiles` entirely, so they cannot show up as
  // `files_not_covered` — which makes this the one degradation that is
  // invisible in the file lists and must be tracked separately.
  const truncated = pullFilesCount > prFilesCount;

  // --- state ---------------------------------------------------------------
  // `unavailable` means "the index could tell us nothing about this PR".
  // `partial` means "it told us something, but not about everything".
  let state: BlastIndexInfo['state'];
  if (degradedReason === 'no_changed_files' || changedFiles.length === 0) {
    state = 'unavailable';
  } else if (indexStatus === null || indexStatus === 'failed' || indexStatus === 'degraded') {
    state = 'unavailable';
  } else if (filesCovered.length === 0) {
    // Indexed repo, but not one changed file is in it — nothing to say.
    state = 'unavailable';
  } else if (indexStatus === 'partial' || filesNotCovered.length > 0 || truncated) {
    state = 'partial';
  } else {
    state = 'full';
  }

  // --- explanation ---------------------------------------------------------
  const reasons: string[] = [];

  const reasonText = degradedReason ? REASON_TEXT[degradedReason] : undefined;
  if (reasonText) {
    reasons.push(reasonText);
  } else if (state === 'unavailable' && indexStatus === null) {
    reasons.push(REASON_TEXT.no_data as string);
  }

  if (filesNotCovered.length > 0) {
    const unsupported = filesNotCovered.filter((f) => !isSupported(f));
    const supportedMisses = filesNotCovered.filter((f) => isSupported(f));

    if (unsupported.length > 0) {
      reasons.push(
        `${unsupported.length} changed file(s) are in languages the index does not parse ` +
          `(it reads ${SUPPORTED_EXT.join(', ')} only): ${nameList(unsupported)}.`,
      );
    }
    if (supportedMisses.length > 0) {
      reasons.push(
        `${supportedMisses.length} changed file(s) have no symbols in the index: ` +
          `${nameList(supportedMisses)}. They may be new since the last index run, ` +
          `may declare nothing importable, or may have been skipped while indexing.`,
      );
    }
  }

  // Index-build limits that shape what could possibly be in there.
  if (stats?.bounded && stats.bounded > 0) {
    reasons.push(
      `The repository exceeds the ${MAX_INDEXED_FILES}-file index limit, so ` +
        `${stats.bounded} file(s) were never indexed.`,
    );
  }
  if (stats?.skippedTooLarge && stats.skippedTooLarge > 0) {
    reasons.push(`${stats.skippedTooLarge} file(s) were skipped for exceeding the size limit.`);
  }
  if (stats?.softBudgetReached) {
    reasons.push('Indexing stopped early against its time budget, so coverage is incomplete.');
  }
  if (stats?.graphFailed) {
    reasons.push(
      'The import graph failed to build on the last index run, so downstream ' +
        'endpoints and crons may be missing.',
    );
  }
  if (stats?.parseDegraded && stats.parseDegraded.length > 0) {
    reasons.push(`${stats.parseDegraded.length} file(s) failed to parse during indexing.`);
  }

  if (truncated) {
    reasons.push(
      `GitHub reported ${pullFilesCount} changed files but only ${prFilesCount} were ` +
        `imported — the file list is truncated at 100, so files beyond that are invisible here.`,
    );
  }

  // Index-wide notes that always apply and keep the answer honest.
  if (state !== 'full') {
    reasons.push(
      'Files ignored by .gitignore are still indexed, and endpoint attribution is ' +
        'file-level, so downstream endpoints are "potentially touched" rather than certain.',
    );
  }

  // The invariant, enforced rather than assumed: never return a non-full state
  // with nothing to show the user.
  let explanation = reasons.join(' ');
  if (state !== 'full' && explanation.trim() === '') {
    explanation =
      'The index could not fully cover this pull request, and no more specific ' +
      'reason was recorded. Re-analyze the repository to rebuild the index.';
  }
  if (state === 'full') explanation = '';

  return {
    state,
    reason: state === 'full' ? null : (degradedReason ?? indexStatus ?? 'no_data'),
    explanation,
    indexed_files: indexedFiles,
    files_covered: filesCovered,
    files_not_covered: filesNotCovered,
  };
}
