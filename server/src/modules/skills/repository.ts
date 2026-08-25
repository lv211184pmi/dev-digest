import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ProjectContextAttachment, SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { isSkillConfigChange } from './helpers.js';

/**
 * skills module data-access. Owns `skills` and `skill_versions`. The
 * `agent_skills` link table is owned by A2's `AgentsRepository` (the agent
 * side: link/reorder/list for an agent) — this repository only reads the
 * reverse direction (which agents use a given skill) for the Stats tab.
 * Workspace-scoped throughout.
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  changeSummary?: string;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill (scoped to workspace). Versions/agent-links cascade. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /**
   * Insert a skill AND record version 1 in skill_versions (immutable snapshot).
   * `tx` lets a caller (e.g. the conventions module's skill-creation use case)
   * compose this into its own `db.transaction(...)` unit of work; falls back
   * to the plain connection when absent.
   */
  async insert(values: InsertSkill, tx?: Db | Tx): Promise<SkillRow> {
    const conn = tx ?? this.db;
    const [row] = await conn
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION, null, tx);
    return row!;
  }

  /**
   * Update a skill. Any config change (name/description/type/body — anything
   * but `enabled`) bumps the version and snapshots the new body into
   * skill_versions, optionally tagged with a `changeSummary` note.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const configChanged = isSkillConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (configChanged && row) {
      await this.snapshotVersion(row, nextVersion, patch.changeSummary ?? null);
    }
    return row;
  }

  private async snapshotVersion(
    row: SkillRow,
    version: number,
    changeSummary: string | null,
    tx?: Db | Tx,
  ): Promise<void> {
    const conn = tx ?? this.db;
    await conn
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body, changeSummary })
      .onConflictDoNothing();
  }

  // ---- skill_versions (immutable body snapshots) ---------------------------

  /** All snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * Restore an old version's `body` as a NEW current version — a
   * non-destructive revert (history is never rewritten). Body-only, by
   * design (D22): a version snapshot never carried attachments, so a
   * restore leaves the skill's current attachment set exactly as it was
   * (AC 54) — there is nothing to revert there.
   *
   * The skill's `body`/`version` update and the version-snapshot insert stay
   * inside ONE `db.transaction()` — a crash or connection drop between them
   * used to be able to commit the body change while leaving
   * `version`/`skill_versions` un-bumped, silently desyncing the snapshot
   * history from the live row (2026-08-24 fix; kept here on purpose).
   */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const target = await this.getVersion(skillId, version);
    if (!target) return undefined;
    const current = await this.getById(workspaceId, skillId);
    if (!current) return undefined;

    const versionChanges = target.body !== current.body;
    const nextVersion = versionChanges ? current.version + 1 : current.version;

    let result: SkillRow | undefined;
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(t.skills)
        .set({ body: target.body, ...(versionChanges ? { version: nextVersion } : {}) })
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
        .returning();

      result = row;

      if (versionChanges && row) {
        await this.snapshotVersion(row, nextVersion, `Restored from v${version}`, tx);
      }
    });
    return result;
  }

  // ---- reverse of agent_skills (Stats tab: "used by N agents") -------------

  /** Agents that have this skill linked (any order), name-sorted for display. */
  async agentsForSkill(skillId: string): Promise<{ id: string; name: string }[]> {
    return this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId));
  }

  // ---- skill_context_docs (Project Context attachments) --------------------

  /** A skill's attached documents for ONE repo, in injection order. */
  async contextDocs(skillId: string, repoId: string): Promise<ProjectContextAttachment[]> {
    const rows = await this.db
      .select({ path: t.skillContextDocs.path, order: t.skillContextDocs.order })
      .from(t.skillContextDocs)
      .where(and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)))
      .orderBy(asc(t.skillContextDocs.order));
    return rows;
  }

  /**
   * Replace the skill's attached documents for ONE repo with `paths`, in that
   * order. Other repos' attachments are untouched. This is the whole
   * operation (D22): attachment changes are mutable metadata, persisted per
   * discrete user action, independent of the skill's version — no version
   * bump, no `skill_versions` row, even when `paths = []` (AC 53) — mirrors
   * `AgentsRepository.setContextDocs`.
   *
   * The delete+insert is still two writes in one logical save, so it stays
   * inside one `db.transaction()`.
   */
  async setContextDocs(
    workspaceId: string,
    skillId: string,
    repoId: string,
    paths: string[],
  ): Promise<ProjectContextAttachment[]> {
    const existing = await this.getById(workspaceId, skillId);
    if (!existing) return [];

    const deduped = dedupePreserveOrder(paths);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillContextDocs)
        .where(and(eq(t.skillContextDocs.skillId, skillId), eq(t.skillContextDocs.repoId, repoId)));
      if (deduped.length > 0) {
        await tx
          .insert(t.skillContextDocs)
          .values(deduped.map((path, i) => ({ skillId, repoId, path, order: i })));
      }
    });

    return this.contextDocs(skillId, repoId);
  }

  /**
   * For every ENABLED skill linked to `agentId`, its attachment rows —
   * `{skillId, skillName, repoId, path, order}` — ordered by
   * `(agentSkills.order, skillContextDocs.order)`. This is the read the
   * resolver needs to inherit a skill's documents after the agent's own
   * (R9). Deliberately NOT filtered by `repoId`: the resolver must be able
   * to see and record a cross-repo row as `skipped_other_repo` (R19) —
   * filtering here would make that status unreachable.
   */
  async contextDocsForAgent(
    agentId: string,
  ): Promise<Array<{ skillId: string; skillName: string; repoId: string; path: string; order: number }>> {
    const rows = await this.db
      .select({
        skillId: t.skills.id,
        skillName: t.skills.name,
        repoId: t.skillContextDocs.repoId,
        path: t.skillContextDocs.path,
        order: t.skillContextDocs.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(t.skillContextDocs, eq(t.skillContextDocs.skillId, t.skills.id))
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
      .orderBy(asc(t.agentSkills.order), asc(t.skillContextDocs.order));
    return rows;
  }
}

/** Dedupe `paths` preserving first occurrence — a client sending a duplicate
 *  path must not violate the (skillId, repoId, path) primary key. */
function dedupePreserveOrder(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
