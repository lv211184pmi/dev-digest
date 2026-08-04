import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../../../messages/en/skills.json";

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric\n\nBody text.",
  enabled: true,
  version: 5,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
let activeSkill = SKILL;
vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkill: () => ({ data: activeSkill, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillAgents: () => ({ data: [] }),
  useSkillVersions: () => ({ data: [] }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { SkillDetailPane } from "./SkillDetailPane";

afterEach(() => {
  cleanup();
  activeSkill = SKILL;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>{ui}</NextIntlClientProvider>);
}

describe("SkillDetailPane (smoke)", () => {
  it("renders the header (name, type, version) and the Config tab by default", () => {
    renderWithIntl(<SkillDetailPane skillId="s1" tab="config" onTab={() => {}} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getAllByText("rubric").length).toBeGreaterThan(0);
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.queryByText("disabled")).not.toBeInTheDocument();
  });

  it("shows a disabled badge when the skill is disabled", () => {
    activeSkill = { ...SKILL, enabled: false };
    renderWithIntl(<SkillDetailPane skillId="s1" tab="config" onTab={() => {}} />);
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });

  it("renders the Preview tab as rendered markdown", () => {
    renderWithIntl(<SkillDetailPane skillId="s1" tab="preview" onTab={() => {}} />);
    expect(screen.getByRole("heading", { name: "PR Quality Rubric" })).toBeInTheDocument();
  });

  it("renders the Stats tab with only real, non-fabricated data", () => {
    renderWithIntl(<SkillDetailPane skillId="s1" tab="stats" onTab={() => {}} />);
    expect(screen.getByText("Used by")).toBeInTheDocument();
    expect(screen.getByText("Not linked to any agent yet.")).toBeInTheDocument();
  });

  it("renders the Evals tab as a placeholder", () => {
    renderWithIntl(<SkillDetailPane skillId="s1" tab="evals" onTab={() => {}} />);
    expect(
      screen.getByText("Skill-level eval runs land in a later lesson. For now, attach this skill to an agent and run it on a real PR to see its effect."),
    ).toBeInTheDocument();
  });
});
