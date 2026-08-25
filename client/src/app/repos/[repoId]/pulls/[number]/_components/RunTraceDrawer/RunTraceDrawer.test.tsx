import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
// `project_context` is additive with `.default([])` on the real contract
// (Phase 1), but a hand-authored fixture typed as `RunTrace` — never passed
// through `RunTrace.parse()` — still has to supply it explicitly: the
// *output* type z.infer produces is non-optional. This is the fixture the
// pre-existing client typecheck gap pointed at; `specs_read` below is left
// exactly as it was (still `string[]`) — that it keeps passing is the proof
// Phase 1 never widened it.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  project_context: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// A run that attached project-context documents: the assembled `specs` block
// is present (so the moved PromptBlock renders) and `project_context` carries
// one `included` and one `truncated` entry (AC 25's status badge).
const TRACE_WITH_CONTEXT: RunTrace = {
  ...TRACE,
  prompt_assembly: { ...TRACE.prompt_assembly, specs: "### docs/security.md\nBody text." },
  project_context: [
    { path: "docs/security.md", type: "docs", tokens: 120, status: "included", inherited_from: null },
    { path: "docs/huge.md", type: "docs", tokens: 4000, status: "truncated", inherited_from: "sec-skill" },
  ],
};

// A run that injected nothing: `prompt_assembly.specs` is null and
// `project_context` is empty — AC 22, the row must not render at all.
const TRACE_NO_CONTEXT: RunTrace = {
  ...TRACE,
  prompt_assembly: { ...TRACE.prompt_assembly, specs: null },
  project_context: [],
};

let currentTrace: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: currentTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  it("renders the project-context row with its label and a status badge for a truncated entry (AC 21/25)", () => {
    currentTrace = TRACE_WITH_CONTEXT;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    // Prompt assembly starts collapsed (TraceSection defaultOpen=false).
    fireEvent.click(screen.getByText("Prompt assembly"));

    // The moved prompt_assembly.specs block, relabelled — not a second block.
    expect(screen.getByText("Project context — attached specs (untrusted)")).toBeInTheDocument();
    // The per-document Configuration list: the included entry has no badge,
    // the truncated one does.
    expect(screen.getByText("docs/security.md")).toBeInTheDocument();
    expect(screen.getByText("docs/huge.md")).toBeInTheDocument();
    expect(screen.getByText("Truncated")).toBeInTheDocument();
  });

  it("renders no project-context row when nothing was injected (AC 22)", () => {
    currentTrace = TRACE_NO_CONTEXT;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    fireEvent.click(screen.getByText("Prompt assembly"));

    expect(screen.queryByText("Project context — attached specs (untrusted)")).not.toBeInTheDocument();
  });
});
