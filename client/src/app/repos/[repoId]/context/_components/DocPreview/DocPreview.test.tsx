import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectContextDoc, ProjectContextDocContent } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";
import { ApiError } from "@/lib/api";

let contentData: ProjectContextDocContent | undefined;
let contentError: ApiError | undefined;
let contentLoading = false;

vi.mock("@/lib/hooks", () => ({
  useProjectContextUsage: () => ({ data: { path: "docs/a.md", agent_count: 2 }, isLoading: false }),
  useProjectContextDoc: () => ({
    data: contentData,
    isLoading: contentLoading,
    isError: !!contentError,
    isSuccess: !contentLoading && !contentError && !!contentData,
  }),
}));

import { DocPreview } from "./DocPreview";

afterEach(() => {
  cleanup();
  contentData = undefined;
  contentError = undefined;
  contentLoading = false;
});

const DOC: ProjectContextDoc = {
  path: "docs/a.md",
  type: "docs",
  bytes: 1200,
  tokens: 300,
  modified_at: "2026-08-20T00:00:00Z",
};

function renderPreview() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <DocPreview repoId="repo1" doc={DOC} />
    </NextIntlClientProvider>,
  );
}

describe("DocPreview", () => {
  it("renders the document's markdown under a header carrying the path and the usage count", () => {
    contentData = {
      path: "docs/a.md",
      type: "docs",
      bytes: 1200,
      tokens: 300,
      text: "# Hello world",
      truncated: false,
    };
    renderPreview();
    expect(screen.getByRole("heading", { name: "Hello world" })).toBeInTheDocument();
    const usedBy = screen.getByText("Used by 2 agents");
    // The count sits in the same header row as the path (R9).
    const path = screen.getByText("docs/a.md");
    expect(path.parentElement?.parentElement).toContainElement(usedBy);
    // The type badge and the bytes/tokens meta row are gone — the header
    // carries the path and the usage count, nothing else.
    expect(screen.queryByText("docs")).not.toBeInTheDocument();
    expect(screen.queryByText("1200")).not.toBeInTheDocument();
    expect(screen.queryByText("≈300")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("renders an inline error state and keeps the pane mounted when the content request fails", () => {
    contentError = new ApiError("not found", 404, "not_found");
    renderPreview();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn’t load this document’s content")).toBeInTheDocument();
    // The pane itself — its header — stays mounted around the error.
    expect(screen.getByText("docs/a.md")).toBeInTheDocument();
  });

  it("renders the truncation caption when the response is truncated", () => {
    contentData = {
      path: "docs/a.md",
      type: "docs",
      bytes: 8000,
      tokens: 2000,
      text: "clipped text",
      truncated: true,
    };
    renderPreview();
    expect(
      screen.getByText("Truncated to the same slice a review run would inject."),
    ).toBeInTheDocument();
  });

  it("renders the empty-state message, not an error, for a 0-byte document", () => {
    contentData = {
      path: "docs/a.md",
      type: "docs",
      bytes: 0,
      tokens: 0,
      text: "",
      truncated: false,
    };
    renderPreview();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // PR3 remediation: `<Markdown>` renders `null` for "", so the empty
    // state has to be rendered explicitly or the content area is silently
    // blank — indistinguishable from something failing to render.
    expect(screen.getByText("This document is empty.")).toBeInTheDocument();
  });
});
