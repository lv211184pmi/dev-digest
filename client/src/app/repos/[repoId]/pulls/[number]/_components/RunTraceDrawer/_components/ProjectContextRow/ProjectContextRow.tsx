/* ProjectContextRow — the Configuration section's per-document status list,
   beside the existing "Specs read:" row. One line per `trace.project_context`
   entry: path, ≈token count, the inheriting skill when the attachment came
   from a skill rather than the agent directly, and a status badge for
   anything other than `included` (AC 25). The existing "Specs read:" row
   (TraceBody.tsx) keeps rendering `trace.specs_read` unchanged — this is an
   addition beside it, not a replacement. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { ProjectContextInjected, ProjectContextStatus } from "@devdigest/shared";
import { s } from "../../styles";

/** Every status other than `included` gets a badge, keyed to its own
    translation under `runs.trace.projectContext.status.*`. */
const STATUS_KEY: Record<Exclude<ProjectContextStatus, "included">, string> = {
  truncated: "trace.projectContext.status.truncated",
  skipped_budget: "trace.projectContext.status.skippedBudget",
  skipped_missing: "trace.projectContext.status.skippedMissing",
  skipped_empty: "trace.projectContext.status.skippedEmpty",
  skipped_other_repo: "trace.projectContext.status.skippedOtherRepo",
};

/** R38: every ancestor of a rendered repo-relative path gets `minWidth: 0`,
    and the path itself wraps with `overflowWrap: "anywhere"` — see styles.ts. */
export function ProjectContextRow({ docs }: { docs: ProjectContextInjected[] }) {
  const t = useTranslations("runs");

  // AC 22 applies to the assembly block; an empty per-document list here
  // simply doesn't render, rather than showing an empty "none" line — a run
  // that attached nothing has no Configuration list to show at all.
  if (docs.length === 0) return null;

  return (
    <div style={s.projectContextList}>
      {docs.map((doc) => (
        <div key={doc.path} style={s.projectContextRow}>
          <span className="mono" style={s.projectContextPath}>
            {doc.path}
          </span>
          <span style={s.projectContextTokens}>
            {t("trace.projectContext.tokens", { count: doc.tokens })}
          </span>
          {doc.inherited_from != null && (
            <span style={s.projectContextInherited}>
              {t("trace.projectContext.inheritedFrom", { skill: doc.inherited_from })}
            </span>
          )}
          {doc.status !== "included" && (
            <Badge color="var(--warn)" bg="var(--warn-bg)">
              {t(STATUS_KEY[doc.status])}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}
