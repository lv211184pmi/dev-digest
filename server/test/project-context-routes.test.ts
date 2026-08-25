import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockGitClient } from '../src/adapters/mocks.js';
import {
  MAX_DISCOVERED_FILES,
  MAX_DOC_CHARS,
  MAX_DOC_READ_BYTES,
} from '../src/modules/project-context/domain-model/constants.js';
import type { Db } from '../src/db/client.js';
import type { RepoRow } from '../src/modules/repos/repository.js';
import type { RepoRef } from '@devdigest/shared';

/**
 * `app.inject()` against the two `GET /repos/:id/project-context*` routes,
 * with a `MockGitClient`. No Docker, no network: `container.auth` is
 * overridden with `MockAuthProvider` (the default `LocalNoAuthProvider`
 * queries the DB for the seeded user/workspace), and `container.db` is a
 * tiny stub covering the ONE query these routes make —
 * `RepoRepository.getById` — since Project Context routes are the first
 * hermetic route tests to exercise a DB-backed repository lookup.
 */

const WORKSPACE_ID = 'w1'; // MockAuthProvider's default workspace id.
const REPO_ID = '11111111-1111-1111-1111-111111111111';

/** Returns `rows` unconditionally from `.select().from(...).where(...)` —
 *  enough for `RepoRepository.getById`'s single query shape; each test
 *  constructs a fresh fake scoped to exactly the repo row it needs. */
function fakeDbReturning(rows: RepoRow[]): Db {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
  } as unknown as Db;
}

function repoRow(over: Partial<RepoRow> = {}): RepoRow {
  return {
    id: REPO_ID,
    workspaceId: WORKSPACE_ID,
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: '/mock/clones/acme/widgets',
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * `MockGitClient.listFiles()` slices its result to exactly `opts.maxFiles`
 * unconditionally (`src/adapters/mocks.ts`), so it cannot itself exhibit the
 * post-B3-fix behaviour `SimpleGitClient.listFiles()` now has: collecting
 * one entry BEYOND `maxFiles` so `list()` can distinguish "exactly the cap"
 * from "the cap was reached and more exist" (see `simple-git.ts`'s
 * `listFiles()` and `project-context-service.ts`'s `list()`). This thin
 * subclass mirrors that real behaviour for exactly the two boundary tests
 * below, without changing the shared mock every other hermetic test in this
 * repo relies on.
 */
class OverflowGitClient extends MockGitClient {
  constructor(
    private readonly entries: Array<{ path: string; bytes: number; modifiedAt: Date }>,
  ) {
    super({});
  }
  override async listFiles(
    _repo: RepoRef,
    opts: { globs: string[]; maxFiles: number },
  ): Promise<Array<{ path: string; bytes: number; modifiedAt: Date }>> {
    return this.entries.slice(0, opts.maxFiles + 1);
  }
}

function syntheticSpecsMdFiles(count: number): Array<{ path: string; bytes: number; modifiedAt: Date }> {
  return Array.from({ length: count }, (_, i) => ({
    path: `specs/file-${String(i).padStart(4, '0')}.md`,
    bytes: 10,
    modifiedAt: new Date('2026-01-01T00:00:00Z'),
  }));
}

describe('GET /repos/:id/project-context', () => {
  it('green listing: shape, roots, truncated: false, non-.md and non-root files excluded', async () => {
    const git = new MockGitClient({
      files: {
        'docs/guide.md': 'x'.repeat(40),
        'specs/api.md': 'y'.repeat(8),
        'README.md': 'not under a configured root',
      },
    });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repo_id).toBe(REPO_ID);
    expect(body.truncated).toBe(false);
    expect(Array.isArray(body.roots)).toBe(true);
    expect(body.roots.length).toBe(3);
    const paths = body.docs.map((d: { path: string }) => d.path);
    expect(paths).toContain('docs/guide.md');
    expect(paths).toContain('specs/api.md');
    expect(paths).not.toContain('README.md');
    const guide = body.docs.find((d: { path: string }) => d.path === 'docs/guide.md');
    expect(guide).toMatchObject({ type: 'docs', bytes: 40, tokens: 10 });

    await app.close();
  });

  it('truncated: true when discovery finds MORE than maxFiles matching documents (B3)', async () => {
    const git = new OverflowGitClient(syntheticSpecsMdFiles(MAX_DISCOVERED_FILES + 1));
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.truncated).toBe(true);
    // The one entry beyond the cap is never returned to the caller.
    expect(body.docs.length).toBe(MAX_DISCOVERED_FILES);

    await app.close();
  });

  it('truncated: false at EXACTLY maxFiles matching documents — not a false positive (B3)', async () => {
    const git = new OverflowGitClient(syntheticSpecsMdFiles(MAX_DISCOVERED_FILES));
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.truncated).toBe(false);
    expect(body.docs.length).toBe(MAX_DISCOVERED_FILES);

    await app.close();
  });

  it('a repo with no clone returns 409 repo_not_cloned, never a 200 with an empty list', async () => {
    const git = new MockGitClient({});
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow({ clonePath: null })]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/project-context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_cloned');

    await app.close();
  });
});

/**
 * Overrides `readFile` to THROW for one path, mirroring
 * `SimpleGitClient.readFile`'s real ENOENT behaviour. `MockGitClient.readFile`
 * itself never throws (`this.opts.files?.[path] ?? ''`), so it cannot by
 * itself exercise "discoverable but unreadable" (R5) — this thin subclass,
 * scoped to this test file only, is the only way to reach that branch
 * hermetically. `listFiles` returns `entries` directly (already shaped to
 * match a configured root), same pattern as `OverflowGitClient` above.
 */
