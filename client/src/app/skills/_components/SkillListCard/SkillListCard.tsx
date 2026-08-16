"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle, type IconName } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents, useDeleteSkill } from "@/lib/hooks/skills";
import { SKILL_TYPE_COLOR } from "@/lib/skill-colors";
import { s } from "./styles";

const SOURCE_ICON: Record<Skill["source"], IconName> = {
  manual: "Edit",
  extracted: "Upload",
  community: "Globe",
  imported_url: "Link",
};

/** A skill card — name, toggle, delete, description, type/source badges, and
 *  the (real, non-fabricated) count of agents that link this skill. Mirrors
 *  AgentCard's layout so it renders consistently in both the Skills grid
 *  (SkillsListView) and the Skills Lab sidebar (SkillsListPane). */
export function SkillListCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const { data: agents } = useSkillAgents(skill.id);
  const del = useDeleteSkill();
  const colors = SKILL_TYPE_COLOR[skill.type];
  const SourceIcon = Icon[SOURCE_ICON[skill.source]];

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox(colors)}>
          <Icon.Sparkles size={14} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(t("card.confirmDelete", { name: skill.name }))) del.mutate(skill.id);
          }}
          disabled={del.isPending}
          title="Delete skill"
          aria-label="Delete skill"
          style={s.deleteButton(del.isPending)}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={colors.color} bg={colors.bg}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <span style={s.sourceTag}>
          <SourceIcon size={12} />
          {t(`listItem.source.${skill.source}`)}
        </span>
        {agents != null && <span style={s.agentCount}>{t("listItem.agentCount", { count: agents.length })}</span>}
      </div>
    </div>
  );
}
