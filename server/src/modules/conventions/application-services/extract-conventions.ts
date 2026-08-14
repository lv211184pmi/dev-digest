import { renderPrompt } from '../../../platform/prompts.js';
import { packSamples, type SampleInput } from '../domain-services/sampling.js';
import { groundConventions } from '../domain-services/grounding.js';
import type {
  ConventionModel,
  ConventionsStore,
  RepoFileReader,
  SamplePicker,
} from '../domain-services/ports.js';
import {
  CONFIG_CANDIDATES,
  MAX_CONFIG_FILES,
  NOT_INDEXED_ERROR,
  PACKAGE_JSON_KEYS,
  SOURCE_SAMPLE_N,
} from '../domain-model/constants.js';

export interface ExtractConventionsPayload {
  runId: string;
  repoId: string;
  workspaceId: string;
}

export interface ExtractConventionsDeps {
  store: ConventionsStore;
  fileReader: RepoFileReader;
  samplePicker: SamplePicker;
  model: ConventionModel;
  /** `owner/repo`, used only in the user-message task line. */
  repoFullName: string;
  logger?: { debug: (obj: unknown, msg?: string) => void };
}

/**
 * The extraction use case — invoked by the `CONVENTIONS_JOB_KIND` job
 * handler. Deliberately does NOT catch errors from `model.extract()` itself:
 * letting them propagate is what makes "exactly one `completeStructured`
 * call on failure" possible — the job handler (infrastructure) is the one
 * that catches and calls `store.failRun()`, so JobRunner's handler-level
 * retry (up to 3x) never sees a rejected promise. See `infrastructure/http/
 * routes.ts` job registration and root `INSIGHTS.md`.
 */
export class ExtractConventionsUseCase {
  constructor(private readonly deps: ExtractConventionsDeps) {}

  async run(payload: ExtractConventionsPayload): Promise<void> {
    const { runId, repoId, workspaceId } = payload;
    const { store, fileReader, samplePicker, model, repoFullName, logger } = this.deps;

    await store.markRunning(runId);

    const inputs = await gatherSamples(fileReader, samplePicker, repoId);
    if (inputs.length === 0) {
      // Unindexed repo (or REPO_INTEL_ENABLED=false) — nothing broke, so the
      // run is still `done`, just with zero candidates and a reason.
      await store.completeRun(runId, {
        workspaceId,
        repoId,
        candidates: [],
        sampleCount: 0,
        droppedCount: 0,
        provider: null,
        model: null,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        error: NOT_INDEXED_ERROR,
      });
      return;
    }

    const { files, block } = packSamples(inputs);
    const system = await renderPrompt('conventions.system.md', {});
    const user = `Extract conventions for ${repoFullName}.\n\n${block}`;

    const result = await model.extract({ system, user });

    const { kept, dropped } = groundConventions(result.conventions, files);
    if (logger) {
      for (const d of dropped) {
        logger.debug({ reason: d.reason, rule: d.candidate.rule }, 'conventions: candidate dropped');
      }
    }

    await store.completeRun(runId, {
      workspaceId,
      repoId,
      candidates: kept,
      sampleCount: files.length,
      droppedCount: dropped.length,
      provider: result.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      error: null,
    });
  }
}

/** Configs first (first hit per family, capped), then rank-ordered sources. */
async function gatherSamples(
  fileReader: RepoFileReader,
  samplePicker: SamplePicker,
  repoId: string,
): Promise<SampleInput[]> {
  const inputs: SampleInput[] = [];
  const foundFamilies = new Set<string>();

  for (const candidate of CONFIG_CANDIDATES) {
    if (foundFamilies.has(candidate.family)) continue;
    if (foundFamilies.size >= MAX_CONFIG_FILES) break;
    const content = await fileReader.read(candidate.path);
    if (content == null) continue;
    foundFamilies.add(candidate.family);
    const trimmed = candidate.path === 'package.json' ? trimPackageJson(content) : content;
    inputs.push({ path: candidate.path, kind: 'config', content: trimmed });
  }

  const sourcePaths = await samplePicker.rankedPaths(repoId, SOURCE_SAMPLE_N);
  for (const path of sourcePaths) {
    const content = await fileReader.read(path);
    if (content == null) continue;
    inputs.push({ path, kind: 'source', content });
  }

  return inputs;
}

function trimPackageJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const trimmed: Record<string, unknown> = {};
    for (const key of PACKAGE_JSON_KEYS) {
      if (key in parsed) trimmed[key] = parsed[key];
    }
    return JSON.stringify(trimmed, null, 2);
  } catch {
    return raw; // not valid JSON — pass through, packSamples still budgets it
  }
}
