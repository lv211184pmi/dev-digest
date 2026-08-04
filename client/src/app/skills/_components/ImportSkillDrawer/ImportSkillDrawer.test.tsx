import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import skillsMessages from "../../../../../messages/en/skills.json";

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportArchivePreview: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCommunitySkills: () => ({
    data: [{ name: "owasp-top-10-review", repo: "secdev/agent-skills", stars: 1240, lang: "any", desc: "Maps diff changes to the OWASP Top 10." }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useImportCommunitySkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>{ui}</NextIntlClientProvider>);
}

describe("ImportSkillDrawer (smoke)", () => {
  it("opens on the File tab by default, with the import form fields", () => {
    renderWithIntl(<ImportSkillDrawer initialTab="file" onClose={() => {}} onImported={() => {}} />);
    expect(screen.getByText("Add a skill")).toBeInTheDocument();
    expect(screen.getByText("Skill name")).toBeInTheDocument();
    expect(screen.getByText("Skill body (Markdown)")).toBeInTheDocument();
    expect(screen.getByText("Import skill")).toBeInTheDocument();
  });

  it("opens on the Community tab and lists the static fixture results", () => {
    renderWithIntl(<ImportSkillDrawer initialTab="community" onClose={() => {}} onImported={() => {}} />);
    expect(screen.getByText("owasp-top-10-review")).toBeInTheDocument();
    expect(screen.getByText("Maps diff changes to the OWASP Top 10.")).toBeInTheDocument();
  });

  it("switching tabs swaps the visible content", () => {
    renderWithIntl(<ImportSkillDrawer initialTab="file" onClose={() => {}} onImported={() => {}} />);
    fireEvent.click(screen.getByText("Community"));
    expect(screen.getByText("owasp-top-10-review")).toBeInTheDocument();
    expect(screen.queryByText("Skill body (Markdown)")).not.toBeInTheDocument();
  });
});
