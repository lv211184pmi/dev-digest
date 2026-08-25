/**
 * The error catalogue — design principle #4, "errors lead forward".
 *
 * Every failure this server can produce is one of the 18 codes below, and every
 * message states the cause AND the concrete next action the calling agent should
 * take. A message that only says what went wrong is a bug: the model on the far
 * side has no other channel to learn what to do about it.
 *
 * SECURITY: messages are composed from THIS catalogue. The only text we ever
 * echo from the API is a 300-char truncated `ApiErrorBody.error.message`. The
 * envelope's third field (the free-form diagnostic payload) is never
 * interpolated — it can carry raw provider output, i.e. LLM-authored text about
 * untrusted diff content, on its way into another agent's context. Same
 * reasoning that kept code snippets out of the conventions skill body.
 */

export type ErrorCode =
  | 'api_unreachable'
  | 'repo_not_found'
  | 'repo_ambiguous'
  | 'pr_not_found'
  | 'pr_not_imported'
  | 'agent_not_found'
  | 'agent_ambiguous'
  | 'run_not_started'
  | 'run_rate_limited'
  | 'run_failed'
  | 'not_reviewed'
  | 'conventions_never_run'
  | 'conventions_in_progress'
  | 'conventions_failed'
  | 'conventions_none_accepted'
  | 'blast_index_unavailable'
  | 'blast_no_changed_files'
  | 'api_error'
  | 'contract_mismatch';

/** A failure with a catalogued, leads-forward message. Never carries a cause chain. */
export class ToolError extends Error {
  readonly code: ErrorCode;

  /**
   * The HTTP status this came from, when it came from the API at all.
   *
   * Carried so a tool can branch on a specific status without matching on
   * message text — the skill-draft 409 in `get-conventions.ts` needs the
   * repo name and candidate count, which the endpoint layer does not have,
   * so the decision has to be made up here.
   */
  readonly status?: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.status = status;
  }
}

/** Same error, tagged with the HTTP status it arrived on. */
export function withStatus(e: ToolError, status: number): ToolError {
  return new ToolError(e.code, e.message, status);
}

/** Narrowing helper — `instanceof` is unreliable only across realms, not here. */
export function isToolError(e: unknown): e is ToolError {
  return e instanceof ToolError;
}

/**
 * Truncates to `n` characters, marking the cut so a downstream model does not
 * mistake a clipped sentence for the whole story.
 */
export function truncate(s: string, n: number): string {
  if (n <= 0) return '… (truncated)';
  return s.length <= n ? s : `${s.slice(0, n)}… (truncated)`;
}

/** An agent whose name collides with another's. */
export interface AgentChoice {
  name: string;
  model: string;
  id: string;
}

function list(items: readonly string[], empty: string): string {
  return items.length === 0 ? empty : items.join(', ');
}

/**
 * One builder per code. The `satisfies` clause is the completeness check: adding
 * a code to `ErrorCode` without a builder here is a compile error.
 */
