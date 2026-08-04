import type { SkillType } from "@devdigest/shared";

/** Badge colour + background for a skill's type — shared by the Skills Lab
 *  cards/detail pane and the Agent Editor's Skills tab. */
export const SKILL_TYPE_COLOR: Record<SkillType, { color: string; bg: string }> = {
  rubric: { color: "var(--info)", bg: "var(--info-bg)" },
  convention: { color: "var(--ok)", bg: "var(--ok-bg)" },
  security: { color: "var(--crit)", bg: "var(--crit-bg)" },
  custom: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};
