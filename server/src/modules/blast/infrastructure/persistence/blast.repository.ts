import { eq } from 'drizzle-orm';
import type { Db } from '../../../../db/client.js';
import * as t from '../../../../db/schema.js';
import type { BlastSummaryRow, BlastSummaryStore } from '../../domain-services/ports.js';

/**
 * `pr_blast` read/upsert — the driven adapter behind `BlastSummaryStore`.
 *
 * Only the summary and its provenance live here. The nodes are re-derived from
 * the repo-intel index on every request and deliberately never persisted, so a
 * reindex can never serve a stale impact map (see the table comment in
 * `db/schema/reviews.ts`).
 */
export class BlastRepository implements BlastSummaryStore {
  constructor(private readonly db: Db) {}

  async get(prId: string): Promise<BlastSummaryRow | null> {
    const [row] = await this.db.select().from(t.prBlast).where(eq(t.prBlast.prId, prId));
    if (!row) return null;
    return {
      summary: row.summary,
      headSha: row.headSha,
      factsHash: row.factsHash,
      provider: row.provider,
      model: row.model,
      costUsd: row.costUsd,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      derivedAt: row.derivedAt,
    };
  }

  async upsert(prId: string, row: BlastSummaryRow): Promise<void> {
    const columns = {
      summary: row.summary,
      headSha: row.headSha,
      factsHash: row.factsHash,
      provider: row.provider,
      model: row.model,
      costUsd: row.costUsd,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      derivedAt: row.derivedAt ?? new Date(),
    };
    await this.db
      .insert(t.prBlast)
      .values({ prId, ...columns })
      .onConflictDoUpdate({ target: t.prBlast.prId, set: columns });
  }
}
