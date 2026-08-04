"use client";

import { useTranslations } from "next-intl";
import { FeaturePlaceholder } from "@/components/feature-placeholder";

/* Route: /agent-performance — placeholder. The AgentPerf contract + messages
   already exist (server/src/vendor/shared/contracts/productionize.ts), but
   the GET /agents/performance endpoint itself is separate scope from Skills —
   flagged as good follow-up work rather than pulled into this task. */
export default function AgentPerformancePage() {
  const t = useTranslations("agentPerformance");
  return (
    <FeaturePlaceholder
      crumb={[{ label: "Agent Performance" }]}
      icon="TrendingUp"
      title={t("title")}
      owner="a later lesson"
      body={t("subtitle")}
    />
  );
}
