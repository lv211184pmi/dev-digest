"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents } from "@/lib/hooks/skills";
import { s } from "./styles";

/**
 * Stats tab — deliberately real-data-only. Findings aren't attributed to a
 * specific skill today (only to a review/agent), so "pull rate" / "accept
 * rate" / "findings by category" would be fabricated numbers. The one honest
 * signal is which agents actually have this skill linked.
 */
export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: agents } = useSkillAgents(skill.id);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("detail.tabs.stats")}</h2>
      </div>
      <div style={s.statsRow}>
        <div style={s.stat}>
          <div style={s.statLabel}>{t("stats.usedBy")}</div>
          <div className="tnum" style={s.statVal}>
            {agents?.length ?? "—"}
          </div>
        </div>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t("stats.agentsUsingSkill")}</h3>
      {agents && agents.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("stats.noAgents")}</p>}
      {(agents ?? []).map((a) => (
        <div key={a.id} style={s.agentRow}>
          <Icon.Cpu size={14} style={{ marginRight: 10, color: "var(--text-muted)" }} />
          <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
          <button
            type="button"
            onClick={() => router.push(`/agents/${a.id}?tab=skills`)}
            style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13 }}
          >
            <Icon.ExternalLink size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
