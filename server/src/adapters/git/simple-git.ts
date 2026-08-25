import { simpleGit, type SimpleGit } from 'simple-git';
import { join, relative, sep } from 'node:path';
import { mkdir, readFile, readdir, stat, access, rm } from 'node:fs/promises';
import { constants, type Dirent } from 'node:fs';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { parseUnifiedDiff } from './diff-parser.js';

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

/**
 * GitClient over simple-git. Repos clone to
 * `<cloneDir>/<owner>/<repo>`. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(private cloneDir: string) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
  }

  clonePathFor(repo: RepoRef): string {
    return join(this.cloneDir, repo.owner, repo.name);
  }

  private git(repo: RepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    await mkdir(join(this.cloneDir, repo.owner), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      // already cloned → fetch latest
      await simpleGit(dest).fetch();
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await simpleGit(this.cloneDir).clone(url, dest, args);
    return { path: dest };
  }

  async fetchPullHead(repo: RepoRef, n: number): Promise<void> {
    // Fetch the PR head ref into a local ref (GitHub exposes pull/<n>/head).
    await this.git(repo).fetch(['origin', `pull/${n}/head:pr-${n}`]);
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the read-only mirror to upstream. A bare `fetch` only moves
    // `origin/<branch>`, so we `reset --hard` to advance local HEAD + worktree —
    // safe here because we never commit to or run code from the clone.
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = this.git(repo);
    await g.fetch(['origin', branch, '--depth', String(RESYNC_FETCH_DEPTH)]);
    await g.reset(['--hard', `origin/${branch}`]);
    return { head: (await g.revparse(['HEAD'])).trim() };
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    const raw = await this.git(repo).diff([`${base}...${head}`]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  async readFile(repo: RepoRef, path: string): Promise<string> {
    return readFile(join(this.clonePathFor(repo), path), 'utf8');
  }

  /**
   * Recursive walk modelled on `repo-intel/pipeline/walk.ts`: skip an
   * unreadable directory rather than aborting, never follow a symlink, skip
   * `node_modules`/`.git` at any depth, and stop once one entry BEYOND
   * `opts.maxFiles` has been collected (no collect-then-slice over the whole
   * tree — that is what R35's 1s budget forbids; this is one extra entry,
   * not the whole remainder). Directory entries are sorted before recursion
   * so the cutoff point is reproducible across runs on the same tree; the
   * final list is sorted by path again for a stable return order.
   *
   * The result can therefore be up to `opts.maxFiles + 1` entries long —
   * deliberately: `list()`
   * (`modules/project-context/application-services/project-context-service.ts`)
   * needs that one extra entry to distinguish "exactly `maxFiles` matching
   * documents, nothing left out" from "the cap was reached and more exist",
   * which comparing the returned length against `maxFiles` with `>=` cannot
   * do — a repo with exactly `maxFiles` documents would false-positive as
   * truncated. `list()` is the layer that slices back down to `maxFiles`
   * before returning to the caller.
   */
  async listFiles(
    repo: RepoRef,
    opts: { globs: string[]; maxFiles: number },
  ): Promise<Array<{ path: string; bytes: number; modifiedAt: Date }>> {
    const root = this.clonePathFor(repo);
    if (!(await this.exists(root))) return [];
    const matchers = parseSimpleGlobs(opts.globs);
    const out: Array<{ path: string; bytes: number; modifiedAt: Date }> = [];
    await walkForMatches(root, root, matchers, opts.maxFiles + 1, out);
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
  }
}

/**
 * Parses `**\/<segment>/**\/*.ext` glob strings into a (root-segment,
 * extension) matcher. This deliberately matches ONLY that simple shape — the
 * canonical discoverable-path RULE (a directory segment equal to a
 * configured root, and a `.md` extension) is owned by
 * `server/src/modules/project-context/domain-services/discovery.ts`'s
 * `matchesRoot`. Kept inline here (not imported from that module) so the git
 * adapter stays free of an application-module dependency — see Phase 3
 * plan's "Open questions".
 */
function parseSimpleGlobs(globs: string[]): Array<{ segment: string; ext: string }> {
  const out: Array<{ segment: string; ext: string }> = [];
  for (const glob of globs) {
    const m = /^\*\*\/([^/*]+)\/\*\*\/\*(\.[^/*]+)$/.exec(glob);
    if (m) out.push({ segment: m[1]!, ext: m[2]! });
  }
  return out;
}

/** `relPath` matches when its filename ends a matcher's extension AND a
 *  directory segment (never the filename itself) equals the matcher's root. */
function matchesAnyGlob(relPath: string, matchers: Array<{ segment: string; ext: string }>): boolean {
  if (matchers.length === 0) return false;
  const segments = relPath.split('/');
  if (segments.length < 2) return false; // no directory segment — a bare filename never matches
  const name = segments[segments.length - 1]!;
  const dirSegments = segments.slice(0, -1);
  return matchers.some((m) => name.endsWith(m.ext) && dirSegments.includes(m.segment));
}

async function walkForMatches(
  root: string,
  dir: string,
  matchers: Array<{ segment: string; ext: string }>,
  /** The hard stop `out.length` must reach — callers pass `opts.maxFiles + 1`
   *  from `listFiles()` so the caller can tell "exactly at the cap" apart
   *  from "truncated" (see `listFiles()`'s doc comment). */
  maxFiles: number,
  out: Array<{ path: string; bytes: number; modifiedAt: Date }>,
): Promise<void> {
  if (out.length >= maxFiles) return;
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink target) — skip
    // cleanly so the walk keeps making progress elsewhere in the tree.
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (out.length >= maxFiles) return;
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, escapes)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      await walkForMatches(root, join(dir, name), matchers, maxFiles, out);
      continue;
    }

    if (!entry.isFile()) continue;

    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    if (!matchesAnyGlob(rel, matchers)) continue;

    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    out.push({ path: rel, bytes: st.size, modifiedAt: st.mtime });
  }
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}
