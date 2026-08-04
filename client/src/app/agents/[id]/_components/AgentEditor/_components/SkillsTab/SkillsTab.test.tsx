import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import commonMessages from "../../../../../../../../messages/en/common.json";

const SKILLS: Skill[] = [
  { id: "s1", name: "pr-quality-rubric", description: "d1", type: "rubric", source: "manual", body: "b", enabled: true, version: 1 },
  { id: "s2", name: "no-then-chains", description: "d2", type: "convention", source: "manual", body: "b", enabled: true, version: 1 },
  { id: "s3", name: "secret-leakage-gate", description: "d3", type: "security", source: "manual", body: "b", enabled: true, version: 1 },
];

const setSkills = vi.fn();

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkills: () => ({
    data: [
      { agent_id: "ag1", skill_id: "s2", order: 0 },
      { agent_id: "ag1", skill_id: "s1", order: 1 },
    ],
  }),
  useSetAgentSkills: () => ({ mutate: setSkills }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, common: commonMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("Agent Editor SkillsTab (smoke)", () => {
  it("lists linked skills first (in order), then unlinked skills, with the enabled count", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
    const names = screen.getAllByText(/pr-quality-rubric|no-then-chains|secret-leakage-gate/).map((n) => n.textContent);
    // linked (order 0,1) first: no-then-chains, pr-quality-rubric — then unlinked: secret-leakage-gate
    expect(names).toEqual(["no-then-chains", "pr-quality-rubric", "secret-leakage-gate"]);
  });

  it("checking an unlinked skill appends it to the linked set", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const checkboxes = screen.getAllByRole("checkbox");
    // third row (secret-leakage-gate) is unlinked
    checkboxes[2]!.click();
    expect(setSkills).toHaveBeenCalledWith(["s2", "s1", "s3"]);
  });

  it("unchecking a linked skill removes it", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const checkboxes = screen.getAllByRole("checkbox");
    checkboxes[0]!.click(); // no-then-chains (first linked row)
    expect(setSkills).toHaveBeenCalledWith(["s1"]);
  });

  it("filters the list by name", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const input = screen.getByPlaceholderText("Filter skills…");
    fireEvent.change(input, { target: { value: "secret" } });
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
    expect(screen.queryByText("pr-quality-rubric")).not.toBeInTheDocument();
    expect(screen.queryByText("no-then-chains")).not.toBeInTheDocument();
  });
});
