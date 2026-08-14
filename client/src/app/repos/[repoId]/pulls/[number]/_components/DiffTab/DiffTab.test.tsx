import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: vi.fn(() => ({ data: [] })),
  useCreatePrComment: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useSmartDiff: vi.fn(),
}));

import { useSmartDiff } from "@/lib/hooks/reviews";
import { DiffTab } from "./DiffTab";

afterEach(cleanup);

const FILES: PrFile[] = [
  { path: "src/a.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line1\n+line2" },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/a.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [], findings: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("DiffTab — order toggle", () => {
  it("renders Smart order by default and swaps to the classic viewer via 'Original order'", () => {
    vi.mocked(useSmartDiff).mockReturnValue({ data: SMART_DIFF, isLoading: false, isError: false } as ReturnType<
      typeof useSmartDiff
    >);
    renderWithIntl(<DiffTab prId="pr1" filesCount={1} files={FILES} canComment={false} />);

    // Smart order renders the role group headers.
    expect(screen.getByText("Core")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Original order" }));

    // Original order renders today's plain DiffViewer — no role grouping.
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("falls back to the classic viewer without throwing when Smart Diff errors", () => {
    vi.mocked(useSmartDiff).mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<
      typeof useSmartDiff
    >);

    renderWithIntl(<DiffTab prId="pr1" filesCount={1} files={FILES} canComment={false} />);

    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("shows a loading skeleton while Smart Diff is still fetching, before either viewer renders", () => {
    vi.mocked(useSmartDiff).mockReturnValue({ data: undefined, isLoading: true, isError: false } as ReturnType<
      typeof useSmartDiff
    >);

    const { container } = renderWithIntl(<DiffTab prId="pr1" filesCount={1} files={FILES} canComment={false} />);

    expect(container.querySelector(".skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
  });
});
