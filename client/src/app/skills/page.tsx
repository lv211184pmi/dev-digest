import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills Lab grid, no selection). Mirrors /agents. Thin route
   entry — the view is colocated under _components/SkillsListView. */
export default function SkillsPage() {
  return <SkillsListView />;
}
