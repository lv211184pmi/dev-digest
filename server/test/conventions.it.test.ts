import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * conventions module, DB-backed (testcontainers). LLM-free via
 * `overrides.llm.openrouter` (a `MockLLMProvider` — no network), `overrides.git`
 * (an in-memory clone), and `overrides.repoIntel` (a fake facade).
 *
 * Two MockLLMProvider gotchas (see root INSIGHTS.md): its constructor only
 * accepts 'openai'|'anthropic' — register the instance under the openrouter
 * key instead — and it hard-validates the fixture against the REAL
 * `ConventionExtractionOutput` schema, so the fixture must satisfy
 * `rule.min(8)` etc. exactly.
 */

const USERS_TS = [
  "import { AppError } from '../errors';",
  'export class NotFoundError extends AppError {',
  "  constructor() { super('not_found'); }",
  '}',
].join('\n');

const GROUNDABLE_CANDIDATE = {
  category: 'error_handling',
  rule: 'Domain errors extend AppError with a stable code.',
  evidence: {
    file: 'src/api/users.ts',
    line: 2,
    snippet: 'export class NotFoundError extends AppError',
  },
  confidence: 0.9,
};

// Cites a file that was never in the sampled set — must be dropped by grounding.
const UNGROUNDED_CANDIDATE = {
  category: 'naming',
  rule: 'This rule cites a file that was never sampled at all.',
  evidence: { file: 'src/never-sampled.ts', line: 1, snippet: 'whatever text appears here' },
  confidence: 0.5,
};

function fakeRepoIntel(samplePaths: string[]): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    refreshIndex: async () => ({ status: 'full', filesIndexed: 0, filesSkipped: 0, durationMs: 0 }),
    getIndexState: async () => ({
      repoId: 'x',
      status: 'full',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      lastIndexedSha: 'x',
      indexerVersion: 1,
      updatedAt: new Date(),
    }),
    getBlastRadius: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [] }),
    getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => samplePaths,
    getTopFilesByRank: async () => samplePaths,
    getCriticalPaths: async () => [],
  };
}

d('conventions module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(opts?: { emptySamples?: boolean }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    // emptySamples: no files at all — every CONFIG_CANDIDATES probe AND every
    // ranked source path reads back null, so the use case never calls the LLM.
    const git = opts?.emptySamples
      ? new MockGitClient({ files: {} })
      : new MockGitClient({
          files: { 'src/api/users.ts': USERS_TS, 'package.json': '{"name":"widgets"}' },
        });
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        ConventionExtraction: { conventions: [GROUNDABLE_CANDIDATE, UNGROUNDED_CANDIDATE] },
      },
    });
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git,
        github: new MockGitHubClient(),
        llm: { openrouter: llm },
        repoIntel: fakeRepoIntel(opts?.emptySamples ? [] : ['src/api/users.ts']),
      },
    });
  }

  async function getRepoId(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    return repos.json()[0]!.id as string;
  }

  it('202 + run_id; a second POST while active returns 409 with the SAME run_id', async () => {
    const app = await makeApp();
    const repoId = await getRepoId(app);

    const first = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(first.statusCode).toBe(202);
    const runId = first.json().run_id;
    expect(runId).toBeTruthy();

    const second = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.details.run_id).toBe(runId);

    await app.container.jobs.onIdle();
    await app.close();
  });

  it('after the job completes, GET returns only grounded candidates', async () => {
    const app = await makeApp();
    const repoId = await getRepoId(app);
    const extract = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const runId = extract.json().run_id;

    await app.container.jobs.onIdle();

    const view = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(view.statusCode).toBe(200);
    const body = view.json();
    expect(body.run.id).toBe(runId);
    expect(body.run.status).toBe('done');
    expect(body.run.dropped_count).toBe(1);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].rule).toBe(GROUNDABLE_CANDIDATE.rule);
    expect(body.candidates[0].accepted).toBe(true); // accepted:true at insert time
    await app.close();
  });

  it('an unindexed repo (zero samples) finishes done, not failed, with an empty candidate list', async () => {
    const app = await makeApp({ emptySamples: true });
    const repoId = await getRepoId(app);
    const extract = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    await app.container.jobs.onIdle();

    const view = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(view.run.id).toBe(extract.json().run_id);
    expect(view.run.status).toBe('done');
    expect(view.run.candidate_count).toBe(0);
    expect(view.run.error).toBe('repo is not indexed yet');
    await app.close();
  });

  it('PATCH flips accepted; decisions with no ids flips every candidate; draft 409s at zero accepted; POST skill persists it with evidence + a version row + run.skill_id', async () => {
    const app = await makeApp();
    const repoId = await getRepoId(app);
    const extract = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const runId = extract.json().run_id;
    await app.container.jobs.onIdle();

    const view = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    const candidate = view.candidates[0];
    expect(candidate.accepted).toBe(true);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/conventions/${candidate.id}`,
      payload: { accepted: false },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().accepted).toBe(false);

    const draftAtZero = await app.inject({ method: 'GET', url: `/conventions/runs/${runId}/skill-draft` });
    expect(draftAtZero.statusCode).toBe(409);

    const decisions = await app.inject({
      method: 'POST',
      url: `/conventions/runs/${runId}/decisions`,
      payload: { accepted: true },
    });
    expect(decisions.statusCode).toBe(200);
    expect(decisions.json().updated).toBe(1);

    const draft = await app.inject({ method: 'GET', url: `/conventions/runs/${runId}/skill-draft` });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json();
    expect(draftBody.enabled).toBe(true);
    expect(draftBody.type).toBe('convention');
    expect(draftBody.evidence_files).toEqual(['src/api/users.ts']);

    const createSkill = await app.inject({
      method: 'POST',
      url: `/conventions/runs/${runId}/skill`,
      payload: {
        name: draftBody.name,
        description: draftBody.description,
        type: draftBody.type,
        enabled: draftBody.enabled,
        body: draftBody.body,
      },
    });
    expect(createSkill.statusCode).toBe(201);
    const skill = createSkill.json();
    expect(skill).toMatchObject({ source: 'extracted', type: 'convention', enabled: true, version: 1 });
    expect(skill.evidence_files).toEqual(['src/api/users.ts']);

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);

    const finalView = (await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })).json();
    expect(finalView.run.skill_id).toBe(skill.id);

    await app.close();
  });

  it('boot reaper flips an orphaned running run to failed on the next app boot', async () => {
    const { db } = pg.handle;
    const [repo] = await db.select().from(t.repos).limit(1);
    const [orphan] = await db
      .insert(t.conventionRuns)
      .values({ workspaceId: repo!.workspaceId, repoId: repo!.id, status: 'running' })
      .returning();

    // buildApp() awaits its reaper pass before serving — see app.ts.
    const app = await makeApp();
    const [row] = await db.select().from(t.conventionRuns).where(eq(t.conventionRuns.id, orphan!.id));
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('interrupted by restart');
    await app.close();
  });
});
