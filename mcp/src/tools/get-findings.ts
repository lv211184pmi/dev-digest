/**
 * `get_findings` — read a review that has ALREADY run. No LLM call, no cost.
 *
 * It is the cheap half of the pair: `run_agent_on_pr` spends money and blocks,
 * this one reads what is already stored. It exists so the two expensive
 * situations have a free answer — a run that outlived the 5-minute wait, and a
 * PR someone already reviewed.
 *
 * Addressing is by meaning: repo full name and PR number, optionally narrowed
 * to one agent. `run_id` is the precise override, and it wins over `agent` when
 * both are given, exactly as the approved description promises.
 *
 * The agent argument is deliberately NOT resolved through `resolveAgent`: here
 * it is a filter over reviews that already exist, not a reviewer to run. An
 * agent that was deleted after producing a review still names that review, and
 * resolving would turn a readable result into `agent_not_found`.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { Endpoints } from '../api/endpoints.js';
import { TOOL_PREFIX } from '../config.js';
import { toErrorResult, toolError } from '../domain/errors.js';
import { formatReviewDigest, projectReview } from '../domain/project.js';
import { resolvePr, resolveRepo } from '../domain/resolve.js';
import { GET_FINDINGS_DESCRIPTION, GET_FINDINGS_TITLE } from './descriptions.js';
import { GetFindingsInput, ReviewResultOutput } from './schemas.js';

/** Deps are structural on purpose: the assembly step just passes `{ endpoints }`. */
export interface GetFindingsDeps {
  endpoints: Endpoints;
}

export function registerGetFindings(server: McpServer, deps: GetFindingsDeps): void {
  server.registerTool(
    `${TOOL_PREFIX}get_findings`,
    {
      title: GET_FINDINGS_TITLE,
      description: GET_FINDINGS_DESCRIPTION,
      inputSchema: GetFindingsInput,
      outputSchema: ReviewResultOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // Reads a live workspace: the same arguments answer differently once a
        // new run finishes.
        openWorldHint: true,
      },
    },
    async (args, ctx) => {
      // One signal for the whole sequence — three calls happen below, and a
      // cancelled request must not leave the last two in flight.
      const call = { signal: ctx.mcpReq.signal };

      try {
        const repo = await resolveRepo(deps.endpoints, args.repo, call);
        const pr = await resolvePr(deps.endpoints, repo, args.pr, call);
        const reviews = await deps.endpoints.listReviews(pr.id, call);

        // `run_id` beats `agent`; `projectReview` encodes that precedence and
        // the "newest review, preferring kind === 'review'" rule with it.
        const runId = args.run_id ?? null;
        const agentName = runId === null ? (args.agent ?? null) : null;

        const projection = projectReview(reviews, { runId, agentName }, args.max_findings);

        // Nothing matched. This is the ONE branch that leaves as an error
        // rather than a payload: a caller who asked for findings and got a
        // valid-looking result with every field null would read the zeros as
        // "clean PR". The catalogued message names the next call instead.
        if (projection.status === 'not_reviewed') {
          throw toolError(
            'not_reviewed',
            repo.fullName,
            pr.number,
            // Only when the caller narrowed by agent — with a `run_id` there is
            // no agent to name, and inventing one would misreport why the
            // lookup came back empty.
            agentName ?? undefined,
          );
        }

        // The annotation is the check that `project.ts`'s hand-written
        // `ReviewResult` and the zod4 `ReviewResultOutput` have not drifted
        // apart: they are declared in different files, in different zod major
        // versions, and only this assignment makes a divergence a build error.
        const structuredContent: ReviewResultOutput = {
          repo: repo.fullName,
          pr: pr.number,
          ...projection,
        };

        return {
          content: [{ type: 'text', text: formatReviewDigest(projection) }],
          structuredContent,
        };
      } catch (e) {
        // Spread, not a bare return — see `list-agents.ts`: `ToolErrorResult`
        // is an `interface`, and only anonymous object types get TypeScript's
        // implicit index signature, which the SDK's `CallToolResult` requires.
        return { ...toErrorResult(e) };
      }
    },
  );
}
