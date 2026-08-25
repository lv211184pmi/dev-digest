"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { useProjectContext, useResyncRepoIntel } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { DocList } from "../DocList";
import { DocPreview } from "../DocPreview";
import { s } from "./styles";

/** Compact relative time for the footer's `discovered …` counter — mirrors
    the hand-rolled helper duplicated in repos/[repoId]/pulls/helpers.ts and
    conventions/_components/ConventionsView/helpers.ts ("no useFormatter()
    precedent in this codebase for relative timestamps"; each route keeps its
    own copy per ui-architecture's colocation rule rather than promoting a
    three-caller helper to a shared module preemptively). Unlike those two
    prior copies, every fragment here is sourced from `context.json`'s
    `footer.time.*` keys via the passed-in `t`, rather than an inline
    literal — no string in this function is hardcoded English. */
function relativeTime(
  iso: string | null | undefined,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!iso) return t("footer.time.unknown");
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return t("footer.time.unknown");
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return t("footer.time.now");
  if (m < 60) return t("footer.time.minutesAgo", { m });
  const h = Math.round(m / 60);
  if (h < 24) return t("footer.time.hoursAgo", { h });
  return t("footer.time.daysAgo", { d: Math.round(h / 24) });
}

/** /repos/:repoId/context — Screen A, the read-only Project Context document
    browser (Phase 5, revision 3). Renders one of four states — loading,
    not-cloned (AC 4, no document list), empty (AC 3, no document list) or
    populated (DocList + DocPreview) — chosen by `listing` presence first and
    `isError` second: a populated cache stays mounted through a failed
    background refetch rather than tearing down to the full error state
    (PR1 remediation). Authoring is a confirmed non-goal, so every control it
    would need — `+`, new-folder, `Upload`, `Edit`, the `Preview | Edit` mode
    toggle — is removed rather than rendered disabled (AC 55/49): an icon-only
    `Refresh` (AC 56) is the page's whole toolbar. It re-runs discovery via
    the same `useProjectContext` query's own `refetch`/`isFetching` — the
    service holds no cache, so a refetch *is* a fresh discovery walk — and
    also invalidates the selected document's content/usage queries so an open
    preview doesn't keep serving stale data for up to the 30s `staleTime`
    (PR2 remediation). */
export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const {
    data: listing,
    isLoading,
    isError,
    isFetching,
    error,
    refetch,
  } = useProjectContext(repoId);
  const resync = useResyncRepoIntel(repoId);

  const notCloned = error instanceof ApiError && error.code === "repo_not_cloned";
  const docs = listing?.docs ?? [];
  // Load-bearing, not incidental: `selectedDoc` is derived fresh from the
  // current `listing` on every render rather than cached as an object, so a
  // `Refresh` whose fresh listing drops `selectedPath` collapses the preview
  // column for free (R7) — do not replace this with a stored `selectedDoc`.
  const selectedDoc = docs.find((d) => d.path === selectedPath) ?? null;
  const totalTokens = docs.reduce((sum, d) => sum + d.tokens, 0);

  // `refetch()` alone only re-runs discovery for the listing query. When a
  // document is selected, its content and usage queries are governed by the
  // same 30s staleTime and would otherwise keep serving pre-refresh data for
  // up to 30s after a fresh discovery walk — contradicting the fact that
  // `Refresh` is meant to be a full re-sync of what's on screen (PR2 remediation).
  const handleRefresh = React.useCallback(() => {
    refetch();
    if (selectedPath) {
      queryClient.invalidateQueries({
        queryKey: ["project-context-doc", repoId, selectedPath],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-context-usage", repoId, selectedPath],
      });
    }
  }, [refetch, queryClient, repoId, selectedPath]);

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true },
    { label: t("title") },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.pageHeader}>
          <h1 style={s.pageTitle}>{t("title")}</h1>
          <Button
            kind="ghost"
            icon="RefreshCw"
            loading={isFetching}
            onClick={handleRefresh}
            aria-label={t("toolbar.refresh")}
            title={t("toolbar.refresh")}
          />
        </div>

        {isLoading && (
          <div style={s.loadingStack}>
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        )}

        {/* TanStack Query keeps the last-good `data` around across a failed
            background refetch (e.g. hitting `Refresh` during a network
            blip). These branches check `!listing` before `isError` so a
            populated cache stays mounted — including the current selection
            — through a background failure; only a listing that has *never*
            loaded successfully tears down to a full error state (PR1
            remediation). The background failure itself still surfaces via
            the global `QueryCache`'s toast (providers.tsx), not by wiping
            the screen. */}
        {!isLoading && !listing && isError && notCloned && (
          <>
            <ErrorState title={t("notCloned.title")} body={t("notCloned.body")} />
            <div style={s.resyncRow}>
              <Button
                kind="primary"
                icon="RefreshCw"
                loading={resync.isPending}
                onClick={() => resync.mutate()}
              >
                {resync.isPending ? t("notCloned.resyncing") : t("notCloned.resync")}
              </Button>
            </div>
          </>
        )}

        {!isLoading && !listing && isError && !notCloned && (
          <ErrorState body={t("loadError")} onRetry={() => refetch()} />
        )}

        {!isLoading && listing && docs.length === 0 && (
          <EmptyState
            icon="FileText"
            title={t("emptyState.title")}
            body={
              <>
                <div>{t("emptyState.body")}</div>
                <div>{t("emptyState.roots", { roots: listing.roots.join(", ") })}</div>
              </>
            }
          />
        )}

        {!isLoading && listing && docs.length > 0 && (
          <>
            {listing.truncated && <div style={s.truncatedNotice}>{t("truncatedNotice")}</div>}
            <div style={s.body}>
              <div style={s.docListCol}>
                <DocList docs={docs} selectedPath={selectedPath} onSelect={setSelectedPath} />
              </div>
              <div style={s.previewCol}>
                {selectedDoc ? (
                  <DocPreview repoId={repoId} doc={selectedDoc} />
                ) : (
                  <div style={s.noSelection}>
                    <EmptyState
                      icon="FileText"
                      title={t("noSelection.title")}
                      body={t("noSelection.body")}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!isLoading && listing && (
          <div style={s.footer}>
            <span>{t("footer.documents", { count: docs.length })}</span>
            <span>{t("footer.tokens", { count: totalTokens })}</span>
            <span>{t("footer.discovered", { time: relativeTime(listing.discovered_at, t) })}</span>
          </div>
        )}
      </div>
    </AppShell>
  );
}
