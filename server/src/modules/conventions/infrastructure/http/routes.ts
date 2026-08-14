/**
 * conventions module — HTTP + job-handler registration.
 *
 *   POST /repos/:id/conventions/extract        → 202 ExtractConventionsAccepted (409 active run)
 *   GET  /repos/:id/conventions                 → ConventionsView (run:null pre-first-scan)
 *   PATCH /conventions/:id                      → ConventionCandidate
 *   POST /conventions/runs/:id/decisions        → { updated }
 *   GET  /conventions/runs/:id/skill-draft      → ConventionSkillDraft (409 zero accepted)
 *   POST /conventions/runs/:id/skill            → Skill (201)
 *
 * Everything after the extract POST is RUN-scoped, not repo-scoped —
 * operating on "the latest run" would race a re-scan landing between a GET
 * and a mutation.
 *
 * The `CONVENTIONS_JOB_KIND` handler is registered here at plugin load,
 * mirroring `repo-intel/routes.ts`'s `registerIndexJobHandlers()` call. It
 * MUST NEVER THROW — see the try/catch below and root `INSIGHTS.md`.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Provider, RepoRef } from '@devdigest/shared';
import {
  UpdateConventionBody,
  ConventionDecisionsBody,
  CreateConventionSkillBody,
} from '@devdigest/shared';
import { getContext } from '../../../_shared/context.js';
import { IdParams } from '../../../_shared/schemas.js';
import { getFeatureModelOverride } from '../../../settings/feature-models.js';
import { RepoRepository } from '../../../repos/repository.js';
import { ConventionsService } from '../../application-services/conventions-service.js';
import {
  ExtractConventionsUseCase,
  type ExtractConventionsPayload,
} from '../../application-services/extract-conventions.js';
import { CONVENTIONS_JOB_KIND } from '../../domain-model/constants.js';
import { CloneFileReader } from '../external/clone-file-reader.js';
import { RankSamplePicker } from '../external/rank-sample-picker.js';
import { LlmExtractor } from '../external/llm-extractor.js';

const DEFAULT_MODEL_CHOICE = { provider: 'openrouter' as Provider, model: 'deepseek/deepseek-v4-flash' };

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const reposRepo = new RepoRepository(container.db);
  const service = new ConventionsService({
    repo: container.conventionsRepo,
    skillsRepo: container.skillsRepo,
    reposRepo,
    db: container.db,
    jobs: container.jobs,
  });

  container.jobs.register(CONVENTIONS_JOB_KIND, async (payload) => {
    const p = payload as ExtractConventionsPayload;
    try {
      const repoRow = await reposRepo.getById(p.workspaceId, p.repoId);
      if (!repoRow) throw new Error('repo not found');
      const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };

      const choice = (await getFeatureModelOverride(container, p.workspaceId, 'conventions')) ?? DEFAULT_MODEL_CHOICE;
      const llmProvider = await container.llm(choice.provider);

      const useCase = new ExtractConventionsUseCase({
        store: container.conventionsRepo,
        fileReader: new CloneFileReader(container.git, ref),
        samplePicker: new RankSamplePicker(container.repoIntel),
        model: new LlmExtractor(llmProvider, choice.provider, choice.model),
        repoFullName: repoRow.fullName,
        logger: { debug: (obj, msg) => app.log.debug(obj, msg) },
      });

      await useCase.run(p);
    } catch (err) {
      // MUST resolve, never rethrow — JobRunner retries a failed handler up
      // to 3x (retries: 2), which would be up to 3 PAID model calls per
      // failed extraction. The job itself still ends up `done` while
      // `convention_runs.status` says `failed` — that mismatch is correct
      // and intentional, not a bug to "fix".
      await container.conventionsRepo.failRun(p.runId, (err as Error).message);
    }
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const result = await service.extract(workspaceId, req.params.id);
    reply.status(202);
    return result;
  });

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getView(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCandidate(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/conventions/runs/:id/decisions',
    { schema: { params: IdParams, body: ConventionDecisionsBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.decisions(workspaceId, req.params.id, req.body.accepted, req.body.ids);
    },
  );

  app.get('/conventions/runs/:id/skill-draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.skillDraft(workspaceId, req.params.id);
  });

  app.post(
    '/conventions/runs/:id/skill',
    { schema: { params: IdParams, body: CreateConventionSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const skill = await service.createSkill(workspaceId, req.params.id, req.body);
      reply.status(201);
      return skill;
    },
  );
}
