/**
 * `get_conventions` — the repo's accepted coding conventions, as markdown.
 *
 * This is a TWO-HOP call: `GET /repos/:id/conventions` gives the extraction run,
 * and `GET /conventions/runs/:id/skill-draft` renders that run's ACCEPTED
 * candidates into the skill body. The draft is what we return, deliberately, and
 * not the `ConventionsView` the first hop already gave us:
 *
 *  - the view is ~3k tokens against the draft's ~800, and
 *  - every `ConventionCandidate` carries an `evidence_snippet`, i.e. raw source
 *    from the repository. Snippets are the injection surface — LLM-adjacent text
 *    from a repo, handed to another agent — and the same reasoning kept them out
 *    of the rendered skill body. The draft has rule sentences and `path:line`
 *    citations only. Do not "enrich" this response with snippets.
 *
 * The first hop is not just a lookup for the run id: three of the four failure
 * branches are ordinary 200s that only the view can distinguish (no run at all,
 * a run still in flight, a run that failed). The fourth is a 409 from the second
 * hop, mapped here — see `isZeroAcceptedConflict`.
 */

import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { ConventionSkillDraft, ConventionsView } from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../api/endpoints.js';
import { CONVENTIONS_MD_MAX, EVIDENCE_FILES_MAX, TOOL_PREFIX } from '../config.js';
import { isToolError, toErrorResult, toolError, truncate } from '../domain/errors.js';
import { resolveRepo } from '../domain/resolve.js';
import { GET_CONVENTIONS_DESCRIPTION, GET_CONVENTIONS_TITLE } from './descriptions.js';
import { ConventionsOutput, GetConventionsInput } from './schemas.js';

/**
 * The "no accepted candidates" 409 from `GET /conventions/runs/:id/skill-draft`
 * (`conventions-service.ts:172`).
 *
 * The mapping deliberately is NOT in the endpoint layer: that layer has neither
 * the repository's name nor the candidate count, and `conventions_none_accepted`
 * is useless without both — "there are 7 of them, go accept some" is the whole
 * point of the message.
 *
 * `client.ts` tags every non-2xx `ToolError` with its HTTP status, so this is a
 * number comparison rather than a match on message wording. The caller wraps
 * ONLY the skill-draft call, so a 409 from any other hop cannot reach here.
 */
function isZeroAcceptedConflict(e: unknown): boolean {
  return isToolError(e) && e.status === 409;
}

/**
 * How many candidates the run produced, for the `conventions_none_accepted`
 * message. `candidate_count` is the run's own tally and survives a view that
 * returns no candidate rows; the array length is the fallback. `null` when both
 * say nothing, because "0 candidates" would contradict a 409 that only happens
 * when candidates exist but none are accepted.
 */
function candidateCount(view: ConventionsView): number | null {
  const fromRun = view.run?.candidate_count ?? 0;
  if (fromRun > 0) return fromRun;
  return view.candidates.length > 0 ? view.candidates.length : null;
}

/** One line for the model to read at a glance. The markdown goes in structured content. */
function digest(result: ConventionsOutput): string {
  const rules = `${result.source_count} convention${result.source_count === 1 ? '' : 's'}`;
  const files = `${result.evidence_files.length} evidence file${
    result.evidence_files.length === 1 ? '' : 's'
  }`;
  const head = `${rules} from ${result.repo} · ${files}`;
  return result.truncated ? `${head} · truncated to fit` : head;
}

/** Resolve → view → branch → draft → project. Throws `ToolError`; the handler converts. */
async function collectConventions(
  endpoints: Endpoints,
  repoArg: string,
  opts: CallOptions,
): Promise<ConventionsOutput> {
  const repo = await resolveRepo(endpoints, repoArg, opts);
  const view = await endpoints.getConventions(repo.id, opts);
  const run = view.run;

  // A repo that was never scanned is a 200 with `run: null`, NOT an HTTP error.
  // Treating it as one would send the caller off to restart the API instead of
  // to the button that fixes it.
  if (run === null) throw toolError('conventions_never_run', repo.fullName);

  switch (run.status) {
    case 'queued':
    case 'running':
      throw toolError('conventions_in_progress', repo.fullName);
    case 'failed':
      throw toolError('conventions_failed', repo.fullName, run.error ?? null);
    case 'done':
      break;
  }

  let draft: ConventionSkillDraft;
  try {
    draft = await endpoints.getSkillDraft(run.id, opts);
  } catch (e) {
    if (isZeroAcceptedConflict(e)) {
      throw toolError('conventions_none_accepted', repo.fullName, candidateCount(view));
    }
    throw e;
  }

  const evidenceFiles = draft.evidence_files.slice(0, EVIDENCE_FILES_MAX);
  const truncated =
    draft.body.length > CONVENTIONS_MD_MAX || draft.evidence_files.length > EVIDENCE_FILES_MAX;

  return {
    repo: repo.fullName,
    run_id: run.id,
    // `finished_at` is nullish in the contract; the output says `null` when
    // unrecorded rather than dropping the key, so the shape never varies.
    extracted_at: run.finished_at ?? null,
    source_count: draft.source_count,
    evidence_files: evidenceFiles,
    conventions_markdown: truncate(draft.body, CONVENTIONS_MD_MAX),
    truncated,
  };
}

/**
 * Registers the tool on `server`. `deps` is an object rather than a bare
 * `Endpoints` so all five registrars are wired identically by `server.ts`.
 */
export function registerGetConventions(server: McpServer, deps: { endpoints: Endpoints }): void {
  server.registerTool(
    `${TOOL_PREFIX}get_conventions`,
    {
      title: GET_CONVENTIONS_TITLE,
      description: GET_CONVENTIONS_DESCRIPTION,
      inputSchema: GetConventionsInput,
      outputSchema: ConventionsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // The DevDigest API is a separate process with its own state — this tool
        // reads the world, it does not compute over its arguments.
        openWorldHint: true,
      },
    },
    async (args, ctx): Promise<CallToolResult> => {
      try {
        // Host cancellation propagates into both hops: a cancelled call must
        // stop making HTTP requests, not finish the sequence into the void.
        const result = await collectConventions(deps.endpoints, args.repo, {
          signal: ctx.mcpReq.signal,
        });
        return {
          content: [{ type: 'text', text: digest(result) }],
          structuredContent: result,
        };
      } catch (e) {
        // The spread is load-bearing: `ToolErrorResult` is an interface, and
        // TypeScript gives implicit index signatures only to anonymous object
        // types, so the interface is not assignable to the SDK's
        // `CallToolResult` (`[x: string]: unknown`). A fresh literal is.
        return { ...toErrorResult(e) };
      }
    },
  );
}
