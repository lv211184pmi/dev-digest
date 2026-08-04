---
name: pr-self-review
description: "Reviews all not-yet-merged local changes (uncommitted, staged, and commits ahead of main) before a PR is opened, by matching the diff's files against this repo's own skills catalog and running only the skills relevant to the touched code (UI skills on client/ files, backend/architecture skills on server/ files, etc). Blocks proceeding to PR creation if any finding is CRITICAL. Use when the user says 'review before PR', 'self review', 'can I open a PR', or as step 0 of the pull-request workflow before pushing. Does NOT replace /code-review or /security-review (those are general-purpose, model-agnostic reviewers) — this skill's value is scoping the repo's own curated skills to the exact diff and gating on the result."
metadata:
  tags: pr, review, gate, ci, quality-gate, meta-skill
---

# PR Self Review

Gate that runs before a PR is opened. It does not carry its own review knowledge —
it dispatches the diff to whichever of this repo's *other* skills actually apply,
collects their findings, and blocks if anything CRITICAL turns up.

## Scope guardrail

| Question | Use |
|---|---|
| "Are my local changes safe to open a PR with?" | **pr-self-review** (this skill) |
| "Review this GitHub PR # for me" | `review` |
| "General code review of my diff, no repo-specific matching" | `/code-review` |
| "Security-specific pass over pending changes" | `security-review` |
| "Is this one file well-architected / does it follow React rules?" | the specific skill directly (`onion-architecture`, `react-best-practices`, ...) |

This skill is a **meta-skill**: its job is routing + gating, not domain knowledge.

## When this runs

- **Manual**: user invokes `/pr-self-review`.
- **Automatic**: as step 0 of the "Creating pull requests" workflow, before `git push` /
  `gh pr create`. If this hasn't run yet on the current diff, run it first and honor the
  gate before continuing that workflow.

**Limitation to be upfront about**: this only blocks *this assistant's* workflow in *this
session*. It is not a GitHub branch-protection check — a user could still open the PR
another way. Making the block real at the GitHub level requires a CI job that runs the
same logic as a required status check; that is out of scope for this skill (see
"Future work" below) unless the user asks for it.

## Step 1 — Collect the diff

Gather everything not yet merged into the base branch, not just the last commit:

```bash
git merge-base HEAD main   # base for comparison
git diff --name-only <merge-base>...HEAD          # commits ahead of main
git diff --name-only                               # unstaged
git diff --cached --name-only                      # staged
git status --porcelain --untracked-files=all       # includes brand-new, not-yet-added files
```

**Do not skip the last command.** `git diff` only ever shows tracked-file changes — a
new file that hasn't been `git add`ed yet is invisible to every other command here, and
new files are often exactly what most needs review. Parse `??` lines from the porcelain
output and add them to the union.

Union all four file lists. Exclude anything matching the repo's "Do not touch" globs
from `CLAUDE.md`: `server/clones/**`, `**/src/vendor/**` (unless the change is a deliberate
`@devdigest/shared` contract update), `**/node_modules/**`, lockfiles.

If the union is empty, report "nothing to review" and stop — do not fabricate findings.

## Step 2 — Classify changed files

