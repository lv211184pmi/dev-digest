/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, Button } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { splitByScope } from "./helpers";
import { s } from "./styles";

// Module-level so they are not re-created on every render. They live here
// rather than in the sibling `styles.ts` because this feature's plan scoped the
// change to this file; fold them into `s` the next time that file is touched.
const DIMMED: React.CSSProperties = { opacity: 0.6 };
const OUT_OF_SCOPE_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 14,
};
const OUT_OF_SCOPE_NOTE: React.CSSProperties = { fontSize: 12.5, color: "var(--text-muted)" };

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [showOutOfScope, setShowOutOfScope] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const { inScope, outOfScope } = React.useMemo(
    () => splitByScope(findings, hideLow),
    [findings, hideLow],
  );
  // Out-of-scope findings are collapsed, never removed — j/k/a/d operate over
  // whatever is actually on screen, so the expanded bucket joins the list.
  const shown = React.useMemo(
    () => (showOutOfScope ? [...inScope, ...outOfScope] : inScope),
    [inScope, outOfScope, showOutOfScope],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <div key={f.id} style={i >= inScope.length ? DIMMED : undefined}>
              <FindingCard
                f={f}
                focused={i === focusIdx}
                defaultExpanded={i === 0}
                pending={action.isPending}
                repoFullName={repoFullName}
                headSha={headSha}
                onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              />
            </div>
          ))
        )}
      </div>

      {outOfScope.length > 0 && (
        <div style={OUT_OF_SCOPE_BAR}>
          <Button
            kind="tertiary"
            size="sm"
            icon={showOutOfScope ? "EyeOff" : "Eye"}
            onClick={() => setShowOutOfScope((v) => !v)}
          >
            {showOutOfScope
              ? t("panel.outOfScopeHide", { count: outOfScope.length })
              : t("panel.outOfScopeShow", { count: outOfScope.length })}
          </Button>
          <span style={OUT_OF_SCOPE_NOTE}>{t("panel.outOfScopeNote")}</span>
        </div>
      )}
    </div>
  );
}
