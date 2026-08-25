import { and, countDistinct, eq, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../../../../db/client.js';
import * as t from '../../../../db/schema.js';
import type { ProjectContextRepository } from '../../domain-services/ports.js';

/**
 * `ProjectContextRepository` — the usage-count query (R6). Attachment
 * reads/writes stay on `AgentsRepository`/`SkillsRepository` (Phase 2); this
 * repository owns only the cross-cutting query neither of those tables can
 * answer alone.
 */
export class ProjectContextDbRepository implements ProjectContextRepository {
  constructor(private readonly db: Db) {}

  /**
   * Distinct `agents.id` in `workspaceId`, `agents.enabled = true`, where
   * EITHER (a) an `agent_context_docs` row exists for `(agent, repoId, path)`
   * OR (b) the agent links an ENABLED skill carrying that same
   * `(repoId, path)` through `skill_context_docs`. `countDistinct` is what
   * makes an agent holding the document BOTH ways count once (R6's dedup
   * boundary) — expressed as one statement, not two counts summed.
   *
   * A disabled skill never contributes: the join onto `skills` carries
   * `skills.enabled = true` IN THE JOIN CONDITION (not `WHERE`), so a
   * disabled skill's row is simply absent from the joined set rather than
   * filtered out after matching — the subsequent `skill_context_docs` join
   * then has nothing to match against for that agent/skill pair.
   */
  async agentsUsing(workspaceId: string, repoId: string, path: string): Promise<number> {
    const [row] = await this.db
      .select({ count: countDistinct(t.agents.id) })
      .from(t.agents)
      .leftJoin(
        t.agentContextDocs,
        and(
          eq(t.agentContextDocs.agentId, t.agents.id),
          eq(t.agentContextDocs.repoId, repoId),
          eq(t.agentContextDocs.path, path),
        ),
      )
      .leftJoin(t.agentSkills, eq(t.agentSkills.agentId, t.agents.id))
      .leftJoin(t.skills, and(eq(t.skills.id, t.agentSkills.skillId), eq(t.skills.enabled, true)))
      .leftJoin(
        t.skillContextDocs,
        and(
          eq(t.skillContextDocs.skillId, t.skills.id),
          eq(t.skillContextDocs.repoId, repoId),
          eq(t.skillContextDocs.path, path),
        ),
      )
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agents.enabled, true),
          or(isNotNull(t.agentContextDocs.path), isNotNull(t.skillContextDocs.path)),
        ),
      );
    return row?.count ?? 0;
  }
}
