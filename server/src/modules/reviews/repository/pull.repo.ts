import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, IntentConfidence, IntentSource } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/** The stored `pr_intent` row. Never crosses out of the reviews module — the
 *  route returns `PrIntentRecord`, a DTO built in `service.ts`. */
export type PrIntentRow = typeof t.prIntent.$inferSelect;

/** Everything a derivation produces, minus `derivedAt` (set here, on write). */
export interface IntentWrite {
  intent: Intent;
  confidence: IntentConfidence;
  sources: IntentSource[];
  headSha: string | null;
  sourcesHash: string | null;
  provider: string | null;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export async function upsertIntent(db: Db, prId: string, record: IntentWrite): Promise<void> {
  const columns = {
    intent: record.intent.intent,
    inScope: record.intent.in_scope,
    outOfScope: record.intent.out_of_scope,
    riskAreas: record.intent.risk_areas,
    confidence: record.confidence,
    sources: record.sources,
    headSha: record.headSha,
    sourcesHash: record.sourcesHash,
    provider: record.provider,
    model: record.model,
    costUsd: record.costUsd,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    derivedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values({ prId, ...columns })
    .onConflictDoUpdate({ target: t.prIntent.prId, set: columns });
}

/**
 * The raw row, not a mapped `Intent`: the caller needs `headSha`/`sourcesHash`
 * for the cache check and the whole row for the DTO.
 */
export async function getIntent(db: Db, prId: string): Promise<PrIntentRow | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  return row;
}
