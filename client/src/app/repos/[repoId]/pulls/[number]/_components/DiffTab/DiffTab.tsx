"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { usePrComments, useCreatePrComment, useSmartDiff } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Smart Diff is deterministic and cheap, but a PR with no reviews/files yet
  // can 404 — `retry: false` (set in the hook) keeps that quiet, and an error
  // here just falls back to the classic viewer below.
  const { data: smartDiff, isLoading: smartLoading, isError: smartError } = useSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // View preference inside this tab, not URL state — `page.tsx`'s `setParam`
  // does a `router.replace` on every change; `?order=` deep-linking is a
  // follow-up, not this toggle.
  const [order, setOrder] = React.useState<"smart" | "original">("smart");

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // There is no Segmented primitive in @devdigest/ui — this matches the
  // show/hide-comments toggle already in this file: plain Buttons, active
  // one "secondary", inactive one "ghost".
  let diffBody: React.ReactNode;
  if (order === "original") {
    diffBody = <DiffViewer files={files} commenting={commenting} />;
  } else if (smartLoading) {
    diffBody = <Skeleton height={200} />;
  } else if (smartDiff && !smartError) {
    diffBody = <SmartDiffViewer smartDiff={smartDiff} files={files} />;
  } else {
    diffBody = <DiffViewer files={files} commenting={commenting} />;
  }

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <Button kind={order === "smart" ? "secondary" : "ghost"} size="sm" onClick={() => setOrder("smart")}>
                {t("smartDiff.orderSmart")}
              </Button>
              <Button
                kind={order === "original" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setOrder("original")}
              >
                {t("smartDiff.orderOriginal")}
              </Button>
            </div>
            {order === "original" ? (
              commentCount > 0 && (
                <Button
                  kind="ghost"
                  size="sm"
                  icon={showComments ? "EyeOff" : "Eye"}
                  onClick={() => setShowComments((v) => !v)}
                >
                  {showComments ? "Hide comments" : "Show comments"} ({commentCount})
                </Button>
              )
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("smartDiff.orderHint")}</span>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {diffBody}
    </section>
  );
}
