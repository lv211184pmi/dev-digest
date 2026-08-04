"use client";

import React from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

/** Preview tab — the skill body rendered as markdown, "as the reviewing
 *  agent receives it" (the raw text is what's actually sent — this is a
 *  read-only rendering aid, not a second copy of the prompt). */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("detail.tabs.preview")}</h2>
      </div>
      <div style={s.previewBox}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.body}</ReactMarkdown>
      </div>
    </div>
  );
}
