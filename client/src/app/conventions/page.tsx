import { ConventionsView } from "./_components/ConventionsView";

/* Route: /conventions — scan the active repo for house-rules, back each with
   evidence, and merge the accepted set into a Skill. Thin route entry — the
   view is colocated under _components/ConventionsView. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
