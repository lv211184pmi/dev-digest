import type {
  ProjectContextAttachment,
  ProjectContextDoc,
  ProjectContextDocContent,
  ProjectContextListing,
  RepoRef,
} from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../../platform/errors.js';
import type { RunLogger } from '../../../platform/run-logger.js';
import type { RepoRepository } from '../../repos/repository.js';
import { safeRepoPath } from '../../reviews/intent/sources.js';
import {
  MAX_DISCOVERED_FILES,
  MAX_DOC_CHARS,
  MAX_DOC_READ_BYTES,
  PROJECT_CONTEXT_GLOBS,
} from '../domain-model/constants.js';
import { docTypeFor, toDoc } from '../domain-services/discovery.js';
import type { ProjectContextFileSource } from '../domain-services/ports.js';
import {
  resolveProjectContext,
  type Candidate,
  type ResolvedProjectContext,
} from '../domain-services/resolve.js';

/**
 * `list()` implements R1/R2/R4/R34/R35 — the discovery use case behind
 * `GET /repos/:id/project-context`. Runs no LLM call and reads no file
 * content; every millisecond is `GitClient.listFiles`'s walk + stat.
 *
 * `resolveForRun()` (Phase 4) is the run-time counterpart: it DOES read file
 * content, once per run, for `run-executor.ts`'s prompt-assembly call.
 */
export interface ProjectContextServiceDeps {
  reposRepo: RepoRepository;
  fileSource: ProjectContextFileSource;
  /** Defaults to the `chars/4` heuristic when absent (tests only —
   *  production always passes `container.tokenizer.count`). */
  countTokens?: (text: string) => number;
}

/**
 * `resolveForRun()`-only dependencies — narrow function ports rather than
 * the concrete `AgentsRepository`/`SkillsRepository` classes, so this
 * application service does not couple to another module's repository shape.
 * Passed per call, not baked into `ProjectContextServiceDeps`: unlike
 * `reposRepo`/`fileSource`/`countTokens` (container-wide, resolved once by
 * `container.projectContext`), which agent is running and whether
 * `skipSkills` applies are per-run concerns the container cannot know in
 * advance.
 */
export type AgentContextDocsFn = (
  agentId: string,
  repoId: string,
) => Promise<ProjectContextAttachment[]>;
export type SkillContextDocsForAgentFn = (
  agentId: string,
) => Promise<
  Array<{ skillId: string; skillName: string; repoId: string; path: string; order: number }>
>;

/** One row before it becomes a `Candidate` — not yet read, not yet typed. */
interface RawCandidate {
  path: string;
  order: number;
  inheritedFrom: string | null;
  repoMatches: boolean;
}

/**
 * A synthetic confinement root — `safeRepoPath` is re-applied to every path
 * the file-source adapter emits (Constraints: "Every path leaving the
 * discovery adapter is re-checked through it") purely as a STRUCTURAL check
 * (no `..` segment, not absolute, no NUL). No filesystem access happens
 * against this root; `GitClient.listFiles` already derives its paths from a
 * real walk rooted at the clone and cannot itself emit a traversal, so this
 * is defense in depth, not the primary guard.
 */
const SAFE_PATH_ROOT = '/project-context-root';

export class ProjectContextService {
  constructor(private readonly deps: ProjectContextServiceDeps) {}

  async list(workspaceId: string, repoId: string): Promise<ProjectContextListing> {
    const { reposRepo, fileSource } = this.deps;
    const repoRow = await reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // `repos.clone_path` is the DB's authoritative "has this ever been
    // cloned" signal (set by `RepoRepository.updateClonePath` once a clone
    // job completes) — same pattern `repo-intel/service.ts` uses. A missing
    // clone is a DISTINCT, typed failure (R4): the route maps this to a 409,
    // never a 200 with an empty `docs: []`, which means something else (AC 3).
    if (!repoRow.clonePath) throw repoNotClonedError();

    const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };
    const entries = await fileSource.listMarkdown(ref, PROJECT_CONTEXT_GLOBS, MAX_DISCOVERED_FILES);

    // `fileSource.listMarkdown` (backed by `GitClient.listFiles`) may return
    // one entry beyond `MAX_DISCOVERED_FILES` on purpose (see
    // `simple-git.ts`'s `listFiles()`), so `> ` — not `>=` — is the correct
    // truncation test: a repo with EXACTLY `MAX_DISCOVERED_FILES` matching
    // documents is not truncated, only one with MORE than that is. The extra
    // entry (when present) is never returned to the caller.
    const truncated = entries.length > MAX_DISCOVERED_FILES;
    const capped = truncated ? entries.slice(0, MAX_DISCOVERED_FILES) : entries;

