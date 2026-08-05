import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ conventions: messages }}>{ui}</NextIntlClientProvider>);
}

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  run_id: "r1",
  category: "error_handling",
  rule: "Domain errors extend AppError with a stable code.",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "export class NotFoundError extends AppError",
  evidence_start_line: 23,
  evidence_end_line: 31,
  confidence: 0.91,
  accepted: true,
  created_at: "2026-08-05T00:00:00Z",
};

describe("ConventionCard (smoke)", () => {
  it("renders the rule, path:start-end, and confidence", () => {
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onToggleAccepted={vi.fn()} onSaveRule={vi.fn()} pending={false} />);
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText(/91%/)).toBeInTheDocument();
  });

  it("clicking Reject calls onToggleAccepted(false) — a distinct button, not a toggle", () => {
    const onToggleAccepted = vi.fn();
    renderWithIntl(
      <ConventionCard candidate={CANDIDATE} onToggleAccepted={onToggleAccepted} onSaveRule={vi.fn()} pending={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onToggleAccepted).toHaveBeenCalledWith(false);
  });

  it("clicking Accepted on a rejected card calls onToggleAccepted(true)", () => {
    const onToggleAccepted = vi.fn();
    renderWithIntl(
      <ConventionCard
        candidate={{ ...CANDIDATE, accepted: false }}
        onToggleAccepted={onToggleAccepted}
        onSaveRule={vi.fn()}
        pending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(onToggleAccepted).toHaveBeenCalledWith(true);
  });

  it("both actions are disabled while a decision is pending", () => {
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onToggleAccepted={vi.fn()} onSaveRule={vi.fn()} pending />);
    expect(screen.getByRole("button", { name: "Accepted" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("edit → change text → Save calls onSaveRule with the trimmed draft", () => {
    const onSaveRule = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onToggleAccepted={vi.fn()} onSaveRule={onSaveRule} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByPlaceholderText("Describe the convention…");
    fireEvent.change(textarea, { target: { value: "  Updated rule text.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveRule).toHaveBeenCalledWith("Updated rule text.");
  });

  it("edit → Cancel discards the draft without calling onSaveRule", () => {
    const onSaveRule = vi.fn();
    renderWithIntl(<ConventionCard candidate={CANDIDATE} onToggleAccepted={vi.fn()} onSaveRule={onSaveRule} pending={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSaveRule).not.toHaveBeenCalled();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
  });
});
