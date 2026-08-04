"use client";

import { FeaturePlaceholder } from "@/components/feature-placeholder";

/* Route: /memory — placeholder. A later lesson surfaces pgvector-backed
   memory items created by the "Learn" action on findings. */
export default function MemoryPage() {
  return (
    <FeaturePlaceholder crumb={[{ label: "Memory" }]} icon="Database" title="Memory" owner="a later lesson" />
  );
}