export const errorMessages = {
  api_unreachable: (base: string) =>
    `Cannot reach the DevDigest API at ${base}. Start it with \`./scripts/dev.sh\`, then call this tool again. Set DEVDIGEST_API_BASE if the API runs on another port.`,

  repo_not_found: (input: string, available: readonly string[]) =>
    `No repository matches '${input}'. Imported repositories: ${list(available, 'none yet')}. Pass one of those names — or import the repo in the DevDigest UI (Repos → Add repository) and call this tool again.`,

  repo_ambiguous: (input: string, matches: readonly string[]) =>
    `'${input}' matches ${matches.length} repositories: ${list(matches, 'none')}. Pass the full "owner/name" form instead, then call this tool again.`,

  pr_not_found: (pr: number, repo: string, imported: readonly number[]) =>
    `PR #${pr} is not imported for ${repo}. Imported PR numbers include: ${list(
      imported.map(String),
      'none yet',
    )}. Open the pull request once in the DevDigest UI to import it, then call this tool again.`,

  pr_not_imported: (pr: number, repo: string) =>
    `PR #${pr} in ${repo} is visible on GitHub but has not been imported into DevDigest, so it has no id to review against. Open it once in the DevDigest UI (Repos → ${repo} → #${pr}) to import it, then call this tool again.`,

  agent_not_found: (input: string) =>
    `No agent named '${input}'. Call list_agents — the \`name\` values it returns are exactly what this argument accepts.`,

  agent_ambiguous: (input: string, matches: readonly AgentChoice[]) =>
    `${matches.length} agents are named '${input}': ${list(
      matches.map((m) => `${m.name} — ${m.model} — ${m.id}`),
      'none',
    )}. Pass the id of the one you want as \`agent\`.`,

  run_not_started: (agent: string, pr: number) =>
    `DevDigest accepted the request but started no run for '${agent}' on PR #${pr}. Call list_agents to confirm the agent name, then call run_agent_on_pr again.`,

  run_rate_limited: () =>
    `DevDigest rate-limits review runs to 10 per minute and that limit is hit. Wait a minute and call run_agent_on_pr again — or call get_findings now if a run for this PR is already in flight.`,

  run_failed: (error: string | null, runId: string) =>
    `The review run failed: ${error ?? 'the API recorded no error text'}. Most common causes: a missing LLM API key (open DevDigest → Settings and add one), or the API restarting mid-run. Fix that, then call run_agent_on_pr again. run_id: ${runId}`,

  not_reviewed: (repo: string, pr: number, agent?: string) =>
    `PR #${pr} in ${repo} has no review${agent ? ` by '${agent}'` : ''} yet. Call run_agent_on_pr with the same repo and PR to produce one, then read the result here.`,

  conventions_never_run: (repo: string) =>
    `No conventions have been extracted for ${repo} yet. Open DevDigest → Conventions, run the extractor, accept the rules that apply, then call get_conventions again.`,

  conventions_in_progress: (repo: string) =>
    `Convention extraction for ${repo} is still running. Wait about a minute and call get_conventions again — nothing needs doing in the UI meanwhile.`,

  conventions_failed: (repo: string, error: string | null) =>
    `Convention extraction for ${repo} failed: ${error ?? 'the API recorded no error text'}. Open DevDigest → Conventions and run the extractor again, then call get_conventions once it finishes.`,

  conventions_none_accepted: (repo: string, candidateCount: number | null) =>
    `${repo} has ${
      candidateCount === null ? 'extracted convention candidates' : `${candidateCount} extracted convention candidates`
    } but none are accepted, so there is no rule set to return. Open DevDigest → Conventions, accept the rules that apply, then call get_conventions again.`,

  /**
   * The index could tell us NOTHING about this PR, so there is no map to return.
   *
   * This is an error rather than an empty success on purpose, and it is the MCP
   * half of the feature's central invariant: an empty `downstream` array reads
   * to a model as "this change is safe to merge", which is the single most
   * expensive wrong answer this tool could give. A partially-covered index is
   * NOT routed here — that returns a normal result carrying its own
   * `index.explanation`, because a partial answer is still an answer.
   */
  /**
   * Split from `blast_index_unavailable` because the next step is different.
   *
   * The index may be perfectly healthy — what is missing is the PR's file list,
   * which DevDigest imports on first open. Telling this caller to "Re-analyze
   * the repository" sends them to rebuild something that is not broken, and
   * leaves the actual fix undiscovered.
   */
  blast_no_changed_files: (repo: string, pr: number) =>
    `DevDigest has not imported the changed files for ${repo}#${pr}, so there is nothing to trace impact from. This is NOT "the PR changes nothing" — the file list simply has not been fetched yet. Open the pull request once in DevDigest (or call get_findings for it) to import its files, then call get_blast_radius again.`,

  blast_index_unavailable: (repo: string, pr: number, explanation: string) =>
    `DevDigest has no usable code index for ${repo}#${pr}, so its blast radius cannot be computed: ${explanation} This is NOT the same as "nothing is affected" — do not treat it as an all-clear. Open DevDigest → the repository → Re-analyze to build the index, wait for the Indexed badge, then call get_blast_radius again.`,

  /**
   * Generic non-2xx fallback. `message` is already truncated by the caller and is
   * the ONLY API-authored text in the catalogue.
   */
  api_error: (status: number, path: string, message?: string) => {
    const head = `DevDigest's API returned ${status} for ${path}${message ? `: ${message}` : ''}.`;
    if (status === 429) {
      return `${head} That is the API's global rate limit. Wait a minute, then call this tool again.`;
    }
    if (status === 404) {
      return `${head} Confirm the repository and pull request exist in the DevDigest UI, then call this tool again.`;
    }
    if (status === 422) {
      return `${head} Re-check the arguments you passed — a repo is "owner/name", a PR is its GitHub number — then call this tool again.`;
    }
    if (status >= 500) {
      return `${head} Check the DevDigest API's terminal output for the stack trace, restart it with \`./scripts/dev.sh\`, then call this tool again.`;
    }
    return `${head} Check the DevDigest API's terminal output, then call this tool again.`;
  },

  contract_mismatch: (schema: string, issue: string) =>
    `DevDigest's response did not match the expected ${schema} — the API and this MCP server are out of sync. Restart the API after \`git pull\` (\`./scripts/dev.sh\`), then call this tool again. First issue: ${issue}.`,
} satisfies Record<ErrorCode, (...args: never[]) => string>;

/** Last-resort text for a throw that is not a ToolError. Also leads forward. */
export const UNEXPECTED_MESSAGE =
  'The DevDigest MCP server hit an unexpected internal failure. Check the MCP server\'s stderr output in your host, then call this tool again.';

/**
 * Builds a `ToolError` for `code` with that code's builder arguments — the only
 * supported way to construct one, so no ad-hoc message can bypass the catalogue.
 */
export function toolError<K extends ErrorCode>(
  code: K,
  ...args: Parameters<(typeof errorMessages)[K]>
): ToolError {
  const build = errorMessages[code] as (...a: unknown[]) => string;
  return new ToolError(code, build(...(args as unknown[])));
}

/** The MCP tool-result shape for a failure. `isError` skips output validation. */
export interface ToolErrorResult {
  content: [{ type: 'text'; text: string }];
  isError: true;
}

/**
 * Converts anything thrown inside a tool handler into an MCP error result.
 * Non-`ToolError` throws are replaced wholesale — a stack trace or an adapter's
 * raw message is never handed to the calling model.
 */
export function toErrorResult(e: unknown): ToolErrorResult {
  const text = isToolError(e) ? e.message : UNEXPECTED_MESSAGE;
  return { content: [{ type: 'text', text }], isError: true };
}
