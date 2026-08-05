"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { EvidenceBlock } from "../EvidenceBlock";
import { confidenceColor } from "./helpers";
import { s } from "./styles";

/** One candidate: the rule (title, editable inline), its evidence, and two
 *  explicit Accept/Reject actions — never a single toggle, so the two states
 *  read as distinct decisions rather than a flip. `accepted` is
 *  server-persisted per card; each button fires immediately, no local "save"
 *  step. The card's left accent and the confidence bar share one color,
 *  keyed off the same confidence tier. */
export function ConventionCard({
  candidate,
  onToggleAccepted,
  onSaveRule,
  pending,
}: {
  candidate: ConventionCandidate;
  onToggleAccepted: (accepted: boolean) => void;
  onSaveRule: (rule: string) => void;
  pending: boolean;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(candidate.rule);
  const [justClicked, setJustClicked] = React.useState<"accept" | "reject" | null>(null);

  React.useEffect(() => {
    if (!pending) setJustClicked(null);
  }, [pending]);

  const startEdit = () => {
    setDraft(candidate.rule);
    setEditing(true);
  };
  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== candidate.rule) onSaveRule(trimmed);
    setEditing(false);
  };
  const accept = () => {
    setJustClicked("accept");
    onToggleAccepted(true);
  };
  const reject = () => {
    setJustClicked("reject");
    onToggleAccepted(false);
  };

  const pct = Math.round(candidate.confidence * 100);
  const color = confidenceColor(pct);

  return (
    <div style={s.card(color)}>
      <div style={s.headerRow}>
        {editing ? (
          <span style={s.spacer} />
        ) : (
          <h3 style={s.rule} onDoubleClick={startEdit}>
            {candidate.rule}
          </h3>
        )}
        {!editing && (
          <>
            <button
              type="button"
              title={t("card.edit")}
              aria-label={t("card.edit")}
              onClick={startEdit}
              style={s.editIconBtn}
            >
              <Icon.Edit size={13} />
            </button>
            <Button
              kind={candidate.accepted ? "primary" : "ghost"}
              size="sm"
              icon="Check"
              loading={pending && justClicked === "accept"}
              disabled={pending}
              onClick={accept}
            >
              {t("card.accepted")}
            </Button>
            <Button
              kind={!candidate.accepted ? "danger" : "ghost"}
              size="sm"
              icon="X"
              loading={pending && justClicked === "reject"}
              disabled={pending}
              onClick={reject}
            >
              {t("card.reject")}
            </Button>
          </>
        )}
      </div>

      {editing && (
        <>
          <textarea
            style={s.ruleTextarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("card.rulePlaceholder")}
            autoFocus
          />
          <div style={s.editActions}>
            <Button kind="ghost" size="sm" onClick={() => setEditing(false)}>
              {t("card.cancelEdit")}
            </Button>
            <Button kind="secondary" size="sm" onClick={save}>
              {t("card.saveEdit")}
            </Button>
          </div>
        </>
      )}

      <EvidenceBlock
        path={candidate.evidence_path}
        startLine={candidate.evidence_start_line}
        endLine={candidate.evidence_end_line}
        snippet={candidate.evidence_snippet}
      />

      <div style={s.confidenceRow}>
        <span style={s.confidenceLabel}>{t("card.confidence")}</span>
        <div style={s.barWrap}>
          <ProgressBar value={pct} color={color} />
        </div>
        <span style={s.confidencePct}>{pct}%</span>
      </div>
    </div>
  );
}
