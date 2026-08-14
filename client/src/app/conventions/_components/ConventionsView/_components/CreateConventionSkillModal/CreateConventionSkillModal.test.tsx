import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionSkillDraft } from "@devdigest/shared";
import conventionsMessages from "../../../../../../../messages/en/conventions.json";
import commonMessages from "../../../../../../../messages/en/common.json";

const DRAFT: ConventionSkillDraft = {
  name: "payments-api-conventions",
  description: "Extracted conventions for acme/payments-api.",
  type: "convention",
  enabled: true,
  body: "# payments-api-conventions\n\nExtracted conventions for acme/payments-api.",
  evidence_files: ["src/api/users.ts"],
  source_count: 1,
  repo_name: "acme/payments-api",
};

const createMutateAsync = vi.fn().mockResolvedValue({ id: "s1" });
const toastSuccess = vi.fn();

vi.mock("../../../../../../lib/hooks/conventions", () => ({
  useConventionSkillDraft: () => ({ data: DRAFT, isLoading: false }),
  useCreateConventionSkill: () => ({ mutateAsync: createMutateAsync, isPending: false }),
}));

vi.mock("../../../../../../lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { CreateConventionSkillModal } from "./CreateConventionSkillModal";

afterEach(() => {
  cleanup();
  createMutateAsync.mockClear();
  toastSuccess.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: conventionsMessages, common: commonMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("CreateConventionSkillModal (smoke)", () => {
  it("seeds its fields from the draft, including Enabled defaulting ON", () => {
    renderWithIntl(<CreateConventionSkillModal runId="r1" repoId="repo1" onClose={vi.fn()} />);
    expect(screen.getByDisplayValue("payments-api-conventions")).toBeInTheDocument();
    expect(screen.getByDisplayValue(DRAFT.description)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("Cancel closes the modal without issuing a POST", () => {
    const onClose = vi.fn();
    renderWithIntl(<CreateConventionSkillModal runId="r1" repoId="repo1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("Create POSTs the edited body, not the original draft", async () => {
    const onClose = vi.fn();
    const { container } = renderWithIntl(<CreateConventionSkillModal runId="r1" repoId="repo1" onClose={onClose} />);

    const bodyField = container.querySelector("textarea")!;
    expect(bodyField.value).toBe(DRAFT.body);
    fireEvent.change(bodyField, { target: { value: "# edited body" } });

    await fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ body: "# edited body", name: DRAFT.name, enabled: true, type: "convention" }),
    );
  });
});
