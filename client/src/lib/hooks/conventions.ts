"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionsView,
  ConventionSkillDraft,
  CreateConventionSkillBody,
  ExtractConventionsAccepted,
  Skill,
  UpdateConventionBody,
} from "@devdigest/shared";

const conventionsKey = (repoId: string | null | undefined) => ["conventions", repoId] as const;

/** Self-terminating poll — status is terminal-bearing, so it stops itself
 *  once the run reaches `done`/`failed` rather than relying on a flag. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionsKey(repoId),
    queryFn: () => api.get<ConventionsView>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      return status === "queued" || status === "running" ? 1500 : false;
    },
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ExtractConventionsAccepted>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => qc.invalidateQueries({ queryKey: conventionsKey(repoId) }),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: UpdateConventionBody;
}

/** Per-card accept/reject/edit — optimistic, rolled back on error. */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      const key = conventionsKey(repoId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsView>(key);
      if (previous) {
        qc.setQueryData<ConventionsView>(key, {
          ...previous,
          candidates: previous.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(conventionsKey(repoId), context.previous);
    },
    onSuccess: (data) => {
      const key = conventionsKey(repoId);
      const current = qc.getQueryData<ConventionsView>(key);
      if (current) {
        qc.setQueryData<ConventionsView>(key, {
          ...current,
          candidates: current.candidates.map((c) => (c.id === data.id ? data : c)),
        });
      }
    },
  });
}

export interface ConventionDecisionsInput {
  runId: string;
  accepted: boolean;
  ids?: string[];
}

/** "Deselect all" / "Select all" — one request, `ids` omitted = the whole run. */
export function useConventionDecisions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, accepted, ids }: ConventionDecisionsInput) =>
      api.post<{ updated: number }>(`/conventions/runs/${runId}/decisions`, { accepted, ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: conventionsKey(repoId) }),
  });
}

export function useConventionSkillDraft(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["convention-skill-draft", runId],
    queryFn: () => api.get<ConventionSkillDraft>(`/conventions/runs/${runId}/skill-draft`),
    enabled: !!runId,
  });
}

export function useCreateConventionSkill(repoId: string | null | undefined, runId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConventionSkillBody) => api.post<Skill>(`/conventions/runs/${runId}/skill`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conventionsKey(repoId) });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
