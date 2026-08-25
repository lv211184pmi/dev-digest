import type { RepoRef } from '@devdigest/shared';
import type { DiscoveredFileEntry } from '../domain-model/types.js';

/**
 * Port interfaces the application service depends on. Implementations live
 * in `infrastructure/` — this file declares shapes only, no I/O.
 */

/**
 * Discovery (and, ahead of Phase 4, read) access to a repo's clone.
 * Implemented by `infrastructure/external/clone-file-source.ts` over
 * `container.git`.
 */
export interface ProjectContextFileSource {
  /**
   * The matched entries under `globs`, capped at `maxFiles`. "No clone yet"
   * (R4) is NOT this method's concern — `repos.clone_path` (the DB column
   * `RepoRepository.updateClonePath` sets once a clone job completes) is the
   * authoritative signal the application service checks BEFORE calling this,
   * same pattern as `repo-intel/service.ts`'s `if (!repo.clonePath)`. Never
   * reads file contents.
   */
  listMarkdown(
    ref: RepoRef,
    globs: readonly string[],
    maxFiles: number,
  ): Promise<DiscoveredFileEntry[]>;
  /**
   * Read one document's text, re-confining `path` through `safeRepoPath`
   * first. `null` on a missing file, an unreadable clone, or a path that
   * fails confinement. **A 0-byte file also normalises to `null`** —
   * `resolveForRun` (Phase 4) depends on that to emit `skipped_empty` (AC
   * 18). Callers who need to tell "empty" apart from "missing" (the content
   * route, R7) use `readRaw` instead.
   */
  read(ref: RepoRef, path: string): Promise<string | null>;
  /**
   * Same confinement and read as `read()`, but returns the file's text
   * **including `''` for a 0-byte file** — `null` only when the path fails
   * confinement or the file cannot be read at all. `read()` delegates to
   * this method and applies the empty→`null` normalisation on top, so the
   * two never diverge in how they resolve a path.
   */
  readRaw(ref: RepoRef, path: string): Promise<string | null>;
}

/**
 * Read-side port over the attachment tables' cross-cutting query. Write
 * paths (`setContextDocs`) already live on `AgentsRepository`/
 * `SkillsRepository` (Phase 2) and are called directly by the owning
 * modules' routes (Step 6) — this port exists only for what THIS module
 * needs: the usage count.
 */
export interface ProjectContextRepository {
  /**
   * Count of DISTINCT enabled agents in `workspaceId` receiving `path` for
   * `repoId` — direct attachment OR inherited through an enabled skill,
   * deduplicated so an agent holding the document both ways counts once (R6).
   */
  agentsUsing(workspaceId: string, repoId: string, path: string): Promise<number>;
}
