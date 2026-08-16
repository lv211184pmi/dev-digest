/**
 * BlastRadiusCard.
 *
 * The tests are weighted deliberately. Rendering a tree is ordinary React and
 * gets ordinary coverage; the two things that can cause real harm get most of
 * the file:
 *
 *  1. **An unknown map must never look like an empty one.** `unavailable` must
 *     not render a map, and `partial` must render its warning alongside the map
 *     it does have. A reviewer who reads "0 callers" as "safe to merge" when the
 *     truth was "we could not see" is the failure this card exists to prevent.
 *  2. **`path:line` must point at the right line.** The link is only useful if
 *     it is sha-pinned and carries the anchor, and it must degrade to plain text
 *     rather than guess a URL when the repo or sha is missing.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBlastRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: vi.fn(),
  useDeriveBlastSummary: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
}));

// The graph view lazy-loads mermaid, which jsdom cannot run. The builder that
// feeds it is pure and tested separately in `graph.test.ts`; here we only care
// that the graph branch renders *something* addressable.
vi.mock("@/components/mermaid-diagram/MermaidDiagram", () => ({
  MermaidDiagram: ({ chart }: { chart: string }) => <pre data-testid="mermaid">{chart}</pre>,
}));

import { useBlastRadius } from "@/lib/hooks/blast";
import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(cleanup);

function record(over: Partial<PrBlastRecord> = {}): PrBlastRecord {
  return {
    pr_id: "pr-1",
    changed_symbols: [
      { name: "rateLimit", file: "src/middleware/rate-limit.ts", kind: "function", line: 12 },
    ],
    downstream: [
      {
        symbol: "rateLimit",
        callers: [
          { name: "registerPublicRoutes", file: "src/api/public/index.ts", line: 23 },
          { name: "webhookRoutes", file: "src/api/public/webhooks.ts", line: 45 },
        ],
        endpoints_affected: ["GET /api/public/items"],
        crons_affected: ["reset-rate-buckets (hourly)"],
        caller_count: 4,
        truncated: true,
      },
    ],
    summary: "Rate limiting now fronts three public endpoints.",
    index: {
      state: "full",
      reason: null,
      explanation: "",
      indexed_files: 412,
      files_covered: ["src/middleware/rate-limit.ts"],
      files_not_covered: [],
    },
    totals: { symbols: 2, callers: 14, endpoints: 3, crons: 1 },
    head_sha: "abc123",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    cost_usd: 0.0001,
    tokens_in: 300,
    tokens_out: 40,
    derived_at: "2026-08-16T10:00:00.000Z",
    is_stale: false,
    ...over,
  };
}

function renderCard(data: PrBlastRecord | undefined, props: Record<string, unknown> = {}) {
  vi.mocked(useBlastRadius).mockReturnValue({
    data,
    isLoading: false,
  } as ReturnType<typeof useBlastRadius>);

  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusCard
        prId="pr-1"
        repoFullName="acme/payments-api"
        headSha="abc123"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusCard — the map", () => {
  it("shows the stat row, the summary and the first symbol expanded", () => {
    renderCard(record());

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("symbols")).toBeTruthy();
    expect(screen.getByText("endpoints")).toBeTruthy();
    expect(screen.getByText(/Rate limiting now fronts/)).toBeTruthy();

    expect(screen.getByText("rateLimit()")).toBeTruthy();
    // First node defaults open, so its callers are visible without a click.
    expect(screen.getByText("src/api/public/index.ts:23")).toBeTruthy();
  });

  it("reports the pre-cap caller count, not the number of rows shown", () => {
    renderCard(record());
    // Two callers rendered, but the server found four.
    expect(screen.getByText("4 callers")).toBeTruthy();
  });

  it("renders endpoints and crons as chips", () => {
    renderCard(record());
    expect(screen.getByText("GET /api/public/items")).toBeTruthy();
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeTruthy();
  });

  it("collapses and expands a symbol", () => {
    renderCard(record());
    const toggle = screen.getByRole("button", { expanded: true });

    fireEvent.click(toggle);
    expect(screen.queryByText("src/api/public/index.ts:23")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByText("src/api/public/index.ts:23")).toBeTruthy();
  });
});

describe("BlastRadiusCard — path:line links", () => {
  it("links each caller to its exact line, pinned to the PR head sha", () => {
    renderCard(record());

    const link = screen.getByText("src/api/public/index.ts:23").closest("a");
    expect(link).toBeTruthy();
    expect(link!.getAttribute("href")).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/api/public/index.ts#L23",
    );
    // Opening a code link must not navigate the studio away from the PR.
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toContain("noopener");
  });

  it("links the declaration site as well as the callers", () => {
    renderCard(record());

    const decl = screen.getByText("src/middleware/rate-limit.ts:12").closest("a");
    expect(decl!.getAttribute("href")).toBe(
      "https://github.com/acme/payments-api/blob/abc123/src/middleware/rate-limit.ts#L12",
    );
  });

  it("falls back to plain text rather than guessing a URL without a repo or sha", () => {
    renderCard(record(), { repoFullName: null });

    const path = screen.getByText("src/api/public/index.ts:23");
    expect(path.closest("a")).toBeNull();
  });
});

describe("BlastRadiusCard — coverage is never masked", () => {
  it("an unavailable index shows the explanation and NO map", () => {
    renderCard(
      record({
        changed_symbols: [],
        downstream: [],
        summary: null,
        index: {
          state: "unavailable",
          reason: "no_data",
          explanation: "This repository has not been indexed yet.",
          indexed_files: 0,
          files_covered: [],
          files_not_covered: ["src/middleware/rate-limit.ts"],
        },
        totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
      }),
    );

    expect(screen.getByText(/has not been indexed yet/)).toBeTruthy();
    // Critically: no stat row claiming zeroes, which would read as "no impact".
    expect(screen.queryByText("callers")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("a partial index keeps its map but warns and names the files it missed", () => {
    renderCard(
      record({
        index: {
          state: "partial",
          reason: "index_partial",
          explanation: "2 changed file(s) are in languages the index does not parse.",
          indexed_files: 412,
          files_covered: ["src/middleware/rate-limit.ts"],
          files_not_covered: ["main.go", "worker.py"],
        },
      }),
    );

    expect(screen.getByText("Partial index")).toBeTruthy();
    expect(screen.getByText(/languages the index does not parse/)).toBeTruthy();
    // Each miss is its own line/link, not one run-on comma-joined paragraph.
    expect(screen.getByText("main.go")).toBeTruthy();
    expect(screen.getByText("worker.py")).toBeTruthy();
    const link = screen.getByText("main.go").closest("a");
    expect(link!.getAttribute("href")).toBe(
      "https://github.com/acme/payments-api/blob/abc123/main.go",
    );
    // The map itself still renders — a partial answer is still an answer.
    expect(screen.getByText("rateLimit()")).toBeTruthy();
  });

  it("caps a long not-covered list instead of dumping every file on one line", () => {
    const files = Array.from({ length: 12 }, (_, i) => `pkg/file${i}.go`);
    renderCard(
      record({
        index: {
          state: "partial",
          reason: "index_partial",
          explanation: "Several changed files are in languages the index does not parse.",
          indexed_files: 412,
          files_covered: ["src/middleware/rate-limit.ts"],
          files_not_covered: files,
        },
      }),
    );

    expect(screen.getByText("pkg/file0.go")).toBeTruthy();
    expect(screen.getByText("+4 more")).toBeTruthy();
    expect(screen.queryByText("pkg/file11.go")).toBeNull();
  });

  it("says so explicitly when a covered diff genuinely has no downstream", () => {
    renderCard(record({ downstream: [], totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 } }));

    expect(screen.getByText(/no downstream callers found/)).toBeTruthy();
  });
});

describe("BlastRadiusCard — views and summary", () => {
  it("switches to the graph view", () => {
    renderCard(record());

    fireEvent.click(screen.getByRole("tab", { name: "Graph" }));

    const mermaid = screen.getByTestId("mermaid");
    expect(mermaid.textContent).toContain("flowchart LR");
    expect(mermaid.textContent).toContain("rateLimit()");
  });

  it("links graph nodes to the same sha-pinned GitHub blob URLs as the Tree view", () => {
    renderCard(record());

    fireEvent.click(screen.getByRole("tab", { name: "Graph" }));

    const mermaid = screen.getByTestId("mermaid").textContent ?? "";
    // Declaration site of the changed symbol.
    expect(mermaid).toContain(
      'href "https://github.com/acme/payments-api/blob/abc123/src/middleware/rate-limit.ts#L12" _blank',
    );
    // Caller file.
    expect(mermaid).toContain(
      'href "https://github.com/acme/payments-api/blob/abc123/src/api/public/index.ts#L23" _blank',
    );
  });

  it("offers to derive the summary when none exists yet", () => {
    renderCard(record({ summary: null }));

    expect(screen.getByRole("button", { name: /Explain impact/ })).toBeTruthy();
  });

  it("flags a stale summary and offers a re-derive", () => {
    renderCard(record({ is_stale: true }));

    expect(screen.getByText("Summary is out of date")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Re-explain/ })).toBeTruthy();
  });

  it("renders nothing while the map is loading", () => {
    vi.mocked(useBlastRadius).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useBlastRadius>);

    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <BlastRadiusCard prId="pr-1" repoFullName="acme/payments-api" headSha="abc123" />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
