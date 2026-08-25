"use client";

import { useTranslations } from "next-intl";
import { EmptyState, Skeleton } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useProjectContext,
  useAgentContextDocs,
  useSetAgentContextDocs,
} from "@/lib/hooks/project-context";
import { ContextTab as SharedContextTab } from "@/components/context-tab";

/**
 * Agent Context tab (Screen B) — wires the shared `ContextTab` to
 * `useAgentContextDocs`/`useSetAgentContextDocs`. Every tick, untick and drop
 * persists immediately (R1, D25) — there is no Save action to wire.
 *
 * **Repo scoping default (Open questions):** an agent is workspace-scoped,
 * not repo-scoped, but attachments are per-repo. This tab follows the app
 * shell's active repo (`useActiveRepo`, the same source `:repoId` nav tokens
 * resolve from) rather than asking the agent to carry a repo of its own.
 * When no repo is active, a "select a repo" empty state renders instead of
 * an empty document list — the two read very differently (no repo to attach
 * from vs. this repo genuinely has nothing).
 */
export function ContextTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents.context");
  const { repoId, reposLoaded } = useActiveRepo();

  const { data: listing } = useProjectContext(repoId);
  const { data: saved } = useAgentContextDocs(agentId, repoId);
  const set = useSetAgentContextDocs(agentId);

  if (!reposLoaded) {
    return <Skeleton height={120} />;
  }

  if (!repoId) {
    return <EmptyState icon="GitBranch" title={t("noRepo")} />;
  }

  if (!listing || !saved) {
    return <Skeleton height={120} />;
  }

  return (
    <SharedContextTab
      ownerKind="agent"
      ownerId={agentId}
      repoId={repoId}
      docs={listing.docs}
      attached={saved}
      onSetPaths={(paths) => set.mutate({ repo_id: repoId, paths })}
      t={t}
    />
  );
}
