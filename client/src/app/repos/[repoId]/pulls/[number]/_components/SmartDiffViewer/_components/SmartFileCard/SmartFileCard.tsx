/* SmartFileCard — one collapsible file in Smart order: header (path, +/- stat,
   "N findings" jump badge) and, when open, its parsed lines. Deliberately not
   FileCard: no commenting, plus a force-open rule driven by findings/role
   instead of just size. No file-level severity colouring — that indicator is
   deliberately scoped to just the line(s) that carry a finding (see
   SmartCodeLine's left edge), so a file's border never implies "the whole
   file is a problem" when only one line in it is. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiffFile, SmartDiffRole } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES, chevronFor, diffStyles, parsePatch } from "@/components/diff-viewer";
import { findingsByNewLine } from "../../helpers";
import { s } from "../../styles";
import { SmartCodeLine } from "../SmartCodeLine";

/** Open by default when the group is core/wiring and the file is small, or
    whenever it carries findings (the mockup's boilerplate-with-findings
    case); otherwise closed. */
function initialOpen(role: SmartDiffRole, file: SmartDiffFile): boolean {
  if (file.findings.length > 0) return true;
  if (role === "boilerplate") return false;
  return file.additions + file.deletions <= AUTO_EXPAND_MAX_LINES;
}

export function SmartFileCard({
  file,
  prFile,
  role,
  target,
  onJump,
  onOpenFinding,
}: {
  file: SmartDiffFile;
  prFile: PrFile | undefined;
  role: SmartDiffRole;
  /** Current scroll-to-line target, owned by SmartDiffViewer. */
  target: { path: string; line: number; nonce: number } | null;
  onJump: (path: string, line: number) => void;
  /** Opens a line's top finding on the Agent runs tab. */
  onOpenFinding: (findingId: string) => void;
}) {
  const tShell = useTranslations("shell");
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(() => initialOpen(role, file));

  // A target landing on this file forces it open, whatever its own rule said.
  React.useEffect(() => {
    if (target && target.path === file.path) setOpen(true);
  }, [target, file.path]);

  const lines = React.useMemo(() => parsePatch(prFile?.patch), [prFile?.patch]);
  const findingsByLine = React.useMemo(() => findingsByNewLine(file.findings), [file.findings]);

  const targetLine = target && target.path === file.path ? target.line : null;
  const targetNonce = target?.nonce ?? 0;

  return (
    <div style={diffStyles.fileCard}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={diffStyles.fileHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={diffStyles.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={diffStyles.fileStat}>
          <span style={diffStyles.addText}>+{file.additions}</span>{" "}
          <span style={diffStyles.delText}>−{file.deletions}</span>
        </span>
        {file.findings.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // finding_lines is deduped ascending — [0] is the file's first
              // finding line.
              onJump(file.path, file.finding_lines[0]!);
            }}
            style={s.findingsBadge}
          >
            {t("smartDiff.findingsBadge", { count: file.findings.length })}
          </button>
        )}
      </div>
      {open && (
        <div style={diffStyles.fileBody}>
          {lines.length === 0 ? (
            <div style={diffStyles.noDiff}>{tShell("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <SmartCodeLine
                key={i}
                ln={ln}
                path={file.path}
                findings={ln.newNo != null ? (findingsByLine.get(ln.newNo) ?? []) : []}
                targetLine={targetLine}
                targetNonce={targetNonce}
                onOpenFinding={onOpenFinding}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
