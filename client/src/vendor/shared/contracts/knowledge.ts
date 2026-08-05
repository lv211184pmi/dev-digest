import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

// The immutable snapshot captured in `skill_versions` whenever a skill's body
// or metadata changes. `change_summary` is an optional short "what changed"
// note the user can attach when saving (shown in the Versions tab).
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  change_summary: z.string().nullish(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error_handling',
  'testing',
  'typing',
  'imports',
  'logging',
  'api_design',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionRunStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type ConventionRunStatus = z.infer<typeof ConventionRunStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  run_id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  evidence_start_line: z.number().int().nullish(),
  evidence_end_line: z.number().int().nullish(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionRun = z.object({
  id: z.string(),
  repo_id: z.string(),
  status: ConventionRunStatus,
  sample_count: z.number().int(),
  candidate_count: z.number().int(),
  dropped_count: z.number().int(),
  provider: z.string().nullish(),
  model: z.string().nullish(),
  tokens_in: z.number().int().nullish(),
  tokens_out: z.number().int().nullish(),
  cost_usd: z.number().nullish(),
  skill_id: z.string().nullish(),
  error: z.string().nullish(),
  created_at: z.string(),
  finished_at: z.string().nullish(),
});
export type ConventionRun = z.infer<typeof ConventionRun>;

/** GET /repos/:id/conventions — `run` is null before the first-ever scan. */
export const ConventionsView = z.object({
  run: ConventionRun.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsView = z.infer<typeof ConventionsView>;

export const ExtractConventionsAccepted = z.object({
  status: z.literal('accepted'),
  run_id: z.string(),
  job_id: z.string().nullable(),
});
export type ExtractConventionsAccepted = z.infer<typeof ExtractConventionsAccepted>;

export const UpdateConventionBody = z.object({
  rule: z.string().min(1).optional(),
  category: ConventionCategory.optional(),
  accepted: z.boolean().optional(),
});
export type UpdateConventionBody = z.infer<typeof UpdateConventionBody>;

/** `ids` omitted = apply `accepted` to every candidate in the run. */
export const ConventionDecisionsBody = z.object({
  accepted: z.boolean(),
  ids: z.array(z.string()).optional(),
});
export type ConventionDecisionsBody = z.infer<typeof ConventionDecisionsBody>;

export const ConventionDecisionsResult = z.object({
  updated: z.number().int(),
});
export type ConventionDecisionsResult = z.infer<typeof ConventionDecisionsResult>;

// The server-rendered markdown draft for a run's accepted candidates —
// GET returns this; the client edits it locally and POSTs the (possibly
// edited) fields back via CreateConventionSkillBody.
export const ConventionSkillDraft = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string(),
  evidence_files: z.array(z.string()),
  source_count: z.number().int(),
  repo_name: z.string(),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

export const CreateConventionSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string().min(1),
});
export type CreateConventionSkillBody = z.infer<typeof CreateConventionSkillBody>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;
