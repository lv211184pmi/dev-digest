import type { IntentSource, UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import type { PullRow } from '../repository.js';
import type * as schema from '../../../db/schema.js';
import type { RunLogger } from '../../../platform/run-logger.js';
import { parseIssueRefs } from '../../../adapters/github/issue-refs.js';
import {
  extractSpecPaths,
  intentSource,
  safeRepoPath,
  synthesizeHunkHeaders,
  type IntentMaterial,
} from './sources.js';

/**
 * The ONLY I/O in the intent path. Everything downstream of it — rendering,
 * confidence, the prompt block — is pure.
 *
 * Every input here originates with the PR author, so each fetch is guarded:
 * issue refs go through the typed `GitHubClient` port (never a hand-built URL),
 * in-repo spec paths must clear `safeRepoPath` against the clone root before
 * `readFile` sees them, and external links are recorded and never fetched.
 *
 * One failure never aborts the gather: an unreachable source becomes an
 * `IntentSource` with `status: 'unavailable'`, which is exactly the signal the
 * confidence rule and the UI need.
 */

/** Commit messages are a fallback for a blank body; a PR-sized window is enough. */
const MAX_COMMIT_MESSAGES = 20;
/** Spec files can be long; log a byte count, never the content. */
const MAX_SPEC_CHARS = 8000;

export interface GatherResult {
  material: IntentMaterial;
  sources: IntentSource[];
}

export async function gatherIntentMaterial(args: {
  container: Container;
  pull: PullRow;
  repoRow: typeof schema.repos.$inferSelect;
  diff: UnifiedDiff;
  runLog: RunLogger;
}): Promise<GatherResult> {
  const { container, pull, repoRow, diff, runLog } = args;
  const repoRef = { owner: repoRow.owner, name: repoRow.name };
  const sources: IntentSource[] = [];
  const prRef = `#${pull.number}`;

  const title = pull.title ?? '';
  const body = pull.body ?? '';

  sources.push(intentSource('pr_title', prRef, title.trim() ? 'used' : 'unavailable'));
  sources.push(intentSource('pr_body', prRef, body.trim() ? 'used' : 'unavailable'));

  // ---- linked issues + external links ------------------------------------
  const { issues: issueRefs, external } = parseIssueRefs(body, repoRef);
  const issues: IntentMaterial['issues'] = [];
  if (issueRefs.length > 0) {
    let github;
    try {
      github = await container.github();
    } catch (err) {
      runLog.info(`intent: GitHub unavailable — ${(err as Error).message}`);
    }
    for (const ref of issueRefs) {
      const label = `${ref.owner}/${ref.name}#${ref.number}`;
      if (!github) {
        sources.push(intentSource('linked_issue', label, 'unavailable'));
        continue;
      }
      try {
        const issue = await github.getIssue({ owner: ref.owner, name: ref.name }, ref.number);
        issues.push({ ref: label, title: issue.title ?? '', body: issue.body ?? '' });
        sources.push(intentSource('linked_issue', label, 'used'));
      } catch {
        sources.push(intentSource('linked_issue', label, 'unavailable'));
      }
    }
  }
  // v1 never fetches an arbitrary author-supplied URL — that is an SSRF
  // primitive. Recorded so the UI can say what the model did not get to read.
  for (const url of external) {
    sources.push(intentSource('external_link', url, 'unresolved'));
  }

  // ---- in-repo spec files -------------------------------------------------
  const specs: IntentMaterial['specs'] = [];
  const cloneRoot = container.git.clonePathFor(repoRef);
  for (const candidate of extractSpecPaths(body)) {
    // `readFile` joins the caller's path onto the clone root with no validation
    // of its own, so this check is the whole defence.
    const safe = safeRepoPath(cloneRoot, candidate);
    if (!safe) {
      runLog.info(`intent: spec path rejected (outside repo) — ${candidate}`);
      sources.push(intentSource('repo_spec', candidate, 'unavailable'));
      continue;
    }
    try {
      const text = (await container.git.readFile(repoRef, safe)).slice(0, MAX_SPEC_CHARS);
      specs.push({ path: safe, text });
      // Log the ref and a byte count — never the file's content.
      runLog.info(`intent: spec ${safe} read (${text.length} bytes)`);
      sources.push(intentSource('repo_spec', safe, 'used'));
    } catch {
      sources.push(intentSource('repo_spec', safe, 'unavailable'));
    }
  }

  // ---- changed files + synthesized hunk headers ---------------------------
  const changedFiles = diff.files.map((f) => f.path);
  const hunkHeaders = synthesizeHunkHeaders(diff);
  sources.push(
    intentSource(
      'changed_files',
      `${changedFiles.length} files`,
      changedFiles.length > 0 ? 'used' : 'unavailable',
    ),
  );

  // ---- commit messages (only when the body is blank) ----------------------
  let commitMessages: string[] = [];
  if (!body.trim()) {
    try {
      const log = await container.git.log(repoRef);
      commitMessages = log
        .slice(0, MAX_COMMIT_MESSAGES)
        .map((c) => c.message.split('\n')[0]!.trim())
        .filter((m) => m.length > 0);
      sources.push(
        intentSource(
          'commit_messages',
          `${commitMessages.length} commits`,
          commitMessages.length > 0 ? 'used' : 'unavailable',
        ),
      );
    } catch {
      sources.push(intentSource('commit_messages', 'git log', 'unavailable'));
    }
  }

  return {
    material: { title, body, issues, specs, changedFiles, hunkHeaders, commitMessages },
    sources,
  };
}
