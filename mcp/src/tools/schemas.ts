/**
 * Tool input/output schemas — zod **v4** only.
 *
 * `zod4` (npm alias for zod@4) is mandatory here: `@modelcontextprotocol/server@2`
 * requires schemas satisfying `StandardSchemaWithJSON`, i.e. a StandardSchemaV1
 * that also carries `~standard.jsonSchema`. The repo's bare `zod` is 3.25.76,
 * whose `zod/v4` subpath omits `jsonSchema`, so a v3 schema is rejected by
 * `registerTool` with "Property 'jsonSchema' is missing". Never import bare
 * `zod` into this file — that one is for `@devdigest/shared` (v3 source) and the
 * two never mix in one expression.
 *
 * Design rules this file encodes:
 *  - **Flat arguments**: every input is scalars only. No nested objects, no
 *    arrays, no unions — models get those wrong far more often than they get a
 *    string wrong.
 *  - **Concise structured response**: `ReviewResultOutput` keeps 8 of the 17
 *    `FindingRecord` fields; the rest are review-UI state no tool here can act on.
 *  - Every field carries `.describe(...)`. The argument descriptions are approved
 *    verbatim text (they are where the "human PR number, not a database id"
 *    confusion gets headed off) — do not paraphrase them.
 *
 * Enums mirror `@devdigest/shared` (`Severity`, `FindingCategory`, `Verdict`)
 * by hand rather than by import, because those are zod v3 objects.
 */

import * as z from 'zod4';

// ---------------------------------------------------------------------------
// Inputs — flat scalars only
// ---------------------------------------------------------------------------

/**
 * `list_agents` takes NO input, so it has no schema: the SDK supports
 * argument-less tools and its handler signature is `(ctx)`, not `(args, ctx)`.
 */

export const RunAgentOnPrInput = z.object({
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" form, e.g. "acme/payments-api". A bare name works if it is unambiguous.',
    ),
  pr: z
    .number()
    .int()
    .min(1)
    .describe('Pull request number as shown on GitHub, e.g. 482. Not a database id.'),
  agent: z
    .string()
    .describe(
      'Agent NAME from list_agents, e.g. "Security Reviewer". An agent id is also accepted, and is required when two agents share a name.',
    ),
});
export type RunAgentOnPrInput = z.infer<typeof RunAgentOnPrInput>;

export const GetFindingsInput = z.object({
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" form, e.g. "acme/payments-api". A bare name works if it is unambiguous.',
    ),
  pr: z
    .number()
    .int()
    .min(1)
    .describe('Pull request number as shown on GitHub, e.g. 482. Not a database id.'),
  agent: z
    .string()
    .describe(
      'Optional agent NAME from list_agents. Omit to get the most recent review by any agent for this PR.',
    )
    .optional(),
  run_id: z
    .string()
    .describe(
      'Exact run identifier, as returned by run_agent_on_pr when it timed out. Takes precedence over the agent argument.',
    )
    .optional(),
  max_findings: z
    .number()
    .int()
    .min(1)
    .max(100)
    .describe(
      'Maximum findings to return, 1-100. Default 20, ordered CRITICAL -> WARNING -> SUGGESTION.',
    )
    .default(20),
});
export type GetFindingsInput = z.infer<typeof GetFindingsInput>;

export const GetConventionsInput = z.object({
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" form, e.g. "acme/payments-api". A bare name works if it is unambiguous.',
    ),
});
export type GetConventionsInput = z.infer<typeof GetConventionsInput>;

export const GetBlastRadiusInput = z.object({
  repo: z
    .string()
    .describe(
      'Repository in "owner/name" form, e.g. "acme/payments-api". A bare name works if it is unambiguous.',
    ),
  pr: z
    .number()
    .int()
    .min(1)
    .describe('Pull request number as shown on GitHub, e.g. 482. Not a database id.'),
});
export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInput>;

// ---------------------------------------------------------------------------
// Shared value enums (hand-mirrored from @devdigest/shared, which is zod v3)
// ---------------------------------------------------------------------------

export const SeverityEnum = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type SeverityEnum = z.infer<typeof SeverityEnum>;

export const CategoryEnum = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type CategoryEnum = z.infer<typeof CategoryEnum>;

export const VerdictEnum = z.enum(['request_changes', 'approve', 'comment']);
export type VerdictEnum = z.infer<typeof VerdictEnum>;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export const AgentSummaryOutput = z.object({
  name: z
    .string()
    .describe(
      'Human name of the agent. This is exactly the string run_agent_on_pr accepts as its `agent` argument.',
    ),
  description: z.string().describe('What this agent is configured to look for.'),
  provider: z.string().describe('LLM provider backing the agent, e.g. "openai" or "anthropic".'),
  model: z.string().describe('Model the agent runs on, e.g. "gpt-5" or "claude-sonnet-4-5".'),
  enabled: z
    .boolean()
    .describe(
      'Whether the agent is enabled in the DevDigest UI. Disabled agents are listed and still run if you ask for them by name.',
    ),
  id: z
    .string()
    .describe(
      'Stable agent identifier. Pass it as `agent` only when two agents share a name, which makes the name ambiguous.',
    ),
});
export type AgentSummaryOutput = z.infer<typeof AgentSummaryOutput>;

