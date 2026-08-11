import { createHash } from 'node:crypto';
import { Intent, type Provider, type UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import type * as schema from '../../../db/schema.js';
import type { RunLogger } from '../../../platform/run-logger.js';
import type { ReviewRepository, PullRow } from '../repository.js';
import type { PrIntentRow } from '../repository/pull.repo.js';
import { resolveFeatureModel, defaultFeatureModel } from '../../settings/feature-models.js';
import { gatherIntentMaterial } from './gather.js';
import { renderSources, sourcesHash } from './sources.js';
import { deriveConfidence } from './confidence.js';
import { buildClassifierMessages } from './render.js';

/**
 * Derive a PR's intent — ONE cheap LLM call per review batch, cached on
 * `(pr_id, head_sha, sources_hash)`.
 *
 * Logging goes through the injected `RunLogger` only: never `console`, never
 * pino directly. Nothing here logs spec content, the PR body, or diff text —
 * only refs and byte counts.
 *
 * Throws on failure. The CALLER decides to degrade; an intent failure must
 * never fail a review run.
 */

export interface DeriveIntentArgs {
  container: Container;
  /** The executor already holds this — never `new` a repository in here. */
  repo: ReviewRepository;
  repoRow: typeof schema.repos.$inferSelect;
  pull: PullRow;
  diff: UnifiedDiff;
  workspaceId: string;
  runLog: RunLogger;
  /**
   * Batch-wide id shared with the review call, so both LLM calls for one PR
   * correlate in the logs. Optional: the POST /intent endpoint derives outside
   * any run and has no batch to belong to.
   */
  correlationId?: string;
  /** Skip the cache check and re-derive (the POST endpoint). */
  force?: boolean;
}

export interface DeriveIntentResult {
  row: PrIntentRow;
  /** True when the stored row was reused and no LLM call was made. */
  cached: boolean;
}

export async function deriveIntent(args: DeriveIntentArgs): Promise<DeriveIntentResult> {
  const { container, repo, repoRow, pull, diff, workspaceId, runLog, correlationId, force } =
    args;

  const { material, sources } = await gatherIntentMaterial({
    container,
    pull,
    repoRow,
    diff,
    runLog,
  });
  const rendered = renderSources(material);
  const hash = sourcesHash(rendered);

  runLog.info(
    `intent: sources — ${sources.map((s) => `${s.kind}(${s.ref})=${s.status}`).join(', ')}`,
  );

  if (!force) {
    const existing = await repo.getIntent(pull.id);
    if (existing && existing.headSha === pull.headSha && existing.sourcesHash === hash) {
      runLog.info(
        `intent: cache hit for ${pull.headSha.slice(0, 7)} — reusing stored intent, no LLM call`,
      );
      return { row: existing, cached: true };
    }
  }

  const choice = await resolveFeatureModel(container, workspaceId, 'review_intent');
  const registryDefault = defaultFeatureModel('review_intent');
  const fromOverride =
    choice.provider !== registryDefault.provider || choice.model !== registryDefault.model;
  runLog.info(
    `intent: using ${choice.provider}/${choice.model} (${fromOverride ? 'workspace override' : 'registry default'})`,
  );

  const messages = buildClassifierMessages(rendered);

  // Same structured prompt-assembly record the review call emits, so BOTH LLM
  // calls are visible in the log with one shape and one correlation id. Sizes
  // and provenance only — `rendered` is the untrusted source text (PR body,
  // fetched spec, issue) and must never reach a log line.
  runLog.info(
    `intent: prompt assembled — ${messages.length} message(s), ${messages.reduce((n, m) => n + m.content.length, 0)} chars`,
    {
      event: 'prompt_assembly',
      ...(correlationId ? { correlation_id: correlationId } : {}),
      call: 'intent',
      model: `${choice.provider}/${choice.model}`,
      sections: messages.map((m) => ({
        section: m.role === 'system' ? 'classifier-instructions' : 'intent-sources',
        source: m.role === 'system' ? 'engine' : 'pr-author+repo',
        trust: m.role === 'system' ? 'trusted' : 'untrusted',
        chars: m.content.length,
        tokens: container.tokenizer.count(m.content),
        ...(container.config.promptLogVerbose
          ? { digest: createHash('sha256').update(m.content).digest('hex').slice(0, 8) }
          : {}),
      })),
    },
  );

  const llm = await container.llm(choice.provider as Provider);
  const res = await llm.completeStructured<Intent>({
    model: choice.model,
    schema: Intent,
    schemaName: 'pr_intent',
    messages,
    temperature: 0,
    requireParameters: true,
    sessionId: `${repoRow.owner}/${repoRow.name}#${pull.number}:intent`,
  });

  // Derived, never read off the model — `Intent` has no `confidence` field.
  const confidence = deriveConfidence(sources);

  await repo.upsertIntent(pull.id, {
    intent: res.data,
    confidence,
    sources,
    headSha: pull.headSha,
    sourcesHash: hash,
    provider: choice.provider,
    model: choice.model,
    costUsd: res.costUsd,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
  });

  runLog.result(
    `intent: confidence=${confidence}, ${res.data.in_scope.length} in scope / ` +
      `${res.data.out_of_scope.length} out of scope, ${res.tokensIn}+${res.tokensOut} tokens, ` +
      `cost ${res.costUsd == null ? 'unknown' : `$${res.costUsd.toFixed(4)}`}`,
  );

  const row = await repo.getIntent(pull.id);
  if (!row) throw new Error('intent row disappeared immediately after write');
  return { row, cached: false };
}
