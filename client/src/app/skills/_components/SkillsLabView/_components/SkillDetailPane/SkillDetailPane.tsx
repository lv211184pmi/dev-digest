"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import { useSkill } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLOR } from "@/lib/skill-colors";
import { ConfigTab, PreviewTab, ContextTab, StatsTab, VersionsTab } from "./_components/tabs";
import { s } from "./styles";

const TABS = ["config", "preview", "context", "evals", "stats", "versions"] as const;

/** Right pane of the Skills Lab — header (name, type/version badges, "Run on
 *  evals") + the 5 detail tabs for the selected skill. */
export function SkillDetailPane({
  skillId,
  tab,
  onTab,
}: {
  skillId: string;
  tab: string;
  onTab: (t: string) => void;
}) {
  const t = useTranslations("skills");
  const { data: skill, isLoading, isError, refetch } = useSkill(skillId);

  if (isLoading) {
    return (
      <div style={s.loadingPad}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError || !skill) {
    return (
      <ErrorState
        fullScreen
        title={t("detail.notFound.title")}
        body={t("detail.notFound.body")}
        onRetry={() => refetch()}
      />
    );
  }

  const colors = SKILL_TYPE_COLOR[skill.type];
  const activeTab = TABS.includes(tab as (typeof TABS)[number]) ? tab : "config";

  let content: React.ReactNode;
  if (activeTab === "config") content = <ConfigTab skill={skill} />;
  else if (activeTab === "preview") content = <PreviewTab skill={skill} />;
  else if (activeTab === "context") content = <ContextTab skillId={skill.id} />;
  else if (activeTab === "stats") content = <StatsTab skill={skill} />;
  else if (activeTab === "versions") content = <VersionsTab skill={skill} />;
  else content = <EmptyState icon="FlaskConical" title={t("detail.tabs.evals")} body={t("evals.body")} />;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Icon.Sparkles size={18} style={{ color: colors.color }} />
        <h1 style={s.title}>{skill.name}</h1>
        <Badge color={colors.color} bg={colors.bg}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <Badge color="var(--text-secondary)" mono>
          {t("preview.version", { version: skill.version })}
        </Badge>
        {!skill.enabled && <Badge color="var(--text-muted)">{t("detail.disabled")}</Badge>}
        <div style={{ marginLeft: "auto" }}>
          <button
            type="button"
            onClick={() => onTab("evals")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <Icon.Play size={13} />
            {t("detail.runOnEvals")}
          </button>
        </div>
      </div>
      <div style={s.tabsBar}>
        <Tabs
          tabs={TABS.map((tb) => ({ key: tb, label: t(`detail.tabs.${tb}`) }))}
          value={activeTab}
          onChange={onTab}
          pad="0 24px"
        />
      </div>
      <div style={s.body}>{content}</div>
    </div>
  );
}
