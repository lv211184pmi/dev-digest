import type { ProjectContextDoc, ProjectContextDocType } from '@devdigest/shared';
import { PROJECT_CONTEXT_EXT, PROJECT_CONTEXT_ROOTS } from '../domain-model/constants.js';
import type { DiscoveredFileEntry } from '../domain-model/types.js';

/**
 * Pure matching + projection functions for Project Context discovery. No
 * I/O — everything here is a plain string/data transform, which is what
 * keeps its tests hermetic.
 */

const ROOT_SET: ReadonlySet<string> = new Set(PROJECT_CONTEXT_ROOTS);

/**
 * WHEN a repo-relative path has a directory segment equal to one of
 * `PROJECT_CONTEXT_ROOTS` at any depth AND ends `.md`, THE SYSTEM treats it
 * as discoverable. A file NAMED `specs.md` at the repo root does NOT match —
 * only a directory segment does (`specs/x.md` matches, bare `specs.md` or
 * the bare directory `specs` do not).
 */
export function matchesRoot(path: string): boolean {
  if (!path) return false;
  if (!path.endsWith(PROJECT_CONTEXT_EXT)) return false;
  const segments = path.split('/');
  // The last segment is the filename, never the matching directory segment.
  const dirSegments = segments.slice(0, -1);
  return dirSegments.some((s) => ROOT_SET.has(s));
}

/**
 * WHEN a path matches more than one root (e.g. `docs/specs/api.md`), THE
 * SYSTEM derives its type from the LEFT-MOST matching segment —
 * `docs/specs/api.md` -> `docs`, not `specs`. Returns `null` for a path that
 * matches no root; callers filter with `matchesRoot` first, so this is a
 * defensive fallback rather than an expected outcome.
 */
export function docTypeFor(path: string): ProjectContextDocType | null {
  const dirSegments = path.split('/').slice(0, -1);
  for (const segment of dirSegments) {
    if (ROOT_SET.has(segment)) return segment as ProjectContextDocType;
  }
  return null;
}

/** `ceil(bytes / 4)` — discovery's token estimate. No file content is read (R35). */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/**
 * Project a raw walk entry into the contract shape. Returns `null` when the
 * entry does not match any root — defensive; callers are expected to have
 * filtered with `matchesRoot` already. A zero-byte file still projects to a
 * doc with `tokens: 0` (it is listed; it only becomes `skipped_empty` at
 * Phase 4's run time, per AC 18).
 */
export function toDoc(entry: DiscoveredFileEntry): ProjectContextDoc | null {
  const type = docTypeFor(entry.path);
  if (!type) return null;
  return {
    path: entry.path,
    type,
    bytes: entry.bytes,
    tokens: estimateTokens(entry.bytes),
    modified_at: entry.modifiedAt.toISOString(),
  };
}
