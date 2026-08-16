/**
 * `list_agents` — the entry point of every other tool.
 *
 * It answers one question: which strings does `run_agent_on_pr`'s `agent`
 * argument accept? That is why the payload leads with `name` and why `id` is
 * documented as the tie-break rather than the primary handle — `agents.name`
 * carries no unique constraint, so the id is the only thing that disambiguates
 * a collision, and nothing else.
 *
 * Registration is a function taking `server` and its dependencies rather than a
 * module-level side effect, so the server assembly step owns wiring and a test
 * can drive the handler against a stubbed `Endpoints` with no HTTP at all.
 */

import type { McpServer } from '@modelcontextprotocol/server';
import type { Agent } from '@devdigest/shared';
import type { Endpoints } from '../api/endpoints.js';
import { API_BASE, TOOL_PREFIX } from '../config.js';
import { toErrorResult } from '../domain/errors.js';
import { LIST_AGENTS_DESCRIPTION, LIST_AGENTS_TITLE } from './descriptions.js';
import { AgentsOutput, type AgentSummaryOutput } from './schemas.js';

/** Deps are structural on purpose: the assembly step just passes `{ endpoints }`. */
export interface ListAgentsDeps {
  endpoints: Endpoints;
}

export function registerListAgents(server: McpServer, deps: ListAgentsDeps): void {
  server.registerTool(
    `${TOOL_PREFIX}list_agents`,
    {
      title: LIST_AGENTS_TITLE,
      description: LIST_AGENTS_DESCRIPTION,
      // No `inputSchema`: the tool takes no arguments, which is also why the
      // handler below is `(ctx)` and not `(args, ctx)`.
      outputSchema: AgentsOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // The answer comes from a local API whose contents change outside this
        // server's control, so it is never cacheable by the host.
        openWorldHint: true,
      },
    },
    async (ctx) => {
      try {
        // Host cancellation propagates into the fetch; a client that gave up
        // must not leave a socket open behind it.
        const agents = await deps.endpoints.listAgents({ signal: ctx.mcpReq.signal });

        const structuredContent: AgentsOutput = {
          api_base: API_BASE,
          agents: [...agents].sort(byName).map(toSummary),
        };

        return {
          content: [{ type: 'text', text: digest(structuredContent) }],
          structuredContent,
        };
      } catch (e) {
        // Spread, not a bare return: `ToolErrorResult` is an `interface`, and
        // TypeScript grants an implicit index signature to anonymous object
        // types only — never to interfaces — so an interface value does not
        // satisfy the SDK's `CallToolResult`, which carries
        // `[x: string]: unknown`. Re-forming it as an object literal is the
        // whole fix, and it beats a cast: a real shape change still fails here.
        return { ...toErrorResult(e) };
      }
    },
  );
}

/**
 * `GET /agents` has no `ORDER BY`, so the API's order is whatever Postgres
 * returns — which can differ between two identical calls. Sorting here makes
 * the tool's output stable, so a model re-reading it does not see a reshuffled
 * list and conclude something changed.
 *
 * Case-insensitive first (that is the order a human reads), then exact, then
 * `id`: names are not unique, so without the last tie-break the order of two
 * same-named agents would still be arbitrary.
 */
function byName(a: Agent, b: Agent): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * 6 of `Agent`'s 12 fields. `system_prompt` is dropped deliberately — it is the
 * largest field on the record and reading it tells the calling model nothing it
 * can act on; `output_schema`, `version`, `strategy`, `ci_fail_on` and
 * `repo_intel` are DevDigest-internal configuration, and three of those only
 * have values here because our own `Agent.parse` applied the schema's defaults
 * to a route that declares no response schema.
 */
function toSummary(a: Agent): AgentSummaryOutput {
  return {
    name: a.name,
    description: a.description,
    provider: a.provider,
    model: a.model,
    enabled: a.enabled,
    id: a.id,
  };
}

/**
 * The one-line human digest that goes in `content`. The structured payload
 * carries the detail; this is what a person skimming the transcript reads, so
 * it is a sentence and never a JSON dump.
 *
 * The empty case still leads forward — an empty list is a legitimate success,
 * not a catalogued error, but a bare "0 agents" would leave the caller nothing
 * to do next.
 */
function digest(output: AgentsOutput): string {
  const { agents } = output;
  if (agents.length === 0) {
    return `No reviewer agents are configured at ${output.api_base}. Add one in DevDigest → Agents, then call list_agents again.`;
  }

  const names = agents.map((a) => (a.enabled ? a.name : `${a.name} (disabled)`)).join(', ');
  const noun = agents.length === 1 ? 'agent' : 'agents';
  return `${agents.length} ${noun} — ${names}`;
}
