import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import type { ProjectContextAttachment, ProjectContextDoc } from "@devdigest/shared";
import agentsMessages from "../../../messages/en/agents.json";
import { ContextTab, type ContextTabProps } from "./ContextTab";
import { reorder } from "./helpers";

// The drawer's own data hooks are a boundary — mocked here so opening the
// drawer in the "Preview" test below never issues a real fetch. Skeleton
// states (isLoading: true) are enough to prove the drawer mounted with the
// right path; the drawer's own content states are DocPreviewDrawer's
// concern, not this component's.
vi.mock("@/lib/hooks", () => ({
  useProjectContextUsage: () => ({ isLoading: true, data: undefined }),
  useProjectContextDoc: () => ({ isLoading: true, isError: false, isSuccess: false, data: undefined }),
}));

afterEach(cleanup);

const DOCS: ProjectContextDoc[] = [
  { path: "docs/a.md", type: "docs", bytes: 100, tokens: 40, modified_at: "2026-08-01T00:00:00Z" },
  { path: "docs/b.md", type: "docs", bytes: 200, tokens: 60, modified_at: "2026-08-01T00:00:00Z" },
  { path: "specs/c.md", type: "specs", bytes: 300, tokens: 80, modified_at: "2026-08-01T00:00:00Z" },
];

// The shared tab takes an already-scoped translator as a prop rather than
// calling useTranslations itself (see ContextTab.tsx's own docblock) — this
// harness resolves the real `agents.context.*` strings the same way the
// AgentEditor wrapper does, so assertions read exactly what a user would see.
function Harness(props: Omit<ContextTabProps, "t">) {
  const t = useTranslations("agents.context");
  return <ContextTab {...props} t={t} />;
}