    const docs: ProjectContextDoc[] = [];
    for (const entry of capped) {
      if (safeRepoPath(SAFE_PATH_ROOT, entry.path) === null) continue;
      const doc = toDoc(entry);
      if (doc) docs.push(doc);
    }
    docs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return {
      repo_id: repoId,
      docs,
      truncated,
      discovered_at: new Date().toISOString(),
      roots: [...PROJECT_CONTEXT_GLOBS],
    };
  }

  /**
   * `GET /repos/:id/project-context/doc`'s use case (Revision 2). Serves a
   * document's text only if `path` is a member of the CURRENT discovery
   * listing (R3) — membership, not existence, is the gate; a path that
   * exists in the clone but was never discoverable is rejected the same way
   * as one that never existed. `list()` has already re-confined every
   * emitted path through `safeRepoPath` (R9), so a member path cannot be an
   * escape attempt.
   *
   * Errors: `list()`'s own `NotFoundError`/`repoNotClonedError` propagate
   * unchanged (R4) — not duplicated here. A `path` absent from the listing
   * throws `ValidationError` (422, R3), the same shape
   * `agents/routes.ts`'s `assertDiscoverable` uses. A member `path` whose
   * known `bytes` exceeds `MAX_DOC_READ_BYTES` also throws `ValidationError`
   * (422) — checked BEFORE `readRaw`, so an oversized file is never loaded
   * into memory (remediation PR1). A member `path` whose `readRaw` comes back
   * `null` (deleted between listing and read, or an unreadable clone) throws
   * `NotFoundError('document_not_found')` (R5).
   */
  async readDoc(workspaceId: string, repoId: string, path: string): Promise<ProjectContextDocContent> {
    const listing = await this.list(workspaceId, repoId);

    const doc = listing.docs.find((d) => d.path === path);
    if (!doc) {
      throw new ValidationError('Path is not a currently discoverable document', {
        invalid_paths: [path],
      });
    }

    // `doc.bytes` comes from the discovery walk's `stat()` — known BEFORE any
    // read. Reject an oversized document here, rather than after
    // `readRaw` has already loaded it whole into memory: this route is
    // reachable per-request by any authenticated workspace member, so an
    // uncapped read would be a memory-exhaustion vector. Comfortably above
    // MAX_DOC_CHARS on purpose — this bounds worst-case memory, it is not a
    // second truncation cap (that is R6, applied below on the actual text).
    if (doc.bytes > MAX_DOC_READ_BYTES) {
      throw new ValidationError('Document exceeds the maximum readable size', {
        path,
        bytes: doc.bytes,
        max_bytes: MAX_DOC_READ_BYTES,
      });
    }

    const { reposRepo, fileSource } = this.deps;
    const repoRow = await reposRepo.getById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const ref: RepoRef = { owner: repoRow.owner, name: repoRow.name };

    const text = await fileSource.readRaw(ref, path);
    if (text === null) throw new NotFoundError('document_not_found');

    // `>`, not `>=` — a document of exactly MAX_DOC_CHARS is NOT truncated
    // (R6), the same inclusive-cap convention `list()` uses for
    // MAX_DISCOVERED_FILES above. `''` (R7) falls through untruncated.
    const truncated = text.length > MAX_DOC_CHARS;
    const slice = truncated ? text.slice(0, MAX_DOC_CHARS) : text;
    const countTokens = this.deps.countTokens ?? ((t: string) => Math.ceil(t.length / 4));

    return {
      path,
      type: doc.type,
      bytes: slice.length,
      tokens: countTokens(slice),
      text: slice,
      truncated,
    };
  }

  /**
   * Run-time resolution (Phase 4): the agent's own attached documents plus
   * its enabled linked skills' attached documents, read from the clone once,
   * capped and budgeted, ready for `reviewPullRequest`'s `specs` slot and
   * `RunTrace.project_context`/`specs_read`. Implements R14/R18/R19/R36.
   *
   * `workspaceId` is not read by this method today (`agentContextDocs`/
   * `skillContextDocsForAgent` are already scoped to `agentId`) — it is part
   * of the signature because every other run-scoped read in this codebase
   * carries it, and a future workspace-scoped check should not need a
   * signature change to add.
   *
   * `agentContextDocs`/`skillContextDocsForAgent` are passed per call, not
   * read from `this.deps` — they are per-run concerns (which agent, and
   * whether `skipSkills` applies to THIS run), while `this.deps` holds only
   * the container-wide `reposRepo`/`fileSource`/`countTokens` composed once
   * by `container.projectContext`. Omitting `skillContextDocsForAgent` (as
   * opposed to `agentContextDocs`, which gates the whole method) means
   * "resolve the agent's own attachments only, no skill-inherited ones" —
   * this is the caller's `skipSkills` (`RunRequest.skip_skills`) knob: the
   * control experiment's purpose is "run without this skill's influence",
   * and its attached documents are part of that influence, while the
   * agent's own direct attachments are unaffected (`run-executor.ts`'s
   * `resolveProjectContext` helper is where this is decided per run).
   *
   * Never throws: a missing `agentContextDocs` (the `list()`-only wiring
   * never calls this method at all) degrades to "no project context" rather
   * than failing the run, matching every other failure mode this method
   * handles (AC 18).
   */
  async resolveForRun(
    workspaceId: string,
    agentId: string,
    repo: { id: string; owner: string; name: string },
    log: RunLogger,
    agentContextDocs?: AgentContextDocsFn,
    skillContextDocsForAgent?: SkillContextDocsForAgentFn,
  ): Promise<ResolvedProjectContext> {
    void workspaceId;
    const { fileSource } = this.deps;
    if (!agentContextDocs) {
      return { specs: [], injected: [], specsRead: [] };
    }

    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const [agentRows, skillRows] = await Promise.all([
      agentContextDocs(agentId, repo.id),
      skillContextDocsForAgent ? skillContextDocsForAgent(agentId) : Promise.resolve([]),
    ]);

    // Agent rows first, in their own order; skill rows after, in
    // `(skill link order, doc order)` — `contextDocsForAgent` already
    // returns them ordered that way (R9). Skill rows are deliberately
    // unfiltered by repo so a cross-repo row is observable as
    // `skipped_other_repo` rather than silently dropped (R19).
    const raw: RawCandidate[] = [
      ...agentRows.map((row): RawCandidate => ({
        path: row.path,
        order: row.order,
        inheritedFrom: null,
        repoMatches: true,
      })),
      ...skillRows.map((row): RawCandidate => ({
        path: row.path,
        order: row.order,
        inheritedFrom: row.skillName,
        repoMatches: row.repoId === repo.id,
      })),
    ];

    // Keyed by path, first occurrence only — mirrors `resolveProjectContext`'s
    // own dedup rule, so the byte count logged for a path is always the one
    // that survives into `injected`.
    const byPath = new Map<string, { text: string | null }>();
    const candidates: Candidate[] = [];
    for (const row of raw) {
      // Confinement + read only for a same-repo row; a cross-repo row is
      // never touched by `readFile` at all — its status is decided by
      // `repoMatches` alone.
      const text = row.repoMatches ? await fileSource.read(ref, row.path) : null;
      if (!byPath.has(row.path)) byPath.set(row.path, { text });
      candidates.push({
        path: row.path,
        type: docTypeFor(row.path) ?? 'docs',
        order: row.order,
        inheritedFrom: row.inheritedFrom,
        repoMatches: row.repoMatches,
        text,
      });
    }

    const countTokens = this.deps.countTokens ?? ((t: string) => Math.ceil(t.length / 4));
    const result = resolveProjectContext(candidates, countTokens);

    for (const doc of result.injected) {
      const bytes = byPath.get(doc.path)?.text?.length ?? 0;
      // Path, bytes and tokens only — never the document's text (R36,
      // matching `intent/gather.ts:104`).
      log.info(
        `project context: ${doc.path} (${bytes} bytes, ${doc.tokens} tokens) — ${doc.status}` +
          (doc.inherited_from ? ` [inherited from ${doc.inherited_from}]` : ''),
      );
    }

    return result;
  }
}

/** Stable machine-readable code so the client can distinguish "not cloned"
 *  (offer `POST /repos/:id/resync`) from every other error shape. */
function repoNotClonedError(): AppError {
  return new AppError('repo_not_cloned', 'Repo has not been cloned yet', 409);
}