export const AgentsOutput = z.object({
  api_base: z
    .string()
    .describe('Base URL of the DevDigest API these agents were read from, e.g. "http://localhost:3001".'),
  agents: z
    .array(AgentSummaryOutput)
    .describe('Every reviewer agent configured in this workspace, enabled or not.'),
});
export type AgentsOutput = z.infer<typeof AgentsOutput>;

/**
 * One finding, reduced to the 8 fields an agent working in a codebase can act
 * on. Dropped from `FindingRecord`: id, review_id, confidence, kind, scope,
 * trifecta_components, evidence, accepted_at, dismissed_at — no tool here
 * accepts or dismisses a finding, and dropping them keeps the payload small.
 */
export const ConciseFindingOutput = z.object({
  severity: SeverityEnum.describe(
    'CRITICAL = must fix before merge; WARNING = should fix; SUGGESTION = optional improvement.',
  ),
  category: CategoryEnum.describe('What kind of issue this is: bug, security, perf, style or test.'),
  title: z.string().describe('One-line statement of the issue.'),
  file: z.string().describe('Repository-relative path of the file the finding is about.'),
  start_line: z.number().int().describe('First line of the cited range, 1-based.'),
  end_line: z.number().int().describe('Last line of the cited range, 1-based and inclusive.'),
  rationale: z
    .string()
    .describe('Why this is a problem. Markdown, truncated to 400 characters.'),
  suggestion: z
    .string()
    .nullable()
    .describe(
      'How to fix it. Markdown, truncated to 300 characters. Null when the agent proposed no fix.',
    ),
});
export type ConciseFindingOutput = z.infer<typeof ConciseFindingOutput>;

export const SeverityCountsOutput = z.object({
  CRITICAL: z.number().int().describe('Number of CRITICAL findings, counted before truncation.'),
  WARNING: z.number().int().describe('Number of WARNING findings, counted before truncation.'),
  SUGGESTION: z
    .number()
    .int()
    .describe('Number of SUGGESTION findings, counted before truncation.'),
});
export type SeverityCountsOutput = z.infer<typeof SeverityCountsOutput>;

/**
 * The single result shape shared by `run_agent_on_pr` and `get_findings`.
 * `run_id` is the ONLY identifier in the payload; everything else is addressed
 * by meaning (repo full name, PR number, agent name).
 */
export const ReviewResultOutput = z.object({
  status: z
    .enum(['completed', 'still_running', 'failed', 'not_reviewed'])
    .describe(
      'completed = the review finished and findings below are final. still_running = the run is in flight and the 5-minute wait ran out; call get_findings later with the same repo/pr or with run_id, and do NOT start another run. failed = the run ended in an error; read `error`. not_reviewed = no review exists for this PR yet; run run_agent_on_pr.',
    ),
  repo: z.string().describe('Repository the review is about, in "owner/name" form.'),
  pr: z.number().int().describe('Pull request number the review is about.'),
  agent: z
    .string()
    .nullable()
    .describe(
      'Name of the agent that produced this result. Null only when no review exists yet (status "not_reviewed").',
    ),
  run_id: z
    .string()
    .nullable()
    .describe(
      'Identifier of the run. Pass it back to get_findings to address this exact run. Null when no run exists yet.',
    ),
  verdict: VerdictEnum.nullable().describe(
    'The agent\'s overall call: request_changes, approve or comment. Null unless the status is "completed".',
  ),
  score: z
    .number()
    .int()
    .nullable()
    .describe('0-100, higher is better. Null unless the status is "completed".'),
  summary: z
    .string()
    .nullable()
    .describe('Prose summary of the review, truncated to 500 characters. Null when there is none.'),
  counts: SeverityCountsOutput.describe(
    'Findings per severity for the whole review, computed after dismissed findings are excluded but before the max_findings cap.',
  ),
  findings: z
    .array(ConciseFindingOutput)
    .describe(
      'Findings ordered most severe first (CRITICAL, then WARNING, then SUGGESTION), then by file and line. Dismissed findings are excluded. Capped at max_findings.',
    ),
  total_findings: z
    .number()
    .int()
    .describe('How many findings the review actually has, ignoring the cap.'),
  truncated: z
    .boolean()
    .describe('True when total_findings exceeds the cap, so the list above is partial.'),
  error: z
    .string()
    .nullable()
    .describe('Why the run failed, when the status is "failed". Null otherwise.'),
  next_step: z
    .string()
    .nullable()
    .describe(
      'What to do next. Set on every status other than "completed"; null when nothing further is needed.',
    ),
});
export type ReviewResultOutput = z.infer<typeof ReviewResultOutput>;

