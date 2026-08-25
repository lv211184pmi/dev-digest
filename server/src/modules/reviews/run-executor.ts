import { randomUUID } from 'node:crypto';
import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { deriveIntent } from './intent/service.js';
import { renderIntentBlock } from './intent/render.js';
import type { ResolvedProjectContext } from '../project-context/domain-services/resolve.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string; skipSkills?: boolean }[],
    logger?: Logger,
  ): Promise<void> {
    // One id for the WHOLE batch: the shared pre-work (diff load, intent
    // classification) plus every agent's review call. It rides on the RunLogger
    // context, so it lands on every stdout line, every SSE event and every
    // persisted trace line without each call site remembering to add it — which
    // is what makes "show me every LLM call for this PR review" one grep.
    const correlationId = randomUUID().slice(0, 8);

    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id, correlationId },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // ---- Derive the PR intent ONCE for the whole batch ---------------------
    // Outside the per-agent loop on purpose: one classification serves every
    // queued run, so a 3-agent fan-out still shows exactly one intent [tool]
    // line and is billed for exactly one call. The cost is stored on `pr_intent`
    // and deliberately NOT added into any run's `costUsd` (see completeAgentRun
    // below) — otherwise a fan-out would triple-count one call.
    //
    // Failure degrades to "no intent section", exactly like buildRepoMapDigest
    // returning undefined. It must NOT go through `failAll`: that path exists
    // for the diff load, without which there is nothing to review at all.
    let intentBlock: string | undefined;
    try {
      const { row, cached } = await runLog.step(
        'Deriving PR intent',
        () =>
          deriveIntent({
            container: this.container,
            repo: this.repo,
            repoRow: repo,
            pull,
            diff,
            workspaceId,
            runLog,
            correlationId,
          }),
        { kind: 'tool' },
      );
      const block = renderIntentBlock({
        intent: row.intent,
        in_scope: row.inScope,
        out_of_scope: row.outOfScope,
        risk_areas: row.riskAreas,
        confidence: row.confidence,
      });
      intentBlock = block.trim().length > 0 ? block : undefined;
      if (!intentBlock) runLog.info('intent: derived block was empty — skipping the prompt section');
      else if (cached) runLog.info('intent: attached to the review prompt (from cache)');
      else runLog.info('intent: attached to the review prompt');
    } catch (err) {
      runLog.info(`intent: ${(err as Error).message} — skipping`);
    }

    for (const { agent, runId, skipSkills } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          correlationId,
          runLog,
          intentBlock,
          skipSkills,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    /** Batch-wide id shared with the intent classifier call — see `executeRuns`. */
    correlationId: string,
    parentLog: RunLogger,
    /** Rendered ONCE for the whole batch by `executeRuns` — never re-derived
     *  per agent. Undefined when the derivation was skipped or failed. */
    intentBlock: string | undefined,
    skipSkills?: boolean,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // Skills (L02) — the agent's linked, enabled skills, in link order.
      // `skipSkills` is the control-experiment override (RunRequest.skip_skills):
      // a one-off "run without skills" for THIS run only, independent of what's
      // linked/enabled on the agent's persisted config.
      const linkedSkills = skipSkills ? [] : await this.agents.linkedSkills(agent.id);
      const skillBodies = linkedSkills.filter((l) => l.skill.enabled).map((l) => l.skill.body);
      runLog.info(
        skipSkills
          ? 'Skills explicitly skipped for this run (control experiment)'
          : skillBodies.length > 0
            ? `Skills: ${skillBodies.length} linked skill(s) attached to the prompt`
            : 'Skills: no enabled skills linked to this agent',
      );

      // Project Context — the agent's own attached documents plus its
      // enabled linked skills' attached documents (Phase 4). Resolved
      // ONCE here, before the engine call, exactly like the enrichment
      // above — never re-resolved per map-reduce chunk (D6: an in-flight
      // run must not disagree with itself about its own context).
      const projectContext = await this.resolveProjectContext(
        workspaceId,
        agent,
        repo,
        runLog,
        skipSkills,
      );

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // Skills (L02) — omitted (assemblePrompt leaves the section out) when
        // there are none linked/enabled, or when skipped for this run.
        ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
        // Project Context — inherited documents belong in the untrusted
        // `## Project context` slot (R10), never in `skills` (which renders
        // as the trusted `## Skills / rules` block). Omitted, same
        // omit-when-empty contract as `repoMap`/`callers` above, when
        // nothing resolved.
        ...(projectContext.specs.length > 0 ? { specs: projectContext.specs } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Derived intent — untrusted (a pure function of author-controlled
        // text); assemblePrompt wraps it and the trusted system message carries
        // the rule for reading it. Same omit-when-absent contract.
        ...(intentBlock ? { intent: intentBlock } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        // Observability only — none of these three change the prompt or the
        // model's input. `countTokens` turns the manifest's `chars` into real
        // token counts; `verbosePromptLog` adds a per-section digest and is
        // hard-gated off in production by `loadConfig`.
        correlationId,
        countTokens: (t) => this.container.tokenizer.count(t),
        verbosePromptLog: this.container.config.promptLogVerbose,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      const keptFindings = outcome.review.findings;

      // ---- Persist review + findings ----------------------------------------
      const review = await this.repo.insertReview({
        workspaceId,
        prId: pull.id,
        agentId: agent.id,
        runId,
        kind: 'review',
        verdict: outcome.review.verdict,
        summary: outcome.review.summary,
        score: outcome.review.score,
        model: agent.model,
      });
      const findingRows = await this.repo.insertFindings(review.id, keptFindings);
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // Mark the commit this review ran against so the PR list can tell
      // reviewed / needs-review (head moved) / stale apart.
      await this.repo.markReviewed(pull.id, pull.headSha);

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Observability: agent_runs + ONE run_traces document --------------
      await this.repo.completeAgentRun(runId, {
        status: 'done',
        durationMs,
        tokensIn,
        tokensOut,
        costUsd,
        findingsCount: findingRows.length,
        grounding,
        score: outcome.review.score,
        blockers,
        error: null,
      });

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
        },
        prompt_assembly: outcome.assembly,
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        // `included`/`truncated` paths only — the denormalised view. The
        // full per-document status list (incl. every skipped one) is
        // `project_context` below.
        specs_read: projectContext.specsRead,
        project_context: projectContext.injected,
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * Project Context (Phase 4) — the agent's own attached documents plus its
   * enabled linked skills' attached documents, read from the clone once.
   * Best-effort, same shape as `buildCallersDigest`/`buildRepoMapDigest`
   * above: a resolution failure is logged and the run continues with none —
   * a document problem must never fail a run (AC 18).
   *
   * **`skipSkills` also suppresses skill-inherited documents.** The spec
   * does not settle whether the `RunRequest.skip_skills` control experiment
   * ("run without skills for this one run") extends to skills' *attached
   * documents* as well as their bodies. Default taken here: yes — the
   * experiment's purpose is "run without this skill's influence", and an
   * inherited document is part of that influence just as much as the
   * skill's body text is. The agent's own direct attachments are
   * unaffected either way. Implemented by omitting
   * `skillContextDocsForAgent` from the per-call arguments passed to
   * `container.projectContext.resolveForRun`, which resolves the agent's
   * own documents only in that case (see `resolveForRun`'s doc comment).
   *
   * `container.projectContext` is the container-composed service —
   * `reposRepo`/`fileSource`/`countTokens` only, built once at the
   * composition root the same way `agentsRepo`/`skillsRepo` are. This
   * method supplies the two per-run functions (`agentContextDocs`,
   * `skillContextDocsForAgent`) as call arguments rather than constructing
   * `RepoRepository`/`CloneFileSource`/`ProjectContextService` inline.
   */
  private async resolveProjectContext(
    workspaceId: string,
    agent: AgentRow,
    repo: typeof schema.repos.$inferSelect,
    runLog: RunLogger,
    skipSkills?: boolean,
  ): Promise<ResolvedProjectContext> {
    try {
      return await this.container.projectContext.resolveForRun(
        workspaceId,
        agent.id,
        repo,
        runLog,
        (agentId, repoId) => this.agents.contextDocs(agentId, repoId),
        skipSkills
          ? undefined
          : (agentId: string) => this.container.skillsRepo.contextDocsForAgent(agentId),
      );
    } catch (err) {
      runLog.info(`project context: resolution failed — ${(err as Error).message}`);
      return { specs: [], injected: [], specsRead: [] };
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      // This path runs on failure/cancel and on pre-work failure — before
      // (or instead of) project-context resolution, so nothing was ever
      // resolved for it to record.
      project_context: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
