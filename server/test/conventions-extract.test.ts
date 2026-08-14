import { describe, it, expect, vi } from 'vitest';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { LlmExtractor } from '../src/modules/conventions/infrastructure/external/llm-extractor.js';
import { ExtractConventionsUseCase } from '../src/modules/conventions/application-services/extract-conventions.js';
import {
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  LLM_TIMEOUT_MS,
  NOT_INDEXED_ERROR,
} from '../src/modules/conventions/domain-model/constants.js';
import type {
  ConventionModel,
  ConventionModelResult,
  ConventionsStore,
  CompletedRunResult,
  RepoFileReader,
  SamplePicker,
} from '../src/modules/conventions/domain-services/ports.js';

describe('LlmExtractor — the single structured call', () => {
  it('calls completeStructured exactly once with schemaName/temperature:0/timeoutMs', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { [CONVENTION_EXTRACTION_SCHEMA_NAME]: { conventions: [] } },
    });
    const extractor = new LlmExtractor(llm, 'openrouter', 'deepseek/deepseek-v4-flash');

    const result = await extractor.extract({ system: 'sys', user: 'user' });

    expect(result.conventions).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.method).toBe('completeStructured');
    const req = llm.calls[0]!.req as {
      schemaName: string;
      temperature: number;
      timeoutMs: number;
      maxRetries: number;
    };
    expect(req.schemaName).toBe('ConventionExtraction');
    expect(req.temperature).toBe(0);
    expect(req.timeoutMs).toBe(LLM_TIMEOUT_MS);
    expect(req.maxRetries).toBe(1);
  });
});

// ---- in-memory fakes for the extraction use case (no DB, no fs, no network) ----

class FakeStore implements ConventionsStore {
  running: string[] = [];
  completed: { runId: string; result: CompletedRunResult }[] = [];
  failed: { runId: string; error: string }[] = [];

  async markRunning(runId: string): Promise<void> {
    this.running.push(runId);
  }
  async completeRun(runId: string, result: CompletedRunResult): Promise<void> {
    this.completed.push({ runId, result });
  }
  async failRun(runId: string, error: string): Promise<void> {
    this.failed.push({ runId, error });
  }
}

class FakeFileReader implements RepoFileReader {
  constructor(private files: Record<string, string>) {}
  async read(path: string): Promise<string | null> {
    return this.files[path] ?? null;
  }
}

class FakeSamplePicker implements SamplePicker {
  constructor(private paths: string[]) {}
  async rankedPaths(): Promise<string[]> {
    return this.paths;
  }
}

class FakeModel implements ConventionModel {
  calls = 0;
  constructor(private result: ConventionModelResult | Error) {}
  async extract(): Promise<ConventionModelResult> {
    this.calls += 1;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const PAYLOAD = { runId: 'run-1', repoId: 'repo-1', workspaceId: 'ws-1' };

describe('ExtractConventionsUseCase — hermetic (no DB, no fs, no network)', () => {
  it('zero-sample repo (unindexed) completes done with 0 candidates, never calls the model', async () => {
    const store = new FakeStore();
    const model = new FakeModel({ conventions: [], provider: 'openrouter', model: 'x', tokensIn: 0, tokensOut: 0, costUsd: 0 });
    const useCase = new ExtractConventionsUseCase({
      store,
      fileReader: new FakeFileReader({}),
      samplePicker: new FakeSamplePicker([]),
      model,
      repoFullName: 'acme/empty-repo',
    });

    await useCase.run(PAYLOAD);

    expect(model.calls).toBe(0);
    expect(store.running).toEqual(['run-1']);
    expect(store.completed).toHaveLength(1);
    expect(store.completed[0]!.result.candidates).toEqual([]);
    expect(store.completed[0]!.result.error).toBe(NOT_INDEXED_ERROR);
  });

  it('ungrounded entries are dropped and counted', async () => {
    const store = new FakeStore();
    const model = new FakeModel({
      conventions: [
        {
          category: 'error_handling',
          rule: 'Domain errors extend AppError with a stable code.',
          evidence: { file: 'src/a.ts', line: 1, snippet: 'export class NotFoundError' },
          confidence: 0.9,
        },
        {
          category: 'naming',
          rule: 'This cites a file that was never sampled at all.',
          evidence: { file: 'src/never-sampled.ts', line: 1, snippet: 'irrelevant' },
          confidence: 0.9,
        },
      ],
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.001,
    });
    const useCase = new ExtractConventionsUseCase({
      store,
      fileReader: new FakeFileReader({ 'src/a.ts': 'export class NotFoundError extends AppError {' }),
      samplePicker: new FakeSamplePicker(['src/a.ts']),
      model,
      repoFullName: 'acme/repo',
    });

    await useCase.run(PAYLOAD);

    expect(model.calls).toBe(1);
    const result = store.completed[0]!.result;
    expect(result.candidates).toHaveLength(1);
    expect(result.droppedCount).toBe(1);
    expect(result.error).toBeNull();
  });

  it('a throwing model call propagates — the use case itself never calls failRun (that is the job handler\'s job)', async () => {
    const store = new FakeStore();
    const model = new FakeModel(new Error('model exploded'));
    const useCase = new ExtractConventionsUseCase({
      store,
      fileReader: new FakeFileReader({ 'src/a.ts': 'export function x() {}' }),
      samplePicker: new FakeSamplePicker(['src/a.ts']),
      model,
      repoFullName: 'acme/repo',
    });

    await expect(useCase.run(PAYLOAD)).rejects.toThrow('model exploded');
    expect(model.calls).toBe(1);
    expect(store.completed).toHaveLength(0);
    expect(store.failed).toHaveLength(0);
  });

  it('anti-retry contract: the job-handler wrapper catches, fails the run, and never rethrows to JobRunner', async () => {
    const store = new FakeStore();
    const model = new FakeModel(new Error('model exploded'));
    const useCase = new ExtractConventionsUseCase({
      store,
      fileReader: new FakeFileReader({ 'src/a.ts': 'export function x() {}' }),
      samplePicker: new FakeSamplePicker(['src/a.ts']),
      model,
      repoFullName: 'acme/repo',
    });

    // Mirrors the exact shape registered in infrastructure/http/routes.ts —
    // the handler must never throw, or JobRunner retries the (paid) model
    // call up to 3x.
    const handler = vi.fn(async (payload: typeof PAYLOAD) => {
      try {
        await useCase.run(payload);
      } catch (e) {
        await store.failRun(payload.runId, (e as Error).message);
      }
    });

    await expect(handler(PAYLOAD)).resolves.toBeUndefined();
    expect(model.calls).toBe(1); // exactly one paid call, not three
    expect(store.failed).toEqual([{ runId: 'run-1', error: 'model exploded' }]);
    expect(store.completed).toHaveLength(0);
  });
});
