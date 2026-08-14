/* SmartCodeLine — one rendered diff line in Smart order: gutter number, sign,
   text, and (when a finding cites this line) a left severity edge + a plain
   icon+label severity tag. No commenting affordance — that stays in Original
   order via CodeLine. Owns the scroll-to-line target: it flips a brief
   highlight when it becomes the current jump target (driven by the file
   header's "N findings" badge) and re-fires on every `targetNonce` bump so
   clicking that badge twice still re-scrolls. The severity tag itself is a
   different affordance — it deep-links to the same finding's card on the
   Agent runs tab (see `onOpenFinding`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import { diffStyles, lineRowFor, lineSignFor, type Line } from "@/components/diff-viewer";
import type { SmartDiffFinding } from "@devdigest/shared";
import { s, lineHighlightFor, lineSeverityEdgeFor } from "../../styles";
import { HIGHLIGHT_MS, LINE_BADGE_LABEL } from "../../constants";

export function SmartCodeLine({
  ln,
  path,
  findings,
  targetLine,
  targetNonce,
  onOpenFinding,
}: {
  ln: Line;
  path: string;
  findings: SmartDiffFinding[];
  targetLine: number | null;
  targetNonce: number;
  /** Opens this line's top finding on the Agent runs tab. */
  onOpenFinding: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = React.useState(false);

  React.useEffect(() => {
    if (targetLine == null || ln.newNo !== targetLine) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLine, targetNonce]);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={diffStyles.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  // Multiple findings can share a line — the top one drives the badge.
  const badgeFinding = findings[0];
  const sev = badgeFinding ? SEV[badgeFinding.severity] : null;
  const SevIcon = sev ? Icon[sev.icon] : null;

  return (
    <div
      ref={rootRef}
      id={`sd-line-${path}-${ln.newNo ?? ""}`}
      style={{
        ...lineRowFor(ln.kind),
        ...lineSeverityEdgeFor(badgeFinding?.severity ?? null),
        ...lineHighlightFor(highlight),
        scrollMarginTop: 16,
      }}
    >
      <span className="mono tnum" style={diffStyles.lineNo}>
        {ln.newNo ?? ln.oldNo ?? ""}
      </span>
      <span className="mono" style={lineSignFor(ln.kind)}>
        {sign}
      </span>
      <span className="mono" style={diffStyles.lineText}>
        {ln.text || " "}
      </span>
      {badgeFinding && sev && SevIcon && ln.newNo != null && (
        <span style={s.lineSeverity}>
          <button
            type="button"
            onClick={() => onOpenFinding(badgeFinding.finding_id)}
            title={t("smartDiff.viewFindingInAgentRuns")}
            aria-label={t("smartDiff.viewFindingInAgentRuns")}
            style={s.lineSeverityTagBtn}
          >
            <span style={s.lineSeverityTag(sev.c)}>
              <SevIcon size={12.5} />
              {LINE_BADGE_LABEL[badgeFinding.severity]}
            </span>
          </button>
        </span>
      )}
    </div>
  );
}
