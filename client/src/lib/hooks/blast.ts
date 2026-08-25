/* hooks/blast.ts — the PR's Blast Radius: what the diff can impact.

   Two calls, deliberately asymmetric. The GET is free and returns the whole
   deterministic map (symbols, callers, endpoints, crons) with `summary: null`
   when no sentence has been derived. The POST spends money on one cheap LLM
   call to write that sentence and nothing else. So the card renders on mount
   and the summary is opt-in — the reverse of a feature that hides its data
   behind a "generate" button. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrBlastRecord } from "@devdigest/shared";
import { api } from "../api";

/**
 * The PR's impact map.
 *
 * `retry: false` matches `usePrIntent`: the failure modes here are 404 (PR gone)
 * and 4xx, neither of which a retry fixes, and the global QueryCache only toasts
 * network/5xx — so a genuine empty state stays silent and inline.
 *
 * Note what is NOT cached separately: the nodes are recomputed from the index on
 * every request, so a re-index shows up on the next fetch with no invalidation
 * dance. Only the summary is persisted server-side.
 */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<PrBlastRecord>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    retry: false,
  });
}

/** Derive (or re-derive) the one-sentence summary. Spends money; refreshes the card. */
export function useDeriveBlastSummary(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBlastRecord>(`/pulls/${prId}/blast`),
    onSuccess: (data) => {
      // The POST returns the full record, so seed the cache with it rather than
      // invalidating — the map is identical and a refetch would recompute the
      // whole graph server-side for no new information.
      qc.setQueryData(["pr-blast", prId], data);
    },
  });
}
