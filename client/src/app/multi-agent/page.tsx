"use client";

import { FeaturePlaceholder } from "@/components/feature-placeholder";

/* Route: /multi-agent — placeholder. A later lesson composes findings from
   several agents into one reviewer-authored GitHub review. */
export default function MultiAgentReviewPage() {
  return (
    <FeaturePlaceholder
      crumb={[{ label: "Multi-Agent Review" }]}
      icon="Workflow"
      title="Multi-Agent Review"
      owner="a later lesson"
    />
  );
}
