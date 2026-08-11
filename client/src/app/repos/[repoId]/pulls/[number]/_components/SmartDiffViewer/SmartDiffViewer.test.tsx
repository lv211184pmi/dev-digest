import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
// SmartFileCard's "no diff" fallback reads `shell.diffViewer.*`, same as the
// classic FileCard.
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

beforeEach(() => {
  // jsdom has no layout, so scrollIntoView doesn't exist — stub it.
  Element.prototype.scrollIntoView = vi.fn();
});

const FILES: PrFile[] = [
  { path: "src/pricing.ts", additions: 4, deletions: 0, patch: "@@ -1,1 +1,5 @@\n line1\n+line2\n+line3\n+line4\n+line5" },
  { path: "src/index.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n line1" },
  { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line1\n+lockline2" },
  { path: "README.md", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line1\n+readmeline2" },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/pricing.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [5],
          findings: [{ finding_id: "f1", severity: "CRITICAL", start_line: 5, end_line: 5 }],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/index.ts",
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          finding_lines: [],
          findings: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "pnpm-lock.yaml",
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          finding_lines: [],
          findings: [],
        },
        {
          path: "README.md",
          pseudocode_summary: null,
          additions: 1,
          deletions: 0,
          finding_lines: [2],
          findings: [{ finding_id: "f2", severity: "WARNING", start_line: 2, end_line: 2 }],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 5, proposed_splits: [] },
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("groups files by role with counts, pins a boilerplate finding open while a clean boilerplate file stays collapsed, and anchors the severity badge to the finding's line", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);

    const coreHeader = screen.getByRole("button", { name: /Core/ });
    const wiringHeader = screen.getByRole("button", { name: /Wiring/ });
    const boilerplateHeader = screen.getByRole("button", { name: /Boilerplate/ });
    expect(within(coreHeader).getByText("1")).toBeInTheDocument();
    expect(within(wiringHeader).getByText("1")).toBeInTheDocument();
    expect(within(boilerplateHeader).getByText("2")).toBeInTheDocument();

    // pnpm-lock.yaml has no findings — its body (the patch line) stays hidden.
    expect(screen.queryByText("lockline2")).not.toBeInTheDocument();
    // README.md carries a finding — it auto-expands even though it's boilerplate.
    expect(screen.getByText("readmeline2")).toBeInTheDocument();

    // The CRITICAL finding's badge sits on the line whose newNo === start_line
    // (line5 of src/pricing.ts), not on a neighbouring line.
    const line5Row = screen.getByText("line5").closest('[id^="sd-line-"]') as HTMLElement;
    expect(within(line5Row).getByRole("button", { name: /Jump to this finding/i })).toBeInTheDocument();
    const line4Row = screen.getByText("line4").closest('[id^="sd-line-"]') as HTMLElement;
    expect(within(line4Row).queryByRole("button", { name: /Jump to this finding/i })).not.toBeInTheDocument();
  });

  it("collapses the core group when its header is clicked", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);

    expect(screen.getByText("line5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Core/ }));
    expect(screen.queryByText("line5")).not.toBeInTheDocument();
  });

  it("scrolls to a finding's line when its file-header badge is clicked", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);

    // Both src/pricing.ts and README.md carry exactly one finding. Exact-name
    // match excludes the (also-clickable) file-header row, whose accessible
    // name includes the badge text plus the path and stat.
    const badges = screen.getAllByRole("button", { name: "1 findings" });
    expect(badges).toHaveLength(2);
    fireEvent.click(badges[0]!);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("re-scrolls when the same finding's badge is clicked twice — the nonce bump forces the effect to re-fire", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);

    const badges = screen.getAllByRole("button", { name: "1 findings" });
    fireEvent.click(badges[0]!);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    // Same path + same line: without the nonce bump, [targetLine, targetNonce]
    // wouldn't change and the scroll effect wouldn't re-fire.
    fireEvent.click(badges[0]!);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("respects the auto-expand size threshold: a large core file with no findings stays collapsed, a small wiring file with no findings stays open", () => {
    const files: PrFile[] = [
      { path: "src/big.ts", additions: 150, deletions: 60, patch: "@@ -1,1 +1,2 @@\n line1\n+bigfileline" },
      { path: "src/small.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line1\n+smallwireline" },
    ];
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "core",
          files: [
            {
              path: "src/big.ts",
              pseudocode_summary: null,
              additions: 150,
              deletions: 60, // 210 total, over the 200-line auto-expand threshold
              finding_lines: [],
              findings: [],
            },
          ],
        },
        {
          role: "wiring",
          files: [
            {
              path: "src/small.ts",
              pseudocode_summary: null,
              additions: 1,
              deletions: 0,
              finding_lines: [],
              findings: [],
            },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 211, proposed_splits: [] },
    };
    renderWithIntl(<SmartDiffViewer smartDiff={smartDiff} files={files} />);

    expect(screen.queryByText("bigfileline")).not.toBeInTheDocument();
    expect(screen.getByText("smallwireline")).toBeInTheDocument();
  });

  it("collapses the whole boilerplate group by default when none of its files carry findings", () => {
    const files: PrFile[] = [
      { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n line1\n+lockline2" },
    ];
    const smartDiff: SmartDiff = {
      groups: [
        {
          role: "boilerplate",
          files: [
            {
              path: "pnpm-lock.yaml",
              pseudocode_summary: null,
              additions: 1,
              deletions: 0,
              finding_lines: [],
              findings: [],
            },
          ],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    };
    renderWithIntl(<SmartDiffViewer smartDiff={smartDiff} files={files} />);

    const boilerplateHeader = screen.getByRole("button", { name: /Boilerplate/ });
    expect(within(boilerplateHeader).getByText("1")).toBeInTheDocument();
    // The group itself starts collapsed — its file card doesn't render at all
    // until the group header is clicked open.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(boilerplateHeader);
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });
});
