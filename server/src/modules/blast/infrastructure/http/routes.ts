/**
 * blast module — HTTP.
 *
 *   GET  /pulls/:id/blast   → PrBlastRecord (200, `summary: null` when never derived)
 *   POST /pulls/:id/blast   → PrBlastRecord (200, always re-derives the sentence)
 *
 * Three decisions recorded here because they are all deliberate deviations from
 * what the neighbouring routes do:
 *
 * (a) THE RIPGREP SCAN IS UNREACHABLE FROM HERE. `container.codeIndex`'s
 *     `.symbols()` / `.references()` walk the whole clone per call with no
 *     cache, cap or timeout (server/INSIGHTS.md). The use case gates on the
 *     feature flag and then on the index status before it ever calls
 *     `getBlastRadius`, and repo-intel carries its own permanent flag guard, so
 *     the fallback path cannot be entered through this route.
 *
 * (b) GET RETURNS 200 WITH `summary: null`, not the 404 that
 *     `GET /pulls/:id/intent` returns for a missing derivation. The
 *     deterministic impact map is the product; the sentence is a garnish. A PR
 *     whose summary was never derived still has a complete, useful blast radius
 *     and must render it.
 *
 * (c) THERE IS DELIBERATELY NO `response:` SCHEMA. `grep -rn "response:"
 *     server/src/modules` returns zero hits — no route in this repo wires one,
 *     despite what README implies. Adding the first one here would newly
 *     activate `app.ts`'s `isResponseSerializationError` branch against a
 *     payload full of `.default()`s and nullables, turning a contract slip into
 *     an opaque 500. The handler's return type is `Promise<PrBlastRecord>`
 *     instead, so `tsc` enforces the contract at build time and the MCP
 *     client's own `validate()` enforces it at the far end.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PrBlastRecord, Provider } from '@devdigest/shared';
import { getContext } from '../../../_shared/context.js';
import { IdParams } from '../../../_shared/schemas.js';
import { RunLogger } from '../../../../platform/run-logger.js';
import { resolveFeatureModel } from '../../../settings/feature-models.js';
import { BlastUseCase } from '../../application-services/blast-service.js';
import type { BlastPullReader, BlastSummarizer } from '../../domain-services/ports.js';
import { BlastRepository } from '../persistence/blast.repository.js';
import { LlmBlastSummarizer } from '../external/llm-summarizer.js';

export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  // `container.reviewRepo`, not `new ReviewRepository(...)`: the container is the
  // composition root and says so at its own definition — consuming modules use
  // the getter instead of reaching into another module's folder.
  const reviewRepo = container.reviewRepo;
  const store = new BlastRepository(container.db);

  /**
   * Adapts `ReviewRepository` to the module's narrow read port, so no Drizzle
   * row type reaches the use case.
   */
  const pulls: BlastPullReader = {
    async getPull(workspaceId, prId) {
      const row = await reviewRepo.getPull(workspaceId, prId);
      if (!row) return null;
      return {
        id: row.id,
        repoId: row.repoId,
        headSha: row.headSha,
        filesCount: row.filesCount,
      };
    },
    async getChangedFiles(prId) {
      const rows = await reviewRepo.getPrFiles(prId);
      return rows.map((r) => r.path);
    },
  };

  /**
   * A summarizer that throws if called. The GET path must never spend money;
   * wiring the real adapter only on POST makes that a type-level guarantee
   * rather than a code-reading exercise.
   */
  const refusingSummarizer: BlastSummarizer = {
    async summarise() {
      throw new Error('GET /pulls/:id/blast must not derive a summary');
    },
  };

  // Read: deterministic map only, no LLM call, so no per-route limit beyond
  // the global one.
  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req): Promise<PrBlastRecord> => {
    const { workspaceId } = await getContext(container, req);
    const useCase = new BlastUseCase({
      store,
      summarizer: refusingSummarizer,
      repoIntel: container.repoIntel,
      pulls,
      repoIntelEnabled: container.config.repoIntelEnabled,
    });
    return useCase.run({ workspaceId, prId: req.params.id });
  });

  // Force re-derive. Same tight limit as the intent trigger: every call spends
  // money on an LLM request.
  app.post(
    '/pulls/:id/blast',
    { schema: { params: IdParams }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<PrBlastRecord> => {
      const { workspaceId } = await getContext(container, req);
      const choice = await resolveFeatureModel(container, workspaceId, 'blast_summary');
      const llm = await container.llm(choice.provider as Provider);

      // Outside a run there is no runId to stream to; a RunLogger with an empty
      // fan-out publishes nothing and still mirrors to the request logger —
      // same pattern as `deriveIntentNow`.
      const runLog = new RunLogger(container.runBus, [], req.log, { prId: req.params.id });

      const useCase = new BlastUseCase({
        store,
        summarizer: new LlmBlastSummarizer(
          llm,
          choice.provider,
          choice.model,
          runLog,
          `${req.params.id}:blast`,
          (text) => container.tokenizer.count(text),
        ),
        repoIntel: container.repoIntel,
        pulls,
        repoIntelEnabled: container.config.repoIntelEnabled,
      });
      return useCase.run({ workspaceId, prId: req.params.id, refresh: true });
    },
  );
}
