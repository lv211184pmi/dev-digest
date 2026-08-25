import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agent, FindingRecord, PrMeta, Repo, ReviewRecord } from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../src/api/endpoints.js';
import { API_BASE } from '../src/config.js';
import { toolError } from '../src/domain/errors.js';
import {
  GET_FINDINGS_DESCRIPTION,
  GET_FINDINGS_TITLE,
  LIST_AGENTS_DESCRIPTION,
  LIST_AGENTS_TITLE,
} from '../src/tools/descriptions.js';
import { GetFindingsInput } from '../src/tools/schemas.js';
import { registerGetFindings } from '../src/tools/get-findings.js';
import { registerListAgents } from '../src/tools/list-agents.js';

/**
 * The two read-only tools, driven through their registrars.
 *
 * The seam under test is the handler: what a calling model is handed for a
 * given API state. So the tests register against a fake `server` that records
 * `registerTool` calls and then invoke the captured handler directly — no
 * transport, no JSON-RPC, no protocol negotiation. That keeps a failure
 * pointing at this package's code rather than at the SDK, and it is the only
 * way to assert the argument-less `(ctx)` handler shape at all.
 *
 * `Endpoints` is stubbed rather than `fetch`, because that is the boundary the
 * tools were written against: the response validation below it has its own
 * suite in `endpoints.test.ts`.
 */

// ---- Fixtures --------------------------------------------------------------
// Typed factories: `Agent` has 12 fields, `ReviewRecord` 12 and `FindingRecord`
// 17, and a test that spells them all out hides the one field it is about.

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'General Reviewer',
    description: 'Reviews everything',
    provider: 'openai',
    model: 'gpt-5',
    system_prompt: 'you review code',
    enabled: true,
    version: 1,
    strategy: 'single-pass',
    ci_fail_on: 'critical',
    repo_intel: true,
    ...over,
  };
}

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    workspace_id: 'ws-1',
    owner: 'acme',
    name: 'payments-api',
    full_name: 'acme/payments-api',
    default_branch: 'main',
    clone_path: null,
    last_polled_at: null,
    created_by: null,
    ...over,
  };
}

function pull(over: Partial<PrMeta> = {}): PrMeta {
  return {
    id: 'pr-1',
    number: 482,
    title: 'Add idempotency keys',
    author: 'octocat',
    branch: 'feat/idempotency',
    base: 'main',
    head_sha: 'abc123',
    additions: 40,
    deletions: 3,
    files_count: 4,
    status: 'needs_review',
    ...over,
  };
}

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: 'f-1',
    review_id: 'rev-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    suggestion: 'do this instead',
    confidence: 0.9,
    kind: 'finding',
    scope: 'in_scope',
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: 'rev-1',
    pr_id: 'pr-1',
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'General Reviewer',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'a summary',
    score: 42,
    model: 'test-model',
    grounding: null,
    created_at: '2026-01-01T00:00:00.000Z',
    findings: [],
    ...over,
  } as ReviewRecord;
}

// ---- The fake MCP server ---------------------------------------------------

interface ToolResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

interface CapturedTool {
  name: string;
  config: ToolConfig;
  /** The registered handler, called exactly as the SDK would call it. */
  call(...args: unknown[]): Promise<ToolResult>;
}

/**
 * Records registrations instead of serving them. The cast is deliberate: a
 * registrar reaching for any other `McpServer` method would throw here loudly
 * rather than quietly pass a test it has no business passing.
 */
function captureServer(): { server: McpServer; tools: Map<string, CapturedTool> } {
  const tools = new Map<string, CapturedTool>();

  const server = {
    registerTool(
      name: string,
      config: ToolConfig,
      handler: (...args: never[]) => Promise<ToolResult>,
    ) {
      tools.set(name, {
        name,
        config,
        call: (...args: unknown[]) => handler(...(args as never[])),
      });
      return {};
    },
  } as unknown as McpServer;

  return { server, tools };
}

function must(tools: Map<string, CapturedTool>, name: string): CapturedTool {
  const found = tools.get(name);
  if (found === undefined) {
    throw new Error(`no tool registered as '${name}' (got: ${[...tools.keys()].join(', ')})`);
  }
  return found;
}

