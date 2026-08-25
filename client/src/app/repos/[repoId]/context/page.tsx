/* Route: /repos/:repoId/context — Project Context (Phase 5, Screen A). The
   read-only document browser: discovery listing, empty/not-cloned states,
   disabled authoring controls, the preview pane and its usage count. Mirrors
   /skills/[id]/page.tsx's shape — thin page, all logic in the colocated
   ProjectContextView. */
"use client";

import { useParams } from "next/navigation";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const params = useParams<{ repoId: string }>();
  return <ProjectContextView repoId={params.repoId} />;
}
