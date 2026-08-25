"use client";

import { Icon } from "@devdigest/ui";
import type { ProjectContextDoc } from "@devdigest/shared";
import { s } from "./styles";

/** One row per discovered document — a file glyph and the repo-relative path,
    nothing else. Selecting a row drives the preview pane (`DocPreview`).
    Rendered only in the "populated" state; the empty and not-cloned states
    never mount this component (R3/R4 — zero rows). */
export function DocList({
  docs,
  selectedPath,
  onSelect,
}: {
  docs: ProjectContextDoc[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div style={s.card}>
      {docs.map((doc) => {
        const active = doc.path === selectedPath;
        return (
          <div
            key={doc.path}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-label={doc.path}
            onClick={() => onSelect(doc.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(doc.path);
              }
            }}
            style={s.row(active)}
          >
            <Icon.FileText size={14} style={s.icon(active)} />
            <span style={s.path}>{doc.path}</span>
          </div>
        );
      })}
    </div>
  );
}
