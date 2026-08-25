import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import { RepoRepository } from '../repos/repository.js';
import { ProjectContextService } from '../project-context/application-services/project-context-service.js';
import { CloneFileSource } from '../project-context/infrastructure/external/clone-file-source.js';
import { AgentsService } from './service.js';

/** `/providers/:id` addresses a provider by name, not a uuid. */
const ProviderParams = z.object({ id: Provider });

/** `/agents/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * A2 — agents module (owner A2).
 *   GET    /agents                  → list (workspace-scoped)
 *   GET    /agents/:id              → one agent
 *   POST   /agents                  → create
 *   PUT    /agents/:id              → update / toggle enabled (versions config)
 *   GET    /agents/:id/versions     → config history (newest first)
 *   GET    /agents/:id/versions/:version → one config snapshot
 *   GET    /agents/:id/skills       → linked skills (ordered)
 *   POST   /agents/:id/skills       → set/reorder linked skills OR link one
 *   GET    /agents/:id/models       → dynamic model list for the agent's provider
 *   GET    /providers/:id/models    → dynamic model list for a provider (editor)
 *   GET    /agents/:id/context-docs → Project Context attachments for one repo (ordered)
 *   PUT    /agents/:id/context-docs → replace the attachment set for one repo (attach/detach/reorder in one call)
 */

const CreateAgentBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  provider: Provider,
  model: z.string().min(1),
  system_prompt: z.string().min(1),
  output_schema: z.unknown().optional(),
  strategy: ReviewStrategy.optional(),
  ci_fail_on: CiFailOn.optional(),
  repo_intel: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const UpdateAgentBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  provider: Provider.optional(),
  model: z.string().min(1).optional(),
  system_prompt: z.string().min(1).optional(),
  output_schema: z.unknown().optional(),
  strategy: ReviewStrategy.optional(),
  ci_fail_on: CiFailOn.optional(),
  repo_intel: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/** Either set the whole ordered set (`skill_ids`) or link one (`skill_id`). */
const SetSkillsBody = z
  .object({
    skill_ids: z.array(z.string().uuid()).optional(),
    skill_id: z.string().uuid().optional(),
    order: z.number().int().optional(),
  })
  .refine((b) => b.skill_ids !== undefined || b.skill_id !== undefined, {
    message: 'Provide skill_ids (set/reorder) or skill_id (link one)',
  });

const ContextDocsQuery = z.object({ repo_id: z.string().uuid() });

const PutContextDocsBody = z.object({
  repo_id: z.string().uuid(),
  paths: z.array(z.string().min(1)),
});

/**
 * Reject the whole request 422 if any submitted path is not a currently
 * discoverable document (the spec's "Attachment path submitted by the
 * client" fence: validated on write, re-confined on read at Phase 4) — a
 * partial write would make the saved set disagree with the version
 * snapshot. `paths: []` (clearing every attachment) skips the check
 * entirely: there is nothing to validate, and a repo that has lost its
 * clone must still be able to clear a stale attachment list.
 */
async function assertDiscoverable(
  container: Container,
  workspaceId: string,
  repoId: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const service = new ProjectContextService({
    reposRepo: new RepoRepository(container.db),
    fileSource: new CloneFileSource(container.git),
  });
  const listing = await service.list(workspaceId, repoId);
  const discoverable = new Set(listing.docs.map((d) => d.path));
  const invalidPaths = paths.filter((p) => !discoverable.has(p));
  if (invalidPaths.length > 0) {
    throw new ValidationError('One or more paths are not currently discoverable documents', {
      invalid_paths: invalidPaths,
    });
  }
}

export default async function agentsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentsService(app.container);

  app.get('/agents', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  });

  app.post('/agents', { schema: { body: CreateAgentBody } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const body = req.body;
    const agent = await service.create(
      workspaceId,
      {
        name: body.name,
        provider: body.provider,
        model: body.model,
        system_prompt: body.system_prompt,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.output_schema !== undefined ? { output_schema: body.output_schema } : {}),
        ...(body.strategy !== undefined ? { strategy: body.strategy } : {}),
        ...(body.ci_fail_on !== undefined ? { ci_fail_on: body.ci_fail_on } : {}),
        ...(body.repo_intel !== undefined ? { repo_intel: body.repo_intel } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
      userId,
    );
    reply.status(201);
    return agent;
  });

  app.put(
    '/agents/:id',
    { schema: { params: IdParams, body: UpdateAgentBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const agent = await service.update(workspaceId, req.params.id, req.body);
      if (!agent) throw new NotFoundError('Agent not found');
      return agent;
    },
  );

  app.delete('/agents/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Agent not found');
    return { ok: true };
  });

  app.get('/agents/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Agent not found');
    return versions;
  });

  app.get(
    '/agents/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Agent version not found');
      return version;
    },
  );

  app.get('/agents/:id/skills', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.skillLinks(req.params.id);
  });

  app.post(
    '/agents/:id/skills',
    { schema: { params: IdParams, body: SetSkillsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const links =
        body.skill_ids !== undefined
          ? await service.setSkills(workspaceId, req.params.id, body.skill_ids)
          : await service.linkSkill(workspaceId, req.params.id, body.skill_id!, body.order);
      if (!links) throw new NotFoundError('Agent not found');
      return links;
    },
  );

  app.get('/agents/:id/models', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agent = await service.get(workspaceId, req.params.id);
    if (!agent) throw new NotFoundError('Agent not found');
    return service.listModels(agent.provider);
  });

  app.get('/providers/:id/models', { schema: { params: ProviderParams } }, async (req) => {
    await getContext(app.container, req);
    return service.listModels(req.params.id);
  });

  app.get(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, querystring: ContextDocsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const docs = await service.contextDocs(workspaceId, req.params.id, req.query.repo_id);
      if (!docs) throw new NotFoundError('Agent not found');
      return docs;
    },
  );

  app.put(
    '/agents/:id/context-docs',
    { schema: { params: IdParams, body: PutContextDocsBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // Agent existence is checked BEFORE `assertDiscoverable` (which can
      // 409 `repo_not_cloned` or throw `NotFoundError` on a bad `repo_id`) —
      // otherwise a request naming both a nonexistent agent AND an invalid
      // repo_id surfaces a misleading "repo not cloned" instead of "Agent
      // not found" (B4 remediation).
      const agent = await service.get(workspaceId, req.params.id);
      if (!agent) throw new NotFoundError('Agent not found');
      await assertDiscoverable(app.container, workspaceId, req.body.repo_id, req.body.paths);
      const docs = await service.setContextDocs(
        workspaceId,
        req.params.id,
        req.body.repo_id,
        req.body.paths,
      );
      if (!docs) throw new NotFoundError('Agent not found');
      return docs;
    },
  );
}
