import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewOutcome } from '@devdigest/reviewer-core';
import { MockGitClient } from '../src/adapters/mocks.js';
import { RunBus } from '../src/platform/sse.js';
import { RunLogger } from '../src/platform/run-logger.js';
import type { Container } from '../src/platform/container.js';
import { ProjectContextService } from '../src/modules/project-context/application-services/project-context-service.js';
import { RepoRepository } from '../src/modules/repos/repository.js';
import { CloneFileSource } from '../src/modules/project-context/infrastructure/external/clone-file-source.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { AgentRow } from '../src/db/rows.js';
import type { PullRow } from '../src/db/rows.js';
import type * as schema from '../src/db/schema.js';
import type { UnifiedDiff, RunTrace } from '@devdigest/shared';

/**
 * `ReviewRunExecutor`'s Project Context wiring (Phase 4) — hermetic: no
 * Docker, no DB, no network, no key. `reviewPullRequest` is mocked so the
 * test can capture exactly what the executor passed it; every repository
 * (`ReviewRepository`, `AgentsRepository`, `SkillsRepository`) is a plain
 * fake object, and `container.git` is `MockGitClient` — the same in-memory
 * fixtures `test/repo-intel-facade-degraded.test.ts` uses for the same
 * reason (a private method under test, reached via a cast).
 */

vi.mock('@devdigest/reviewer-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@devdigest/reviewer-core')>();
  return { ...actual, reviewPullRequest: vi.fn() };
});

const { reviewPullRequest } = await import('@devdigest/reviewer-core');
const mockReviewPullRequest = vi.mocked(reviewPullRequest);

function mockOutcome(): ReviewOutcome {
  return {
    review: { verdict: 'approve', summary: 'looks fine', score: 90, findings: [] },
    grounding: '0/0 passed',
    dropped: [],
    mode: 'single-pass',
    assembly: {
      system: 'sys',
      skills: null,
      memory: null,
      specs: null,
      callers: null,
      repo_map: null,
      pr_description: null,
      intent: null,
      user: 'user prompt',
    },
    chunks: [{ label: 'whole diff' }],
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    raw: 'raw model output',
  };
}

const AGENT_ID = 'agent-1';
const REPO: typeof schema.repos.$inferSelect = {
  id: 'repo-1',
  owner: 'acme',
  name: 'widgets',
} as unknown as typeof schema.repos.$inferSelect;

const AGENT: AgentRow = {
  id: AGENT_ID,
  name: 'Reviewer',
  provider: 'anthropic',
  model: 'claude',
  systemPrompt: 'You are a reviewer.',
  strategy: 'single-pass',
  repoIntel: false, // keep the run focused on project context, not enrichment
  ciFailOn: 'high',
  version: 1,
} as unknown as AgentRow;

const PULL: PullRow = {
  id: 'pull-1',
  repoId: REPO.id,
  number: 42,
  title: 'Add rate limiting',
  author: 'octocat',
  headSha: 'abc123',
  body: '',
} as unknown as PullRow;

const DIFF = { files: [] } as unknown as UnifiedDiff;

/** Builds a `ReviewRunExecutor` with every dependency faked in-memory. */
async function buildExecutor(opts: {
  git: MockGitClient;
  agentContextDocs: (agentId: string, repoId: string) => Promise<Array<{ path: string; order: number }>>;
  skillContextDocsForAgent?: () => Promise<
    Array<{ skillId: string; skillName: string; repoId: string; path: string; order: number }>
  >;
}) {
  const { ReviewRunExecutor } = await import('../src/modules/reviews/run-executor.js');

  const runBus = new RunBus();
  const savedTraces: RunTrace[] = [];

  const countTokens = (t: string) => Math.ceil(t.length / 4);
  const container = {
    db: {} as never,
    git: opts.git,
    tokenizer: { count: countTokens },
    runBus,
    config: { promptLogVerbose: false },
    llm: async () => ({}) as never,
    skillsRepo: {
      contextDocsForAgent: opts.skillContextDocsForAgent ?? (async () => []),
    },
    // Mirrors `container.projectContext`'s real composition (Remediation
    // A1): `reposRepo`/`fileSource`/`countTokens` only — `resolveForRun`'s
    // per-run `agentContextDocs`/`skillContextDocsForAgent` are supplied by
    // `resolveProjectContext` on each call, not baked in here either.
    projectContext: new ProjectContextService({
      reposRepo: new RepoRepository({} as never),
      fileSource: new CloneFileSource(opts.git),
      countTokens,
    }),
  } as unknown as Container;

  const agents = {
    linkedSkills: async () => [],
    contextDocs: opts.agentContextDocs,
  } as unknown as Container['agentsRepo'];

  const repo = {
    insertReview: async () => ({ id: 'review-1' }) as never,
    insertFindings: async () => [],
    markReviewed: async () => undefined,
    completeAgentRun: async () => undefined,
    saveRunTrace: async (_runId: string, trace: RunTrace) => {
      savedTraces.push(trace);
    },
  } as unknown as ReviewRepository;

  const executor = new ReviewRunExecutor(container, repo, agents);
  return { executor, runBus, savedTraces };
}