/** The one field of `ServerContext` these handlers touch. */
function ctx(signal: AbortSignal = new AbortController().signal): unknown {
  return { mcpReq: { signal } };
}

/** The text a model reads first. Handlers always return exactly one block. */
function text(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n');
}

// ---- The Endpoints stub ----------------------------------------------------

interface StubParts {
  agents?: Agent[];
  repos?: Repo[];
  pulls?: PrMeta[];
  reviews?: ReviewRecord[];
}

function stub(parts: StubParts = {}) {
  const listAgents = vi.fn(async (_opts?: CallOptions): Promise<Agent[]> => parts.agents ?? []);
  const listRepos = vi.fn(async (_opts?: CallOptions): Promise<Repo[]> => parts.repos ?? []);
  const listPulls = vi.fn(
    async (_repoId: string, _opts?: CallOptions): Promise<PrMeta[]> => parts.pulls ?? [],
  );
  const listReviews = vi.fn(
    async (_prId: string, _opts?: CallOptions): Promise<ReviewRecord[]> => parts.reviews ?? [],
  );

  const endpoints = { listAgents, listRepos, listPulls, listReviews } as unknown as Endpoints;
  return { endpoints, listAgents, listRepos, listPulls, listReviews };
}

/** The seeded workspace the `get_findings` tests resolve against. */
const WORKSPACE: StubParts = { repos: [repo()], pulls: [pull()] };

