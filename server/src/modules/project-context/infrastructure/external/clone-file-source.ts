import type { GitClient, RepoRef } from '@devdigest/shared';
import { safeRepoPath } from '../../../reviews/intent/sources.js';
import type { DiscoveredFileEntry } from '../../domain-model/types.js';
import type { ProjectContextFileSource } from '../../domain-services/ports.js';

/**
 * `ProjectContextFileSource` over `container.git`, modelled on
 * `conventions/infrastructure/external/clone-file-reader.ts`.
 *
 * `safeRepoPath` is imported, never reimplemented — it is the ONLY path
 * check in this codebase for confining a candidate path to a clone root
 * (`reviews/intent/sources.ts`'s own comment: "this check is the whole
 * defence"). Both "missing" shapes for `read()` normalise to `null`,
 * mirroring `CloneFileReader`'s documented reasoning: `MockGitClient.readFile`
 * returns `''`, `SimpleGitClient.readFile` throws ENOENT.
 */
export class CloneFileSource implements ProjectContextFileSource {
  constructor(private readonly git: GitClient) {}

  /** No file content is read — `GitClient.listFiles` only stats entries. */
  async listMarkdown(
    ref: RepoRef,
    globs: readonly string[],
    maxFiles: number,
  ): Promise<DiscoveredFileEntry[]> {
    const entries = await this.git.listFiles(ref, { globs: [...globs], maxFiles });
    return entries.map((e) => ({ path: e.path, bytes: e.bytes, modifiedAt: e.modifiedAt }));
  }

  async read(ref: RepoRef, candidate: string): Promise<string | null> {
    const text = await this.readRaw(ref, candidate);
    return text === null || text.length === 0 ? null : text;
  }

  /**
   * `read()`'s body minus the empty→`null` normalisation — see the port
   * docblock. Kept here as the one place `safeRepoPath` confinement and
   * `GitClient.readFile` are actually called; `read()` delegates so the two
   * methods' confinement/error behaviour cannot drift apart.
   */
  async readRaw(ref: RepoRef, candidate: string): Promise<string | null> {
    const safe = safeRepoPath(this.git.clonePathFor(ref), candidate);
    if (safe === null) return null;
    try {
      return await this.git.readFile(ref, safe);
    } catch {
      return null;
    }
  }
}