| Path prefix | Package | Scope |
|---|---|---|
| `client/src/app/**`, `client/src/components/**` | client | Frontend |
| `client/src/lib/**`, `client/src/i18n/**` | client | Frontend |
| `client/src/test/**` | client | Frontend (testing) |
| `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `server/src/db/**` (incl. `db/migrations/**`), `server/src/prompts/**`, `server/src/app.ts`, `server/src/server.ts` | server | Backend |
| `server/test/**` | server | Backend (testing — includes `*.it.test.ts` DB-backed tests) |
| `server/src/vendor/shared/**`, `client/src/vendor/shared/**` | contracts | Full-stack (contract change — the two paths are the same `@devdigest/shared` mirrored on both sides; if one changed without the other, that's **CRITICAL** — a one-sided contract edit breaks the type contract between packages per `CLAUDE.md`'s "contracts change in `@devdigest/shared` first, then in consumers." Run **both** Backend and Frontend skill sets.) |
| `.claude/skills/**`, `.claude/commands/**` | tooling | Meta/process — no domain skill in the catalog reviews skill-authoring itself; Step 3 will find no candidates. Note it as "not covered by any skill" per Edge cases, don't silently skip it as if it were prose docs. |
| `client/src/vendor/ui/**` | client | Vendored — skip. Exception: a deliberate vendor-primitive update (rare); treat like the shared-contract row above if so. |
| `reviewer-core/src/**` | reviewer-core | Full-stack (pure engine, consumed as source by server) |
| `e2e/**` | e2e | Testing (no LLM involved per `e2e/README.md`) |
| any `*.ts`/`*.tsx` not covered above | — | Full-stack fallback |
| `*.md`, `docs/**`, `specs/**`, `INSIGHTS.md`, `client/messages/**` (i18n strings) | — | Docs/content — no review skill needed, skip |

## Step 3 — Match project skills to the diff

Read `.claude/skills/README.md`'s catalog table for the current list and each matched
skill's own frontmatter `description` (and, where present, its own "Scope guardrail"
table, e.g. `onion-architecture/SKILL.md`) before running it — the catalog's `Scope`
column is a first filter, not the final word. A file only triggers a skill if the
skill's own guardrail agrees the question is in scope for it.

| Diff scope | Candidate skills |
|---|---|
| Frontend | `react-best-practices`, `next-best-practices`, `ui-architecture`, `react-testing-library` (if `*.test.*`/`*.spec.*`) |
| Backend | `fastify-best-practices` (routes/plugins), `onion-architecture` (layering/imports), `drizzle-orm-patterns` + `postgresql-table-design` (schema/queries/migrations) |
| Full-stack (any touched `.ts`/`.tsx`) | `zod` (if schemas touched), `typescript-expert` (if generics/perf/tooling), `security` (always, if the diff touches auth, input handling, file upload, secrets, or DB queries) |
| Contract change (`vendor/shared`) | run **both** the Backend and Frontend sets above, since a contract change ripples both ways |

Do not run a skill against files outside its scope (e.g. don't run `react-best-practices`
against `server/src/modules/**`). Do not run `mermaid-diagram` or `engineering-insights` —
they are not review skills.

## Step 4 — Deterministic pre-gate: typecheck & tests

Before spending any LLM judgment, run the cheap objective checks for every package
touched by the diff (per Step 2's classification). A red typecheck or a failing test is
not a judgment call — it's as blocking as a CRITICAL finding, and far cheaper to detect.

| Touched package | Command |
|---|---|
| `client/` | `cd client && pnpm typecheck && pnpm test` |
| `server/` | `cd server && pnpm typecheck && pnpm test` (hermetic `*.test.ts` only; add `*.it.test.ts` only if the diff touches DB-backed code, since those need testcontainers Postgres) |
| `reviewer-core/` | `cd reviewer-core && npm run typecheck && npm test` |
| `e2e/` | run `cd e2e && npm run e2e:hermetic` only if the diff itself touches `e2e/**` |

Only run commands for packages actually present in Step 2's classification — never
typecheck the whole repo for a diff confined to one package, and never run anything for
a docs-only or meta-only diff (Step 2's "skip" rows). Any non-zero exit is an automatic
`[CRITICAL] <package> — typecheck/test failed` finding, using the failing command's own
output as the summary. This can be reported and gated on immediately — no need to wait
for Step 5's LLM passes to finish first, though they can run in parallel with this step.

## Step 5 — Run scoped review passes

For each matched skill, dispatch one `Agent` call (run these in parallel, not
sequentially) with:
- the skill's own SKILL.md content as its instructions,
- only the diff hunks + full contents of the files in that skill's matched scope,
- an explicit instruction to report findings via `ReportFindings`, using the severity
  rubric below (not whatever labels the source skill happens to use internally).

Keep each pass scoped to its own files — do not let a backend-scoped pass see frontend
diff or vice versa; this keeps context small and avoids a skill commenting outside its
expertise.

## Step 6 — Unified severity rubric

Individual skills use their own severity words inconsistently (e.g.
`react-best-practices` already labels CRITICAL/HIGH/MEDIUM; `onion-architecture` does
not label at all). Normalize every finding into exactly one of:

- **CRITICAL** — will break in production, causes data loss/corruption, introduces a
  security vulnerability, or is a hard architectural-boundary violation (e.g. UI
  importing a repository directly, a route bypassing validation). **Blocks the PR.**
- **HIGH** — will cause real bugs or maintenance pain soon, but isn't an active
  incident risk right now.
- **MEDIUM** — hurts readability/consistency; worth a follow-up, not urgent.

When a source skill already assigns CRITICAL/HIGH/MEDIUM, keep it. When it doesn't,
the dispatched sub-review must classify using the definitions above, not invent new
tiers.

## Step 7 — Aggregate and gate

1. Merge all findings from Step 4 (deterministic) and Step 5 (LLM passes) into one list.
2. Deduplicate: same `file` + overlapping `line` + same underlying issue → keep one,
   note which skill(s) flagged it.
3. Sort CRITICAL first.
4. **If any CRITICAL finding exists**: report the full list, state plainly that the PR
   is blocked, and do not proceed to `git push` / `gh pr create` in this session.
5. **Override**: only accept an override that names the specific CRITICAL finding(s)
   being bypassed and says to proceed anyway (e.g. "override, proceed despite the
   onion-architecture finding on `server/src/modules/x.ts:42`"). Restate which
   finding(s) are being knowingly bypassed in the message where you proceed, so the
   override is visible in the transcript, not silently absorbed. A bare "continue" or
   "yes" that doesn't name a finding is not an override — ask which one they mean before
   proceeding.
6. **Re-run discipline**: once any file changes to address a finding, re-run the whole
   gate from Step 1 against the new diff. Don't selectively re-check only the
   previously flagged file or trust that a fix couldn't have introduced something new
   elsewhere — the diff itself changed.
7. **Otherwise** (no CRITICAL): report HIGH/MEDIUM findings as a plain list
   (informational) and continue the workflow.

## Output format

A flat list, most severe first: `[SEVERITY] file:line — summary (flagged by: skill-name)`.
End with one line: either `BLOCKED — N critical finding(s)` or `OK — proceeding`.
Nothing gets written to disk or committed; this is a chat-only report.

## Edge cases

- Diff touches only docs/specs/markdown → skip Step 3–5 entirely (no skills to match,
  nothing to typecheck), report "docs-only, no scoped skills apply".
- Diff spans multiple packages → run every applicable skill per Step 3, not just the
  first match.
- A file matches no skill's scope (e.g. `docker-compose.yml`, `scripts/*.sh`) → note it
  as "not covered by any skill" rather than silently dropping it; this is a gap to be
  aware of, not a finding.

## Future work (not implemented here)

A GitHub Actions job that runs the same Step 1–7 logic as a required status check would
make the block real at the branch-protection level, independent of whether the change
went through Claude Code at all. Build this only if asked — it's a separate piece of
infrastructure (CI config, not a skill).
