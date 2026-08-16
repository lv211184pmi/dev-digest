/* BlastRadiusCard — what this PR can impact: changed symbols → their callers →
   the HTTP endpoints and cron jobs downstream.

   Every node is read from the repo-intel index; the only model-written text is
   the one-sentence summary, and it is opt-in because deriving it costs money.

   THE STATE THAT MATTERS IS `index.state`. A blast map with nothing in it is
   ambiguous — it means either "nothing depends on this" or "we could not see" —
   and the two have opposite consequences for a reviewer. So `unavailable` gets
   an EmptyState instead of a map, and `partial` keeps its map but wears a
   warning that names the files the index missed. An empty tree is never
   rendered bare. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Chip, EmptyState, Icon, MonoLink } from "@devdigest/ui";
import type { DownstreamImpact, PrBlastRecord } from "@devdigest/shared";
import { useBlastRadius, useDeriveBlastSummary } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import { MermaidDiagram } from "@/components/mermaid-diagram/MermaidDiagram";
import { buildBlastGraph } from "./graph";
import { s } from "./styles";

/** Callers shown before the "+N more" line. The server already capped at 20. */
const VISIBLE_CALLERS = 6;
/** Uncovered files shown before the "+N more" line. A run-on comma list of
 *  every miss on one unbroken paragraph is what produced the overflow this
 *  caps — see the coverage-notice block below. */
const VISIBLE_NOT_COVERED = 8;

type View = "tree" | "graph";

interface BlastRadiusCardProps {
  prId: string | null;
  /** `owner/name`, for the GitHub blob links. Without it paths render unlinked. */
  repoFullName?: string | null;
  /** The PR head, so a line link points at the code as this PR leaves it. */
  headSha?: string | null;
}

/** One `path:line` that opens the file at that line on GitHub, pinned to the head sha. */
function PathLink({
  repoFullName,
  headSha,
  file,
  line,
}: {
  repoFullName?: string | null;
  headSha?: string | null;
  file: string;
  line: number;
}) {
  const text = line > 0 ? `${file}:${line}` : file;
  // No repo/sha means no honest link — a URL guessed against the wrong ref
  // would open the right file at the wrong line, which is worse than plain text.
  if (!repoFullName || !headSha) {
    return (
      <span style={s.pathWrap}>
        <span style={s.meta}>{text}</span>
      </span>
    );
  }
  return (
    <span style={s.pathWrap}>
      <MonoLink href={githubBlobUrl(repoFullName, headSha, file, line > 0 ? line : undefined)}>
        {text}
      </MonoLink>
    </span>
  );
}

