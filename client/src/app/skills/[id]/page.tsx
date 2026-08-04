"use client";

import { useParams } from "next/navigation";
import { SkillsLabView } from "../_components/SkillsLabView";

/* Route: /skills/:id (Skills Lab, skill selected). Mirrors /agents/:id. */
export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  return <SkillsLabView skillId={params.id} />;
}
