"use client";

import React from "react";
import type { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, Icon } from "@devdigest/ui";
import type { ProjectContextAttachment, ProjectContextDoc } from "@devdigest/shared";
import { DocTypeBadge } from "@/components/doc-type-badge";
import { attachedTokens, filterRows, mergeRows, reorder, splitPath } from "./helpers";
import { DocPreviewDrawer } from "./DocPreviewDrawer";
import { s } from "./styles";

/** A translator already scoped to this tab's own strings (`agents.context.*`
    or `skills.context.*`) — the consumer resolves the namespace via a static
    `useTranslations("agents.context")` / `useTranslations("skills.context")`
    call and passes the result down, so this shared component never calls
    `useTranslations` with a dynamic namespace itself. */
export type ContextTabTranslator = ReturnType<typeof useTranslations>;

export interface ContextTabProps {
  /** Which editor mounted this tab — carried through for scoping (test hooks,
      the owner-kind attribute below), not for branching logic: the two
      owners behave identically once their docs/attached/onSetPaths are
      resolved. */
  ownerKind: "agent" | "skill";
  ownerId: string;
  repoId: string;
  /** The repo's discovered documents (Phase 5's `useProjectContext`). */
  docs: ProjectContextDoc[];
  /** The persisted attachment set, in injection order — read straight from
      the query cache (Step 2's optimistic `onMutate` write lands here). */
  attached: ProjectContextAttachment[];
  /** Fires once, immediately, with the full ordered next path array — on
      every tick, untick and drop (R1). No Save, no batching (R5). */
  onSetPaths: (paths: string[]) => void;
  t: ContextTabTranslator;
}

/** The agent/skill Context tab (Screens B/C): one merged list — attached
    documents first in injection order, then unattached discovered documents
    — with a client-side path filter and a preview drawer. There is no staged
    set and no Save/Discard footer (D25 supersedes D9): every tick, untick and
    drop calls `onSetPaths` immediately, and the component renders `attached`
    directly rather than mirroring it into local state. */
export function ContextTab({
  ownerKind,
  ownerId,
  repoId,
  docs,
  attached,
  onSetPaths,
  t,
}: ContextTabProps) {
  const attachedPaths = React.useMemo(
    () =>
      attached
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((a) => a.path),
    [attached]
  );

  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const previewTriggerRef = React.useRef<HTMLElement | null>(null);
  const dragIndex = React.useRef<number | null>(null);

  // Truly nothing to show only when the repo has no discovered documents AND
  // the owner has no attached paths — a repo that lost its discovered
  // documents while an agent/skill still has an attachment pointing at one
  // is a *different* state (C2 remediation, carried into R14's boundary
  // note): that attachment is still injected into every run, so it must stay
  // visible and detachable rather than being hidden behind this empty state.
  if (docs.length === 0 && attached.length === 0) {
    return <EmptyState icon="FileText" title={t("empty")} />;
  }

  const hasFilter = filter.trim() !== "";
  const rows = filterRows(mergeRows(docs, attachedPaths), filter);
  const byPath = new Map(docs.map((d) => [d.path, d]));

  const toggle = (path: string, checked: boolean) => {
    const next = checked ? [...attachedPaths, path] : attachedPaths.filter((p) => p !== path);
    onSetPaths(next);
  };

  const handleDrop = (targetPath: string) => {
    const to = attachedPaths.indexOf(targetPath);
    if (dragIndex.current !== null && to !== -1) {
      onSetPaths(reorder(attachedPaths, dragIndex.current, to));
    }
    dragIndex.current = null;
  };

  // R17: closing the drawer never mutates the attachment set and returns
  // keyboard focus to the `Preview` control that opened it.
  const closePreview = () => {
    setPreviewPath(null);
    previewTriggerRef.current?.focus();
  };

  return (
    <div style={s.wrap} data-context-owner={`${ownerKind}:${ownerId}`}>
      <div style={s.sectionHeader}>
        <span style={s.heading}>{t("heading")}</span>
        <span style={s.counter}>
          {t("counter", { n: attachedPaths.length, m: docs.length })}
        </span>
      </div>
      <p style={s.hint}>{t("orderHint")}</p>

      <div style={s.filterRow}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("filterPlaceholder")}
          aria-label={t("filterLabel")}
          style={s.filterInput}
        />
      </div>

      {rows.length === 0 ? (
        <p style={s.noMatches}>{t("noMatches")}</p>
      ) : (
        <div style={s.list}>
          {rows.map((row) => {
            const { dir, file } = splitPath(row.path);
            const draggableRow = row.attached && !hasFilter;
            return (
              <div key={row.path} style={s.row} data-row-path={row.path}>
                {row.attached && (
                  <span
                    style={hasFilter ? { ...s.handle, ...s.handleDisabled } : s.handle}
                    aria-disabled={hasFilter || undefined}
                    title={hasFilter ? t("dragDisabled") : undefined}
                    draggable={draggableRow}
                    onDragStart={
                      draggableRow
                        ? () => {
                            dragIndex.current = attachedPaths.indexOf(row.path);
                          }
                        : undefined
                    }
                    onDragOver={draggableRow ? (e) => e.preventDefault() : undefined}
                    onDrop={draggableRow ? () => handleDrop(row.path) : undefined}
                  >
                    <Icon.Menu size={14} />
                  </span>
                )}
                <div style={s.checkboxWrap}>
                  <Checkbox
                    checked={row.attached}
                    onChange={(v) => toggle(row.path, v)}
                    label={
                      <span style={s.rowMain}>
                        <span style={s.srOnly}>{row.path}</span>
                        <span aria-hidden="true" style={s.fileName}>
                          {file}
                        </span>
                        {dir && (
                          <span aria-hidden="true" style={s.dirName}>
                            {dir}
                          </span>
                        )}
                      </span>
                    }
                  />
                </div>
                {row.doc && <DocTypeBadge type={row.doc.type} />}
                <Button
                  kind="ghost"
                  size="sm"
                  icon="Eye"
                  onClick={(e) => {
                    previewTriggerRef.current = e.currentTarget;
                    setPreviewPath(row.path);
                  }}
                >
                  {t("preview")}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div style={s.serializesAs}>
        <div style={s.serializesLabel}>{t("serializesAs")}</div>
        <pre style={s.serializesBlock}>
          {`## Project context\n${attachedPaths
            .map((path) => `${path} — ≈${byPath.get(path)?.tokens ?? 0}`)
            .join("\n")}`}
        </pre>
        <p style={s.caption}>{t("caption")}</p>
      </div>

      <div style={s.footer}>
        <span style={s.tokenTotal}>
          {t("tokens", { count: attachedTokens(docs, attachedPaths) })}
        </span>
      </div>

      {previewPath !== null && (
        <DocPreviewDrawer
          key={previewPath}
          repoId={repoId}
          path={previewPath}
          doc={byPath.get(previewPath) ?? null}
          onClose={closePreview}
          t={t}
        />
      )}
    </div>
  );
}