/** Parsed the way the SDK parses it, so `max_findings` carries its default. */
function findingsArgs(raw: Record<string, unknown>): unknown {
  return GetFindingsInput.parse(raw);
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

/**
 * `list_agents` is the tool every other one depends on: its `name` values are
 * the exact strings `run_agent_on_pr` accepts. So what matters is that the
 * names come back complete, stably ordered, and paired with the approved
 * description — a model that cannot trust this list has to guess an agent, and
 * guessing wrong costs an LLM call.
 */
describe('list_agents — registration', () => {
  it('registers under the fixed name, with the approved title and description', () => {
    const { server, tools } = captureServer();

    registerListAgents(server, { endpoints: stub().endpoints });

    const tool = must(tools, 'list_agents');
    expect(tool.config.title).toBe(LIST_AGENTS_TITLE);
    // Byte-identity, not "contains": the description is approved verbatim text
    // and an inline string at the call site is exactly what this catches.
    expect(tool.config.description).toBe(LIST_AGENTS_DESCRIPTION);
  });

  it('declares no input schema, and is annotated read-only and non-destructive', () => {
    const { server, tools } = captureServer();

    registerListAgents(server, { endpoints: stub().endpoints });

    const tool = must(tools, 'list_agents');
    // The absence is load-bearing: an argument-less tool's handler is `(ctx)`,
    // and adding a schema here silently changes that signature.
    expect(tool.config.inputSchema).toBeUndefined();
    expect(tool.config.outputSchema).toBeDefined();
    expect(tool.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

describe('list_agents — handler', () => {
  it('returns api_base and the 6 acting fields per agent, dropping the system prompt', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({ agents: [agent()] });
    registerListAgents(server, { endpoints });

    const result = await must(tools, 'list_agents').call(ctx());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      api_base: API_BASE,
      agents: [
        {
          name: 'General Reviewer',
          description: 'Reviews everything',
          provider: 'openai',
          model: 'gpt-5',
          enabled: true,
          id: 'agent-1',
        },
      ],
    });
  });

  it('digests to one human line naming the agents, never a JSON dump', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({
      agents: [agent(), agent({ id: 'agent-2', name: 'Security Reviewer', enabled: false })],
    });
    registerListAgents(server, { endpoints });

    const result = await must(tools, 'list_agents').call(ctx());

    expect(text(result)).toBe('2 agents — General Reviewer, Security Reviewer (disabled)');
    expect(text(result)).not.toContain('{');
  });

  it('sorts by name case-insensitively — GET /agents has no ORDER BY', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({
      agents: [
        agent({ id: 'a-3', name: 'Security Reviewer' }),
        agent({ id: 'a-2', name: 'general reviewer' }),
        agent({ id: 'a-1', name: 'General Reviewer' }),
      ],
    });
    registerListAgents(server, { endpoints });

    const result = await must(tools, 'list_agents').call(ctx());

    const agents = (result.structuredContent as { agents: { id: string }[] }).agents;
    expect(agents.map((a) => a.id)).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('breaks a shared name by id, so two same-named agents keep a fixed order', async () => {
    const { server, tools } = captureServer();
    // `agents.name` has no unique constraint — a workspace can genuinely hold
    // two of these, and the pair must not swap places between two calls.
    const { endpoints } = stub({
      agents: [
        agent({ id: 'agent-9', name: 'Security Reviewer' }),
        agent({ id: 'agent-4', name: 'Security Reviewer' }),
      ],
    });
    registerListAgents(server, { endpoints });

    const result = await must(tools, 'list_agents').call(ctx());

    const agents = (result.structuredContent as { agents: { id: string }[] }).agents;
    expect(agents.map((a) => a.id)).toEqual(['agent-4', 'agent-9']);
  });

  it('an empty workspace is a success whose text still names the next action', async () => {
    const { server, tools } = captureServer();
    registerListAgents(server, { endpoints: stub({ agents: [] }).endpoints });

    const result = await must(tools, 'list_agents').call(ctx());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ api_base: API_BASE, agents: [] });
    expect(text(result)).toContain('Add one in DevDigest');
  });

  it('passes the host cancellation signal down to the API call', async () => {
    const { server, tools } = captureServer();
    const { endpoints, listAgents } = stub({ agents: [agent()] });
    registerListAgents(server, { endpoints });
    const controller = new AbortController();

    await must(tools, 'list_agents').call(ctx(controller.signal));

    expect(listAgents).toHaveBeenCalledWith({ signal: controller.signal });
  });

  it('an unreachable API surfaces as isError with the catalogued message', async () => {
    const { server, tools } = captureServer();
    const { endpoints, listAgents } = stub();
    listAgents.mockRejectedValueOnce(toolError('api_unreachable', API_BASE));
    registerListAgents(server, { endpoints });

    const result = await must(tools, 'list_agents').call(ctx());

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toContain('./scripts/dev.sh');
  });
});

// ---------------------------------------------------------------------------
// get_findings
// ---------------------------------------------------------------------------

describe('get_findings — registration', () => {
  it('registers with the approved text, both schemas, and read-only annotations', () => {
    const { server, tools } = captureServer();

    registerGetFindings(server, { endpoints: stub().endpoints });

    const tool = must(tools, 'get_findings');
    expect(tool.config.title).toBe(GET_FINDINGS_TITLE);
    expect(tool.config.description).toBe(GET_FINDINGS_DESCRIPTION);
    expect(tool.config.inputSchema).toBe(GetFindingsInput);
    expect(tool.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

describe('get_findings — handler', () => {
  it('projects the latest review into a digest line plus structured content', async () => {
    const { server, tools } = captureServer();
    const { endpoints, listReviews } = stub({
      ...WORKSPACE,
      reviews: [
        review({
          findings: [
            finding({ id: 'f-1', severity: 'CRITICAL', file: 'src/pay.ts', start_line: 3 }),
            finding({ id: 'f-2', severity: 'WARNING', file: 'src/pay.ts', start_line: 9 }),
          ],
        }),
      ],
    });
    registerGetFindings(server, { endpoints });
    const controller = new AbortController();

    const result = await must(tools, 'get_findings').call(
      findingsArgs({ repo: 'acme/payments-api', pr: 482 }),
      ctx(controller.signal),
    );

    expect(result.isError).toBeUndefined();
    expect(text(result)).toBe('request_changes · score 42 · 1 CRITICAL, 1 WARNING — 2 findings');

    const structured = result.structuredContent as Record<string, unknown>;
    // Addressed by meaning: the full name and the GitHub number the caller
    // passed, never the uuids the API answers with.
    expect(structured.repo).toBe('acme/payments-api');
    expect(structured.pr).toBe(482);
    expect(structured.agent).toBe('General Reviewer');
    expect(structured.run_id).toBe('run-1');
    expect(structured.status).toBe('completed');
    expect(structured.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 0 });
    expect(structured.total_findings).toBe(2);
    expect(structured.truncated).toBe(false);
    // Cancellation has to reach the last call in the sequence, not just the first.
    expect(listReviews).toHaveBeenCalledWith('pr-1', { signal: controller.signal });
  });

  it('narrows to the named agent when one is given', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({
      ...WORKSPACE,
      reviews: [
        review({ id: 'rev-1', run_id: 'run-1', agent_name: 'General Reviewer', score: 42 }),
        review({
          id: 'rev-2',
          run_id: 'run-2',
          agent_name: 'Security Reviewer',
          score: 77,
          created_at: '2026-01-02T00:00:00.000Z',
        }),
      ],
    });
    registerGetFindings(server, { endpoints });

    const result = await must(tools, 'get_findings').call(
      findingsArgs({ repo: 'acme/payments-api', pr: 482, agent: 'General Reviewer' }),
      ctx(),
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.agent).toBe('General Reviewer');
    expect(structured.score).toBe(42);
  });

  it('run_id wins over agent when both are given', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({
      ...WORKSPACE,
      reviews: [
        review({ id: 'rev-1', run_id: 'run-1', agent_name: 'General Reviewer', score: 42 }),
        review({ id: 'rev-2', run_id: 'run-2', agent_name: 'Security Reviewer', score: 77 }),
      ],
    });
    registerGetFindings(server, { endpoints });

    const result = await must(tools, 'get_findings').call(
      findingsArgs({
        repo: 'acme/payments-api',
        pr: 482,
        agent: 'General Reviewer',
        run_id: 'run-2',
      }),
      ctx(),
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.run_id).toBe('run-2');
    expect(structured.agent).toBe('Security Reviewer');
  });

  it('honours max_findings: the cap trims the list, never the counts', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({
      ...WORKSPACE,
      reviews: [
        review({
          findings: [
            finding({ id: 'f-1', severity: 'CRITICAL', start_line: 1 }),
            finding({ id: 'f-2', severity: 'CRITICAL', start_line: 2 }),
            finding({ id: 'f-3', severity: 'WARNING', start_line: 3 }),
          ],
        }),
      ],
    });
    registerGetFindings(server, { endpoints });

    const result = await must(tools, 'get_findings').call(
      findingsArgs({ repo: 'acme/payments-api', pr: 482, max_findings: 1 }),
      ctx(),
    );

    const structured = result.structuredContent as {
      findings: unknown[];
      counts: unknown;
      total_findings: number;
      truncated: boolean;
    };
    expect(structured.findings).toHaveLength(1);
    expect(structured.counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 0 });
    expect(structured.total_findings).toBe(3);
    expect(structured.truncated).toBe(true);
    expect(text(result)).toContain('showing 1 of 3 findings');
  });

  it('a PR with no review is an error that names run_agent_on_pr', async () => {
    const { server, tools } = captureServer();
    registerGetFindings(server, { endpoints: stub({ ...WORKSPACE, reviews: [] }).endpoints });

    const result = await must(tools, 'get_findings').call(
      findingsArgs({ repo: 'acme/payments-api', pr: 482 }),
      ctx(),
    );

    // Not a payload of nulls and zeros: a model reading `total_findings: 0`
    // would report the PR clean when nobody has looked at it.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toContain('has no review');
    expect(text(result)).toContain('run_agent_on_pr');
  });

  it('names the agent in the no-review message when the caller narrowed by one', async () => {
    const { server, tools } = captureServer();
    const { endpoints } = stub({
      ...WORKSPACE,
      reviews: [review({ agent_name: 'General Reviewer' })],
    });
    registerGetFindings(server, { endpoints });

    const result = await must(tools, 'get_findings').call(
      findingsArgs({ repo: 'acme/payments-api', pr: 482, agent: 'Security Reviewer' }),
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("by 'Security Reviewer'");
  });

  it('a resolution failure surfaces as isError and never reaches the reviews call', async () => {
    const { server, tools } = captureServer();
    const { endpoints, listReviews } = stub({ repos: [] });
    registerGetFindings(server, { endpoints });

    const result = await must(tools, 'get_findings').call(
      findingsArgs({ repo: 'acme/payments-api', pr: 482 }),
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('No repository matches');
    expect(listReviews).not.toHaveBeenCalled();
  });
});
