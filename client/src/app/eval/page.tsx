"use client";

import { FeaturePlaceholder } from "@/components/feature-placeholder";

/* Route: /eval — placeholder. A later lesson adds the Eval Dashboard (gold
   set of eval cases, recall/precision/citation metrics per run). */
export default function EvalDashboardPage() {
  return (
    <FeaturePlaceholder
      crumb={[{ label: "Skills Lab" }, { label: "Eval Dashboard" }]}
      icon="BarChart"
      title="Eval Dashboard"
      owner="a later lesson"
    />
  );
}
