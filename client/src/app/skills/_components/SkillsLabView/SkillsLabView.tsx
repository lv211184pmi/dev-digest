"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { ErrorState } from "@devdigest/ui";
import { useSkill, useSkills } from "@/lib/hooks/skills";
import { SkillsListPane } from "./_components/SkillsListPane";
import { SkillDetailPane } from "./_components/SkillDetailPane";
import { s } from "./styles";

const VALID_TABS = ["config", "preview", "evals", "stats", "versions"];

/**
 * /skills/:id — master-detail Skills Lab. The list (left) is always visible;
 * the detail pane (right) shows the selected skill's Config/Preview/Evals/
 * Stats/Versions tabs. Mirrors /agents/:id; the active tab lives in ?tab=.
 */
export function SkillsLabView({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: activeSkill } = useSkill(skillId);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (tb: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", tb);
    router.replace(`/skills/${skillId}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: activeSkill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("page.loadError")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.split}>
        <SkillsListPane
          skills={skills}
          isLoading={isLoading}
          activeId={skillId}
          onSelect={(id) => router.push(`/skills/${id}?tab=${tab}`)}
        />
        <div style={s.detail}>
          <SkillDetailPane skillId={skillId} tab={tab} onTab={setTab} />
        </div>
      </div>
    </AppShell>
  );
}
