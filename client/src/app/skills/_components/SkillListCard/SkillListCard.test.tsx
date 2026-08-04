import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkillAgents: () => ({ data: [{ id: "a1", name: "Security Reviewer" }, { id: "a2", name: "General Reviewer" }] }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SkillListCard } from "./SkillListCard";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "pr-quality-rubric",
  description: "Rubric for evaluating overall PR quality.",
  type: "rubric",
  source: "manual",
  body: "# PR Quality Rubric",
  enabled: true,
  version: 3,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ skills: messages }}>{ui}</NextIntlClientProvider>);
}

describe("SkillListCard (smoke)", () => {
  it("renders name, description, type badge, source, and agent count", () => {
    renderWithIntl(<SkillListCard skill={SKILL} />);
    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("Rubric for evaluating overall PR quality.")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<SkillListCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("calls onToggle without triggering onClick when the toggle is used", () => {
    const onClick = vi.fn();
    const onToggle = vi.fn();
    renderWithIntl(<SkillListCard skill={SKILL} onClick={onClick} onToggle={onToggle} />);
    screen.getByRole("switch").click();
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls delete without triggering onClick when the trash icon is used", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClick = vi.fn();
    renderWithIntl(<SkillListCard skill={SKILL} onClick={onClick} />);
    screen.getByRole("button", { name: "Delete skill" }).click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
