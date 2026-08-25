"use client";

import { useTranslations } from "next-intl";
import { EmptyState, Skeleton } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useProjectContext,
  useSkillContextDocs,
  useSetSkillContextDocs,
} from "@/lib/hooks/project-context";
import { ContextTab as SharedContextTab } from "@/components/context-tab";

/**
 * Skill Context tab (Screen C) — same wiring as the agent Context tab
 * (`AgentEditor/_components/ContextTab`), against `useSkillContextDocs`/
 * `useSetSkillContextDocs` instead. Every tick, untick and drop persists
 * immediately (R1, D25) — there is no Save action to wire. Same active-repo
 * resolution and same no-repo empty state: a skill is workspace-scoped,
 * attachments are per-repo, so this follows the app shell's active repo
 * rather than asking the skill to carry one.
 */
export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills.context");
  const { repoId, reposLoaded } = useActiveRepo();

  const { data: listing } = useProjectContext(repoId);
  const { data: saved } = useSkillContextDocs(skillId, repoId);
  const set = useSetSkillContextDocs(skillId);

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
      ownerKind="skill"
      ownerId={skillId}
      repoId={repoId}
      docs={listing.docs}
      attached={saved}
      onSetPaths={(paths) => set.mutate({ repo_id: repoId, paths })}
      t={t}
    />
  );
}
