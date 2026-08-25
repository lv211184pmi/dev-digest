# Insights — cross-package

Decisions that span more than one package, and things we tried that did not
work. Module-local lessons go in `<module>/INSIGHTS.md` instead.

Read at the start of a task, written at the end of one, by the
`engineering-insights` skill. Sections are fixed — add to the one that fits,
newest first. Every entry must be actionable cold: claim first, `path:line` or a
runnable command last. If it would be obvious to anyone reading the code, leave
it out.

Roughly 5 entries per section. When an entry becomes stable reference material,
move it into `docs/` and delete it here.

---

## Decisions

### 2026-08-22 — Automate only the half of the chain whose rubric is already fixed

**What:** `.claude/commands/implement.md` (`/implement`) drives `implementer` →
`plan-verifier` → `architecture-reviewer` → `pr-self-review` → `document-writer`
from an **approved plan file** and nothing earlier. `spec-creator` and
`implementation-planner` are invoked by hand, one at a time, and no command
advances a spec's `Status` either. Two roster changes went with it:
`test-writer` left the default chain (still invocable by hand), and
`architecture-reviewer` moved `opus` → `sonnet`.
**Why:** the two halves fail differently. Every step before the approved plan
ends in a decision only the caller can make — `spec-creator` returns blocking
clarifications and a design-gap list, `implementation-planner` returns a
requirement verdict plus the execution-mode question it asks every time — so
chaining past them converts a review point into a formality and you approve a
spec and a plan you never read. After the plan, the rubric *is* the plan: the
steps are mechanical enough to sequence, and the two gates catch a bad run. The
same "is the rubric supplied?" test is what makes `plan-verifier` and now
`architecture-reviewer` Sonnet agents — their rules come from the plan, from
`onion-architecture`/`ui-architecture`/`reviewer-core-engine`, and from
`pr-self-review` Step 6's severity rubric, none of which the model has to infer.
**Rejected:** one `/sdd` command spanning spec → commit (written, then deleted
the same session — it made the approval gates look like progress bars); deleting
`test-writer.md` outright rather than un-chaining it (a standalone testing pass
over existing code still has no other owner).
**2026-08-22 addendum — two corollaries of the same boundary.** (1) *Arguments
go into the plan file, never into the agent's prompt.* `/implement` takes
`--spec`, `--design <screenshots>` and free-text notes and writes them to a
`## Run inputs` section on the plan, because `implementer.md` Step 0 refuses
prose intent — the plan is the only channel it trusts, so anything arriving by
another route is either ignored or silently outside the fence, and
`plan-verifier` (which audits the plan) would never see it. The section is
supporting material by construction: a design asset showing a screen no step
lists is a Deviation, and free text that would change a step's Files, add a
`Done when` or contradict a plan line is a *requirement* the command refuses and
routes back to `implementation-planner`. That test is the only thing between a
build command and unreviewed scope creep. (2) *Review findings iterate through
the plan too.* All three reviewers are read-only — `architecture-reviewer` has no
`Write`/`Edit` at the tool level — so a finding becomes an `A`-prefixed
`## Remediation` id (`A` so it never collides with the plan's `R` ids) and the
implementer runs scoped to it; a boundary fix needing an unlisted path extends
that step's Files list **visibly**, in the same edit. Reviewer *questions*
("Could not determine") take the other route: answered "deliberate", they are
recorded in the module's `INSIGHTS.md`, which `architecture-reviewer` Step 2
reads before flagging — so the answer retires the question permanently instead of
it being re-raised every feature. Both loops are capped at two cycles per
reviewer: a finding surviving two scoped fixes is a planning error, not a coding
one.

**Cost / what to watch:** with `test-writer` out, **nothing automatic notices a
missing test** — `implementation-planner` Step 4 now *requires* every plan to name
its test files with the lane already chosen and bind the testing skill on that
step, and that obligation is the only thing holding the line. Watch for plans that
quietly omit one. On the Sonnet reviewer, watch for false CRITICALs or a "Rule"
line that paraphrases a skill instead of citing a section — either means put it
back on `opus`, which is a one-line change.

### 2026-08-22 — The plan audit belongs to the cheap fresh-context agent, and it is a gate with a way back

**What:** `implementer.md` Step 5 lost its requirement-traceability table and its
acceptance-criteria verdicts, keeping only what that run alone can know — scope
proof from `git status --porcelain --untracked-files=all`, a per-step `Done when`
table, the constraint sweep and verification colour. The full audit is
`plan-verifier.md`'s alone, and it now runs **immediately after** the implementer,
ahead of `architecture-reviewer`. Because it has no `Write`
tool, a gap is returned as a *remediation directive*: un-archive the plan, set
`Status: approved`, append a `## Remediation` section naming the failed ids.
`implementer.md` Step 0 accepts such a plan and scopes the run to those ids only;
`/implement remediate` applies the move.
**Why:** the two audits were the same audit. The implementer ran it on
`model: inherit` inside the largest context in the chain, and `plan-verifier` is
forbidden from reusing its rows — so the expensive copy was discarded by design.
Ordering it first is the other half: it is Sonnet and read-only, so gating on it
costs least, and it needs a tree containing only what the plan listed, so
nothing that writes may run ahead of it. Before the directive existed the chain simply
stopped: a green run archives the plan as `implemented`, and the implementer
accepts only `approved`/`in-progress` from `.claude/plans/`, so a `not met`
verdict had no route back into code.
**Rejected:** giving `plan-verifier` `Write` or `mv` so it could re-open the plan
itself — a verifier that edits its own rubric is not one, and that fence is the
same reason it omits `Skill`. The directive is text; the caller or `/implement` applies
it.
**Cost:** "run the steps after `implementer` in any order" is now false, and the
order lives in three places — `.claude/agents/README.md`, `.claude/commands/implement.md`
and each agent's Handoff line. A `## Remediation` section is also a second scoping
mechanism beside the Steps' Files list; if the two disagree the implementer reports
a Deviation rather than picking.

### 2026-08-20 — `spec-creator`'s write fence is one glob, and routing bends to keep it that way

**What:** `.claude/agents/spec-creator.md` may write to exactly `**/specs/**` and
nothing else. To hold that line, specs for `e2e/` and `mcp/` route to the **root**
`specs/` rather than to a module directory: `e2e/specs/` is reserved for runnable
`.flow.json` and `mcp/` has no `specs/` at all, so the alternatives were writing
prose into `e2e/docs/` or creating `mcp/specs/`. The glob also covers the
`specs/README.md` the agent must link a new spec into, so "link it" needs no
second exception.
**Why:** a fence stated as one glob is checkable by reading the path; a fence
stated as "specs, plus `e2e/docs/`, plus a directory it may create" is a policy
the agent has to interpret, and an agent that interprets its own boundary does
not have one. Root `specs/` was already the documented home for anything spanning
≥2 packages, and `specs/03-devdigest-mcp.md` had set the precedent for `mcp/`.
**Rejected:** a `PreToolUse` hook in `.claude/settings.json` enforcing the path —
mechanically stronger, but it lands repo-wide config on everyone to constrain one
agent, and the `tools` allowlist plus prompt rules already deny the routes that
matter (no `Bash` writes, no `NotebookEdit`).
**Cost:** two agents could have claimed `specs/`, so `document-writer.md`'s
destination-table row for specs now hands the job over and its remaining
`specs/` right is narrowed to flipping an existing spec's `Status:` to `shipped`.
If that row drifts back, both agents will write specs and neither will own them.

### 2026-08-09 — implementation-planner → implementer hand off through a file, never through the conversation

**What:** `.claude/agents/implementation-planner.md` writes a plan to `.claude/plans/` (gitignored)
and `.claude/agents/implementer.md` reads it back; the plan's "Steps → Files" list
is the implementer's scope boundary and its "Skills contract" table is the binding
list of skills it may load. The implementer archives the plan to
`.claude/plans/archive/` with `Status: implemented` on a fully green run (kept in
place as `Status: blocked` otherwise), so a later `plan-verifier` run can still
read the requirement list.
**Why:** a non-fork subagent starts with the full `CLAUDE.md` hierarchy and a git
status snapshot but **no conversation history** — anything agreed while planning is
invisible to the next agent, so a conversational handoff loses exactly the
constraints that made the plan correct.
**Rejected:** returning the plan as report text for the caller to relay (lossy, and
truncates on long plans); committing plans to git (churn in every PR diff, and
`pr-self-review` then has to classify them).
**Cost:** the plan file is now a third place a design can be stale. Keep it out of
the working set — that is what the archive-on-success rule is for, and
`.claude/plans/` is gitignored as a directory, so `archive/` stays out of git with
no extra rule. Note that the popular
claim "planner/implementer role-splitting is an official Anthropic anti-pattern"
has **no primary source**; it is absent from
`https://code.claude.com/docs/en/best-practices`, which documents plan-then-
implement plus a fresh-context reviewer. Don't dismantle this pair citing it.

### 2026-08-04 — Skills reach the prompt un-delimited; the `enabled` toggle is the trust gate, not `wrapUntrusted()`

**What:** `reviewer-core/src/prompt.ts` wraps every other external input
(diff, PR description, repo map, callers, specs) in `wrapUntrusted()` +
`INJECTION_GUARD`, but `parts.skills` is joined straight into the `## Skills /
rules` section with no delimiter. This is intentional, not an oversight: a
skill only ever reaches the prompt if `run-executor.ts` finds it both linked
*and* `enabled`, and `source: 'imported_url' | 'extracted' | 'community'`
skills are always created with `enabled: false`
(`server/src/modules/skills/service.ts` `importCommunity`,
`ImportSkillDrawer.tsx` `importFile`) — a human has to read the body and flip
the toggle before it can ever be sent. A `source: 'manual'` skill is trusted
like the agent's own system prompt, which also isn't delimited.
**Why:** the enable toggle already forces a human vetting step for every
non-manual source; delimiter-wrapping on top would be defense-in-depth for a
threat (an admin enabling a skill body they never read) the UI's own copy
("must be vetted before it is enabled") already tells the user not to do.
**Rejected:** none — this was not revisited, only verified. Flag it if a
future change ever lets `enabled` default to `true` for an imported source, or
lets `POST /skills` set `enabled: true` with a non-manual `source` without a
review step — at that point the un-delimited prompt path becomes a real
injection vector and `wrapUntrusted()` should be applied to `skillsBlock` in
`reviewer-core/src/prompt.ts:88`.
**2026-08-05 update:** this trip-wire fired — see the Conventions Extractor
entry immediately below, which deliberately defaults `enabled: true` for
`source: 'extracted'`. The three properties that make it defensible there are
exactly the ones this entry named as the bar to clear.

### 2026-08-05 — Conventions Extractor defaults the created skill's `enabled` to `true`

**What:** `CreateConventionSkillModal` (`client/src/app/conventions/_components/ConventionsView/_components/CreateConventionSkillModal/`)
defaults the new skill's Enabled toggle to ON, and the server never forces it
off — `source: 'extracted'`, `type: 'convention'`. This is a deliberate
exception to the rule above ("non-manual sources default `enabled: false`").
**Why:** three properties hold simultaneously, all required: (1) the skill
body — rendered server-side by `server/src/modules/conventions/domain-services/merge.ts`'s
`renderConventionsSkillBody()` — contains only model-written rule sentences
and `path:line` citations, never raw repo code (deliberately: code snippets
were named as "decisively the injection surface" in the module's design);
(2) every rule is passed through `sanitizeRule()` (newlines collapsed,
leading `#`/backtick fences stripped, capped at 300 chars) before merge;
(3) the create-skill modal **is** the vetting step — every field is
seeded from a server-rendered draft (`GET .../skill-draft`) into local
component state the user can edit, and there is no code path from an
extraction run to a saved skill that didn't pass through this modal, unlike
`importCommunity()` / archive import which persist immediately with
`enabled: false` and no forced review screen.
**Rejected:** keeping the inherited `enabled: false` default — considered and
rejected because it would make "Create skill" silently produce a skill that
does nothing until a second, easy-to-forget trip to Skills Lab, for content
that was already the single most vetted of any non-manual source.
**Cost / what to watch:** `wrapUntrusted(skillsBlock)` in
`reviewer-core/src/prompt.ts:88` is still outstanding hardening, not applied.
If a future change lets raw evidence snippets into the skill body, or lets
`POST /conventions/runs/:id/skill` be called without the modal (e.g. a bulk
"create for all repos" action), revisit this default immediately.

### 2026-08-02 — AGENTS.md is the source of truth; CLAUDE.md is a symlink to it

**What:** every package's `CLAUDE.md` (root, `client/`, `e2e/`,
`reviewer-core/`, `server/`) was renamed to `AGENTS.md`, and `CLAUDE.md` was
recreated as a relative symlink (`CLAUDE.md -> AGENTS.md`) at the same path.
Edit `AGENTS.md`; never edit `CLAUDE.md` directly, it has no independent
content.
**Why:** `AGENTS.md` is the emerging cross-tool convention (Codex, Cursor,
etc.), and the project wants any AGENTS.md-aware tool to pick it up while
Claude Code keeps working unmodified by resolving `CLAUDE.md` to the same
bytes.
**Rejected:** Claude Code's native `@AGENTS.md` import syntax inside a stub
`CLAUDE.md`. A symlink was preferred because it is transparent to every tool,
not just Claude Code, with zero drift risk between the two files.
**Cost:** on a Windows checkout without `core.symlinks` enabled, git may check
`CLAUDE.md` out as a plain text file containing the literal string
`AGENTS.md` instead of a working symlink. Not a concern today (macOS-only
contributors) but worth knowing if that changes.

### 2026-08-01 — Per-run severity counts are derived client-side, not a contract field

**What:** the PR list's `findings_by_severity` is a new `PrMeta` field computed
by the server, but the identical breakdown on the Agent runs timeline is derived
in the browser from the reviews `usePrReviews` already loaded, keyed by
`review.run_id`. `RunSummary` deliberately did **not** gain the field.
**Why:** the two surfaces have different data on hand. The list never fetches
findings, so it has to be told; the PR detail page already holds every finding
for its `FindingsPanel`, so a second source would be a second query for data
sitting in the cache. Deriving it also makes dismissal live — dismissing a
finding in the panel updates the chip above it in the same render, which a
denormalized column could not do without an invalidation round-trip.
**Rejected:** a `findings_by_severity` column on `agent_runs` alongside the
existing `findings_count`/`blockers` denorms. It would go stale on dismiss, and
those two columns are written once at run completion precisely because they
describe the run, not the user's later triage of it.
**Cost:** the rollup rule now exists twice — `rollupSeverities` +
`selectLatestReviewPerAgent` in `server/src/modules/pulls/status.ts`, and
`countedFindings` + `countBySeverity` in `client/src/lib/findings.ts`. Both file
headers point at each other; change one and you must change the other, or the
same PR reports different numbers on the list and the detail page.

### 2026-07-31 — Standalone packages instead of a workspace

**What:** four packages, each with its own `package.json` and lockfile; sharing
happens through tsconfig path aliases, not published modules. Each suite is
gated by its own CI workflow with a path filter.
**Why:** _rationale not recorded anywhere in the repo — fill this in._ Do not
"fix" this into a workspace before that gap is closed; it is load-bearing for the
per-package CI path filters.

### 2026-07-31 — Zod contracts as the single source of truth

**What:** `@devdigest/shared` schemas drive request validation, response
serialization, and client-side types.
**Why:** one definition, no drift between server and client.
**Rejected:** hand-rolled `Schema.parse(req.body)` inside handlers — it validated
input but left responses unchecked, so contract drift surfaced in the browser.

## What Works

_None yet._

## What Doesn't Work

_None yet._

## Codebase Patterns

- **2026-08-23** — `reviewer-core`'s project-context prompt slot is **fully built
  and completely dead**, and has been since it was written. `PromptParts.specs`
  assembles a `## Project context` section with `wrapUntrusted()` and a manifest
  record (`reviewer-core/src/prompt.ts:64,205-207,255-257`); `ReviewInput.specs`
  threads it through (`reviewer-core/src/review/run.ts:60,155`); the contracts
  carry `PromptAssembly.specs` and `RunTrace.specs_read`
  (`server/src/vendor/shared/contracts/trace.ts:43,94`); and the client already
  renders both (`…/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:58-63`,
  `…/RunTraceDrawer/constants.ts:19`) — while
  `server/src/modules/reviews/run-executor.ts:379,528` hard-codes
  `specs_read: []` and `specs: null`, so nothing ever populates any of it. This is
  the second instance of the "scaffolding built and never wired" pattern that
  `specs/02-intent-layer.md` already named. Before speccing or estimating a "new"
  prompt slot, grep `reviewer-core/src/prompt.ts` and
  `server/src/vendor/shared/contracts/trace.ts` for it first — the remaining work
  may be wiring one call site rather than building a feature, and the two
  estimates differ by an order of magnitude.

- **2026-08-20** — Renaming an agent is a seven-file edit, and nothing in the
  repo catches a miss: agent files link each other with **relative markdown
  links** (`[planner.md](planner.md)`), the two roster tables in
  `.claude/agents/README.md` and `.claude/skills/README.md` link the file by
  path, sibling agents name it in prose (`implementer.md` refuses to run and
  tells the caller to run it), and root `INSIGHTS.md` cites the filename in a
  Decisions entry. There is no link checker and no build step over `.claude/`,
  so a stale `[planner.md](planner.md)` just resolves to nothing at read time.
  After any agent rename run
  `grep -rn '\bold-name\b' --include='*.md' . | grep -v node_modules | grep -v
  server/clones` and expect zero hits other than deliberate historical quotes —
  `INSIGHTS.md:39` quotes the external "planner/implementer role-splitting"
  claim and must **not** be rewritten. The same holds for an agent's **step
  numbers**, which sibling agents cite as prose anchors: inserting
  `implementer.md`'s Step 5 (final self-check) renumbered plan-lifecycle 5→6 and
  broke three live references — `plan-verifier.md` twice and one row in
  `.claude/agents/README.md`'s rules table. Grep
  `grep -rn '<agent>.md.*Step [0-9]' --include='*.md' .claude` after any step
  insertion; `.claude/plans/archive/**` hits are historical records and stay.

- **2026-08-09** — With the roster at seven agents, `description` being the *sole*
  auto-delegation signal stopped being trivia and became the main failure mode:
  `test-writer` collides with `implementer` (which also writes tests), and
  `plan-verifier` / `architecture-reviewer` collide with the `pr-self-review` skill,
  `/code-review` and `/security-review`. Two conventions now carry that load and a
  new agent must satisfy both — a row in the `## Choosing between the review agents`
  table in `.claude/agents/README.md`, and an explicit "does **not** …" sentence
  closing the agent's own Responsibility paragraph naming the sibling that owns what
  it declines. An agent added without those is not mis-configured, it is
  mis-*routed*, which shows up as the wrong agent silently answering.

- **2026-08-09** — This repo's path→skill routing table and its per-package
  typecheck/test command table live in `.claude/skills/pr-self-review/SKILL.md`
  Steps 2, 3 and 4, and are the single source of truth for both.
  `implementation-planner.md` and
  `implementer.md` are written to `Read` those sections rather than carry their own
  copy — three copies of the `vendor/shared` mirror rule or the
  `pnpm` vs `npm` split would drift silently and only surface as an agent running
  the wrong command in the wrong package. Any new agent or skill that needs "which
  skills apply to this diff" points at those sections too.
  **2026-08-20 update — catalog membership is not reachability.** Because binding
  flows catalog → Step 3 → plan, a skill listed in `.claude/skills/README.md`
  that no Step 3 row names can never be bound by `implementation-planner` and is
  effectively dead: `corner-case-checklist` sat in that state, reachable only
  because `test-writer.md` hard-codes it for itself. The second hole is subtler —
  a Step 2 `Scope` cell whose wording does not literally match a Step 3
  `Diff scope` row name falls through to the Full-stack fallback with no
  package-specific skill; `e2e/**` classified as "Testing", a row Step 3 never
  had. Both are now checkable in one place: the catalog's **Bindable?** column
  (`yes` / `no` / `standing`) is the single flag, and the prose exclusion lists
  that used to be duplicated in `pr-self-review` Step 3 and
  `implementation-planner.md` Step 4 both defer to it. After adding a skill,
  confirm it appears in *both* the catalog and a Step 3 row, or it is shipped
  and unreachable.
  **2026-08-22 update — a single source of truth is only as good as its last
  check against the code it describes.** Step 4's `server/` row asserted
  `pnpm test` was "hermetic `*.test.ts` only" while `server/package.json`'s
  script is a bare `vitest run`; nobody had diffed the table against the
  `package.json` since it was written, and because four agents read the row
  instead of thinking, the wrong command reached every generated plan —
  `implementation-planner.md`'s plan template shipped it as its worked example.
  Referencing beats copying, but it converts one stale cell into a repo-wide
  defect. After editing any Step 4 row, run it. `mcp/` had the opposite failure:
  present in Step 4, absent from `implementer.md`'s and `test-writer.md`'s own
  per-package tables, so a plan touching it got no lane at all.

- **2026-08-03** — `.claude/skills/next-best-practices/` covers Next.js App
  Router *routing mechanics only* — the special-file table, `[slug]` /
  `[...slug]` / `[[...slug]]` syntax, `@slot` parallel routes, `(.)`/`(..)`
  interceptors, and the `middleware.ts`→`proxy.ts` rename. Grepping all 20 of
  its files turns up zero hits for "colocat", and its entire Private Folders
  section is 10 lines stating only that a `_` prefix opts a folder out of
  routing — it says nothing about what to put in `_components/`, `src/` vs.
  root `app/`, or when route groups are worth adding organizationally. That
  whole area is owned by `ui-architecture/nextjs-organization.md` instead. When
  extending either skill, keep this boundary: mechanics stay in
  `next-best-practices`, non-route organization stays in `ui-architecture`.

- **2026-08-01** — Per-run LLM cost is already computed end-to-end; the only
  thing ever missing is persistence. Every provider returns `costUsd` on its
  result, and for OpenRouter it is the REAL billed figure — the client asks for
  it with `usage: { include: true }` and reads `usage.cost`, falling back to the
  injected `PriceBook` estimator. `reviewPullRequest` then sums it across
  map-reduce chunks onto `ReviewOutcome.costUsd`. Commit `d45ab0d` removed the
  cost *feature* by dropping that one field at the destructure in
  `run-executor.ts` and deleting the `agent_runs.cost_usd` column, leaving the
  computation intact. So surfacing cost anywhere costs **zero extra model
  calls** — wire up the existing field, never add a pricing lookup or a second
  request. `reviewer-core/src/review/run.ts:216`

- **2026-08-10** — adding a field to a `@devdigest/shared` Zod object that
  already has passing fixture-parse tests requires `.default(...)`, not a bare
  type. Smart Diff's `findings: z.array(SmartDiffFinding).default([])` on
  `SmartDiffFile` (`server/src/vendor/shared/contracts/brief.ts:142` + client
  mirror) is what let `server/test/contracts.test.ts:108`'s pre-existing fixture
  (written before the field existed) keep parsing unchanged — a required field
  would have broken that test the moment the schema changed, even though no
  test file was touched. Any additive field on an already-fixture-tested
  contract needs the same treatment.
  **2026-08-23 corollary — the rule covers new fields only, and a *type change*
  has no escape hatch at all.** `RunTrace.specs_read` is `z.array(z.string())`
  (`server/src/vendor/shared/contracts/trace.ts:94`) with three live consumers —
  `TraceBody.tsx:63`, `RunTraceDrawer.test.tsx:15` and the fixture-parse tests —
  so the "obvious" widening to an object array to carry per-document token counts
  is breaking, and no `.default()` saves it. The way through is the same additive
  move one level up: leave the old field alone and add a new one beside it
  (`RunTrace.project_context` with `.default([])`), letting the old field stay the
  denormalized view. Reach for that whenever a fixture-tested contract needs a
  *richer* shape rather than a *new* one.

## Tool & Library Notes

- **2026-08-09** — A Claude Code subagent can only invoke a skill if `Skill` is in
  its frontmatter `tools:` allowlist, and it fails **silently** — the agent simply
  never reaches the catalog, with no error to notice. Omitting `tools:` entirely
  inherits every tool (including `Skill`); the moment you write an allowlist you
  have opted out of that. `.claude/agents/researcher.md:11` lists
  `Read, Grep, Glob, Bash, WebSearch, WebFetch` and therefore cannot use any of the
  15 skills in `.claude/skills/` — fine for a read-only investigator, but check this
  first whenever an agent "ignores" a skill. The separate `skills:` frontmatter
  field is not the fix: it *preloads* skill bodies at startup and costs context
  whether or not they apply. `https://code.claude.com/docs/en/sub-agents`
  **The converse is also a design lever, so don't "fix" every missing `Skill`:**
  `.claude/agents/plan-verifier.md:12` omits it deliberately, because its rubric is
  the plan file and loading any construction or review skill is exactly what drags a
  spec-conformance checker into the generic advice it exists not to give. An agent
  that omits `Skill` on purpose says so in its body — check there before adding it.

- **2026-08-22** — `cd server && pnpm test` is **both** test lanes, not the
  hermetic one: the script is a bare `vitest run` (`server/package.json`), so it
  picks up all ten `*.it.test.ts` files and boots a testcontainers Postgres even
  for a diff that touches no DB code. The lanes must be selected explicitly, as
  `TESTING.md` "Running locally" does —
  `pnpm exec vitest run --exclude '**/*.it.test.ts'` and
  `pnpm exec vitest run .it.test` — and `pnpm exec` rather than a committed
  script because `server/package.json` is `skip-worktree`. The failure is
  two-sided: **without** Docker that lane exits `0` having run nothing, because
  `server/test/helpers/pg.ts`'s `dockerAvailable()` skips it cleanly, so "green"
  can mean 10 suites never executed. Any agent or CI step reporting a test result
  must record `passed / failed / skipped`, not the exit code alone. Add
  `--reporter=dot` while you are there — the default reporter over 47 files is
  thousands of tokens per run, and an agent that runs the suite per plan step
  pays it every time.

- **2026-08-03** — `git diff` and `git diff --cached` never show untracked
  files — only tracked-file changes. Any tool that needs "all local changes
  not yet merged" (e.g. a pre-PR review gate) must also union in
  `git status --porcelain --untracked-files=all` (the `??` lines), or
  brand-new files are silently invisible. Confirmed by dogfooding
  `.claude/skills/pr-self-review/SKILL.md` on itself: its own new SKILL.md
  file was untracked and did not show up until this check was added.

- **2026-08-03** — In this environment's shell (zsh), an unquoted variable
  holding multi-line `grep -l` output does **not** word-split in a `for f in
  $files` loop — the whole multi-line string becomes one element, and piping
  it into `sed`/`xargs` fails as `sed: <all paths jammed together>: File name
  too long`. `grep -rlZE ... | xargs -0 sed -i ...` has the same failure mode
  here even with `-Z`/`-0`. What works: write the match list to a real file,
  then `while IFS= read -r f; do …; done < file` — reading a file line-by-line
  never depends on shell word-splitting. Verify any xargs/loop approach first
  with a cheap dry run (e.g. `xargs -0 -n1 echo`) before trusting it against
  real files.

## Recurring Errors & Fixes

_None yet._

## Open Questions

_None yet._