export const ConventionsOutput = z.object({
  repo: z.string().describe('Repository the conventions were extracted from, in "owner/name" form.'),
  run_id: z.string().describe('Identifier of the extraction run these conventions come from.'),
  extracted_at: z
    .string()
    .nullable()
    .describe('ISO 8601 timestamp of when the extraction run finished. Null when unrecorded.'),
  source_count: z
    .number()
    .int()
    .describe(
      'How many extracted convention rules a human accepted — i.e. how many rules the markdown contains. See evidence_files for the files they were learned from.',
    ),
  evidence_files: z
    .array(z.string())
    .describe(
      'Repository-relative paths the rules were learned from, capped at 20. Read these when you need to see a rule applied in place.',
    ),
  conventions_markdown: z
    .string()
    .describe(
      'The accepted rule set as markdown: rule sentences with `path:line` citations, never source snippets. Capped at 20000 characters.',
    ),
  truncated: z
    .boolean()
    .describe('True when the markdown or the evidence file list was cut to fit the cap.'),
});
export type ConventionsOutput = z.infer<typeof ConventionsOutput>;

// ---- get_blast_radius ------------------------------------------------------
//
// Hand-mirrored from the v3 `PrBlastRecord` in `@devdigest/shared`, the same way
// `ReviewResultOutput` mirrors `FindingRecord`. The two zods never meet in one
// expression, so drift is caught by `endpoints.getBlastRadius`'s v3 `validate()`
// on the way in, not by structural typing here.
//
// PROJECTED, not passed through: the wire record carries LLM provenance
// (`provider`, `model`, `cost_usd`, `tokens_in`, `tokens_out`, `derived_at`,
// `head_sha`, `pr_id`) that no calling model can act on. Dropping it keeps the
// payload near the `get_findings` budget on a realistic PR.

export const BlastCallerOutput = z.object({
  name: z
    .string()
    .describe('Enclosing symbol at the call site, e.g. "handleRequest". Falls back to the file name.'),
  file: z.string().describe('Repository-relative path of the calling file.'),
  line: z.number().int().describe('1-based line of the reference. Pair with file as "file:line".'),
});

export const BlastSymbolOutput = z.object({
  symbol: z.string().describe('Name of the changed symbol, e.g. "rateLimit".'),
  kind: z.string().describe('Symbol kind: function, class, method, interface, type or enum.'),
  file: z.string().describe('Repository-relative path the symbol is DECLARED in.'),
  line: z.number().int().describe('1-based declaration line. 0 when the index did not record one.'),
  callers: z
    .array(BlastCallerOutput)
    .describe(
      'Cross-file callers, highest file-rank first, capped at 5 per symbol to stay within a token budget. Read caller_count for the true total — the DevDigest UI lists more. Excludes the declaring file itself.',
    ),
  caller_count: z
    .number()
    .int()
    .describe('Total callers found BEFORE the 20 cap. Compare against callers.length to see what was dropped.'),
  truncated: z.boolean().describe('True when caller_count exceeds the callers listed here.'),
  endpoints_affected: z
    .array(z.string())
    .describe(
      'HTTP endpoints as "METHOD /path", reachable from this symbol within two levels of the reverse import graph. Attribution is file-level, so treat these as POTENTIALLY touched, not certainly.',
    ),
  crons_affected: z
    .array(z.string())
    .describe('Cron expressions or "job:<kind>" identifiers reachable from this symbol, same two-level rule.'),
});

export const BlastIndexOutput = z.object({
  state: z
    .enum(['full', 'partial', 'unavailable'])
    .describe(
      'How much of this PR the code index could see. "partial" means the map below is real but incomplete — read explanation and files_not_covered before drawing a conclusion.',
    ),
  explanation: z
    .string()
    .describe('Why coverage is not full, in prose. Empty only when state is "full".'),
  files_not_covered: z
    .array(z.string())
    .describe(
      'Changed files the index could NOT see — unsupported language, unindexed, or skipped. Symbols in these files are absent from the map entirely.',
    ),
});

export const BlastRadiusOutput = z.object({
  repo: z.string().describe('Repository in "owner/name" form.'),
  pr: z.number().int().describe('Pull request number.'),
  summary: z
    .string()
    .nullable()
    .describe(
      'A 1-2 sentence plain-English impact summary, or null when it has not been derived. Written from the nodes below and nothing else — it never contributes a node.',
    ),
  index: BlastIndexOutput.describe('Index coverage for this PR. Always present; never assume "full".'),
  totals: z
    .object({
      symbols: z.number().int(),
      callers: z.number().int(),
      endpoints: z.number().int(),
      crons: z.number().int(),
    })
    .describe('Counts across the whole map, before the per-symbol caller cap.'),
  changed_symbols: z
    .array(BlastSymbolOutput)
    .describe(
      'Symbols declared in the PR\'s changed files, each with who calls it and what sits downstream. Every entry is read from the index — none is inferred.',
    ),
  truncated: z
    .boolean()
    .describe('True when the symbol list itself was cut to fit the response budget.'),
});
export type BlastRadiusOutput = z.infer<typeof BlastRadiusOutput>;
