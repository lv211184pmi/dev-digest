"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { SkillListCard } from "../../../SkillListCard";
import { CreateSkillModal } from "../../../CreateSkillModal";
import { ImportSkillDrawer } from "../../../ImportSkillDrawer";
import { s } from "./styles";

/** Left pane of the Skills Lab: search + "Add Skill" (create/import) + the
 *  skill list. Selecting a skill navigates to /skills/:id. */
export function SkillsListPane({
  skills,
  isLoading,
  activeId,
  onSelect,
}: {
  skills: Skill[] | undefined;
  isLoading: boolean;
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importTab, setImportTab] = React.useState<"file" | "community" | null>(null);

  const query = search.trim().toLowerCase();
  const list = (skills ?? []).filter((sk) => !query || sk.name.toLowerCase().includes(query));

  return (
    <div style={s.pane}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={onSelect} />}
      {importTab && (
        <ImportSkillDrawer initialTab={importTab} onClose={() => setImportTab(null)} onImported={onSelect} />
      )}
      <div style={s.header}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
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
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <div style={s.list}>
        {isLoading && (
          <>
            <Skeleton height={80} style={{ marginBottom: 8 }} />
            <Skeleton height={80} style={{ marginBottom: 8 }} />
            <Skeleton height={80} />
          </>
        )}
        {!isLoading && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setImportTab("file")}
          />
        )}
        {list.map((sk) => (
          <SkillListCard
            key={sk.id}
            skill={sk}
            active={sk.id === activeId}
            onClick={() => onSelect(sk.id)}
            onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
          />
        ))}
      </div>
    </div>
  );
}
