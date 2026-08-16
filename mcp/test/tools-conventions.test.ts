import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import type {
  ConventionCandidate,
  ConventionRun,
  ConventionSkillDraft,
  ConventionsView,
  Repo,
} from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../src/api/endpoints.js';
import { CONVENTIONS_MD_MAX, EVIDENCE_FILES_MAX } from '../src/config.js';
import { toolError, withStatus } from '../src/domain/errors.js';

/**
 * What `client.ts` actually throws for a non-2xx: the catalogue's `api_error`
 * message, tagged with the HTTP status. The status is what `get_conventions`
 * branches on, so a stub that omits it would not exercise the real path.
 */
function apiError(status: number, path: string, message: string) {
  return withStatus(toolError('api_error', status, path, message), status);
}
import {
  GET_CONVENTIONS_DESCRIPTION,
  GET_CONVENTIONS_TITLE,
} from '../src/tools/descriptions.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';

/**
 * These tests drive the tools through their REGISTRAR, not through an exported
 * handler: the registration config is half of what a tool is (name, title, the
 * approved description, the annotations, whether an `outputSchema` exists at
 * all) and a test that called a bare handler would assert none of it.
 *
 * The SDK is never instantiated. `registerTool` is the only method these
 * registrars touch, so a recording stub is a truer seam than a real server —
 * and it keeps the suite hermetic, which is this package's rule.
 */

// ---- the recording server --------------------------------------------------

interface ToolResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

type Handler = (
  args: Record<string, unknown>,
  ctx: { mcpReq: { signal: AbortSignal } },
) => Promise<ToolResult>;

interface RegisteredTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: Record<string, unknown>;
  };
  handler: Handler;
}

function recordingServer() {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(name: string, config: RegisteredTool['config'], handler: Handler) {
      tools.push({ name, config, handler });
      return {};
    },
    // The registrars call exactly one method, so the double cast is honest
    // about what this stub is: `registerTool` and nothing else.
  } as unknown as McpServer;
  return { server, tools };
}

/** The one tool the registrar under test registered. */
function onlyTool(tools: RegisteredTool[]): RegisteredTool {
  expect(tools).toHaveLength(1);
  const tool = tools[0];
  if (tool === undefined) throw new Error('no tool registered');
  return tool;
}

const SIGNAL = new AbortController().signal;
const CTX = { mcpReq: { signal: SIGNAL } };

// ---- contract factories ----------------------------------------------------

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

function run(over: Partial<ConventionRun> = {}): ConventionRun {
  return {
    id: 'run-1',
    repo_id: 'repo-1',
    status: 'done',
    sample_count: 40,
    candidate_count: 11,
    dropped_count: 2,
    error: null,
    created_at: '2026-08-15T09:00:00.000Z',
    finished_at: '2026-08-15T09:04:00.000Z',
    ...over,
  };
}

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'cand-1',
    run_id: 'run-1',
    category: 'naming',
    rule: 'Route handlers are named after the resource, not the verb.',
    evidence_path: 'server/src/modules/pulls/routes.ts',
    evidence_snippet: 'export async function registerPullRoutes() {}',
    confidence: 0.9,
    accepted: false,
    created_at: '2026-08-15T09:03:00.000Z',
    ...over,
  };
}

function draft(over: Partial<ConventionSkillDraft> = {}): ConventionSkillDraft {
  return {
    name: 'acme-payments-api-conventions',
    description: 'Extracted conventions for acme/payments-api.',
    type: 'convention',
    enabled: true,
    body: '# Conventions\n\n- Handlers are named after the resource. `routes.ts:42`\n',
    evidence_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    source_count: 11,
    repo_name: 'acme/payments-api',
    ...over,
  };
}

// ---- the Endpoints stub ----------------------------------------------------

interface StubParts {
  repos?: Repo[];
  view?: ConventionsView;
  /** A function form lets a test throw the 409 the real API answers with. */
  skillDraft?: ConventionSkillDraft | (() => ConventionSkillDraft);
}

/**
 * Only the three methods `get_conventions` may touch are implemented; anything
 * else throws loudly rather than returning a convincing `undefined`.
 */
