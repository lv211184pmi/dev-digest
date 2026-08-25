"use client";

import { Drawer, ErrorState, Markdown, Skeleton } from "@devdigest/ui";
import type { ProjectContextDoc } from "@devdigest/shared";
import { useProjectContextDoc, useProjectContextUsage } from "@/lib/hooks";
import { DocTypeBadge } from "@/components/doc-type-badge";
import type { ContextTabTranslator } from "./ContextTab";
import { s } from "./styles";

export interface DocPreviewDrawerProps {
  repoId: string;
  path: string;
  /** The discovered document this path resolves to, or `null` for a stale
      attached path with no matching discovered document (R14's boundary
      case) — the badge is omitted rather than guessed when this is `null`. */
  doc: ProjectContextDoc | null;
  onClose: () => void;
  t: ContextTabTranslator;
}

/** The Context tab's read-only preview drawer (D12) — a right-side `Drawer`,
    not an inline split pane, because `ContextTab` mounts in both the wide
    Agent editor and the narrow Skill detail pane. Mutates nothing: it takes
    no `onSetPaths`, so R17's "never mutates the attachment set" is
    structural rather than a convention. Path, type badge and the `Used by N
    agents` count all live in the `title` slot so they render in the same
    header row (R9, R16, R23) rather than the vendored `Drawer`'s separate
    title/subtitle stack. */
export function DocPreviewDrawer({ repoId, path, doc, onClose, t }: DocPreviewDrawerProps) {
  const usage = useProjectContextUsage(repoId, path);
  const content = useProjectContextDoc(repoId, path);

  return (
    <Drawer
      title={
        <span style={s.drawerTitleRow}>
          <span style={s.drawerPath}>{path}</span>
          {doc && <DocTypeBadge type={doc.type} />}
          <span style={s.drawerUsedBy}>
            {usage.isLoading ? (
              <Skeleton width={100} height={13} />
            ) : (
              t("drawer.usedBy", { count: usage.data?.agent_count ?? 0 })
            )}
          </span>
        </span>
      }
      onClose={onClose}
    >
      {content.isLoading && <Skeleton height={240} />}
      {content.isError && <ErrorState body={t("drawer.loadError")} />}
      {content.isSuccess && (
        <>
          <div style={s.drawerMeta}>
            <span>{`${t("drawer.bytes")}: ${content.data.bytes}`}</span>
            <span>{`${t("drawer.tokens")}: ≈${content.data.tokens}`}</span>
          </div>
          {content.data.truncated && (
            <p style={s.drawerTruncated}>{t("drawer.truncated")}</p>
          )}
          {/* A 0-byte document previews as empty content, not an error (R18)
              — `<Markdown>` returns `null` for an empty string, which is the
              correct rendering here rather than something to special-case. */}
          <Markdown>{content.data.text}</Markdown>
        </>
      )}
    </Drawer>
  );
}
