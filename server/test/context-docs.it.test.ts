import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-docs] Docker not available — skipping integration tests.');
}

/**
 * Project Context attachments — the DB-backed repository behaviour revision 3
 * establishes: attachments are a meta layer, mutable independently of the
 * agent/skill's version (D22). These assertions are the observable form of
 * that decision — an attachment write never bumps a version or inserts a
 * version row, and a restore never touches the live attachment set. Do NOT
 * "fix" the missing version bump; there isn't one, by design. Exercises
 * `AgentsRepository`/`SkillsRepository` directly — Phase 3 adds the HTTP
 * routes over these.
 */
d('project context attachments', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db.select().from(t.repos).limit(1);
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('setContextDocs writes the ordered rows and cuts no version', async () => {
    const { db } = pg.handle;
    const agentsRepo = new AgentsRepository(db);
    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'Context Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    expect(agent.version).toBe(1);

    const countVersions = async () => (await agentsRepo.listVersions(agent.id)).length;
    const liveVersion = async () => {
      const [row] = await db
        .select({ version: t.agents.version })
        .from(t.agents)
        .where(eq(t.agents.id, agent.id));
      return row!.version;
    };
    const versionsBefore = await countVersions();

    const result = await agentsRepo.setContextDocs(workspaceId, agent.id, repoId, [
      'docs/a.md',
      'docs/b.md',
    ]);
    expect(result.map((r) => r.path)).toEqual(['docs/a.md', 'docs/b.md']);
    expect(await liveVersion()).toBe(1);
    expect(await countVersions()).toBe(versionsBefore);

    // Boundary: clearing to [] is still a real write, still no version cut.
    const cleared = await agentsRepo.setContextDocs(workspaceId, agent.id, repoId, []);
    expect(cleared).toEqual([]);
    expect(await liveVersion()).toBe(1);
    expect(await countVersions()).toBe(versionsBefore);

    // Boundary: setting the same list twice is idempotent, still no version cut.
    await agentsRepo.setContextDocs(workspaceId, agent.id, repoId, ['docs/a.md']);
    const repeated = await agentsRepo.setContextDocs(workspaceId, agent.id, repoId, ['docs/a.md']);
    expect(repeated.map((r) => r.path)).toEqual(['docs/a.md']);
    expect(await liveVersion()).toBe(1);
    expect(await countVersions()).toBe(versionsBefore);
  });

  it('restoring a skill version leaves the current attachment set untouched', async () => {
    const { db } = pg.handle;
    const skillsRepo = new SkillsRepository(db);
    const skill = await skillsRepo.insert({
      workspaceId,
      name: 'context-skill',
      description: 'x',
      type: 'convention',
      source: 'manual',
      body: 'original body',
    });

    // v2: a real body edit — this is what restoreVersion reverts to.
    await skillsRepo.update(workspaceId, skill.id, { body: 'edited body' });

    // Attach two documents to the live skill (attachments never touch versions).
    await skillsRepo.setContextDocs(workspaceId, skill.id, repoId, ['spec.md', 'other.md']);
    const before = await skillsRepo.contextDocs(skill.id, repoId);
    expect(before.map((doc) => doc.path)).toEqual(['spec.md', 'other.md']);

    const restored = await skillsRepo.restoreVersion(workspaceId, skill.id, 1);
    expect(restored?.body).toBe('original body');
    expect(restored?.version).toBe(3); // v1 + v2 (edit) + v3 (this restore)

    const afterRestore = await skillsRepo.contextDocs(skill.id, repoId);
    expect(afterRestore.map((doc) => doc.path)).toEqual(['spec.md', 'other.md']);
  });

  it("contextDocsForAgent excludes a disabled skill's rows and includes an other-repo row", async () => {
    const { db } = pg.handle;
    const agentsRepo = new AgentsRepository(db);
    const skillsRepo = new SkillsRepository(db);

    const [otherRepo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'other-repo', fullName: 'acme/other-repo' })
      .returning();

    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'Resolver Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const enabledSkill = await skillsRepo.insert({
      workspaceId,
      name: 'enabled-skill',
      description: 'x',
      type: 'convention',
      source: 'manual',
      body: 'b',
      enabled: true,
    });
    const disabledSkill = await skillsRepo.insert({
      workspaceId,
      name: 'disabled-skill',
      description: 'x',
      type: 'convention',
      source: 'manual',
      body: 'b',
      enabled: false,
    });
    await agentsRepo.linkSkill(agent.id, enabledSkill.id, 0);
    await agentsRepo.linkSkill(agent.id, disabledSkill.id, 1);

    await skillsRepo.setContextDocs(workspaceId, enabledSkill.id, repoId, ['from-primary-repo.md']);
    await skillsRepo.setContextDocs(workspaceId, enabledSkill.id, otherRepo!.id, [
      'from-other-repo.md',
    ]);
    // Never observable: the linked skill is disabled.
    await skillsRepo.setContextDocs(workspaceId, disabledSkill.id, repoId, ['should-not-appear.md']);

    const rows = await skillsRepo.contextDocsForAgent(agent.id);
    const paths = rows.map((r) => r.path);
    expect(paths).toContain('from-primary-repo.md');
    expect(paths).toContain('from-other-repo.md'); // cross-repo row IS observable (R19)
    expect(paths).not.toContain('should-not-appear.md');
    expect(rows.every((r) => r.skillId === enabledSkill.id)).toBe(true);
  });
});
