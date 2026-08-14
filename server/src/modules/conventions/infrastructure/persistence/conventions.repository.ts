import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../../../db/client.js';
import * as t from '../../../../db/schema.js';
import type { ConventionRow, ConventionRunRow } from '../../../../db/rows.js';
import type { CompletedRunResult, ConventionsStore } from '../../domain-services/ports.js';
import { ACTIVE_RUN_STATUSES, type ConventionRunStatus } from '../../domain-model/run.js';
import type { ConventionCategoryValue } from '../../domain-model/constants.js';

const ACTIVE_STATUSES: ConventionRunStatus[] = [...ACTIVE_RUN_STATUSES];

/**
 * conventions module data-access. Owns `convention_runs` and `conventions`.
 * Workspace-scoped throughout except the two boot/HTTP-internal helpers that
 * are documented as intentionally not scoped (`getActiveRunForRepo`,
 * `reapActiveRuns`).
 *
 * Implements `ConventionsStore` (the extraction-flow port) directly — this
 * class IS the infrastructure adapter, so no separate wrapper is needed. The
 * hermetic `conventions-extract.test.ts` uses an in-memory fake of the same
 * port instead of this class.
 */

export interface UpdateConventionPatch {
  rule?: string;
  category?: ConventionCategoryValue;
  accepted?: boolean;
}

export class ConventionsRepository implements ConventionsStore {
  constructor(private db: Db) {}

  // ---- runs ------------------------------------------------------------

  async createRun(workspaceId: string, repoId: string): Promise<ConventionRunRow> {
    const [row] = await this.db
      .insert(t.conventionRuns)
      .values({ workspaceId, repoId, status: 'queued' })
      .returning();
    return row!;
  }

  /** Not workspace-scoped — used only for the pre-enqueue concurrency check,
   *  which already knows the repo belongs to the caller's workspace. */
  async getActiveRunForRepo(repoId: string): Promise<ConventionRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionRuns)
      .where(and(eq(t.conventionRuns.repoId, repoId), inArray(t.conventionRuns.status, ACTIVE_STATUSES)));
    return row;
  }

  async getRun(workspaceId: string, runId: string): Promise<ConventionRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionRuns)
      .where(and(eq(t.conventionRuns.workspaceId, workspaceId), eq(t.conventionRuns.id, runId)));
    return row;
  }

  async getLatestRun(workspaceId: string, repoId: string): Promise<ConventionRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionRuns)
      .where(and(eq(t.conventionRuns.workspaceId, workspaceId), eq(t.conventionRuns.repoId, repoId)))
      .orderBy(desc(t.conventionRuns.createdAt))
      .limit(1);
    return row;
  }

  async markRunning(runId: string): Promise<void> {
    await this.db.update(t.conventionRuns).set({ status: 'running' }).where(eq(t.conventionRuns.id, runId));
  }

  /** Persists the terminal `done` state AND inserts the grounded candidates
   *  (accepted:true at insert time) in one transaction. */
  async completeRun(runId: string, result: CompletedRunResult): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(t.conventionRuns)
        .set({
          status: 'done',
          sampleCount: result.sampleCount,
          candidateCount: result.candidates.length,
          droppedCount: result.droppedCount,
          provider: result.provider,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
          error: result.error ?? null,
          finishedAt: new Date(),
        })
        .where(eq(t.conventionRuns.id, runId));

      if (result.candidates.length > 0) {
        await tx.insert(t.conventions).values(
          result.candidates.map((c) => ({
            workspaceId: result.workspaceId,
            repoId: result.repoId,
            runId,
            category: c.category,
            rule: c.rule,
            evidencePath: c.evidencePath,
            evidenceSnippet: c.evidenceSnippet,
            evidenceStartLine: c.evidenceStartLine,
            evidenceEndLine: c.evidenceEndLine,
            confidence: c.confidence,
            accepted: true,
          })),
        );
      }
    });
  }

  async failRun(runId: string, error: string): Promise<void> {
    await this.db
      .update(t.conventionRuns)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(eq(t.conventionRuns.id, runId));
  }

  /** Boot reaper — unconditionally flips every active run (single-instance
   *  assumption, mirrors `ReviewService.reapStaleRuns` at `app.ts:82`). */
  async reapActiveRuns(error: string): Promise<number> {
    const rows = await this.db
      .update(t.conventionRuns)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(inArray(t.conventionRuns.status, ACTIVE_STATUSES))
      .returning({ id: t.conventionRuns.id });
    return rows.length;
  }

  async attachSkill(runId: string, skillId: string, tx?: Db | Tx): Promise<void> {
    const conn = tx ?? this.db;
    await conn.update(t.conventionRuns).set({ skillId }).where(eq(t.conventionRuns.id, runId));
  }

  // ---- candidates --------------------------------------------------------

  async listCandidates(runId: string): Promise<ConventionRow[]> {
    return this.db.select().from(t.conventions).where(eq(t.conventions.runId, runId));
  }

  async getCandidate(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: UpdateConventionPatch,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** `ids` omitted (or empty) = apply to every candidate in the run. */
  async setDecisions(runId: string, accepted: boolean, ids?: string[]): Promise<number> {
    const where =
      ids && ids.length > 0
        ? and(eq(t.conventions.runId, runId), inArray(t.conventions.id, ids))
        : eq(t.conventions.runId, runId);
    const rows = await this.db.update(t.conventions).set({ accepted }).where(where).returning({ id: t.conventions.id });
    return rows.length;
  }

  async acceptedCandidates(runId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.runId, runId), eq(t.conventions.accepted, true)));
  }
}
