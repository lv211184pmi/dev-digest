/**
 * Server assembly — the five DevDigest tools on one `McpServer`.
 *
 * Every registrar takes `(server, { endpoints })`, so wiring is uniform and the
 * whole surface can be driven against a stubbed `Endpoints` in tests without a
 * transport, a port, or a running API.
 *
 * !!! stdout is the JSON-RPC channel. NEVER `console.log` in this package —
 * !!! a single stray write corrupts the protocol stream. Use `console.error`.
 */

import { McpServer } from '@modelcontextprotocol/server';

import { endpoints as realEndpoints, type Endpoints } from './api/endpoints.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';

export const SERVER_NAME = 'devdigest';
export const SERVER_VERSION = '0.0.0';

export interface CreateServerDeps {
  /** Substitute in tests. Defaults to the real HTTP client against API_BASE. */
  endpoints?: Endpoints;
}

/**
 * Build a fully-registered server. Called once per stdio connection by
 * `serveStdio`, so it must stay cheap and side-effect free — no network, no
 * filesystem, no reads of mutable module state.
 */
export function createServer(deps: CreateServerDeps = {}): McpServer {
  const endpoints = deps.endpoints ?? realEndpoints;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // Read-only tools first: that is the order a model meets them in `tools/list`,
  // and `list_agents` is the documented entry point for a valid `agent` value.
  registerListAgents(server, { endpoints });
  registerGetFindings(server, { endpoints });
  registerGetConventions(server, { endpoints });
  registerGetBlastRadius(server, { endpoints });

  // The only tool that writes — and the only one that spends money.
  registerRunAgentOnPr(server, { endpoints });

  return server;
}
