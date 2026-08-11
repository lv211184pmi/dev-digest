/* IntentCard — the PR's derived intent: summary, in/out of scope, risk areas.
   Four states: absent (derive CTA), present, stale (head moved), low confidence
   (badge + the sources that did not resolve). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Chip, EmptyState, Icon, type IconName } from "@devdigest/ui";
import type { IntentSource, PrIntentRecord } from "@devdigest/shared";
import { usePrIntent, useDeriveIntent } from "@/lib/hooks/reviews";
import { s } from "./styles";

/** Sources that did not make it into the classifier input, in record order. */
function missingSources(sources: IntentSource[]): IntentSource[] {
  return sources.filter((src) => src.status !== "used");
}

/** Risk areas are freeform noun phrases from the classifier — no type on the
    wire, so the icon/color is inferred from keywords for a scannable chip. */
function riskVisual(text: string): { icon: IconName; color: string } {
  const t = text.toLowerCase();
  if (/\bauth/.test(t)) return { icon: "Shield", color: "var(--crit)" };
  if (/depend|package|library|\bnpm\b/.test(t)) return { icon: "Boxes", color: "var(--warn)" };
  if (/redis|cache|round.?trip|latency|\bdb\b|database|\bquery|queries\b/.test(t))
    return { icon: "Zap", color: "var(--accent)" };
  return { icon: "AlertTriangle", color: "var(--text-muted)" };
}

function ScopeColumn({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color?: string;
}) {
  return (
    <div>
      <div style={color ? { ...s.columnTitle, color } : s.columnTitle}>{title}</div>
      {items.length === 0 ? (
        <div style={s.meta}>—</div>
      ) : (
        <div style={s.list}>
          {items.map((item) => (
            <div key={item} style={s.listItem}>
              <span style={s.listBullet}>–</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function IntentCard({
  prId,
  headSha,
}: {
  prId: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const { data, isLoading } = usePrIntent(prId);
  const derive = useDeriveIntent(prId);

  if (!prId || isLoading) return null;

  if (!data) {
    return (
      <div style={s.card}>
        <div style={s.header}>
          <Icon.Target size={14} style={{ color: "var(--text-muted)" }} />
          <span style={s.headerText}>{t("intent.title")}</span>
        </div>
        <EmptyState
          icon="Target"
          title={t("intent.emptyTitle")}
          body={t("intent.emptyBody")}
          cta={t("intent.derive")}
          onCta={() => derive.mutate()}
          ctaLoading={derive.isPending}
        />
      </div>
    );
  }

  const record: PrIntentRecord = data;
  // The server derives `is_stale` against the head it knew about; comparing to
  // the head this page is rendering catches a PR that moved since the fetch.
  const stale = record.is_stale || (!!headSha && record.head_sha !== headSha);
  const missing = missingSources(record.sources);

  return (
    <div style={s.card}>
      <div style={s.header}>
        <Icon.Target size={14} style={{ color: "var(--text-muted)" }} />
        <span style={s.headerText}>{t("intent.title")}</span>
      </div>

      {stale && (
        <div style={s.notice}>
          <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
            {t("intent.stale")}
          </Badge>
          <Button
            kind="tertiary"
            size="sm"
            icon="RefreshCw"
            loading={derive.isPending}
            onClick={() => derive.mutate()}
          >
            {t("intent.reDerive")}
          </Button>
        </div>
      )}

      {record.confidence === "low" && (
        <div style={s.notice}>
          <Badge icon="Info">{t("intent.lowConfidence")}</Badge>
          <span>
            {t("intent.missingIntro")}{" "}
            {missing
              .map((src) => t(`intent.missing.${src.kind}`, { ref: src.ref }))
              .join("; ")}
          </span>
        </div>
      )}

      <blockquote style={s.summary}>&ldquo;{record.intent}&rdquo;</blockquote>

      <div style={s.columns}>
        <ScopeColumn title={t("intent.inScope")} items={record.in_scope} color="var(--ok)" />
        <ScopeColumn title={t("intent.outOfScope")} items={record.out_of_scope} />
      </div>

      {record.risk_areas.length > 0 && (
        <div>
          <div style={s.columnTitle}>{t("intent.riskAreas")}</div>
          <div style={s.chips}>
            {record.risk_areas.map((area) => {
              const { icon, color } = riskVisual(area);
              return (
                <Chip key={area} icon={icon} color={color}>
                  {area}
                </Chip>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
