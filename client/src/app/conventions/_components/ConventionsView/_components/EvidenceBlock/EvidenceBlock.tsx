"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

/** `path:start-end` header + copy + a mono snippet block. Copy pattern lifted
 *  from RunTraceDrawer's PromptBlock (clipboard + 1200ms flip-back) — there
 *  is no shared primitive for this in @devdigest/ui. */
export function EvidenceBlock({
  path,
  startLine,
  endLine,
  snippet,
}: {
  path: string;
  startLine: number | null | undefined;
  endLine: number | null | undefined;
  snippet: string;
}) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);

  const location = startLine ? (endLine && endLine !== startLine ? `${path}:${startLine}-${endLine}` : `${path}:${startLine}`) : path;

  const copy = () => {
    void navigator.clipboard?.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={s.block}>
      <div style={s.head}>
        <span className="mono" style={s.path}>
          {location}
        </span>
        <button
          type="button"
          title={t("card.copyEvidence")}
          aria-label={t("card.copyEvidence")}
          onClick={copy}
          style={s.copyBtn}
        >
          {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
        </button>
      </div>
      <pre className="mono" style={s.pre}>
        {snippet}
      </pre>
    </div>
  );
}
