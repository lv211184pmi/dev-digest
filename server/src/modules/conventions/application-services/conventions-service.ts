import type {
  ConventionCandidate,
  ConventionsView,
  ConventionSkillDraft,
  CreateConventionSkillBody,
  ExtractConventionsAccepted,
  Skill,
  UpdateConventionBody,
} from '@devdigest/shared';
import type { Db } from '../../../db/client.js';
import { AppError, NotFoundError } from '../../../platform/errors.js';
import type { JobRunner } from '../../../platform/jobs.js';
import { CONVENTIONS_JOB_KIND, STALE_RUN_MS, type ConventionCategoryValue } from '../domain-model/constants.js';
import { isStaleActiveRun } from '../domain-model/run.js';
import {
  collectEvidenceFiles,
  deriveSkillName,
  renderConventionsSkillBody,
  type MergeCandidate,
} from '../domain-services/merge.js';
import type { ConventionsRepository } from '../infrastructure/persistence/conventions.repository.js';
import type { SkillsRepository } from '../../skills/repository.js';
import type { RepoRepository } from '../../repos/repository.js';
import { toSkillDto } from '../../skills/helpers.js';
import { toConventionDto, toConventionRunDto } from '../helpers.js';

/**
 * HTTP-facing conventions use cases — everything EXCEPT the extraction run
 * itself (that's `ExtractConventionsUseCase`, invoked by the job handler).
 * Dependencies are concrete repository instances resolved from the
 * container at the composition root (`infrastructure/http/routes.ts`),
 * mirroring `container.skillsRepo`/`container.agentsRepo` — this flow's
 * DB-backed correctness is exercised by `conventions.it.test.ts`, so a port
 * abstraction here would buy hermetic-testability nothing new bought already
 * by the extraction use case's own ports.
 */
export interface ConventionsServiceDeps {
  repo: ConventionsRepository;
  skillsRepo: SkillsRepository;
  reposRepo: RepoRepository;
  db: Db;
  jobs: JobRunner;
}

export class ConventionsService {
  constructor(private readonly deps: ConventionsServiceDeps) {}

  async extract(workspaceId: string, repoId: string): Promise<ExtractConventionsAccepted> {
    const { repo, reposRepo, jobs } = this.deps;
    const repoRow = await reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const active = await repo.getActiveRunForRepo(repoId);
    if (active) {
      if (isStaleActiveRun(active.createdAt, STALE_RUN_MS)) {
        await repo.failRun(active.id, 'stale run superseded by a new extraction');
      } else {
        throw activeRunConflict(active.id);
      }
    }

    let run;
    try {
      run = await repo.createRun(workspaceId, repoId);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await repo.getActiveRunForRepo(repoId);
        if (winner) throw activeRunConflict(winner.id);
      }
      throw err;
    }

    let jobId: string | null = null;
    try {
      const job = await jobs.enqueue(workspaceId, CONVENTIONS_JOB_KIND, {
        runId: run.id,
        repoId,
        workspaceId,
      });
      jobId = job.id;
    } catch {
      // Degraded path — the run stays `queued`; the boot reaper or a manual
      // re-scan recovers it. Mirrors repo-intel/routes.ts's resync handler.
    }

    return { status: 'accepted', run_id: run.id, job_id: jobId };
  }

  async getView(workspaceId: string, repoId: string): Promise<ConventionsView> {
    const repoRow = await this.deps.reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    const run = await this.deps.repo.getLatestRun(workspaceId, repoId);
    if (!run) return { run: null, candidates: [] };

    const candidates = await this.deps.repo.listCandidates(run.id);
    return { run: toConventionRunDto(run), candidates: candidates.map(toConventionDto) };
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: UpdateConventionBody,
  ): Promise<ConventionCandidate> {
    const row = await this.deps.repo.updateCandidate(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention candidate not found');
    return toConventionDto(row);
  }

  async decisions(
    workspaceId: string,
    runId: string,
    accepted: boolean,
    ids?: string[],
  ): Promise<{ updated: number }> {
    const run = await this.deps.repo.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Convention run not found');
    const updated = await this.deps.repo.setDecisions(runId, accepted, ids);
    return { updated };
  }

  async skillDraft(workspaceId: string, runId: string): Promise<ConventionSkillDraft> {
    const { repoRow, accepted } = await this.acceptedContext(workspaceId, runId);
    const mergeCandidates = toMergeCandidates(accepted);

    return {
      name: deriveSkillName(repoRow.fullName),
      description: `Extracted conventions for ${repoRow.fullName}.`,
      type: 'convention',
      enabled: true,
      body: renderConventionsSkillBody(repoRow.fullName, mergeCandidates),
      evidence_files: collectEvidenceFiles(mergeCandidates),
      source_count: accepted.length,
      repo_name: repoRow.fullName,
    };
  }

  /** Skill insert + `skill_versions` v1 + `convention_runs.skill_id` in ONE transaction. */
  async createSkill(
    workspaceId: string,
    runId: string,
    input: CreateConventionSkillBody,
  ): Promise<Skill> {
    const { accepted } = await this.acceptedContext(workspaceId, runId);
    const evidenceFiles = collectEvidenceFiles(toMergeCandidates(accepted));

    return this.deps.db.transaction(async (tx) => {
      const skillRow = await this.deps.skillsRepo.insert(
        {
          workspaceId,
          name: input.name,
          description: input.description,
          type: input.type,
          source: 'extracted',
          body: input.body,
          enabled: input.enabled,
          evidenceFiles,
        },
        tx,
      );
      await this.deps.repo.attachSkill(runId, skillRow.id, tx);
      return toSkillDto(skillRow);
    });
  }

  private async acceptedContext(workspaceId: string, runId: string) {
    const run = await this.deps.repo.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Convention run not found');
    const repoRow = await this.deps.reposRepo.getById(workspaceId, run.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const accepted = await this.deps.repo.acceptedCandidates(runId);
    if (accepted.length === 0) {
      throw new AppError('no_accepted_candidates', 'No accepted candidates to build a skill from', 409);
    }
    return { run, repoRow, accepted };
  }
}

function toMergeCandidates(rows: { category: string; rule: string; confidence: number | null; evidencePath: string | null; evidenceStartLine: number | null }[]): MergeCandidate[] {
  return rows.map((c) => ({
    category: c.category as ConventionCategoryValue,
    rule: c.rule,
    confidence: c.confidence ?? 0,
    evidencePath: c.evidencePath ?? '',
    evidenceStartLine: c.evidenceStartLine ?? 1,
  }));
}

function activeRunConflict(runId: string): AppError {
  return new AppError(
    'conventions_run_active',
    'An extraction is already running for this repo',
    409,
    { run_id: runId },
  );
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
