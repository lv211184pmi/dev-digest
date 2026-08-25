/* hooks/project-context.ts — React Query hooks for the Project Context page
   (Phase 5 client): the read-only document browser over
     GET /repos/:id/project-context        → ProjectContextListing
                                              (409 `repo_not_cloned` when the
                                              repo has never been cloned — R4)
     GET /repos/:id/project-context/usage  → { path, agent_count }
   The existing resync action (`useResyncRepoIntel`, hooks/repo-intel.ts) is
   reused for the not-cloned state's CTA rather than a second one being added
   here — AC 4 offers *the existing* action. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  ProjectContextAttachment,
  ProjectContextDocContent,
  ProjectContextListing,
} from "@devdigest/shared";

/** GET /repos/:id/project-context → the discovered `.md` documents for a repo.
    A repo that has never been cloned rejects with a 409 carrying the
    machine-readable `repo_not_cloned` code on `ApiError.code` — callers branch
    on that, never on the error message text. */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery<ProjectContextListing, ApiError>({
    queryKey: ["project-context", repoId],
    queryFn: () => api.get<ProjectContextListing>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}

/** Response shape of the usage endpoint — not in `@devdigest/shared` (a small,
    single-consumer route response, same precedent as `RepoIntelState` in
    hooks/repo-intel.ts). */
export interface ProjectContextUsage {
  path: string;
  agent_count: number;
}

/** GET /repos/:id/project-context/usage?path=… → distinct enabled agents
    (direct + skill-inherited, deduped) receiving one document. Disabled until
    both a repo and a document path are known, so selecting a document issues
    exactly one request rather than one per listed row. */
export function useProjectContextUsage(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery<ProjectContextUsage, ApiError>({
    queryKey: ["project-context-usage", repoId, path],
    queryFn: () =>
      api.get<ProjectContextUsage>(
        `/repos/${repoId}/project-context/usage?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

/** GET /repos/:id/project-context/doc?path=… → the document's own text, byte
    and token counts (possibly truncated to the same slice a run would
    inject) and its type. The per-path key is what gives R2 (a reopen inside
    the QueryClient's 30 s `staleTime` serves from cache); a 404/422 is an
    *expected* outcome the pane renders inline, and the global `QueryCache`
    (providers.tsx) already toasts on `0`/`≥500` only, so this hook adds no
    `onError` — a per-hook toast here would double-toast. */
export function useProjectContextDoc(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery<ProjectContextDocContent, ApiError>({
    queryKey: ["project-context-doc", repoId, path],
    queryFn: () =>
      api.get<ProjectContextDocContent>(
        `/repos/${repoId}/project-context/doc?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

/* -------------------------------------------------------------------------
   Phase 6/4 — the agent/skill Context tabs (Screens B/C). Revision 3 (AC 51,
   D25) supersedes the staged-then-Saved model D9 established: there is no
   local `staged` set and no Save action. Every tick, untick and drop persists
   **immediately** via the one mutation below per owner kind — the attachment
   list itself lives in the query cache (`onMutate` writes it optimistically),
   never in component `useState`. Both GET/PUT routes are from Phase 2/3 —
   `/agents/:id/context-docs` and `/skills/:id/context-docs`,
   `{ repo_id, paths }` in, `ProjectContextAttachment[]` (path + injection
   order) out; this phase changes call frequency and origin only, not the
   route contract.

   Concurrency (R3, D25): two rapid actions on the same owner+repo must not
   race. Each hook instance keeps its own in-flight `AbortController` and a
   monotonic `seq` ref; issuing a new `PUT` aborts the previous one and only
   the response whose `seq` still matches the ref's current value is ever
   applied to the cache — a superseded response is silently discarded rather
   than clobbering a newer optimistic state.

   `onError`'s rollback (PR1 remediation) cannot simply restore whatever
   `onMutate` snapshotted as `previous` — a supersede-then-fail sequence can
   make that snapshot itself an unconfirmed value: tick A's optimistic write
   sits in the cache, unconfirmed, when tick B's `onMutate` snapshots it as
   *its* `previous`; A is then silently superseded (never confirmed by the
   server) and B's own PUT genuinely fails. Restoring B's `previous`
   unconditionally would resurrect A's phantom, server-unconfirmed state. A
   per-hook-instance `confirmed` ref tracks whether the cache currently holds
   a server-confirmed value; `onMutate` captures that flag *before* writing
   its own optimistic value (so `previousConfirmed` reflects what the
   snapshot actually was), and `onError` only restores `ctx.previous`
   directly when `previousConfirmed` is true — otherwise it invalidates the
   list key so an active observer refetches the real state rather than
   trusting a client-only snapshot that may itself never have been
   confirmed.

   Ticks are deliberately NOT debounced (R5, spec `:842-849`) — each is a
   distinct user decision, and debouncing would blur that into "did the user
   mean this" ambiguity the spec explicitly rejects.
   ------------------------------------------------------------------------- */

export interface SetContextDocsInput {
  repo_id: string;
  /** The full ordered set — one PUT replaces attach/detach/reorder at once
      (D9, AC 11 — carried forward unchanged by D25). Never a partial diff. */
  paths: string[];
}

/** Sentinel returned by `mutationFn` when its own request was aborted because
    a newer one superseded it. A cancellation is not a failure: rethrowing the
    `AbortError` would reach `providers.tsx`'s unconditional
    `MutationCache.onError` and toast "Cannot reach the DevDigest engine" on
    every fast double-tick (the gap the plan's R2/R3 note calls out). */
const SUPERSEDED = Symbol("superseded");

interface MutationResult {
  seq: number;
  data: ProjectContextAttachment[] | typeof SUPERSEDED;
}

/** One factory shared by the agent and skill hooks below — they differ only
    by key prefix and URL, so the cancel-and-replace/optimistic-update wiring
    is written exactly once. The list's query key is `[keyPrefix, ownerId,
    repoId]`, matching `useAgentContextDocs`/`useSkillContextDocs`'s own key
    shape exactly — `repoId` is only known once `mutate` is called (it rides
    on `input.repo_id`), so the key is built per-call inside `onMutate`
    rather than captured once at hook-creation time. */
function useSetContextDocs(
  keyPrefix: "agent-context-docs" | "skill-context-docs",
  ownerId: string | null | undefined,
  urlFor: (ownerId: string) => string
) {
  const qc = useQueryClient();
  const inFlight = React.useRef<AbortController | null>(null);
  const seq = React.useRef(0);
  // Whether the cache currently holds a server-confirmed value (the initial
  // GET, or the last applied `onSuccess` result) rather than another
  // mutation's still-unconfirmed optimistic write. Read in `onMutate`
  // *before* that call's own optimistic write, so `onError`'s rollback can
  // tell whether `ctx.previous` is safe to restore directly (PR1).
  const confirmed = React.useRef(true);

  return useMutation<
    MutationResult,
    ApiError,
    SetContextDocsInput,
    { previous: unknown; listKey: QueryKey; previousConfirmed: boolean }
  >({
    mutationFn: async (input) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const mySeq = ++seq.current;
      try {
        const data = await api.put<ProjectContextAttachment[]>(urlFor(ownerId!), input, {
          signal: controller.signal,
        });
        return { seq: mySeq, data };
      } catch (e) {
        if (controller.signal.aborted) {
          return { seq: mySeq, data: SUPERSEDED };
        }
        throw e;
      }
    },
    onMutate: async (input) => {
      const listKey: QueryKey = [keyPrefix, ownerId, input.repo_id];
      await qc.cancelQueries({ queryKey: listKey });
      const previous = qc.getQueryData(listKey);
      // Capture whether `previous` is itself server-confirmed *before*
      // flipping the flag for this call's own (about to be written)
      // optimistic value — see the module docblock and `onError` (PR1).
      const previousConfirmed = confirmed.current;
      confirmed.current = false;
      qc.setQueryData(
        listKey,
        input.paths.map((path, order) => ({ path, order }))
      );
      return { previous, listKey, previousConfirmed };
    },
    onError: (_err, _input, ctx) => {
      // R2's rollback. No toast here — `providers.tsx`'s `MutationCache`
      // already toasts every mutation failure; a per-hook toast would
      // double-toast (react-query-patterns).
      if (!ctx) return;
      if (ctx.previousConfirmed) {
        // `ctx.previous` was a server-confirmed value when this mutation
        // started — a direct restore is safe and needs no round trip.
        qc.setQueryData(ctx.listKey, ctx.previous);
        confirmed.current = true;
      } else {
        // `ctx.previous` was another mutation's still-unconfirmed
        // optimistic write (a supersede-then-fail sequence, PR1) —
        // restoring it risks resurrecting a state the server never
        // actually applied. Refetch the real state instead of trusting a
        // client-only snapshot that may itself never have been confirmed.
        qc.invalidateQueries({ queryKey: ctx.listKey });
      }
    },
    onSuccess: (result, _input, ctx) => {
      if (result.data === SUPERSEDED) return;
      // A late response from a request that has since been superseded by a
      // newer one must never clobber the newer optimistic state (R3). This
      // also catches the case where a superseded request's underlying
      // fetch resolves normally instead of rejecting (PR2) — its result
      // still carries the stale `seq` it was issued with.
      if (result.seq !== seq.current) return;
      if (ctx) qc.setQueryData(ctx.listKey, result.data);
      // The cache now holds a server-confirmed value again (PR1).
      confirmed.current = true;
      // Attaching/detaching a document changes each document's usage count,
      // but after phase 2 a write cuts no version — the owner's own
      // detail/version keys did not change (AC 53), so invalidating them is
      // work with a wrong justification attached. Also do NOT invalidate
      // the owner's own list key: a refetch racing a newer optimistic write
      // is exactly what cancel-and-replace exists to prevent — the
      // `setQueryData` above is the authoritative write.
      qc.invalidateQueries({ queryKey: ["project-context-usage"] });
    },
  });
}

/** GET /agents/:id/context-docs?repo_id=… → the agent's saved attachment set
    for one repo, in injection order. Disabled until both ids are known so an
    agent with no active repo issues no request. */
export function useAgentContextDocs(
  agentId: string | null | undefined,
  repoId: string | null | undefined
) {
  return useQuery<ProjectContextAttachment[], ApiError>({
    queryKey: ["agent-context-docs", agentId, repoId],
    queryFn: () =>
      api.get<ProjectContextAttachment[]>(
        `/agents/${agentId}/context-docs?repo_id=${repoId}`
      ),
    enabled: !!agentId && !!repoId,
  });
}

/** GET /skills/:id/context-docs?repo_id=… — same shape, for a skill. */
export function useSkillContextDocs(
  skillId: string | null | undefined,
  repoId: string | null | undefined
) {
  return useQuery<ProjectContextAttachment[], ApiError>({
    queryKey: ["skill-context-docs", skillId, repoId],
    queryFn: () =>
      api.get<ProjectContextAttachment[]>(
        `/skills/${skillId}/context-docs?repo_id=${repoId}`
      ),
    enabled: !!skillId && !!repoId,
  });
}

/** PUT /agents/:id/context-docs — persists immediately on every tick, untick
    and drop (R1). Optimistic + cancel-and-replace, see the factory above. */
export function useSetAgentContextDocs(agentId: string | null | undefined) {
  return useSetContextDocs("agent-context-docs", agentId, (id) => `/agents/${id}/context-docs`);
}

/** PUT /skills/:id/context-docs — same, for a skill. Unlike the superseded
    Save model, this write cuts no version (phase 2, AC 53) — so it
    invalidates no `skill`/`skill-versions`/`skills` key; only the usage
    count changes. */
export function useSetSkillContextDocs(skillId: string | null | undefined) {
  return useSetContextDocs("skill-context-docs", skillId, (id) => `/skills/${id}/context-docs`);
}
