/* SmartDiffViewer — the PR's "Files changed" reordered by review risk: core →
   wiring → boilerplate, findings pinned to the top of their group, severity
   badges anchored to diff lines. Fully deterministic — the response carries
   no patch text, so lines render from the already-loaded `pr.files`. Owns the
   scroll-to-line target shared by every RoleGroup/SmartFileCard/SmartCodeLine
   below it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import { indexFilesByPath } from "./helpers";
import { s } from "./styles";
import { RoleGroup } from "./_components/RoleGroup";

interface ScrollTarget {
  path: string;
  line: number;
  /** Bumped on every jump so re-clicking the same finding still re-scrolls. */
  nonce: number;
}

export function SmartDiffViewer({
  smartDiff,
  files,
  initialTarget = null,
  onOpenFinding,
}: {
  smartDiff: SmartDiff;
  files: PrFile[];
  initialTarget?: { path: string; line: number } | null;
  /** Opens a line's top finding on the Agent runs tab; a no-op default keeps
      this component usable standalone (e.g. in tests) without the caller
      wiring cross-tab navigation. */
  onOpenFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const filesByPath = React.useMemo(() => indexFilesByPath(files), [files]);

  const [target, setTarget] = React.useState<ScrollTarget | null>(() =>
    initialTarget ? { path: initialTarget.path, line: initialTarget.line, nonce: 0 } : null,
  );
  const jumpTo = React.useCallback((path: string, line: number) => {
    setTarget((prev) =>
      prev && prev.path === path && prev.line === line
        ? { ...prev, nonce: prev.nonce + 1 }
        : { path, line, nonce: 0 },
    );
  }, []);

  const allFiles = smartDiff.groups.flatMap((g) => g.files);
  const totalAdditions = allFiles.reduce((n, f) => n + f.additions, 0);
  const totalDeletions = allFiles.reduce((n, f) => n + f.deletions, 0);

  const { too_big, total_lines, proposed_splits } = smartDiff.split_suggestion;

  return (
    <div style={s.viewer}>
      <div style={s.header}>
        <span style={s.headerText}>{t("smartDiff.header")}</span>
        <span style={s.statsText}>
          {t("smartDiff.stats", {
            files: allFiles.length,
            additions: totalAdditions,
            deletions: totalDeletions,
          })}
        </span>
      </div>

      {too_big && (
        <div style={s.splitBanner}>
          <span style={s.splitTitle}>{t("smartDiff.largeTitle", { lines: total_lines })}</span>
          <span style={s.splitBody}>{t("smartDiff.largeBody")}</span>
          {proposed_splits.length > 0 && (
            <div style={s.splitList}>
              {proposed_splits.map((split) => (
                <span key={split.name} style={s.splitItem}>
                  {split.name} · {t("smartDiff.filesCount", { count: split.files.length })}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={s.groups}>
        {smartDiff.groups.map((group) => (
          <RoleGroup
            key={group.role}
            role={group.role}
            files={group.files}
            filesByPath={filesByPath}
            target={target}
            onJump={jumpTo}
            onOpenFinding={onOpenFinding ?? (() => {})}
          />
        ))}
      </div>
    </div>
  );
}
