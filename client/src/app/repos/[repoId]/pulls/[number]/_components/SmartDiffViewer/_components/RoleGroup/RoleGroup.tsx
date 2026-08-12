/* RoleGroup — one collapsible core/wiring/boilerplate section: a header
   (role colour square, label, file count, description) and, when open, its
   SmartFileCards in the server's already-sorted order. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiffFile, SmartDiffRole } from "@devdigest/shared";
import { chevronFor } from "@/components/diff-viewer";
import { ROLE_COLOR_VAR, ROLE_DESC_KEY, ROLE_LABEL_KEY } from "../../constants";
import { s, roleSquareFor } from "../../styles";
import { SmartFileCard } from "../SmartFileCard";

export function RoleGroup({
  role,
  files,
  filesByPath,
  target,
  onJump,
  onOpenFinding,
}: {
  role: SmartDiffRole;
  files: SmartDiffFile[];
  filesByPath: Map<string, PrFile>;
  target: { path: string; line: number; nonce: number } | null;
  onJump: (path: string, line: number) => void;
  /** Opens a line's top finding on the Agent runs tab. */
  onOpenFinding: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  // Boilerplate starts collapsed unless one of its files carries a finding
  // (the mockup's boilerplate-with-findings case); core/wiring start open.
  const anyFindings = files.some((f) => f.findings.length > 0);
  const [open, setOpen] = React.useState(role !== "boilerplate" || anyFindings);

  return (
    <div style={s.group}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={s.groupHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <span style={roleSquareFor(ROLE_COLOR_VAR[role])} />
        <span style={s.groupTitle}>{t(`smartDiff.${ROLE_LABEL_KEY[role]}`)}</span>
        <span style={s.groupCount}>{files.length}</span>
        <span style={s.groupDesc}>{t(`smartDiff.${ROLE_DESC_KEY[role]}`)}</span>
      </div>
      {open && (
        <div style={s.groupBody}>
          {files.map((f) => (
            <SmartFileCard
              key={f.path}
              file={f}
              prFile={filesByPath.get(f.path)}
              role={role}
              target={target}
              onJump={onJump}
              onOpenFinding={onOpenFinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}
