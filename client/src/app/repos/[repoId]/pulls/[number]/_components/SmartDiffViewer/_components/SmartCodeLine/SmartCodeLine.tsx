/* SmartCodeLine — one rendered diff line in Smart order: gutter number, sign,
   text, and (when a finding cites this line) a right-aligned SeverityBadge.
   No commenting affordance — that stays in Original order via CodeLine.
   Owns the scroll-to-line target: it flips a brief highlight when it becomes
   the current jump target and re-fires on every `targetNonce` bump so
   clicking the same finding twice still re-scrolls. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@devdigest/ui";
import { diffStyles, lineRowFor, lineSignFor, type Line } from "@/components/diff-viewer";
import type { SmartDiffFinding } from "@devdigest/shared";
import { s, lineHighlightFor } from "../../styles";
import { HIGHLIGHT_MS } from "../../constants";

export function SmartCodeLine({
  ln,
  path,
  findings,
  targetLine,
  targetNonce,
  onJump,
}: {
  ln: Line;
  path: string;
  findings: SmartDiffFinding[];
  targetLine: number | null;
  targetNonce: number;
  onJump: (path: string, line: number) => void;
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

  return (
    <div
      ref={rootRef}
      id={`sd-line-${path}-${ln.newNo ?? ""}`}
      style={{ ...lineRowFor(ln.kind), ...lineHighlightFor(highlight), scrollMarginTop: 16 }}
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
      {badgeFinding && ln.newNo != null && (
        <span style={s.lineSeverity}>
          <button
            type="button"
            onClick={() => onJump(path, ln.newNo!)}
            title={t("smartDiff.jumpToFinding")}
            aria-label={t("smartDiff.jumpToFinding")}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <SeverityBadge severity={badgeFinding.severity} />
          </button>
        </span>
      )}
    </div>
  );
}
