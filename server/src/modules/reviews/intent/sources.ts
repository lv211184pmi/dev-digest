import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IntentSource, IntentSourceKind, IntentSourceStatus } from '@devdigest/shared';
import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Pure source handling for the intent derivation: path confinement, spec-path
 * extraction, hunk-header synthesis, and rendering the classifier's input text.
 *
 * PURE — no `node:fs`, no octokit, no db. `node:path` and `node:crypto` are
 * string/hash maths, not I/O. Everything here takes already-fetched material
 * and returns strings or records, which is what makes its tests hermetic and
 * key-free.
 */

/** Changed-file list cap. Beyond this the list is noise and burns tokens. */
export const MAX_LISTED_FILES = 200;
/** In-repo spec paths we are willing to read. */
export const MAX_SPEC_PATHS = 3;
/** Per-file hunk-header cap, so one churned file cannot dominate the input. */
const MAX_HUNKS_PER_FILE = 20;

/**
 * Resolve `candidate` against `clonePath` and return it only if it stays inside
 * the clone. Returns `null` rather than throwing — a bad path is an expected
 * outcome of parsing author-controlled text, not an exception.
 *
 * This is the whole defence for the spec-reading path: `GitClient.readFile`
 * joins the caller's path onto the clone root with no validation of its own.
 */
export function safeRepoPath(clonePath: string, candidate: string): string | null {
  if (!clonePath || !candidate) return null;
  // NUL truncates paths in some syscalls; reject outright.
  if (candidate.includes('\0')) return null;
  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) return null;
  // Reject any `..` segment before resolving, so an escape never depends on
  // string comparison alone.
  const segments = candidate.split(/[\\/]+/);
  if (segments.some((s) => s === '..')) return null;

  const root = path.resolve(clonePath);
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  // A path that resolves back onto the root itself is a directory, not a file.
  if (resolved === root) return null;
  return path.relative(root, resolved);
}

/** `specs/foo.md`, `docs/a/b.md` — in-repo markdown the body points at. */
const SPEC_PATH = /(?<![\w./-])((?:specs|docs)\/[A-Za-z0-9._/-]+\.md)\b/g;

/**
 * In-repo plan/spec-looking paths mentioned in the body, de-duplicated,
 * order-preserving, capped. Confinement is NOT done here — the caller must
 * still run `safeRepoPath` before touching the filesystem.
 */
export function extractSpecPaths(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(SPEC_PATH)) {
    const p = m[1]!;
    if (seen.has(p)) continue;
    seen.add(p);
    if (out.length >= MAX_SPEC_PATHS) break;
    out.push(p);
  }
  return out;
}

/**
 * `@@ -a,b +c,d @@` headers SYNTHESIZED from the hunk's line numbers.
 *
 * `DiffHunk` carries no line text, and `UnifiedDiff.raw` is deliberately not
 * read here — diff content leaking into the classifier is impossible by
 * construction, not by review.
 */
export function synthesizeHunkHeaders(diff: UnifiedDiff): string[] {
  const out: string[] = [];
  for (const file of diff.files ?? []) {
    const hunks = (file.hunks ?? []).slice(0, MAX_HUNKS_PER_FILE);
    for (const h of hunks) {
      out.push(`${file.path}: @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    }
  }
  return out;
}

/** Everything the classifier gets to read, already fetched. */
export interface IntentMaterial {
  title: string;
  body: string;
  /** Fetched issues, in ref order. */
  issues: { ref: string; title: string; body: string }[];
  /** Read in-repo specs. */
  specs: { path: string; text: string }[];
  changedFiles: string[];
  hunkHeaders: string[];
  /** Only gathered when the body is blank. */
  commitMessages: string[];
}

/** A changed-file list, capped, with an explicit truncation line. */
function renderFileList(files: string[]): string {
  const shown = files.slice(0, MAX_LISTED_FILES);
  const lines = shown.map((f) => `- ${f}`);
  if (files.length > MAX_LISTED_FILES) {
    lines.push(`… and ${files.length - MAX_LISTED_FILES} more`);
  }
  return lines.join('\n');
}

/**
 * The classifier's untrusted input text. Sections are omitted when empty so a
 * blank body does not read to the model as "the body says nothing about scope".
 */
export function renderSources(material: IntentMaterial): string {
  const parts: string[] = [];
  parts.push(`# PR title\n${material.title}`);
  if (material.body.trim()) parts.push(`# PR description\n${material.body.trim()}`);
  for (const issue of material.issues) {
    parts.push(`# Linked issue ${issue.ref}\n${issue.title}\n\n${issue.body}`.trimEnd());
  }
  for (const spec of material.specs) {
    parts.push(`# In-repo spec ${spec.path}\n${spec.text}`);
  }
  if (material.commitMessages.length > 0) {
    parts.push(`# Commit messages\n${material.commitMessages.map((c) => `- ${c}`).join('\n')}`);
  }
  if (material.changedFiles.length > 0) {
    parts.push(
      `# Changed files (${material.changedFiles.length})\n${renderFileList(material.changedFiles)}`,
    );
  }
  if (material.hunkHeaders.length > 0) {
    parts.push(
      `# Changed regions (hunk headers only — no diff content)\n${material.hunkHeaders.join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** Half the cache key `(pr_id, head_sha, sources_hash)`. */
export function sourcesHash(renderedText: string): string {
  return createHash('sha256').update(renderedText).digest('hex');
}

export function intentSource(
  kind: IntentSourceKind,
  ref: string,
  status: IntentSourceStatus,
): IntentSource {
  return { kind, ref, status };
}