function stubEndpoints(parts: StubParts = {}) {
  const calls = {
    listRepos: vi.fn<(opts?: CallOptions) => void>(),
    getConventions: vi.fn<(repoId: string, opts?: CallOptions) => void>(),
    getSkillDraft: vi.fn<(runId: string, opts?: CallOptions) => void>(),
  };

  const endpoints = {
    async listRepos(opts?: CallOptions) {
      calls.listRepos(opts);
      return parts.repos ?? [repo()];
    },
    async getConventions(repoId: string, opts?: CallOptions) {
      calls.getConventions(repoId, opts);
      return parts.view ?? { run: run(), candidates: [] };
    },
    async getSkillDraft(runId: string, opts?: CallOptions) {
      calls.getSkillDraft(runId, opts);
      const answer = parts.skillDraft ?? draft();
      return typeof answer === 'function' ? answer() : answer;
    },
  } as unknown as Endpoints;

  return { endpoints, calls };
}

/** Registers `get_conventions` over a stub and calls it once. */
async function callConventions(parts: StubParts = {}, args: Record<string, unknown> = {}) {
  const { server, tools } = recordingServer();
  const { endpoints, calls } = stubEndpoints(parts);
  registerGetConventions(server, { endpoints });
  const tool = onlyTool(tools);
  const result = await tool.handler({ repo: 'acme/payments-api', ...args }, CTX);
  return { tool, result, calls };
}

// ---------------------------------------------------------------------------
// get_conventions — registration
// ---------------------------------------------------------------------------

