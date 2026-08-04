"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import { DiffViewer } from "@/components/diff-viewer";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { versionDiffToPrFile } from "@/lib/version-diff";
import { s } from "./styles";

/**
 * Versions tab — full history with diff + restore. Restore is non-destructive:
 * it copies the old body into a NEW current version rather than rewriting
 * history (server: SkillsRepository.restoreVersion).
 */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion(skill.id);
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);

  const sorted = (versions ?? []).slice().sort((a, b) => b.version - a.version);

  const doRestore = (version: number) =>
    restore.mutate(version, { onSuccess: () => toast.success(t("versions.restored", { version })) });

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("versions.count", { count: sorted.length })}</Badge>
      </div>
      {sorted.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("versions.empty")}</p>}
      {sorted.map((v, i) => {
        const isCurrent = v.version === skill.version;
        const older = sorted[i + 1];
        const diffOpen = openDiff === v.version;
        return (
          <div key={v.version} style={s.versionRow}>
            <div style={s.versionHeader}>
              <Badge color="var(--text-secondary)" mono>
                v{v.version}
              </Badge>
              <span style={s.versionSummary}>{v.change_summary ?? (v.version === 1 ? t("versions.initial") : "—")}</span>
              <span style={s.versionDate}>{new Date(v.created_at).toLocaleDateString()}</span>
              {isCurrent && <Badge color="var(--ok)" bg="var(--ok-bg)">{t("versions.current")}</Badge>}
            </div>
            <div style={s.versionActions}>
              {older && (
                <Button kind="ghost" size="sm" icon="Eye" onClick={() => setOpenDiff(diffOpen ? null : v.version)}>
                  {diffOpen ? t("versions.hideDiff") : t("versions.diff")}
                </Button>
              )}
              {!isCurrent && (
                <Button
                  kind="secondary"
                  size="sm"
                  icon="RefreshCw"
                  onClick={() => doRestore(v.version)}
                  disabled={restore.isPending}
                >
                  {restore.isPending ? t("versions.restoring") : t("versions.restore")}
                </Button>
              )}
            </div>
            {diffOpen && older && (
              <div style={{ marginTop: 10 }}>
                <DiffViewer files={[versionDiffToPrFile(skill.name, older.body, v.body)]} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