function renderTab(props: Omit<ContextTabProps, "t" | "ownerKind" | "ownerId">) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      <Harness ownerKind="agent" ownerId="ag1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  it("ticking a document calls onSetPaths once with the full ordered array, and renders no Save/Discard control (R1)", () => {
    const onSetPaths = vi.fn();
    renderTab({ repoId: "r1", docs: DOCS, attached: [], onSetPaths });

    // getByRole with an accessible name — a positional getAllByRole("checkbox")[0]
    // would still pass even if the checkbox had no accessible name at all.
    fireEvent.click(screen.getByRole("checkbox", { name: "docs/a.md" }));

    expect(onSetPaths).toHaveBeenCalledTimes(1);
    expect(onSetPaths).toHaveBeenCalledWith(["docs/a.md"]);
    // The direct inversion of the v1 test that asserted "ticking never persists".
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("keeps the checkbox's accessible name the full repo-relative path while the visible label leads with the filename (R6, R22)", () => {
    renderTab({
      repoId: "r1",
      docs: DOCS,
      attached: [{ path: "docs/a.md", order: 0 }],
      onSetPaths: vi.fn(),
    });

    expect(screen.getByRole("checkbox", { name: "docs/a.md" })).toBeChecked();

    // Visible presentation is filename first, directory second — the two
    // are separate text nodes (excluded from the accessible name via
    // aria-hidden) so "a.md" and "docs/" both exist and in that DOM order,
    // scoped to this row since "docs/" also appears in the unattached
    // docs/b.md row.
    const row = document.querySelector<HTMLElement>('[data-row-path="docs/a.md"]')!;
    const fileNode = within(row).getByText("a.md");
    const dirNode = within(row).getByText("docs/");
    expect(fileNode.compareDocumentPosition(dirNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("filtering shows only matching rows, leaves the N of M counter unchanged, and keeps a filtered-out attached document attached (R10, R11, R12)", () => {
    const attached: ProjectContextAttachment[] = [{ path: "docs/a.md", order: 0 }];
    renderTab({ repoId: "r1", docs: DOCS, attached, onSetPaths: vi.fn() });

    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents by path" }), {
      target: { value: "specs" },
    });

    expect(screen.queryByText("a.md")).not.toBeInTheDocument();
    expect(screen.getByText("c.md")).toBeInTheDocument();

    // The counter is unaffected by the filter.
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();

    // The filtered-out attachment stays attached — its tokens still count
    // toward the footer total even though its row isn't rendered.
    expect(screen.getByText("≈40 tokens attached")).toBeInTheDocument();
  });

  it("renders the no-matches message with heading, counter and footer still present when nothing matches (R13)", () => {
    renderTab({ repoId: "r1", docs: DOCS, attached: [], onSetPaths: vi.fn() });

    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents by path" }), {
      target: { value: "zzz-nope" },
    });

    expect(screen.getByText("No documents match that filter.")).toBeInTheDocument();
    expect(screen.getByText("Project context")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 attached")).toBeInTheDocument();
    expect(screen.getByText("≈0 tokens attached")).toBeInTheDocument();
  });

  it("disables drag on an attached row while a filter is active (R15) — a silently ignored drag would look identical to a working one", () => {
    const attached: ProjectContextAttachment[] = [{ path: "docs/a.md", order: 0 }];
    renderTab({ repoId: "r1", docs: DOCS, attached, onSetPaths: vi.fn() });

    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents by path" }), {
      target: { value: "docs/a" },
    });

    const handle = screen.getByTitle("Clear the filter to reorder.");
    expect(handle).toHaveAttribute("aria-disabled", "true");
    expect(handle).toHaveAttribute("draggable", "false");
  });

  it("reorders via a single onDrop with no mutation on dragover (R4, D25)", () => {
    const onSetPaths = vi.fn();
    const attached: ProjectContextAttachment[] = [
      { path: "docs/a.md", order: 0 },
      { path: "docs/b.md", order: 1 },
    ];
    const { container } = renderTab({ repoId: "r1", docs: DOCS, attached, onSetPaths });

    const handles = container.querySelectorAll('[draggable="true"]');
    expect(handles).toHaveLength(2);
    const [handleA, handleB] = handles as unknown as [Element, Element];

    fireEvent.dragStart(handleA);
    fireEvent.dragOver(handleB);
    expect(onSetPaths).not.toHaveBeenCalled();

    fireEvent.drop(handleB);
    expect(onSetPaths).toHaveBeenCalledTimes(1);
    expect(onSetPaths).toHaveBeenCalledWith(["docs/b.md", "docs/a.md"]);
  });

  it("renders no Browse all documents link (R20)", () => {
    renderTab({ repoId: "r1", docs: DOCS, attached: [], onSetPaths: vi.fn() });
    expect(screen.queryByRole("link", { name: "Browse all documents" })).not.toBeInTheDocument();
  });

  it("activating Preview opens a drawer titled with the path, and closing it returns focus to the Preview control (R16, R17)", () => {
    renderTab({ repoId: "r1", docs: DOCS, attached: [], onSetPaths: vi.fn() });

    const previewButton = screen.getAllByRole("button", { name: "Preview" })[0]!;
    fireEvent.click(previewButton);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(DOCS[0]!.path)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(previewButton).toHaveFocus();
  });
});

// Drag-reorder's pure arithmetic (splice-based move, out-of-range no-ops) is
// covered independently of the DOM-drag test above, at the pure-function
// level — the empty-list, single-item and first/last-index edges are cheaper
// to assert here than through simulated drag events.
describe("reorder", () => {
  it("returns an empty list unchanged", () => {
    expect(reorder([], 0, 0)).toEqual([]);
  });

  it("is a no-op on a single-item list", () => {
    expect(reorder(["a"], 0, 0)).toEqual(["a"]);
  });

  it("moves the first item to last, and back to first", () => {
    const list = ["a", "b", "c"];
    const movedToLast = reorder(list, 0, 2);
    expect(movedToLast).toEqual(["b", "c", "a"]);
    expect(reorder(movedToLast, 2, 0)).toEqual(list);
  });

  it("moves the last item to first", () => {
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});
