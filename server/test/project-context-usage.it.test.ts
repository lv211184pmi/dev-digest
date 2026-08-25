import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { ProjectContextDbRepository } from '../src/modules/project-context/infrastructure/persistence/project-context.repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context-usage] Docker not available — skipping integration tests.');
}

/**
 * `ProjectContextDbRepository.agentsUsing` (R6) — exactly the two boundaries
 * that make the count meaningful: an agent holding a document BOTH directly
 * and through an enabled skill counts once (the dedup boundary), and a
 * disabled skill contributes zero even when it's linked and carries the
 * path (the enabled-only boundary).
 */
d('project context usage query', () => {
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

  it('an agent holding the same path directly AND through an enabled skill counts once', async () => {
    const { db } = pg.handle;
    const agentsRepo = new AgentsRepository(db);
    const skillsRepo = new SkillsRepository(db);
    const usage = new ProjectContextDbRepository(db);

    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'Dedup Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const skill = await skillsRepo.insert({
      workspaceId,
      name: 'dedup-skill',
      description: 'x',
      type: 'convention',
      source: 'manual',
      body: 'b',
      enabled: true,
    });
    await agentsRepo.linkSkill(agent.id, skill.id, 0);

    await agentsRepo.setContextDocs(workspaceId, agent.id, repoId, ['docs/shared.md']);
    await skillsRepo.setContextDocs(workspaceId, skill.id, repoId, ['docs/shared.md']);

    const count = await usage.agentsUsing(workspaceId, repoId, 'docs/shared.md');
    expect(count).toBe(1);
  });

  it('an enabled agent linking a DISABLED skill that carries the path counts as 0', async () => {
    const { db } = pg.handle;
    const agentsRepo = new AgentsRepository(db);
    const skillsRepo = new SkillsRepository(db);
    const usage = new ProjectContextDbRepository(db);

    const agent = await agentsRepo.insert({
      workspaceId,
      name: 'Disabled-Skill Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const disabledSkill = await skillsRepo.insert({
      workspaceId,
      name: 'disabled-usage-skill',
      description: 'x',
      type: 'convention',
      source: 'manual',
      body: 'b',
      enabled: false,
    });
    await agentsRepo.linkSkill(agent.id, disabledSkill.id, 0);
    await skillsRepo.setContextDocs(workspaceId, disabledSkill.id, repoId, ['docs/only-via-disabled.md']);

    const count = await usage.agentsUsing(workspaceId, repoId, 'docs/only-via-disabled.md');
    expect(count).toBe(0);
  });
});
