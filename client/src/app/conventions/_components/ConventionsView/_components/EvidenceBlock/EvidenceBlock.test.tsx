import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/conventions.json";
import { EvidenceBlock } from "./EvidenceBlock";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ conventions: messages }}>{ui}</NextIntlClientProvider>);
}

describe("EvidenceBlock (smoke)", () => {
  it("renders a path:start-end header and the snippet", () => {
    renderWithIntl(
      <EvidenceBlock path="src/api/users.ts" startLine={23} endLine={31} snippet="export class NotFoundError" />,
    );
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText("export class NotFoundError")).toBeInTheDocument();
  });

  it("renders just path:line when start and end are the same", () => {
    renderWithIntl(<EvidenceBlock path="a.ts" startLine={5} endLine={5} snippet="x" />);
    expect(screen.getByText("a.ts:5")).toBeInTheDocument();
  });

  it("copies the snippet to the clipboard and flips the icon back after 1200ms", () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderWithIntl(<EvidenceBlock path="a.ts" startLine={1} endLine={1} snippet="export const x = 1;" />);
    const button = screen.getByRole("button", { name: "Copy evidence" });
    act(() => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith("export const x = 1;");
    act(() => {
      vi.advanceTimersByTime(1201);
    });
    vi.useRealTimers();
  });
});
