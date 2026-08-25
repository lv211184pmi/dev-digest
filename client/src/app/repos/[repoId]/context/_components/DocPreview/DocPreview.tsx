"use client";

import { useTranslations } from "next-intl";
import { ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import type { ProjectContextDoc } from "@devdigest/shared";
import { useProjectContextDoc, useProjectContextUsage } from "@/lib/hooks";
import { s } from "./styles";

/** The pane for the selected document — its path and the `Used by N agents`
    count (AC 6) in one header section, then the document's own rendered
    markdown filling the rest of the pane (AC 48). Mounted only once a
    document is selected, so both the usage and content queries fire exactly
    once per selection (never before one exists). Authoring is a confirmed
    non-goal, so there is no `Edit` control here at all — removed, not
    disabled. */
export function DocPreview({
  repoId,
  doc,
}: {
  repoId: string;
  doc: ProjectContextDoc;
}) {
  const t = useTranslations("context");
  const usage = useProjectContextUsage(repoId, doc.path);
  const content = useProjectContextDoc(repoId, doc.path);

  return (
    <div style={s.card}>
      <div style={s.header}>
        <div style={s.pathWrap}>
          <span style={s.path}>{doc.path}</span>
        </div>
        <div style={s.usedBy}>
          {usage.isLoading ? (
            <Skeleton width={120} height={13} />
          ) : (
            <span>{t("doc.usedBy", { count: usage.data?.agent_count ?? 0 })}</span>
          )}
        </div>
      </div>

      <div style={s.content}>
        {content.isLoading && <Skeleton height={220} />}
        {content.isError && <ErrorState body={t("doc.loadError")} />}
        {content.isSuccess && (
          <>
            {content.data.truncated && (
              <div style={s.truncatedNote}>{t("doc.truncated")}</div>
            )}
            {content.data.text === "" ? (
              // A 0-byte document is a real, spec-required case (R11/R7): it
              // previews as empty content, not an error. `<Markdown>` returns
              // `null` for an empty string, which left the content area
              // completely bare with no way to tell "genuinely empty" from
              // "something didn't render" (PR3 remediation).
              <div style={s.empty}>{t("doc.empty")}</div>
            ) : (
              <Markdown>{content.data.text}</Markdown>
            )}
          </>
        )}
      </div>
    </div>
  );
}
