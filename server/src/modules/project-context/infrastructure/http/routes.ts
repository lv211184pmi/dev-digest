/**
 * project-context module — HTTP.
 *
 *   GET /repos/:id/project-context        → ProjectContextListing
 *                                            (409 `repo_not_cloned` — never a
 *                                            200 with an empty list — when the
 *                                            repo has never been cloned; R4)
 *   GET /repos/:id/project-context/usage  → { path, agent_count }
 *   GET /repos/:id/project-context/doc    → ProjectContextDocContent
 *                                            (the document's text — 422 if
 *                                            `path` is not in the current
 *                                            discovery listing or exceeds the
 *                                            read-size cap, 404 if it is
 *                                            listed but no longer readable)
 *
 * The four attach/detach/reorder routes live on `agents/routes.ts` and
 * `skills/routes.ts` — they address an agent or a skill, not a repo, and
 * call that module's own service (Step 6 of the Phase 3 plan).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../../../_shared/context.js';
import { IdParams } from '../../../_shared/schemas.js';
import { RepoRepository } from '../../../repos/repository.js';
import { ProjectContextService } from '../../application-services/project-context-service.js';
import { CloneFileSource } from '../external/clone-file-source.js';
import { ProjectContextDbRepository } from '../persistence/project-context.repository.js';

const UsageQuery = z.object({ path: z.string().min(1) });
const UsageResponse = z.object({ path: z.string(), agent_count: z.number().int().nonnegative() });
const DocQuery = z.object({ path: z.string().min(1) });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const reposRepo = new RepoRepository(container.db);
  const service = new ProjectContextService({
    reposRepo,
    fileSource: new CloneFileSource(container.git),
  });
  const usageRepo = new ProjectContextDbRepository(container.db);

  app.get('/repos/:id/project-context', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.get(
    '/repos/:id/project-context/usage',
    { schema: { params: IdParams, querystring: UsageQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const count = await usageRepo.agentsUsing(workspaceId, req.params.id, req.query.path);
      return UsageResponse.parse({ path: req.query.path, agent_count: count });
    },
  );

  // `container.projectContext` — not the locally-constructed `service`
  // above — because `readDoc` needs the real `TiktokenTokenizer`
  // (`platform/container.ts:126-133`) to count tokens over the returned
  // slice (R8). The listing route's token estimate is `bytes`-derived
  // (`discovery.ts`'s `estimateTokens`) and needs no tokenizer, which is why
  // it is the only route still built on the local `service` above.
  app.get(
    '/repos/:id/project-context/doc',
    { schema: { params: IdParams, querystring: DocQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return container.projectContext.readDoc(workspaceId, req.params.id, req.query.path);
    },
  );
}