class UnreadableFileGitClient extends MockGitClient {
  constructor(
    private readonly entries: Array<{ path: string; bytes: number; modifiedAt: Date }>,
    private readonly unreadablePath: string,
  ) {
    super({});
  }
  override async listFiles(
    _repo: RepoRef,
    opts: { globs: string[]; maxFiles: number },
  ): Promise<Array<{ path: string; bytes: number; modifiedAt: Date }>> {
    return this.entries.slice(0, opts.maxFiles);
  }
  override async readFile(_repo: RepoRef, path: string): Promise<string> {
    if (path === this.unreadablePath) throw new Error('ENOENT');
    return '';
  }
}

describe('GET /repos/:id/project-context/doc', () => {
  it('happy path: a discoverable document returns 200 with its text, type, bytes and tokens', async () => {
    const text = 'hello project context';
    const git = new MockGitClient({ files: { 'docs/a.md': text } });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=docs/a.md`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ path: 'docs/a.md', type: 'docs', truncated: false, text });
    expect(body.bytes).toBe(text.length);
    expect(Number.isInteger(body.tokens)).toBe(true);
    expect(body.tokens).toBeGreaterThan(0);

    await app.close();
  });

  it('a path not in the current listing is rejected 422 — membership, not existence, is the gate (R3)', async () => {
    const git = new MockGitClient({
      files: {
        'docs/guide.md': 'discoverable',
        'README.md': 'a real file, but not under a configured root',
      },
    });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=README.md`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    await app.close();
  });

  it('a repo with no clone returns 409 repo_not_cloned (R4)', async () => {
    const git = new MockGitClient({});
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow({ clonePath: null })]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=docs/a.md`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_cloned');

    await app.close();
  });

  it('discoverable but no longer readable returns 404 document_not_found (R5)', async () => {
    const path = 'docs/ghost.md';
    const git = new UnreadableFileGitClient(
      [{ path, bytes: 10, modifiedAt: new Date('2026-01-01T00:00:00Z') }],
      path,
    );
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=${path}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');

    await app.close();
  });

  it('truncates at MAX_DOC_CHARS + 1 and does not truncate at exactly MAX_DOC_CHARS (R6)', async () => {
    const overText = 'x'.repeat(MAX_DOC_CHARS + 1);
    const exactText = 'y'.repeat(MAX_DOC_CHARS);
    const git = new MockGitClient({
      files: { 'docs/over.md': overText, 'docs/exact.md': exactText },
    });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      // The route resolves through `container.projectContext`, wired with the
      // real `TiktokenTokenizer` — `cl100k_base` encoding is pathologically
      // slow on a single-character repeated string (~6s for one 8001-char
      // fixture vs ~11ms for varied content). This test only asserts on
      // `truncated`/`text.length`/`bytes`, never on `tokens`, so a mock
      // counter is the correct seam (`adapters/tokenizer/index.ts`'s own
      // docblock: "swappable in tests via a mock counter").
      overrides: { auth: new MockAuthProvider(), git, tokenizer: { count: () => 0 } },
    });

    const overRes = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=docs/over.md`,
    });
    expect(overRes.statusCode).toBe(200);
    const overBody = overRes.json();
    expect(overBody.truncated).toBe(true);
    expect(overBody.text.length).toBe(MAX_DOC_CHARS);
    expect(overBody.bytes).toBe(MAX_DOC_CHARS);

    const exactRes = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=docs/exact.md`,
    });
    expect(exactRes.statusCode).toBe(200);
    const exactBody = exactRes.json();
    expect(exactBody.truncated).toBe(false);
    expect(exactBody.text.length).toBe(MAX_DOC_CHARS);

    await app.close();
  });

  it('a 0-byte document previews as empty content, not an error (R7)', async () => {
    const git = new MockGitClient({ files: { 'docs/empty.md': '' } });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=docs/empty.md`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.text).toBe('');
    expect(body.bytes).toBe(0);
    expect(body.tokens).toBe(0);
    expect(body.truncated).toBe(false);

    await app.close();
  });

  it('a document whose listed size exceeds MAX_DOC_READ_BYTES is rejected 422 before it is read (PR3 remediation)', async () => {
    const path = 'docs/huge.md';
    // Listing `bytes` is synthetic and independent of `MockGitClient`'s
    // `files` map (the `listFiles` override), so the fixture never needs an
    // actual over-the-cap file — the size-budget guard rejects on the
    // listed `bytes` alone, before `readRaw` would ever be called.
    const git = new MockGitClient({
      listFiles: [
        { path, bytes: MAX_DOC_READ_BYTES + 1, modifiedAt: new Date('2026-01-01T00:00:00Z') },
      ],
    });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=${path}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    await app.close();
  });

  it('a document at exactly MAX_DOC_READ_BYTES is still accepted — the cap is inclusive (boundary pair)', async () => {
    const path = 'docs/at-limit.md';
    const git = new MockGitClient({
      listFiles: [
        { path, bytes: MAX_DOC_READ_BYTES, modifiedAt: new Date('2026-01-01T00:00:00Z') },
      ],
    });
    const app = await buildApp({
      config,
      db: fakeDbReturning([repoRow()]),
      overrides: { auth: new MockAuthProvider(), git },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${REPO_ID}/project-context/doc?path=${path}`,
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});
