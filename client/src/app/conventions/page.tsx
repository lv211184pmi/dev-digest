"use client";

import { useTranslations } from "next-intl";
import { FeaturePlaceholder } from "@/components/feature-placeholder";

/* Route: /conventions — placeholder. A later lesson scans the repo for
   house-rules and lets you turn each into a Skill. */
export default function ConventionsPage() {
  const t = useTranslations("conventions");
  return (
    <FeaturePlaceholder
      crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}
      icon="ListChecks"
      title="Conventions"
      owner="a later lesson"
      body={t("page.subtitle")}
    />
  );
}