function SymbolNode({
  impact,
  declFile,
  declLine,
  repoFullName,
  headSha,
  defaultOpen,
}: {
  impact: DownstreamImpact;
  declFile: string;
  declLine: number;
  repoFullName?: string | null;
  headSha?: string | null;
  defaultOpen: boolean;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(defaultOpen);

  const visible = impact.callers.slice(0, VISIBLE_CALLERS);
  const hidden = impact.caller_count - visible.length;

  return (
    <div>
      <button type="button" style={s.symbolRow} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon.ChevronRight size={13} style={s.chevron(open)} />
        <Icon.Code size={13} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
        <span style={s.symbolName}>{impact.symbol}()</span>
        <span style={s.symbolCount}>{t("callerCount", { count: impact.caller_count })}</span>
      </button>

      {open && (
        <div style={s.branch}>
          {/* The declaration itself, so the reader can jump to what changed. */}
          <div style={s.callerRow}>
            <span style={s.branchGlyph}>◆</span>
            <PathLink
              repoFullName={repoFullName}
              headSha={headSha}
              file={declFile}
              line={declLine}
            />
          </div>

          {visible.map((caller) => (
            <div key={`${caller.file}:${caller.line}`} style={s.callerRow}>
              <span style={s.branchGlyph}>↳</span>
              <PathLink
                repoFullName={repoFullName}
                headSha={headSha}
                file={caller.file}
                line={caller.line}
              />
            </div>
          ))}

          {hidden > 0 && <div style={s.moreCallers}>+{hidden} more</div>}

          {(impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0) && (
            <div style={s.chips}>
              {impact.endpoints_affected.map((endpoint) => (
                <Chip key={endpoint} icon="Globe" color="var(--accent)">
                  {endpoint}
                </Chip>
              ))}
              {impact.crons_affected.map((cron) => (
                <Chip key={cron} icon="Clock" color="var(--warn)">
                  {cron}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function BlastRadiusCard({ prId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading } = useBlastRadius(prId);
  const derive = useDeriveBlastSummary(prId);
  const [view, setView] = React.useState<View>("tree");

  // Every hook runs before the first early return, or the hook order changes
  // between the loading and loaded renders. Hence the `?? []` rather than the
  // more natural placement after `data` is known non-null. `declByName` feeds
  // both the ◆ row inside each Tree node and the Graph view's node links, so
  // it is computed up here too rather than duplicated after the return.
  const declByName = React.useMemo(
    () => new Map((data?.changed_symbols ?? []).map((sym) => [sym.name, sym])),
    [data?.changed_symbols],
  );
  const graph = React.useMemo(
    () => buildBlastGraph(data?.downstream ?? [], { declByName, repoFullName, headSha }),
    [data?.downstream, declByName, repoFullName, headSha],
  );

  // Cards render nothing while loading — the page owns the skeleton.
  if (!prId || isLoading || !data) return null;

  const record: PrBlastRecord = data;
  const { index, totals, downstream, changed_symbols } = record;

  const header = (
    <div style={s.header}>
      <Icon.Zap size={14} style={{ color: "var(--text-muted)" }} />
      <span style={s.headerText}>{t("title")}</span>
    </div>
  );

  // Nothing usable came back. Say why, and never draw an empty map next to it.
  if (index.state === "unavailable") {
    return (
      <div style={s.card}>
        {header}
        <EmptyState
          icon="Zap"
          title={t("empty.unindexedTitle")}
          body={index.explanation || t("empty.body")}
        />
      </div>
    );
  }

  return (
    <div style={s.card}>
      {header}

      <div style={s.statRow}>
        <span style={s.stat}>
          <Icon.Code size={12} />
          <span style={s.statValue}>{totals.symbols}</span> {t("stat.symbols")}
        </span>
        <span style={s.stat}>
          <Icon.CornerDownRight size={12} />
          <span style={s.statValue}>{totals.callers}</span> {t("stat.callers")}
        </span>
        <span style={s.stat}>
          <Icon.Globe size={12} />
          <span style={s.statValue}>{totals.endpoints}</span> {t("stat.endpoints")}
        </span>
        <span style={s.stat}>
          <Icon.Clock size={12} />
          <span style={s.statValue}>{totals.crons}</span> {t("stat.crons")}
        </span>

        <div style={s.segmented} role="tablist">
          {(["tree", "graph"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              style={s.segment(view === key)}
              onClick={() => setView(key)}
            >
              {t(`view.${key}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Partial coverage keeps its map but must not be read as exhaustive. */}
      {index.state === "partial" && (
        <div style={s.notice}>
          <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
            {t("coverage.partial")}
          </Badge>
          <div style={s.noticeBody}>
            {index.explanation}
            {index.files_not_covered.length > 0 && (
              <div style={s.notCovered}>
                <div>{t("coverage.notCoveredLabel")}:</div>
                {index.files_not_covered.slice(0, VISIBLE_NOT_COVERED).map((file) => (
                  <div key={file} style={s.notCoveredFile}>
                    <PathLink repoFullName={repoFullName} headSha={headSha} file={file} line={0} />
                  </div>
                ))}
                {index.files_not_covered.length > VISIBLE_NOT_COVERED && (
                  <div style={s.meta}>
                    +{index.files_not_covered.length - VISIBLE_NOT_COVERED} more
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={s.summaryRow}>
        {record.summary ? (
          <p style={s.summary}>{record.summary}</p>
        ) : (
          <Button
            kind="tertiary"
            size="sm"
            icon="Sparkles"
            loading={derive.isPending}
            onClick={() => derive.mutate()}
          >
            {t("summarize")}
          </Button>
        )}
        {record.summary && record.is_stale && (
          <>
            <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
              {t("stale")}
            </Badge>
            <Button
              kind="tertiary"
              size="sm"
              icon="RefreshCw"
              loading={derive.isPending}
              onClick={() => derive.mutate()}
            >
              {t("resummarize")}
            </Button>
          </>
        )}
      </div>

      {downstream.length === 0 ? (
        <div style={s.meta}>{t("noDownstream", { count: changed_symbols.length })}</div>
      ) : view === "tree" ? (
        <div style={s.tree}>
          {downstream.map((impact, i) => {
            const decl = declByName.get(impact.symbol);
            return (
              <SymbolNode
                key={impact.symbol}
                impact={impact}
                declFile={decl?.file ?? ""}
                declLine={decl?.line ?? 0}
                repoFullName={repoFullName}
                headSha={headSha}
                // Only the first is open, matching the screenshot: an expanded
                // list of every symbol buries the stat row on a large PR.
                defaultOpen={i === 0}
              />
            );
          })}
        </div>
      ) : graph ? (
        <div style={s.graphBox} role="img" aria-label={t("graph.ariaLabel")}>
          <MermaidDiagram chart={graph} />
        </div>
      ) : (
        <div style={s.meta}>{t("graph.empty")}</div>
      )}
    </div>
  );
}
