"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  headSha?: string | null;
}

export function OverviewTab({ prBody, prId, headSha }: OverviewTabProps) {
  return (
    <>
      {/* Half-width so a sibling (e.g. blast radius) can sit alongside it. */}
      <div style={s.topRow}>
        <IntentCard prId={prId} headSha={headSha} />
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
