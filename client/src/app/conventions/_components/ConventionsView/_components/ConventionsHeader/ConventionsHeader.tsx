"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { ConventionRun } from "@devdigest/shared";
import { relativeTime } from "../../helpers";
import { s } from "./styles";

/** Heading + subtitle + the Run extraction / Re-scan action — shown across
 *  every state once a repo is active. */
export function ConventionsHeader({
  repoName,
  run,
  onRescan,
  pending,
}: {
  repoName: string;
  run: ConventionRun | null;
  onRescan: () => void;
  pending: boolean;
}) {
  const t = useTranslations("conventions");
  const scanning = run?.status === "queued" || run?.status === "running";

  const subtitle =
    run?.status === "done" && run.sample_count > 0
      ? t("page.subtitleDetected", { count: run.sample_count, ago: relativeTime(run.finished_at) })
      : run?.status === "failed"
        ? t("page.extractionFailed")
        : scanning
          ? t("page.scanning")
          : run
            ? t("page.subtitle")
            : t("page.neverScanned");

  return (
    <div style={s.header}>
      <div style={s.headerText}>
        <h1 style={s.h1}>
          {t("page.headingPrefix")}
          {repoName}
        </h1>
        <p style={s.subtitle}>{subtitle}</p>
      </div>
      <Button
        kind={run ? "secondary" : "primary"}
        icon={run ? "RefreshCw" : "Play"}
        onClick={onRescan}
        disabled={pending || scanning}
        loading={pending || scanning}
      >
        {run ? t("page.rescan") : t("page.runExtraction")}
      </Button>
    </div>
  );
}
