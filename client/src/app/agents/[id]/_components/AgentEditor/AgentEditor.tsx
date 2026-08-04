/* AgentEditor — 5-tab editor. Config + Skills (L02) are fully built; Evals/
   Stats/CI render the shared mount placeholder until their own lessons land.
   Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  const activeTab = TABS.find((tb) => tb.key === tab) ?? TABS[0]!;

  let content: React.ReactNode;
  if (tab === "config") content = <ConfigTab agent={agent} />;
  else if (tab === "skills") content = <SkillsTab agentId={agent.id} />;
  else {
    content = (
      <EmptyState
        icon={activeTab.icon}
        title={t(activeTab.labelKey)}
        body={t("mount.body", { owner: "a later lesson" })}
      />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>{content}</div>
    </div>
  );
}
