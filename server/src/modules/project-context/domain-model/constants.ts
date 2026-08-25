import type { ProjectContextDocType } from '@devdigest/shared';

/**
 * Project Context discovery constants. See
 * `server/src/vendor/shared/contracts/project-context.ts` for the contract
 * shapes and `../domain-services/discovery.ts` for the matching rule these
 * feed.
 *
 * `PROJECT_CONTEXT_ROOTS` is a BUILD-TIME constant in v1 — per-repo search
 * root configuration is explicitly out of scope for this phase (plan's "Out
 * of scope"). `ProjectContextListing.roots` is the seam that would let this
 * become configurable later without a contract change.
 */
export const PROJECT_CONTEXT_ROOTS: readonly ProjectContextDocType[] = [
  'specs',
  'docs',
  'insights',
] as const;

/** The only extension discovery reports on. */
export const PROJECT_CONTEXT_EXT = '.md';

/** Discovery stops here and sets `ProjectContextListing.truncated = true` (R34). */
export const MAX_DISCOVERED_FILES = 2000;

/**
 * Human-readable glob strings — reported on `ProjectContextListing.roots`
 * (AC 3's empty state names these) and passed to `GitClient.listFiles`. Each
 * takes the `**\/<segment>/**\/*.md` shape the git adapter's inline matcher
 * parses (`server/src/adapters/git/simple-git.ts`); the canonical matching
 * RULE (a directory segment equal to a root, and a `.md` extension) is owned
 * by `discovery.ts`'s `matchesRoot`, not by this glob string shape.
 */
export const PROJECT_CONTEXT_GLOBS: readonly string[] = PROJECT_CONTEXT_ROOTS.map(
  (root) => `**/${root}/**/*.md`,
);

/**
 * Run-time resolution constants (Phase 4) — see `../domain-services/resolve.ts`.
 *
 * `MAX_DOC_TOKENS` is the per-document cap (AC 16); `MAX_DOC_CHARS` is its
 * character-count equivalent, using the same `4 chars ≈ 1 token` ratio as
 * `MAX_SPEC_CHARS` (`server/src/modules/reviews/intent/gather.ts:32`) so a
 * document is truncated by a plain character slice before a real token count
 * is ever taken of it. `MAX_CONTEXT_TOKENS` is the per-run budget (AC 17).
 *
 * Both numbers are the caller's 2026-08-23 instruction to ship and revisit —
 * they are not derived from any measurement, and are expected to move once
 * real runs' `truncated` / `skipped_budget` counts say whether they bite too
 * often or not often enough.
 */
export const MAX_DOC_TOKENS = 2000;
export const MAX_DOC_CHARS = MAX_DOC_TOKENS * 4;
export const MAX_CONTEXT_TOKENS = 8000;

/**
 * Read-time size budget for `ProjectContextService.readDoc()` (Revision 2's
 * content route). Checked against `ProjectContextDoc.bytes` — already known
 * from the discovery walk's `stat()` (`domain-services/discovery.ts`) —
 * BEFORE `fileSource.readRaw()` loads the file into memory, so an
 * unexpectedly large document is rejected instead of read in full and only
 * then truncated. Deliberately well above `MAX_DOC_CHARS`: UTF-8 bytes and JS
 * string length are not 1:1, so this bounds worst-case memory rather than
 * approximating the char cap. 1 MiB is comfortably above any real markdown
 * document this route is meant to serve.
 */
export const MAX_DOC_READ_BYTES = 1024 * 1024;
