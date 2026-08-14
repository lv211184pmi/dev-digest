import type { GitClient, RepoRef } from '@devdigest/shared';
import type { RepoFileReader } from '../../domain-services/ports.js';

/**
 * `RepoFileReader` over `container.git.readFile`. RepoIntel has no public
 * read (only a private `readClone()` internal to `repo-intel/service.ts`),
 * and a single consumer doesn't earn one — reading through `container.git`
 * directly keeps this a 4-line adapter.
 *
 * Normalizes both "missing" shapes to `null`: `MockGitClient.readFile`
 * returns `''` (see `adapters/mocks.ts`), `SimpleGitClient.readFile` throws
 * ENOENT (`node:fs/promises`). Both branches below are load-bearing — cutting
 * either breaks one of the two git client implementations silently.
 */
export class CloneFileReader implements RepoFileReader {
  constructor(
    private readonly git: GitClient,
    private readonly ref: RepoRef,
  ) {}

  async read(path: string): Promise<string | null> {
    // SimpleGitClient.readFile does a bare join() with no traversal guard.
    if (path.includes('..')) return null;
    try {
      const text = await this.git.readFile(this.ref, path);
      return text.trim().length === 0 ? null : text;
    } catch {
      return null;
    }
  }
}
