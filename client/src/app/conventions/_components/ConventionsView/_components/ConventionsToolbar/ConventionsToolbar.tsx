"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { s } from "./styles";

/** Deselect all / Select all, the derived "N of M accepted" count (never
 *  mirrored into local state), and Create skill. */
export function ConventionsToolbar({
  total,
  accepted,
  onSelectAll,
  onDeselectAll,
  onCreateSkill,
  decisionsPending,
}: {
  total: number;
  accepted: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCreateSkill: () => void;
  decisionsPending: boolean;
}) {
  const t = useTranslations("conventions");

  return (
    <div style={s.bar}>
      <span style={s.count}>{t("toolbar.acceptedCount", { accepted, total })}</span>
      <Button kind="ghost" size="sm" onClick={onDeselectAll} disabled={decisionsPending || accepted === 0}>
        {t("toolbar.deselectAll")}
      </Button>
      <Button kind="ghost" size="sm" onClick={onSelectAll} disabled={decisionsPending || accepted === total}>
        {t("toolbar.selectAll")}
      </Button>
      <div style={s.spacer} />
      <Button
        kind="primary"
        size="sm"
        icon="Sparkles"
        onClick={onCreateSkill}
        disabled={accepted === 0}
        title={accepted === 0 ? t("toolbar.noneAccepted") : undefined}
      >
        {t("toolbar.createSkill")}
      </Button>
    </div>
  );
}
