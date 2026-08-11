/**
 * Parsing of issue/PR references out of author-controlled text (a PR body).
 *
 * PURE — no network, no octokit, no filesystem. It turns text into refs; the
 * caller decides what to fetch. That is what keeps its tests hermetic.
 *
 * All input here is attacker-controlled: a PR body is written by whoever opened
 * the PR. Nothing parsed here is ever executed, interpolated into a URL by hand,
 * or trusted — refs go through `GitHubClient.getIssue(repo, n)`, which builds
 * the request from typed fields, and external links are returned separately and
 * deliberately never fetched (see specs/02-intent-layer.md).
 */

/** A GitHub issue or PR reference, resolved to an explicit owner/repo. */
export interface IssueRef {
  owner: string;
  name: string;
  number: number;
  /** The exact text that produced this ref, for the `IntentSource.ref` field. */
  raw: string;
}

export interface ParsedRefs {
  issues: IssueRef[];
  /** URLs that are not GitHub issue/pull links. Recorded, never fetched. */
  external: string[];
}

/** Max refs we will ever try to resolve — an unbounded list is a fetch amplifier. */
const MAX_ISSUE_REFS = 5;
const MAX_EXTERNAL_LINKS = 5;

/** GitHub allows [A-Za-z0-9-_.] in owner/repo names. */
const OWNER = String.raw`[A-Za-z0-9._-]+`;

/**
 * `https://github.com/<owner>/<repo>/issues/123` and `/pull/123`. Both resolve
 * through REST `/repos/{owner}/{repo}/issues/{n}`, which serves PRs too.
 */
const URL_REF = new RegExp(
  String.raw`https?://(?:www\.)?github\.com/(${OWNER})/(${OWNER})/(?:issues|pull)/(\d+)`,
  'gi',
);

/** `owner/repo#123` — cross-repo shorthand. */
const CROSS_REPO_REF = new RegExp(String.raw`(?<![/\w])(${OWNER})/(${OWNER})#(\d+)\b`, 'g');

/** Bare `#123`, anywhere — not only after closes/fixes/resolves. */
const BARE_REF = /(?<![\w/#])#(\d+)\b/g;

/** Any absolute http(s) URL, used to pick out the non-GitHub ones. */
const ANY_URL = /https?:\/\/[^\s<>()[\]{}"'`]+/gi;

/**
 * Strip fenced code blocks (``` and ~~~) and inline code spans, so a `#123` in
 * a snippet is not mistaken for a reference.
 */
export function stripCode(text: string): string {
  return text
    .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, '')
    // An unterminated fence swallows the rest of the document, which is what a
    // Markdown renderer does too.
    .replace(/^[ \t]*(```|~~~)[\s\S]*$/m, '')
    .replace(/`[^`\n]*`/g, '');
}

/**
 * Parse issue refs and external links out of `text`.
 *
 * De-duplicated by `owner/name#number`, order-preserving (URL and cross-repo
 * forms first, then bare `#N`, each in the order they appear), capped at 5.
 * A bare `#N` resolves against `self`.
 */
export function parseIssueRefs(
  text: string,
  self: { owner: string; name: string },
): ParsedRefs {
  const issues: IssueRef[] = [];
  const seen = new Set<string>();
  const external: string[] = [];
  const seenExternal = new Set<string>();

  if (!text) return { issues, external };
  const body = stripCode(text);

  const push = (owner: string, name: string, number: number, raw: string): void => {
    // Issue numbers are 1-based; `#0` is not a reference.
    if (!Number.isSafeInteger(number) || number <= 0) return;
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}#${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (issues.length >= MAX_ISSUE_REFS) return;
    issues.push({ owner, name, number, raw });
  };

  for (const m of body.matchAll(URL_REF)) {
    push(m[1]!, m[2]!, Number(m[3]), m[0]!);
  }
  for (const m of body.matchAll(CROSS_REPO_REF)) {
    push(m[1]!, m[2]!, Number(m[3]), m[0]!);
  }
  for (const m of body.matchAll(BARE_REF)) {
    push(self.owner, self.name, Number(m[1]), m[0]!);
  }

  for (const m of body.matchAll(ANY_URL)) {
    const url = m[0]!.replace(/[.,;:)\]]+$/, '');
    if (/^https?:\/\/(?:www\.)?github\.com\//i.test(url)) continue;
    if (seenExternal.has(url)) continue;
    seenExternal.add(url);
    if (external.length >= MAX_EXTERNAL_LINKS) continue;
    external.push(url);
  }

  return { issues, external };
}
