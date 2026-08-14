import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionsView as ConventionsViewData, Repo } from "@devdigest/shared";
import conventionsMessages from "../../../../../messages/en/conventions.json";

const REPO: Repo = {
  id: "repo1",
  workspace_id: "w1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
};

let activeRepo: Repo | null = REPO;
let reposLoaded = true;
vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo, reposLoaded, repoId: activeRepo?.id ?? null, repos: activeRepo ? [activeRepo] : [], setRepoId: vi.fn() }),
}));

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let conventionsData: ConventionsViewData = { run: null, candidates: [] };
const extractMutate = vi.fn();
const updateMutate = vi.fn();
const decisionsMutate = vi.fn();

vi.mock("../../../../lib/hooks/conventions", () => ({
  useConventions: () => ({ data: conventionsData, isLoading: false, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
  useConventionDecisions: () => ({ mutate: decisionsMutate, isPending: false }),
  useConventionSkillDraft: () => ({ data: undefined, isLoading: false }),
  useCreateConventionSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  activeRepo = REPO;
  reposLoaded = true;
  conventionsData = { run: null, candidates: [] };
  extractMutate.mockClear();
  updateMutate.mockClear();
  decisionsMutate.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: conventionsMessages }}>
      <ConventionsView />
    </NextIntlClientProvider>,
  );
}

describe("ConventionsView (smoke)", () => {
  it("no-repo: renders the dedicated empty state when there is no active repo", () => {
    activeRepo = null;
    renderWithIntl();
    expect(screen.getByText("No repo selected")).toBeInTheDocument();
  });

  it("never-scanned: run is null → the empty state with a Run extraction CTA", () => {
    conventionsData = { run: null, candidates: [] };
    renderWithIntl();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    expect(screen.getByText("Not scanned yet")).toBeInTheDocument();
  });

  it("scanning: run.status is running → shows the scanning subtitle, no candidate grid", () => {
    conventionsData = {
      run: {
        id: "run1", repo_id: "repo1", status: "running", sample_count: 0, candidate_count: 0, dropped_count: 0,
        provider: null, model: null, tokens_in: null, tokens_out: null, cost_usd: null, skill_id: null, error: null,
        created_at: "2026-08-05T00:00:00Z", finished_at: null,
      },
      candidates: [],
    };
    renderWithIntl();
    expect(screen.getByText("Scanning…")).toBeInTheDocument();
  });

  it("failed: run.status is failed → shows the run's error inline", () => {
    conventionsData = {
      run: {
        id: "run1", repo_id: "repo1", status: "failed", sample_count: 0, candidate_count: 0, dropped_count: 0,
        provider: null, model: null, tokens_in: null, tokens_out: null, cost_usd: null, skill_id: null,
        error: "model exploded",
        created_at: "2026-08-05T00:00:00Z", finished_at: "2026-08-05T00:01:00Z",
      },
      candidates: [],
    };
    renderWithIntl();
    expect(screen.getByText("model exploded")).toBeInTheDocument();
  });

  it("list: renders every candidate; the accepted counter is derived from data, not local state", () => {
    conventionsData = {
      run: {
        id: "run1", repo_id: "repo1", status: "done", sample_count: 17, candidate_count: 2, dropped_count: 1,
        provider: "openrouter", model: "deepseek/deepseek-v4-flash", tokens_in: 100, tokens_out: 20, cost_usd: 0.001,
        skill_id: null, error: null,
        created_at: "2026-08-05T00:00:00Z", finished_at: "2026-08-05T00:01:00Z",
      },
      candidates: [
        {
          id: "c1", run_id: "run1", category: "error_handling",
          rule: "Domain errors extend AppError with a stable code.",
          evidence_path: "src/api/users.ts", evidence_snippet: "export class NotFoundError extends AppError",
          evidence_start_line: 23, evidence_end_line: 31, confidence: 0.9, accepted: true,
          created_at: "2026-08-05T00:00:00Z",
        },
        {
          id: "c2", run_id: "run1", category: "naming",
          rule: "Use camelCase for exported functions.",
          evidence_path: "src/utils.ts", evidence_snippet: "export function fooBar()",
          evidence_start_line: 4, evidence_end_line: 6, confidence: 0.7, accepted: false,
          created_at: "2026-08-05T00:00:00Z",
        },
      ],
    };
    renderWithIntl();
    expect(screen.getByText("Domain errors extend AppError with a stable code.")).toBeInTheDocument();
    expect(screen.getByText("Use camelCase for exported functions.")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
  });

  it("Create skill is disabled when 0 candidates are accepted", () => {
    conventionsData = {
      run: {
        id: "run1", repo_id: "repo1", status: "done", sample_count: 5, candidate_count: 1, dropped_count: 0,
        provider: null, model: null, tokens_in: null, tokens_out: null, cost_usd: null, skill_id: null, error: null,
        created_at: "2026-08-05T00:00:00Z", finished_at: "2026-08-05T00:01:00Z",
      },
      candidates: [
        {
          id: "c1", run_id: "run1", category: "other", rule: "Some rule that is long enough.",
          evidence_path: "a.ts", evidence_snippet: "x", evidence_start_line: 1, evidence_end_line: 1,
          confidence: 0.5, accepted: false, created_at: "2026-08-05T00:00:00Z",
        },
      ],
    };
    renderWithIntl();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeDisabled();
  });
});
