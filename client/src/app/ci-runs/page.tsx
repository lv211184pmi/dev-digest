"use client";

import { useTranslations } from "next-intl";
import { FeaturePlaceholder } from "@/components/feature-placeholder";

/* Route: /ci-runs — placeholder. A later lesson (Export-to-CI) lists agent
   reviews executed inside GitHub Actions here. */
export default function CiRunsPage() {
  const t = useTranslations("ci");
  return (
    <FeaturePlaceholder
      crumb={[{ label: "CI Runs" }]}
      icon="GitCommit"
      title={t("runs.title")}
      owner="a later lesson"
      body={t("runs.subtitle")}
    />
  );
}
