import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

beforeEach(() => {
  // jsdom has no layout, so scrollIntoView doesn't exist — stub it.
  Element.prototype.scrollIntoView = vi.fn();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "bug",
    title: "Missing null check",
    file: "src/handler.ts",
    start_line: 22,
    end_line: 22,
    rationale: "This can throw.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — targetFindingId (Files changed → Agent runs deep link)", () => {
  it("expands and scrolls to the targeted finding instead of defaulting to the first one", () => {
    renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" targetFindingNonce={1} />,
    );

    // f2 (WARNING) sorts after f1 (CRITICAL) — without targeting, only f1
    // would auto-expand. Targeted, f2's rationale is the one visible...
    expect(screen.getByText("This can throw.")).toBeInTheDocument();
    // ...and f1 stays collapsed.
    expect(screen.queryByText("A secret is committed.")).not.toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("defaults to focusing the first finding when no target is given", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("A secret is committed.")).toBeInTheDocument();
    expect(screen.queryByText("This can throw.")).not.toBeInTheDocument();
  });

  it("re-targets a different finding on a bumped nonce without remounting — regression for the accordion-already-open case", () => {
    // ReviewRunAccordion only re-mounts FindingsPanel the first time a run
    // opens; a run that's already open (the newest one, opened by default)
    // reuses the same instance for every subsequent click. `rerender` here
    // simulates exactly that: same component instance, new target props.
    const { rerender } = renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f1" targetFindingNonce={1} />,
    );
    expect(screen.getByText("A secret is committed.")).toBeInTheDocument();
    expect(screen.queryByText("This can throw.")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" targetFindingNonce={2} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("This can throw.")).toBeInTheDocument();
    // f1 was left expanded from the previous target — the new click must
    // collapse it, not just open f2 alongside it.
    expect(screen.queryByText("A secret is committed.")).not.toBeInTheDocument();

    // Re-clicking the SAME finding (nonce bumps again, id unchanged) must
    // still re-fire the scroll.
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" targetFindingNonce={3} />
      </NextIntlClientProvider>,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("collapses a card the user manually expanded, once a target arrives — only the target stays open", () => {
    const { rerender } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    // f1 is open by default (no target yet); manually open f2 too.
    fireEvent.click(screen.getByText("Missing null check"));
    expect(screen.getByText("A secret is committed.")).toBeInTheDocument();
    expect(screen.getByText("This can throw.")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" targetFindingId="f2" targetFindingNonce={1} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("This can throw.")).toBeInTheDocument();
    expect(screen.queryByText("A secret is committed.")).not.toBeInTheDocument();
  });
});
