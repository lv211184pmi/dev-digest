import { describe, expect, it } from 'vitest';
import { createMcpHandler } from '@modelcontextprotocol/server';

import type { Endpoints } from '../src/api/endpoints.js';
import { TOOL_PREFIX } from '../src/config.js';
import {
  GET_BLAST_RADIUS_DESCRIPTION,
  GET_BLAST_RADIUS_TITLE,
  GET_CONVENTIONS_DESCRIPTION,
  GET_CONVENTIONS_TITLE,
  GET_FINDINGS_DESCRIPTION,
  GET_FINDINGS_TITLE,
  LIST_AGENTS_DESCRIPTION,
  LIST_AGENTS_TITLE,
  RUN_AGENT_ON_PR_DESCRIPTION,
  RUN_AGENT_ON_PR_TITLE,
} from '../src/tools/descriptions.js';
import { createServer } from '../src/server.js';

/**
 * The assembled server, driven over the real JSON-RPC path.
 *
 * Everything below asserts the *contract a host sees* — the tool list, the
 * annotations that decide what a host may auto-approve, and the description
 * text. The individual handlers have their own suites; this file exists so a
 * refactor cannot quietly change the published surface.
 *
 * `Endpoints` is stubbed and never called: `tools/list` does no I/O, and
 * wiring a real client here would only test the SDK.
 */

const stubEndpoints = {} as Endpoints;

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

/** One `tools/list` round trip through the handler, no transport, no port. */
async function listTools(): Promise<ListedTool[]> {
  const handler = createMcpHandler(() => createServer({ endpoints: stubEndpoints }));
  const res = await handler.fetch(
    new Request('http://mcp.test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  expect(res.ok).toBe(true);

  // The handler may answer as plain JSON or as a single SSE frame depending on
  // the negotiated response mode; accept either rather than pinning transport.
  const raw = await res.text();
  const payload = raw.startsWith('event:') || raw.startsWith('data:')
    ? JSON.parse(raw.split('\n').find((l) => l.startsWith('data:'))!.slice(5).trim())
    : JSON.parse(raw);

  expect(payload.error).toBeUndefined();
  return payload.result.tools as ListedTool[];
}

const n = (base: string): string => `${TOOL_PREFIX}${base}`;

describe('createServer — the published tool surface', () => {
  it('registers exactly the five agreed tools', async () => {
    const names = (await listTools()).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        n('get_blast_radius'),
        n('get_conventions'),
        n('get_findings'),
        n('list_agents'),
        n('run_agent_on_pr'),
      ].sort(),
    );
  });

  /**
   * Hosts auto-approve read-only tools. `run_agent_on_pr` spends real money on
   * LLM calls, so it must be the ONE tool that never carries readOnlyHint.
   */
  it('marks run_agent_on_pr as the only non-read-only tool', async () => {
    const tools = await listTools();
    const writers = tools.filter((t) => t.annotations?.readOnlyHint !== true);
    expect(writers.map((t) => t.name)).toEqual([n('run_agent_on_pr')]);
  });

  it('never marks any tool destructive', async () => {
    for (const t of await listTools()) {
      expect(t.annotations?.destructiveHint, t.name).not.toBe(true);
    }
  });
});

/**
 * Descriptions are user-approved verbatim text. Comparing against the imported
 * consts (never a copied literal) is what makes a later "tightening" edit fail
 * here instead of silently degrading what the model is told.
 */
describe('createServer — approved text reaches the wire intact', () => {
  const expected: Array<[string, string, string]> = [
    [n('list_agents'), LIST_AGENTS_TITLE, LIST_AGENTS_DESCRIPTION],
    [n('run_agent_on_pr'), RUN_AGENT_ON_PR_TITLE, RUN_AGENT_ON_PR_DESCRIPTION],
    [n('get_findings'), GET_FINDINGS_TITLE, GET_FINDINGS_DESCRIPTION],
    [n('get_conventions'), GET_CONVENTIONS_TITLE, GET_CONVENTIONS_DESCRIPTION],
    [n('get_blast_radius'), GET_BLAST_RADIUS_TITLE, GET_BLAST_RADIUS_DESCRIPTION],
  ];

  it.each(expected)('%s → byte-identical title and description', async (name, title, description) => {
    const tool = (await listTools()).find((t) => t.name === name);
    expect(tool, `${name} not registered`).toBeDefined();
    expect(tool!.title).toBe(title);
    expect(tool!.description).toBe(description);
  });
});

describe('createServer — schema declarations', () => {
  /**
   * Every tool returns a success payload, so every tool describes it. This used
   * to carve out `get_blast_radius` as the one placeholder with nothing to
   * describe; now that it is implemented the carve-out is gone, and asserting
   * the FULL set (rather than deleting the test) is what stops a future tool
   * from shipping undocumented output.
   */
  it('all five tools declare an outputSchema', async () => {
    const tools = await listTools();
    const withOutput = tools.filter((t) => t.outputSchema !== undefined).map((t) => t.name).sort();
    expect(withOutput).toEqual(
      [
        n('get_blast_radius'),
        n('get_conventions'),
        n('get_findings'),
        n('list_agents'),
        n('run_agent_on_pr'),
      ].sort(),
    );
  });

  /** list_agents takes no arguments — the SDK gives it a one-parameter handler. */
  it('list_agents declares no meaningful input while the others take arguments', async () => {
    const tools = await listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const base of ['run_agent_on_pr', 'get_findings', 'get_conventions', 'get_blast_radius']) {
      expect(byName.get(n(base))?.inputSchema, base).toBeDefined();
    }
    const listAgents = byName.get(n('list_agents'))!;
    const props = (listAgents.inputSchema as { properties?: Record<string, unknown> } | undefined)
      ?.properties;
    expect(props === undefined || Object.keys(props).length === 0).toBe(true);
  });
});
