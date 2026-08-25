import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import type { IntentSource } from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // The PR list rolls up score + findings for every PR on the page through
    // reviews.pr_id on each load, so this is a hot read path, not a rare one.
    prIdx: index('reviews_pr_id_idx').on(t.prId),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    /**
     * Whether the finding falls inside the PR's derived intent. Nullable: null
     * means no intent was available when the review ran, which is different
     * from "the model judged it in scope".
     */
    scope: text('scope', { enum: ['in_scope', 'out_of_scope'] }),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // Every findings read joins back to its review — the PR list rollup, the
    // detail page, and the cascade on review delete all go through this key.
    reviewIdx: index('findings_review_id_idx').on(t.reviewId),
  }),
);

/**
 * One derived intent per PR. No extra index: the PK is `pr_id` and every read
 * is by that key.
 *
 * `head_sha` + `sources_hash` together form the cache key — a re-run against an
 * unchanged head with unchanged source material skips the LLM call entirely.
 * `confidence` is derived server-side from `sources`, never emitted by the
 * model.
 */
export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  riskAreas: jsonb('risk_areas').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] })
    .notNull()
    .default('low'),
  sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
  headSha: text('head_sha'),
  sourcesHash: text('sources_hash'),
  provider: text('provider'),
  model: text('model'),
  costUsd: doublePrecision('cost_usd'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  derivedAt: timestamp('derived_at', { withTimezone: true }).defaultNow(),
});

/**
 * The cached one-sentence blast-radius summary for a PR, and nothing else.
 *
 * `head_sha` + `facts_hash` together form the cache key: the summary is reused
 * only when the PR head is unchanged AND the computed node set hashes the same,
 * so a reindex that moves the nodes invalidates the sentence describing them.
 *
 * The nodes themselves (changed symbols, callers, endpoints, crons) are
 * DELIBERATELY NOT PERSISTED — they are re-derived from the repo-intel index on
 * every request. Caching them would let a reindex serve a stale impact map,
 * which is the one failure this feature exists to prevent.
 *
 * Shaped exactly like `pr_intent` above: PK is `pr_id` itself, no surrogate id
 * and no extra index (every read is by that key), cache-key columns nullable.
 */
export const prBlast = pgTable('pr_blast', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  headSha: text('head_sha'),
  factsHash: text('facts_hash'),
  provider: text('provider'),
  model: text('model'),
  costUsd: doublePrecision('cost_usd'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  derivedAt: timestamp('derived_at', { withTimezone: true }).defaultNow(),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
