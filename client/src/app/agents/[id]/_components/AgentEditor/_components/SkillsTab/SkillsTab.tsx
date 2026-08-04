"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkills } from "@/lib/hooks/skills";
import { useAgentSkills, useSetAgentSkills } from "@/lib/hooks/agents";
import { SKILL_TYPE_COLOR } from "@/lib/skill-colors";
import { s } from "./styles";

/** Skills tab — every workspace skill, checkbox = linked/unlinked, drag to
 *  reorder the linked ones. Order determines the sequence of "## Skills /
 *  rules" blocks the assembled prompt renders. Pure UI over the existing
 *  GET/POST /agents/:id/skills endpoints — no server change. */
export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const common = useTranslations("common");
  const { data: allSkills } = useSkills();
  const { data: links } = useAgentSkills(agentId);
  const setSkills = useSetAgentSkills(agentId);
  const [filter, setFilter] = React.useState("");
  const dragIndex = React.useRef<number | null>(null);

  if (!allSkills || !links) return <div style={s.loading}>{common("states.loading")}</div>;

  const linkedIds = links
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((l) => l.skill_id);
  const linkedSet = new Set(linkedIds);
  const byId = new Map(allSkills.map((sk) => [sk.id, sk]));
  const linked = linkedIds.map((id) => byId.get(id)).filter((sk): sk is Skill => !!sk);
  const unlinked = allSkills.filter((sk) => !linkedSet.has(sk.id));
  const ordered = [...linked, ...unlinked];
  const query = filter.trim().toLowerCase();
  const visible = query ? ordered.filter((sk) => sk.name.toLowerCase().includes(query)) : ordered;

  const toggle = (skillId: string, checked: boolean) => {
    const next = checked ? [...linkedIds, skillId] : linkedIds.filter((id) => id !== skillId);
    setSkills.mutate(next);
  };

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...linkedIds];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setSkills.mutate(next);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linked.length, total: allSkills.length })}
        </Badge>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("skills.filterPlaceholder")}
        style={s.filterInput}
      />
      <div style={s.list}>
        {visible.map((sk) => {
          const isLinked = linkedSet.has(sk.id);
          const linkedIndex = linkedIds.indexOf(sk.id);
          const colors = SKILL_TYPE_COLOR[sk.type];
          return (
            <div
              key={sk.id}
              style={s.row}
              draggable={isLinked}
              onDragStart={() => {
                dragIndex.current = isLinked ? linkedIndex : null;
              }}
              onDragOver={(e) => {
                if (isLinked) e.preventDefault();
              }}
              onDrop={() => {
                if (isLinked && dragIndex.current !== null) reorder(dragIndex.current, linkedIndex);
                dragIndex.current = null;
              }}
            >
              <span style={s.handle}>{isLinked ? <Icon.Menu size={14} /> : <span style={{ width: 14 }} />}</span>
              <Checkbox checked={isLinked} onChange={(v) => toggle(sk.id, v)} />
              <span style={s.name}>{sk.name}</span>
              <Badge color={colors.color} bg={colors.bg}>
                {sk.type}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
