import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/** `/skills/:id/versions/:version` — id is a uuid, version a positive integer. */
const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

/**
 * skills module.
 *   GET    /skills                          → list (workspace-scoped)
 *   GET    /skills/:id                      → one skill
 *   POST   /skills                          → create
 *   PUT    /skills/:id                      → update (versions body/meta changes)
 *   DELETE /skills/:id                      → delete
 *   GET    /skills/:id/versions             → version history (newest first)
 *   GET    /skills/:id/versions/:version    → one snapshot
 *   POST   /skills/:id/versions/:version/restore → revert to an old body (new version)
 *   GET    /skills/:id/agents               → agents that link this skill (Stats tab)
 *   POST   /skills/import/preview           → multipart .zip → unpersisted preview
 *   GET    /skills/community                → static fixture search
 *   POST   /skills/community/import         → import one fixture as a real Skill
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  body: z.string().min(1),
  source: SkillSource.optional(),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  change_summary: z.string().optional(),
});

const CommunityQuery = z.object({
  q: z.string().optional(),
  lang: z.string().optional(),
});

const CommunityImportBody = z.object({
  repo: z.string().min(1),
  name: z.string().min(1),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  // ---- Community search (static fixture) — registered before /skills/:id so
  // "community" is never mistaken for an id (Fastify matches static segments
  // first regardless, but keeping it visually grouped here). -------------
  app.get('/skills/community', { schema: { querystring: CommunityQuery } }, async (req) => {
    await getContext(app.container, req);
    return service.searchCommunity(req.query.q, req.query.lang);
  });

  app.post(
    '/skills/community/import',
    { schema: { body: CommunityImportBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.importCommunity(workspaceId, req.body.repo, req.body.name);
      reply.status(201);
      return skill;
    },
  );

  // ---- Import preview (archive only — a plain .md is parsed client-side) --
  app.post('/skills/import/preview', async (req) => {
    await getContext(app.container, req);
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded (expected a multipart "file" field)');
    if (!file.filename.toLowerCase().endsWith('.zip')) {
      throw new ValidationError(
        'Only .zip archives are accepted here — plain .md files are parsed client-side',
      );
    }
    const buffer = await file.toBuffer();
    return service.previewArchive(buffer);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.get(
    '/skills/:id/versions/:version',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const version = await service.getVersion(workspaceId, req.params.id, req.params.version);
      if (!version) throw new NotFoundError('Skill version not found');
      return version;
    },
  );

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill version not found');
      return skill;
    },
  );

  app.get('/skills/:id/agents', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const agents = await service.agentsForSkill(workspaceId, req.params.id);
    if (!agents) throw new NotFoundError('Skill not found');
    return agents;
  });
}
