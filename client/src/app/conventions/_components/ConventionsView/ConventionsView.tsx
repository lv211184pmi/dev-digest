"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import {
  useConventionDecisions,
  useConventions,
  useExtractConventions,
  useUpdateConvention,
} from "@/lib/hooks/conventions";
import { ConventionsHeader } from "./_components/ConventionsHeader";
import { ConventionsToolbar } from "./_components/ConventionsToolbar";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateConventionSkillModal } from "./_components/CreateConventionSkillModal";
import { s } from "./styles";

/** /conventions — scan the active repo for house-rules, back each with
 *  evidence, and merge the accepted set into a Skill. Not nested under
 *  /repos/:repoId, so the repo comes from `useActiveRepo()`. */
export function ConventionsView() {
  const t = useTranslations("conventions");
  const { activeRepo, reposLoaded } = useActiveRepo();
  const [showSkillModal, setShowSkillModal] = React.useState(false);
  const [pendingCandidateId, setPendingCandidateId] = React.useState<string | null>(null);

  const repoId = activeRepo?.id ?? null;
  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const updateCandidate = useUpdateConvention(repoId);
  const decisions = useConventionDecisions(repoId);

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  if (!reposLoaded) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={120} />
        </div>
      </AppShell>
    );
  }

  if (!activeRepo) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="GitBranch" title={t("page.noRepo.title")} body={t("page.noRepo.body")} />
        </div>
      </AppShell>
    );
  }

  const run = data?.run ?? null;
  const candidates = data?.candidates ?? [];
  const acceptedCount = candidates.filter((c) => c.accepted).length;
  const onRescan = () => extract.mutate();

  return (
    <AppShell crumb={crumb}>
      {showSkillModal && run && (
        <CreateConventionSkillModal
          runId={run.id}
          repoId={repoId!}
          onClose={() => setShowSkillModal(false)}
        />
      )}
      <div style={s.page}>
        <ConventionsHeader
          repoName={activeRepo.full_name}
          run={run}
          onRescan={onRescan}
          pending={extract.isPending}
        />

        {isLoading && <Skeleton height={120} style={{ marginTop: 18 }} />}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && !run && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={onRescan}
            ctaLoading={extract.isPending}
          />
        )}

        {run && (run.status === "queued" || run.status === "running") && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}

        {run && run.status === "failed" && (
          <div style={s.failedBanner}>
            <Icon.AlertTriangle size={16} />
            <span>{run.error ?? t("page.extractionFailed")}</span>
          </div>
        )}

        {run && run.status === "done" && candidates.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={run.error ? t("page.notIndexed") : t("page.empty.body")}
          />
        )}

        {run && run.status === "done" && candidates.length > 0 && (
          <>
            <ConventionsToolbar
              total={candidates.length}
              accepted={acceptedCount}
              onSelectAll={() => decisions.mutate({ runId: run.id, accepted: true })}
              onDeselectAll={() => decisions.mutate({ runId: run.id, accepted: false })}
              onCreateSkill={() => setShowSkillModal(true)}
              decisionsPending={decisions.isPending}
            />
            <div style={s.grid}>
              {candidates.map((c) => (
                <ConventionCard
                  key={c.id}
                  candidate={c}
                  pending={updateCandidate.isPending && pendingCandidateId === c.id}
                  onToggleAccepted={(accepted) => {
                    setPendingCandidateId(c.id);
                    updateCandidate.mutate(
                      { id: c.id, patch: { accepted } },
                      { onSettled: () => setPendingCandidateId(null) },
                    );
                  }}
                  onSaveRule={(rule) => updateCandidate.mutate({ id: c.id, patch: { rule } })}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
