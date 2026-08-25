import { pgTable, uuid, text, integer, boolean, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';
import { skills } from './skills';
import { repos } from './repos';

// ============================================================ Agents & skills

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  provider: text('provider', { enum: ['openai', 'anthropic', 'openrouter'] }).notNull(),
  model: text('model').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  outputSchema: jsonb('output_schema'),
  // Review execution strategy — whole diff in one call (default) vs per-file.
  strategy: text('strategy', { enum: ['single-pass', 'map-reduce', 'auto'] })
    .notNull()
    .default('single-pass'),
  // CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
  // check) vs just comment. Deterministic from finding severities.
  ciFailOn: text('ci_fail_on', { enum: ['never', 'critical', 'warning', 'any'] })
    .notNull()
    .default('critical'),
  // Whether this agent's reviews get repo-intel context (repo skeleton + callers
  // + file-rank note) injected into the prompt. Default on; the global
  // REPO_INTEL_ENABLED flag is the second gate (facade degrades when off).
  repoIntel: boolean('repo_intel').notNull().default(true),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: now(),
});

export const agentVersions = pgTable(
  'agent_versions',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    configJson: jsonb('config_json').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.version] }) }),
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    order: integer('order').notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.agentId, t.skillId] }) }),
);

/**
 * Project Context — repo-scoped `.md` documents an agent attaches so their
 * text is injected into the prompt. Modelled exactly on `agentSkills` above:
 * composite PK, an `order` column for injection order, cascade on both FKs.
 * Scoped by `repoId` in addition to `agentId` because agents are
 * workspace-scoped while documents live in one repo's clone — an agent can
 * attach documents from more than one repo.
 */
export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.repoId, t.path] }),
    // AC 6's usage-count query filters by (repo, path) across all agents —
    // without this index that query is a sequential scan of the table.
    repoPathIdx: index('agent_context_docs_repo_path_idx').on(t.repoId, t.path),
  }),
);
