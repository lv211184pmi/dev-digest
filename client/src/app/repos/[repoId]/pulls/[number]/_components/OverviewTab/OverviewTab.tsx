"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  headSha?: string | null;
  /** `owner/name` — Blast Radius needs it to build sha-pinned GitHub file links. */
  repoFullName?: string | null;
}

export function OverviewTab({ prBody, prId, headSha, repoFullName }: OverviewTabProps) {
  return (
    <>
      {/* Two cards, why and what: the PR's intent beside what it can reach. */}
      <div style={s.topRow}>
        <IntentCard prId={prId} headSha={headSha} />
        <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
