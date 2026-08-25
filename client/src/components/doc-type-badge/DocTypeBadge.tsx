/* Shared type badge for a project-context document — three routes render it:
   this page's DocList and DocPreview, and phase 4's Context tab rows and
   drawer. Colour AND text both encode the type (AC 30's WCAG rule, the same
   one SeverityBadge follows) — colour is never the only channel. */
"use client";

import { Badge } from "@devdigest/ui";
import type { ProjectContextDocType } from "@devdigest/shared";

const TYPE_COLORS: Record<ProjectContextDocType, { color: string; bg: string }> = {
  specs: { color: "var(--accent)", bg: "var(--accent-bg)" },
  docs: { color: "var(--ok)", bg: "var(--ok-bg)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

export function DocTypeBadge({ type }: { type: ProjectContextDocType }) {
  const { color, bg } = TYPE_COLORS[type];
  // The badge's text is the literal contract enum value, not a translated
  // label: it is the same string `docTypeFor` derives from the path, and
  // translating it would break the correspondence AC 32 depends on.
  return (
    <Badge mono color={color} bg={bg} style={{ flexShrink: 0 }}>
      {type}
    </Badge>
  );
}
