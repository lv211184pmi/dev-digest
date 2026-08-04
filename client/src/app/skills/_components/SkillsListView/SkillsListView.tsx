/* /skills — Skills list (grid). Mirrors AgentsListView so the two Skills Lab
   list pages read as one system. Selecting a skill navigates to the
   master-detail editor at /skills/:id. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillListCard } from "../SkillListCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [creating, setCreating] = React.useState(false);
  const [importTab, setImportTab] = React.useState<"file" | "community" | null>(null);
  const [search, setSearch] = React.useState("");

  const list = filterSkills(skills ?? [], search);
  const goToSkill = (id: string) => router.push(`/skills/${id}?tab=config`);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={goToSkill} />}
      {importTab && (
        <ImportSkillDrawer initialTab={importTab} onClose={() => setImportTab(null)} onImported={goToSkill} />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.createFromScratch"), icon: "Edit", onClick: () => setCreating(true) },
              { label: t("page.importFromFile"), icon: "Upload", onClick: () => setImportTab("file") },
              { label: t("page.searchCommunity"), icon: "Globe", onClick: () => setImportTab("community") },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setImportTab("file")}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillListCard
                key={sk.id}
                skill={sk}
                onClick={() => goToSkill(sk.id)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