/** `runOneAgent` is private — reached the same way the sibling fixture file
 *  reaches into `RepoIntelService`'s private `repo` field. */
async function runOneAgent(
  executor: unknown,
  runBus: RunBus,
  runId: string,
  skipSkills?: boolean,
): Promise<{ review: { id: string } }> {
  const parentLog = new RunLogger(runBus, [runId]);
  const fn = (
    executor as {
      runOneAgent: (...args: unknown[]) => Promise<{ review: { id: string } }>;
    }
  ).runOneAgent.bind(executor);
  return fn(
    'workspace-1',
    PULL,
    REPO,
    DIFF,
    AGENT,
    runId,
    'corr-1',
    parentLog,
    undefined,
    skipSkills,
  );
}

beforeEach(() => {
  mockReviewPullRequest.mockReset();
  mockReviewPullRequest.mockResolvedValue(mockOutcome());
});

describe('ReviewRunExecutor — Project Context wiring', () => {
  it('zero resolved documents: the reviewPullRequest call carries no `specs` key', async () => {
    const git = new MockGitClient({ files: {} });
    const { executor, runBus } = await buildExecutor({
      git,
      agentContextDocs: async () => [],
    });

    await runOneAgent(executor, runBus, 'run-1');

    expect(mockReviewPullRequest).toHaveBeenCalledTimes(1);
    const call = mockReviewPullRequest.mock.calls[0]![0];
    expect(call).not.toHaveProperty('specs');
  });

  it('two resolved documents: `specs` is [{path, text}] in order and `skills` carries no document text', async () => {
    const git = new MockGitClient({
      files: {
        'docs/a.md': 'A content',
        'specs/b.md': 'B content',
      },
    });
    const { executor, runBus, savedTraces } = await buildExecutor({
      git,
      agentContextDocs: async () => [
        { path: 'docs/a.md', order: 0 },
        { path: 'specs/b.md', order: 1 },
      ],
    });

    await runOneAgent(executor, runBus, 'run-2');

    const call = mockReviewPullRequest.mock.calls[0]![0];
    expect(call.specs).toEqual([
      { path: 'docs/a.md', text: 'A content' },
      { path: 'specs/b.md', text: 'B content' },
    ]);
    // R10 guard: no linked skills here, so `skills` is omitted entirely — and
    // even when present it must never carry a project-context document's text.
    expect(call).not.toHaveProperty('skills');
    expect(JSON.stringify(call.skills ?? '')).not.toContain('A content');
    expect(JSON.stringify(call.skills ?? '')).not.toContain('B content');

    // The trace persisted both as `included` and denormalised into specs_read.
    const trace = savedTraces.at(-1)!;
    expect(trace.specs_read).toEqual(['docs/a.md', 'specs/b.md']);
    expect(trace.project_context.map((d) => d.path)).toEqual(['docs/a.md', 'specs/b.md']);
    expect(trace.project_context.every((d) => d.status === 'included')).toBe(true);
  });

  it('a resolution failure does not fail the run', async () => {
    const git = new MockGitClient({ files: {} });
    const { executor, runBus, savedTraces } = await buildExecutor({
      git,
      agentContextDocs: async () => {
        throw new Error('DB unavailable');
      },
    });

    const outcome = await runOneAgent(executor, runBus, 'run-3');

    // The run completed and persisted a review — a project-context
    // resolution failure never propagates into a failed/cancelled run.
    expect(outcome.review.id).toBe('review-1');
    const call = mockReviewPullRequest.mock.calls[0]![0];
    expect(call).not.toHaveProperty('specs');
    expect(savedTraces.at(-1)!.project_context).toEqual([]);
  });

  it('`skipSkills` also suppresses skill-inherited documents, not the agent’s own', async () => {
    const git = new MockGitClient({
      files: { 'docs/agent-doc.md': 'agent doc', 'docs/skill-doc.md': 'skill doc' },
    });
    const { executor, runBus } = await buildExecutor({
      git,
      agentContextDocs: async () => [{ path: 'docs/agent-doc.md', order: 0 }],
      skillContextDocsForAgent: async () => [
        { skillId: 's1', skillName: 'lint-rules', repoId: REPO.id, path: 'docs/skill-doc.md', order: 0 },
      ],
    });

    await runOneAgent(executor, runBus, 'run-4', true);

    const call = mockReviewPullRequest.mock.calls[0]![0];
    expect(call.specs).toEqual([{ path: 'docs/agent-doc.md', text: 'agent doc' }]);
  });
});