describe('registerGetConventions', () => {
  it('registers get_conventions with the approved text and read-only annotations', () => {
    const { server, tools } = recordingServer();
    const { endpoints } = stubEndpoints();

    registerGetConventions(server, { endpoints });

    const tool = onlyTool(tools);
    expect(tool.name).toBe('get_conventions');
    expect(tool.config.title).toBe(GET_CONVENTIONS_TITLE);
    // Byte-identity with the approved const — an inline copy would drift.
    expect(tool.config.description).toBe(GET_CONVENTIONS_DESCRIPTION);
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.outputSchema).toBeDefined();
    expect(tool.config.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});

// ---------------------------------------------------------------------------
// get_conventions — the four failure branches
// ---------------------------------------------------------------------------

describe('get_conventions failure branches', () => {
  it('reports conventions_never_run when the repo has no extraction run', async () => {
    const { result, calls } = await callConventions({ view: { run: null, candidates: [] } });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No conventions have been extracted');
    expect(result.content[0]?.text).toContain('acme/payments-api');
    // `run: null` is a valid 200 — the second hop must not be attempted.
    expect(calls.getSkillDraft).not.toHaveBeenCalled();
    expect(result.structuredContent).toBeUndefined();
  });

  it.each(['queued', 'running'] as const)(
    'reports conventions_in_progress while the run is %s',
    async (status) => {
      const { result, calls } = await callConventions({
        view: { run: run({ status }), candidates: [] },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('still running');
      expect(result.content[0]?.text).toContain('acme/payments-api');
      expect(calls.getSkillDraft).not.toHaveBeenCalled();
    },
  );

  it('reports conventions_failed carrying the run error', async () => {
    const { result, calls } = await callConventions({
      view: { run: run({ status: 'failed', error: 'anthropic: 401 invalid api key' }), candidates: [] },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('anthropic: 401 invalid api key');
    expect(result.content[0]?.text).toContain('run the extractor again');
    expect(calls.getSkillDraft).not.toHaveBeenCalled();
  });

  it('maps the skill-draft 409 to conventions_none_accepted and names the candidate count', async () => {
    const { result } = await callConventions({
      view: { run: run({ candidate_count: 7 }), candidates: [] },
      skillDraft: () => {
        // Exactly what `client.ts` builds for a 409 on this route: the endpoint
        // layer maps nothing per-status, so it arrives as a generic api_error
        // carrying status 409 — which is the handle the tool branches on.
        throw apiError(
          409,
          '/conventions/runs/run-1/skill-draft',
          'No accepted candidates to build a skill from',
        );
      },
    });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('7 extracted convention candidates');
    expect(text).toContain('none are accepted');
    expect(text).toContain('acme/payments-api');
    // It must not degrade into the generic HTTP message, which tells the caller
    // to restart the API — the wrong next step entirely.
    expect(text).not.toContain('409');
  });

  it('falls back to the candidates array when the run reports no count', async () => {
    const { result } = await callConventions({
      view: {
        run: run({ candidate_count: 0 }),
        candidates: [candidate({ id: 'c1' }), candidate({ id: 'c2' })],
      },
      skillDraft: () => {
        throw apiError(409, '/conventions/runs/run-1/skill-draft', 'nope');
      },
    });

    expect(result.content[0]?.text).toContain('2 extracted convention candidates');
  });

  it('leaves a non-409 API failure as its own error', async () => {
    const { result } = await callConventions({
      skillDraft: () => {
        throw apiError(500, '/conventions/runs/run-1/skill-draft', 'boom');
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('500');
    expect(result.content[0]?.text).not.toContain('none are accepted');
  });

  it('surfaces a repo that does not resolve', async () => {
    const { result, calls } = await callConventions({ repos: [] }, { repo: 'ghost/repo' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No repository matches');
    expect(calls.getConventions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_conventions — the happy path and its caps
// ---------------------------------------------------------------------------

describe('get_conventions success', () => {
  it('returns the skill-draft markdown plus a one-line digest', async () => {
    const { result, calls } = await callConventions();

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('11 conventions from acme/payments-api · 3 evidence files');
    expect(result.structuredContent).toEqual({
      repo: 'acme/payments-api',
      run_id: 'run-1',
      extracted_at: '2026-08-15T09:04:00.000Z',
      source_count: 11,
      evidence_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      conventions_markdown: draft().body,
      truncated: false,
    });
    // The digest is a summary, not the payload: the markdown is structured
    // content only.
    expect(result.content[0]?.text).not.toContain('# Conventions');
    expect(calls.getConventions).toHaveBeenCalledWith('repo-1', { signal: SIGNAL });
    expect(calls.getSkillDraft).toHaveBeenCalledWith('run-1', { signal: SIGNAL });
  });

  it('reports a null extracted_at when the run never recorded finishing', async () => {
    const { result } = await callConventions({
      view: { run: run({ finished_at: null }), candidates: [] },
    });

    expect(result.structuredContent?.extracted_at).toBeNull();
  });

  it('caps the markdown at CONVENTIONS_MD_MAX and flags truncation', async () => {
    const body = 'x'.repeat(CONVENTIONS_MD_MAX + 500);
    const { result } = await callConventions({ skillDraft: draft({ body }) });

    const markdown = result.structuredContent?.conventions_markdown as string;
    expect(markdown.startsWith('x'.repeat(CONVENTIONS_MD_MAX))).toBe(true);
    expect(markdown).toContain('(truncated)');
    // The marker is the only thing allowed past the cap.
    expect(markdown.length).toBeLessThan(CONVENTIONS_MD_MAX + 40);
    expect(result.structuredContent?.truncated).toBe(true);
    expect(result.content[0]?.text).toContain('truncated to fit');
  });

  it('keeps markdown exactly at the cap intact and untruncated', async () => {
    const body = 'y'.repeat(CONVENTIONS_MD_MAX);
    const { result } = await callConventions({ skillDraft: draft({ body }) });

    expect(result.structuredContent?.conventions_markdown).toBe(body);
    expect(result.structuredContent?.truncated).toBe(false);
  });

  it('caps evidence_files at EVIDENCE_FILES_MAX and flags truncation', async () => {
    const files = Array.from({ length: EVIDENCE_FILES_MAX + 5 }, (_, i) => `src/file-${i}.ts`);
    const { result } = await callConventions({ skillDraft: draft({ evidence_files: files }) });

    const evidence = result.structuredContent?.evidence_files as string[];
    expect(evidence).toHaveLength(EVIDENCE_FILES_MAX);
    expect(evidence[0]).toBe('src/file-0.ts');
    expect(evidence.at(-1)).toBe(`src/file-${EVIDENCE_FILES_MAX - 1}.ts`);
    expect(result.structuredContent?.truncated).toBe(true);
    expect(result.content[0]?.text).toContain(`${EVIDENCE_FILES_MAX} evidence files`);
  });

  it('handles a draft with no evidence files at all', async () => {
    const { result } = await callConventions({
      skillDraft: draft({ evidence_files: [], source_count: 1 }),
    });

    expect(result.structuredContent?.evidence_files).toEqual([]);
    expect(result.structuredContent?.truncated).toBe(false);
    expect(result.content[0]?.text).toBe('1 convention from acme/payments-api · 0 evidence files');
  });
});

// `get_blast_radius` is no longer a placeholder and has its own suite —
// see `tools-blast.test.ts`.
