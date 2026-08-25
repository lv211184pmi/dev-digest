import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectContextDoc, ProjectContextListing, Repo } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";
import { ApiError } from "@/lib/api";

const REPO: Repo = {
  id: "repo1",
  workspace_id: "w1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: "/clones/acme/payments-api",
  last_polled_at: null,
  created_by: null,
};

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: REPO,
    reposLoaded: true,
    repoId: REPO.id,
    repos: [REPO],
    setRepoId: vi.fn(),
  }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let listingData: ProjectContextListing | undefined;
let listingError: ApiError | undefined;
let listingIsFetching = false;
const resyncMutate = vi.fn();
const refetchMock = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useProjectContext: () => ({
    data: listingData,
    isLoading: false,
    isError: !!listingError,
    isFetching: listingIsFetching,
    error: listingError,
    refetch: refetchMock,
  }),
  useResyncRepoIntel: () => ({ mutate: resyncMutate, isPending: false }),
  useProjectContextUsage: () => ({ data: { path: "docs/a.md", agent_count: 2 }, isLoading: false }),
  useProjectContextDoc: () => ({
    data: {
      path: "docs/a.md",
      type: "docs",
      bytes: 1200,
      tokens: 300,
      text: "content",
      truncated: false,
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));

import { ProjectContextView } from "./ProjectContextView";

let queryClient: QueryClient;

afterEach(() => {
  cleanup();
  listingData = undefined;
  listingError = undefined;
  listingIsFetching = false;
  resyncMutate.mockClear();
  refetchMock.mockClear();
});

function renderView() {
  queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <ProjectContextView repoId="repo1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function rerenderView(rerender: (ui: React.ReactElement) => void) {
  rerender(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <ProjectContextView repoId="repo1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const DOC_A: ProjectContextDoc = {
  path: "docs/a.md",
  type: "docs",
  bytes: 1200,
  tokens: 300,
  modified_at: "2026-08-20T00:00:00Z",
};
const DOC_B: ProjectContextDoc = {
  path: "specs/b.md",
  type: "specs",
  bytes: 800,
  tokens: 190,
  modified_at: "2026-08-21T00:00:00Z",
};

function listing(overrides: Partial<ProjectContextListing>): ProjectContextListing {
  return {
    repo_id: "repo1",
    docs: [],
    truncated: false,
    discovered_at: "2026-08-23T00:00:00Z",
    roots: ["**/specs/**/*.md", "**/docs/**/*.md", "**/insights/**/*.md"],
    ...overrides,
  };
}

describe("ProjectContextView (smoke)", () => {
  it("populated: renders one row per document, path only — no type, bytes or token column", () => {
    listingData = listing({ docs: [DOC_A, DOC_B] });
    renderView();
    expect(screen.getByText("docs/a.md")).toBeInTheDocument();
    expect(screen.getByText("specs/b.md")).toBeInTheDocument();
    expect(screen.queryByText("≈300")).not.toBeInTheDocument();
    expect(screen.queryByText("1200")).not.toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  it("populated with nothing selected: the preview column tells the user to pick a document", () => {
    listingData = listing({ docs: [DOC_A, DOC_B] });
    renderView();
    expect(screen.getByText("No document selected")).toBeInTheDocument();
    expect(screen.getByText("Pick a document from the list to read it here.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "docs/a.md" }));
    expect(screen.queryByText("No document selected")).not.toBeInTheDocument();
  });

  it("empty: names the search roots and renders zero document rows", () => {
    listingData = listing({ docs: [] });
    renderView();
    expect(screen.getByText("No documents found")).toBeInTheDocument();
    expect(screen.getByText(/\*\*\/specs\/\*\*\/\*\.md/)).toBeInTheDocument();
    expect(screen.queryByText("docs/a.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
  });

  it("not-cloned: renders the not-cloned state with a resync control and zero document rows", () => {
    listingError = new ApiError("Repo has not been cloned yet", 409, "repo_not_cloned");
    renderView();
    expect(screen.getByText("Repo not cloned")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync" })).toBeInTheDocument();
    expect(screen.queryByText("docs/a.md")).not.toBeInTheDocument();
  });

  it("Refresh is the only toolbar control — every authoring control is removed, not disabled", () => {
    listingData = listing({ docs: [DOC_A] });
    renderView();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    // Negative assertion — a control silently surviving the removal is
    // exactly the failure mode this test exists to catch (R5).
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("activating Refresh calls the listing query's refetch", () => {
    listingData = listing({ docs: [DOC_A] });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("a refreshed listing that omits the selected path clears the preview pane", () => {
    listingData = listing({ docs: [DOC_A, DOC_B] });
    const { rerender } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "docs/a.md" }));
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();

    // Simulate the fresh listing dropping the previously selected document.
    listingData = listing({ docs: [DOC_B] });
    rerenderView(rerender);
    expect(screen.queryByText("Used by 2 agents")).not.toBeInTheDocument();
  });

  it("truncated: renders the cap notice", () => {
    listingData = listing({ docs: [DOC_A], truncated: true });
    renderView();
    expect(screen.getByText(/capped at the discovery limit/)).toBeInTheDocument();
  });

  it("a background refetch failure keeps the populated view mounted instead of tearing down to the full error state (PR1)", () => {
    listingData = listing({ docs: [DOC_A, DOC_B] });
    const { rerender } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "docs/a.md" }));
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();

    // A background refetch fails, but `listing` (TanStack Query's last-good
    // `data`) is still cached and passed through by the mock, exactly as the
    // real query would keep it across a failed background refetch.
    listingError = new ApiError("network blip", 0, "network_error");
    rerenderView(rerender);

    // The populated view — list, selection (DocPreview) and footer — stays
    // mounted; the full-page error state (which would unmount all of it)
    // does not appear.
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
    expect(screen.getByText("specs/b.md")).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t load the document list")).not.toBeInTheDocument();
  });

  it("activating Refresh with a document selected also invalidates that document's content and usage queries (PR2)", () => {
    listingData = listing({ docs: [DOC_A, DOC_B] });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "docs/a.md" }));

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["project-context-doc", "repo1", "docs/a.md"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["project-context-usage", "repo1", "docs/a.md"],
    });
  });

  it("activating Refresh with no document selected does not touch the doc/usage queries", () => {
    listingData = listing({ docs: [DOC_A] });
    renderView();

    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
