import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * The skills module (L02): CRUD, version snapshotting + restore, the
 * agent_skills link/reorder round trip (owned by A2's agents module but
 * exercised here end-to-end), and the community-fixture import path.
 */
d('skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'pr-quality-rubric',
    description: 'Rubric for evaluating overall PR quality.',
    type: 'rubric' as const,
    body: '# PR Quality Rubric\n\nCheck correctness, tests, and clarity.',
  };

  it('creates a skill with exactly one version (v1) and enabled defaults true', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill).toMatchObject({ name: createBody.name, type: 'rubric', source: 'manual', enabled: true, version: 1 });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ skill_id: skill.id, version: 1, body: createBody.body });
    await app.close();
  });

  it('a body edit bumps the version and snapshots a change_summary; toggling enabled alone does not', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${skillId}`,
      payload: { body: '# PR Quality Rubric\n\nTightened scope.', change_summary: 'Tightened scope rule' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].change_summary).toBe('Tightened scope rule');
    expect(versions[1].change_summary).toBeNull();

    await app.inject({ method: 'PUT', url: `/skills/${skillId}`, payload: { enabled: false } });
    const afterToggle = (await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })).json();
    expect(afterToggle).toHaveLength(2); // no new snapshot from the enabled-only change
    await app.close();
  });

  it('restore copies an old body into a NEW current version (non-destructive revert)', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;
    await app.inject({ method: 'PUT', url: `/skills/${skillId}`, payload: { body: 'v2 body' } });
    await app.inject({ method: 'PUT', url: `/skills/${skillId}`, payload: { body: 'v3 body' } });

    const restored = await app.inject({ method: 'POST', url: `/skills/${skillId}/versions/1/restore` });
    expect(restored.statusCode).toBe(200);
    const skill = restored.json();
    expect(skill.version).toBe(4); // new version, history not rewritten
    expect(skill.body).toBe(createBody.body);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${skillId}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions[0].body).toBe(createBody.body);
    await app.close();
  });

  it('404s for an unknown skill and an unknown version', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect((await app.inject({ method: 'GET', url: `/skills/${ghost}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/skills/${skillId}/versions/99` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/skills/${skillId}/versions/99/restore` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('deleting a skill removes it from the list', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json().id as string;
    const del = await app.inject({ method: 'DELETE', url: `/skills/${skillId}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/skills/${skillId}` })).statusCode).toBe(404);
    await app.close();
  });

  it('links skills to an agent in order, and GET /skills/:id/agents reflects it back', async () => {
    const app = await makeApp();
    const skillA = (await app.inject({ method: 'POST', url: '/skills', payload: createBody })).json();
    const skillB = (
      await app.inject({ method: 'POST', url: '/skills', payload: { ...createBody, name: 'second-skill' } })
    ).json();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Skill Link Test Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'x' },
      })
    ).json();

    const linked = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skillB.id, skillA.id] },
    });
    expect(linked.statusCode).toBe(200);
    const links = linked.json();
    expect(links.map((l: { skill_id: string; order: number }) => l.skill_id)).toEqual([skillB.id, skillA.id]);
    expect(links.map((l: { order: number }) => l.order)).toEqual([0, 1]);

    const agentsForSkillA = (await app.inject({ method: 'GET', url: `/skills/${skillA.id}/agents` })).json();
    expect(agentsForSkillA.map((a: { id: string }) => a.id)).toContain(agent.id);
    await app.close();
  });

  it('community search returns the static fixture list; importing one creates a disabled skill needing vetting', async () => {
    const app = await makeApp();
    const search = await app.inject({ method: 'GET', url: '/skills/community?q=owasp' });
    expect(search.statusCode).toBe(200);
    const results = search.json();
    expect(results).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'owasp-top-10-review', repo: 'secdev/agent-skills' })]),
    );

    const imported = await app.inject({
      method: 'POST',
      url: '/skills/community/import',
      payload: { repo: 'secdev/agent-skills', name: 'owasp-top-10-review' },
    });
    expect(imported.statusCode).toBe(201);
    const skill = imported.json();
    expect(skill).toMatchObject({ name: 'owasp-top-10-review', source: 'community', enabled: false });
    await app.close();
  });

  it('404s importing an unknown community skill', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills/community/import',
      payload: { repo: 'nobody/nothing', name: 'made-up' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
