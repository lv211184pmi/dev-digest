# Agents

Subagents live in `.claude/agents/` and are invoked via the `Agent` tool. Each runs in a
**fresh context**: it inherits the `CLAUDE.md` hierarchy and a git-status snapshot, but
**not** this conversation's history. Anything an agent needs has to be in its prompt, in
a curated file, or in an artifact on disk — which is why `implementation-planner` →
`implementer` hand off through a plan file rather than through the chat.

Skills are catalogued separately in [`../skills/README.md`](../skills/README.md).

## At a glance

| Agent | Model | Writes? | In | Out |
|---|---|---|---|---|
| [researcher](researcher.md) | Sonnet | no | a question | report (text) |
| [spec-creator](spec-creator.md) | Opus | `specs/` only | a feature idea, a design, or notes | `<module>/specs/<date>-<slug>.md` |
| [implementation-planner](implementation-planner.md) | Opus | plan file only | requirements / a change request | `.claude/plans/<date>-<slug>.md` |
| [implementer](implementer.md) | Inherit | source + tests | an approved plan file | edited working tree + report |
| [test-writer](test-writer.md) † | Inherit | test files only | a subject + package | test files + report |
| [plan-verifier](plan-verifier.md) | Sonnet | no | a plan file + the working tree | traceability report (text) |
| [architecture-reviewer](architecture-reviewer.md) | Sonnet | no | files, or the local diff | findings (text) |
| [document-writer](document-writer.md) | Inherit | `*.md` only | a plan, report or diff | docs + report |

† `test-writer` is **not** in the default chain — invoke it by hand. See below.

## The chain, and where it is automated

It runs in two halves, and the split is deliberate.

**Half one — intent. Run each agent yourself, one at a time. No command drives this.**

`researcher` (optional, when the question is open) → `spec-creator` → **you set the spec
`Status: agreed`** → `implementation-planner` → **you approve the plan** (`Status: approved`).

Every step here ends in a decision only the caller can make. `spec-creator` returns a
design-gap list and up to 3 blocking clarifications; `implementation-planner` returns a
requirement verdict, improvement instructions and the execution-mode question it asks every
time. Chaining past those turns a review point into a formality — you would be approving a
spec and a plan you never read, which is the one thing spec-driven development exists to
prevent. Both agents also refuse to invent their input: the planner will not plan from a
spec still marked `draft`, and the implementer will not run without an approved plan.

**Half two — construction. [`/implement`](../commands/implement.md) drives it.**

**`/clear`** → `implementer` → `plan-verifier` **(gate)** → `architecture-reviewer` →
`pr-self-review` skill **(gate)** → `document-writer` → `engineering-insights` skill →
**you review, then commit**.

Here the rubric is already fixed — the approved plan — so the steps are mechanical enough to
sequence, and the two gates are what stop a bad run reaching a commit.
`/implement status` reports position without running anything.

**Passing material to the run.** `/implement` takes `--spec <path>`, `--design <path…>` for
screenshots and mockups, and free-text notes. It writes them into the plan file under
`## Run inputs` rather than into the implementer's prompt — the implementer refuses prose
intent, so the plan is the only channel it trusts, and materialising the inputs there keeps
them auditable by `plan-verifier`. **None of it widens scope:** the Files list stays the
fence, a design asset showing something no step lists is a Deviation, and free text that
would change a step's Files, add a `Done when` or contradict a plan line is a *requirement* —
the command stops and sends it back to `implementation-planner`. That check is the only
thing standing between a build command and unreviewed scope creep.

**Review findings iterate through the plan, not around it.** All three reviewers are
read-only, so none closes its own loop. A finding becomes a `## Remediation` id on the plan
(`A1`, `A2`, … from `architecture-reviewer`, so they never collide with the plan's `R` ids),
and `implementer` runs scoped to those ids; where a boundary fix needs a path no step lists,
that step's Files list is extended **visibly**, in the same edit. A reviewer *question* —
anything in "Could not determine" — goes to you instead, and when the answer is "that
divergence is deliberate" it is recorded in the module's `INSIGHTS.md`, which
`architecture-reviewer` reads before flagging: the re-review then clears it without being
told. The loop is capped at **two cycles per reviewer**; a finding that survives two scoped
fixes is a planning error, not a coding one.

**The order in half two matters; it is not a menu.** Two positions are fixed:

- **`plan-verifier` runs immediately after `implementer`.** It is the cheapest agent in the
  chain and it is a gate: a boundary review of half-built code returns findings about
  scaffolding, and on a remediation cycle everything downstream would run twice. It also
  needs a tree containing only what the plan listed — anything that writes before it drops
  unplanned files in front of its scope proof and out-of-scope check.
- **`pr-self-review` runs last**, once the tree has stopped moving; its own Step 6 re-run
  discipline invalidates it on any later edit.

`architecture-reviewer` and `document-writer` are skippable when the change does not need
them ([`/implement`](../commands/implement.md) lists when). The two gates are not. None of
them commits.

**`test-writer` is not in the chain** (2026-08-22). Tests come from the plan: the
implementer writes them from steps `implementation-planner` is required to include, with the
testing skill bound. `test-writer` remains a working agent for a standalone testing job —
"cover this with tests", "why is this test failing" — invoked by hand. The cost of the
change is that nothing automatic now notices a missing test, so the planner's test-step
obligation is the only thing holding that line.

**When `plan-verifier` finds a gap**, the chain routes back: it emits a *remediation
directive* — it has no `Write` tool — which un-archives the plan, sets `Status: approved`
and appends a `## Remediation` section listing the failed ids. `implementer` accepts that
plan and treats only those ids as in scope. `/implement remediate` applies the move.

---

## researcher

**Responsibility** — Answers a question from two sources of truth, this repository and
the open internet, and returns a structured report. Investigates; never changes anything.

**Model** `sonnet`
**Tools** `Read, Grep, Glob, Bash, WebSearch, WebFetch`
**Permissions** — No `Write`, no `Edit`, no `Skill`. Bash is read-only by prompt
constraint (`git log`/`blame`/`show`/`diff`, `ls`, `wc`; no redirects, no `rm`/`mv`, no
installs, no server or DB mutation). Cannot invoke project skills — the `tools` allowlist
omits `Skill`.

**Input** — A question, plus enough scope to answer it. Asks up to 3 clarifying questions
first when different readings would produce materially different research.
**Output** — A report returned as text, never written to disk: conclusions with confidence
and evidence, a repo-vs-external-practice table verdicted `aligned` / `divergent` / `gap`,
a never-omitted "could not determine" list, and sources.

---

## spec-creator

**Responsibility** — Turns a feature idea, a design, or a module's existing docs and code
into one specification: acceptance criteria in **EARS** grammar, preceded by a
design-analysis pass that names the gaps, the uncovered corner cases, the cross-module
contracts and the UX states the design left undefined. Writes intent; never implementation,
never `docs/`, never `INSIGHTS.md`.

**Model** `opus` — gap analysis and requirement phrasing are the judgment-heavy kind.
**Tools** `Read, Grep, Glob, Write, Edit, Bash, Skill` · **denied** `WebSearch, WebFetch`
**Permissions** — **One writable surface: `**/specs/**`.** `Write` and `Edit` apply to spec
files and to the `README.md` inside a `specs/` directory, nowhere else; anything outside
that glob is refused and reported rather than written, and Bash is not a way around it.
Never writes into `e2e/specs/` (runnable `.flow.json` only). Bash is read-only on the same
terms as `researcher`, plus `date`. `Skill` is granted for `corner-case-checklist`,
`security` and `mermaid-diagram`.

**Input** — A design artefact the caller names (a `.dc.html` canvas, a mockup, a
screenshot), or the curated files in `AGENTS.md` order, or an ad-hoc description pasted at
invocation. Asks up to 3 numbered clarifications, each with a default, when different
readings would produce materially different specs.
**Output** — One file, `<module>/specs/<YYYY-MM-DD>-<slug>.md`, linked from that
directory's `README.md`, with the nine-section EARS backbone plus the destination module's
own sections. Plus a report whose **Design gaps found**, **Corner cases added**,
**Could not determine** and **Insight candidates** sections are never omitted.

**Rules based on**

| Rule | Source |
|---|---|
| Frontmatter schema; `disallowedTools` as a subtractive guard; `Skill` required to invoke skills | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| The five EARS patterns and the `shall` grammar | Mavin, Wilkinson, Harwood & Novak, *Easy Approach to Requirements Syntax*, IEEE RE'09 |
| Which `specs/` directory a spec belongs in; the metadata block; the four `Status` values; `YYYY-MM-DD-feature-name.md` naming | [`specs/README.md`](../../specs/README.md) and the four package `specs/README.md` files |
| `e2e/specs/` is `.flow.json` only; `mcp/` has no `specs/` — both route to root | [`e2e/specs/README.md`](../../e2e/specs/README.md), [`specs/03-devdigest-mcp.md`](../../specs/03-devdigest-mcp.md) |
| Path → package classification — **referenced, not copied** | [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) Step 2 |
| The `≥2 packages → root` rule, and the `vendor/shared` carve-out | [`../skills/engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md) "Module resolution" |
| Empty / zero / first-last / at-the-limit corner cases | [`../skills/corner-case-checklist/SKILL.md`](../skills/corner-case-checklist/SKILL.md) |
| Diagram-type decision guide; inline fenced blocks, never a checked-in image | [`../skills/mermaid-diagram/SKILL.md`](../skills/mermaid-diagram/SKILL.md) |
| A stale spec reads as current intent; an unlinked doc is invisible; destination rules per directory | [`document-writer.md`](document-writer.md) Steps 1, 2 and 5 |
| Blocking Step 0 clarify with stated defaults; mandatory output template; never-omitted unresolved section; explicit allowed/forbidden Bash verb lists | [`researcher.md`](researcher.md) house style |

---

## implementation-planner

**Responsibility** — Analyses the requirements it was given, then turns them into a
step-by-step plan grounded in the repo's curated files and architectural constraints.
Names the exact files each step touches, binds the skills the implementer must load, and
gives every step a verification command. Plans implementation; never implements, and does
**not** author or update a specification — [`spec-creator`](spec-creator.md) owns
`<module>/specs/`.

**Model** `opus` — one high-leverage reasoning pass per change.
**Tools** `Read, Grep, Glob, Bash, Skill, Write`
**Permissions** — No `Edit` tool at all, so source cannot be modified. `Write` is confined
by prompt constraint to `.claude/plans/*.md`. Bash is read-only on the same terms as
`researcher`, plus `date`. `Skill` is granted so it can consult architecture skills while
planning.

**Input** — Requirements: a feature or change request, plus whatever is already written
down. Reads `<module>/specs/` → `docs/` → `INSIGHTS.md` → source before proposing
anything — `specs/` strictly as a read-only statement of existing intent.
**Output** — One file, `.claude/plans/<YYYY-MM-DD>-<slug>.md` (gitignored), with fixed
sections: Context, **Requirements** (each id'd, sourced and marked clear / ambiguous /
missing / conflicting) + **How to improve these requirements**, Grounding, Constraints,
**Skills contract**, **Execution**, Steps, Verification, Out of scope, Open questions.
Plus a short text summary naming the plan path, the riskiest step, the requirement
verdict, the execution mode, and any blocking question.

**Two blocking questions** — Step 0 asks up to 3 numbered clarifications (each with a
default) only when a requirement gap would change the plan. Step 1 asks **every time**,
in the same round trip, whether execution should run as the **multi-agent review chain**
(`implementer` → `plan-verifier` → `architecture-reviewer` →
`pr-self-review`) or as a **single-agent run**, with a recommendation. The answer is
recorded in the plan's `Execution` line and changes the plan's shape.

**Rules based on**

| Rule | Source |
|---|---|
| Frontmatter schema; `tools` omitted inherits everything; `Skill` required to invoke skills; `model` selection; what a subagent does and does not inherit at startup | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Explore → plan → implement → verify, with review in a fresh context | [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) |
| Read order `specs/ → docs/ → INSIGHTS.md → source`; contracts change in `@devdigest/shared` first; pnpm vs npm per package; do-not-touch globs | root [`AGENTS.md`](../../AGENTS.md) |
| Blocking Step 0 clarify with stated defaults; mandatory output template; never-omitted unresolved section; explicit allowed/forbidden Bash verb lists; `path:line` citations | [`researcher.md`](researcher.md) house style |
| Path → package → scope classification (Step 2); scope → candidate skills (Step 3); per-package verification commands (Step 4) — **referenced, not copied** | [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) |
| Backend ring rules and banned imports | [`../skills/onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) |
| Frontend placement, colocation, barrel-file rules | [`../skills/ui-architecture/SKILL.md`](../skills/ui-architecture/SKILL.md) |
| Why the handoff is a file, and why the "role-splitting is an anti-pattern" claim has no primary source | root [`INSIGHTS.md`](../../INSIGHTS.md), Decisions 2026-08-09 |

---

## implementer

**Responsibility** — Executes an approved plan across backend and frontend, loading the
skills the plan bound and editing only the files it listed. Builds; never designs, never
reviews, never commits.

**Model** `inherit` — implementation quality tracks the session's model.
**Tools** `Read, Grep, Glob, Edit, Write, Bash, Skill` · **denied** `WebSearch, WebFetch`
**Permissions** — Full edit access to source, constrained by the plan's file list rather
than by tooling: a file the plan does not name is not edited, it is reported as a
Deviation. No git history (`commit`, `push`, `checkout`, `reset`, `stash`, `merge`,
`rebase` all forbidden; `status`/`diff`/`log`/`blame` fine). `mv` allowed for exactly one
path — the plan file it was handed, into `.claude/plans/archive/`; `rm` is forbidden
outright. No dependency installs unless the plan has one as a step. No
`docker compose down -v`. No web access.

**Input** — A plan file with `Status: approved` and no blocking open question. **Refuses
to run without one** and will not reconstruct a plan from the prompt.
**Output** — An edited, uncommitted working tree, plus a report: per-step status table,
files changed, a **Self-check** (scope proof, a per-step **Done-when** table with
`path:line` evidence, constraint sweep, verification colour), **Deviations** (never
omitted), a **Verification** table carrying `passed / failed / skipped` per command,
**Insight candidates**, and a **Handoff** line naming what the caller still owes.
It deliberately produces **no** requirement-traceability table and **no** acceptance-criteria
verdicts: that audit is `plan-verifier`'s, which re-derives it in a fresh context and is
forbidden from reusing these rows anyway — doing it here ran it twice, the first time in the
chain's largest and most expensive context, for a result discarded by design. The plan file is **archived to
`.claude/plans/archive/`** with `Status: implemented` on a fully green run; on anything
else it is kept in place with `Status: blocked` and an execution log. It is never deleted
— `plan-verifier` reads it afterwards.

**Rules based on** — everything in the implementation-planner's table above, plus:

| Rule | Source |
|---|---|
| `disallowedTools` as a subtractive guard; `model: inherit` semantics | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Test split: `*.it.test.ts` are DB-backed (testcontainers), everything else hermetic; migrations do not run on boot; never `docker compose down -v` | root [`AGENTS.md`](../../AGENTS.md), [`TESTING.md`](../../TESTING.md) |
| No commits; insight candidates reported rather than written | user decision, 2026-08-09 |
| End-of-task `engineering-insights` obligation, transferred to the caller via the Handoff section | root [`AGENTS.md`](../../AGENTS.md), [`../skills/engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md) |
| Skills floor + `Bindable?` eligibility before loading an unbound skill | [`../skills/README.md`](../skills/README.md) catalog, [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) Step 3 |
| Final self-check: scope proof, requirement traceability, AC verdicts in `plan-verifier`'s vocabulary | [`plan-verifier.md`](plan-verifier.md) report template, [`spec-creator.md`](spec-creator.md) `## Acceptance criteria (EARS)` |
| Scope gate, plan-required refusal, conditional plan archiving, skill/plan conflicts reported not resolved | design decisions for this pair — no external source |

---

## test-writer

**Not in the default chain (2026-08-22)** — `/implement` has no step for it, and tests are
written by the `implementer` from steps the plan named. Invoke this agent by hand for a
standalone testing pass, a failing test, or coverage a plan skipped. The tradeoff taken: one
fewer `inherit`-model agent pass per run, at the cost that nothing automatic now notices a
missing test — `implementation-planner` Step 4's test-step obligation is the only thing
holding that line, so watch for plans that quietly omit one.

**Responsibility** — Writes and repairs tests across both halves of the stack: React
components and hooks in `client/` (Vitest + RTL, jsdom), and routes, adapters and services
in `server/`, choosing the hermetic vs DB-backed lane and binding this repo's testing
skills itself. **Does NOT** edit production source, does not review, does not commit, and
does not chase a coverage number.

**Model** `inherit` — test quality tracks the session's model, as with `implementer`.
**Tools** `Read, Grep, Glob, Edit, Write, Bash, Skill` · **denied** `WebSearch, WebFetch`
**Permissions** — Write access confined by prompt constraint to test paths only:
`**/*.test.ts(x)`, `**/*.it.test.ts`, `e2e/specs/*.flow.json`, `server/test/helpers/**`,
`client/src/test/setup.ts`. A change needed in production source is reported under "Source
changes required", never made. No git history, no installs, no
`docker compose down -v`, no web access. Runs only the touched package's lane command.

**Input** — A subject (files or behaviour), its package, and whether it needs a DB. Asks up
to 3 clarifying questions when a different reading changes the lane.
**Output** — New or repaired test files, plus a report: cases covered mapped to
corner-case categories, **Source changes required** (never omitted), **Not covered and
why** (never omitted — the typological philosophy means deliberate gaps), verification
output, and a Handoff line.

**Rules based on**

| Rule | Source |
|---|---|
| Frontmatter schema; `tools` omitted inherits everything; `Skill` required to invoke skills; `disallowedTools` as a subtractive guard | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Typological-not-exhaustive philosophy; the `*.it.test.ts` suffix rule and the unit/integration split commands; hermetic tests use `src/adapters/mocks.ts` | [`TESTING.md`](../../TESTING.md) |
| pnpm vs npm per package; do-not-touch globs; read curated files first | root [`AGENTS.md`](../../AGENTS.md) |
| Per-package verification commands — **referenced, not copied** | [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) Step 4 |
| Which testing/domain skill applies to which subject | [`../skills/react-testing-library/SKILL.md`](../skills/react-testing-library/SKILL.md), [`../skills/corner-case-checklist/SKILL.md`](../skills/corner-case-checklist/SKILL.md) |
| Blocking Step 0 clarify with stated defaults; mandatory report template with never-omitted sections | [`researcher.md`](researcher.md) / [`implementer.md`](implementer.md) house style |

---

## plan-verifier

**Responsibility** — Audits an implemented change against one specific plan file,
requirement by requirement, and gives each a verdict backed by `path:line` evidence from
the working tree. **Does NOT** review code quality, architecture or security; does not fix
anything; does not manage the plan file's lifecycle; does not work without a plan.

**Model** `sonnet` — the rubric is supplied, so the work is evidence-gathering against a
fixed checklist rather than open-ended reasoning, and it should be cheap enough to re-run
after every implementer pass.
**Tools** `Read, Grep, Glob, Bash`
**Permissions** — No `Write`, no `Edit`, no `Skill`. The `Skill` omission is deliberate and
documented in the file itself: the rubric is the plan, not the catalog, and loading review
skills is what turns an audit into the generic advice it must not give. Bash is read-only
git plus the plan's own Verification commands — no installs, no migrations, no server
start. Never moves, archives or deletes the plan file.

**Input** — A plan file: the caller's path, else `.claude/plans/`, else
`.claude/plans/archive/` where a green `implementer` run leaves it. **Refuses to run
without one** and will not reconstruct a checklist from the diff, the prompt, or the
implementer's own report.
**Output** — A traceability table with every requirement `R1..Rn` and one of four verdicts
(met / partially met / not met / not verifiable), plus **Not verifiable**,
**Out-of-scope check** and **Remediation directive** (all three never omitted), the real
exit codes *and `passed / failed / skipped` counts* of the plan's verification commands, and
an **Out of band** list capped at one routing line per item. The remediation directive is
emitted as text for the caller or `/implement` to apply — this agent never touches the plan file,
which is what keeps a verifier from editing its own rubric.

**Rules based on**

| Rule | Source |
|---|---|
| Frontmatter schema; `model` selection; `Skill` required to invoke skills — and that it fails silently without it | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents), root [`INSIGHTS.md`](../../INSIGHTS.md) Tool & Library Notes 2026-08-09 |
| Where the plan file lives after a run — archived on green, kept on blocked | [`implementer.md`](implementer.md) Step 6 |
| Per-package verification commands — **referenced, not copied** | [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) Step 4 |
| `git diff` never shows untracked files; union in `git status --porcelain --untracked-files=all` | root [`INSIGHTS.md`](../../INSIGHTS.md) Tool & Library Notes 2026-08-03 |
| Do-not-touch globs | root [`AGENTS.md`](../../AGENTS.md) |
| Mandatory output template; never-omitted unresolved sections; `path:line` citations | [`researcher.md`](researcher.md) house style |

---

## architecture-reviewer

**Responsibility** — Reviews already-written code for architectural boundary violations
only: ring and import direction in `server/`, component/hook/util placement in `client/`,
and the purity rule plus grounding-gate veto in `reviewer-core/`.
Returns severity-labelled findings, each citing the rule it breaks with `path:line`
evidence. **Does NOT** find correctness bugs (`/code-review`), does not do security
(`security-review`), does not gate the PR (`pr-self-review`), and does not write code.

**Model** `sonnet` — **changed from `opus` on 2026-08-22.** The argument for Opus was that
deciding what *not* to flag is the expensive part, since a false CRITICAL from a boundary
reviewer is what makes a team stop reading its output. That is still true, but the judgment
here is less open-ended than it looks: the rules are supplied, not inferred — `onion-architecture`,
`ui-architecture` and `reviewer-core-engine` state them explicitly, `pr-self-review` Step 6
supplies the severity rubric verbatim, and every finding must cite the rule it breaks with
`path:line` or it is not a finding. That is a rubric-shaped task, the same shape that makes
`plan-verifier` a Sonnet agent. Three structural guards carry the load the model used to:
the mandatory **rule citation** per finding, the never-omitted **"Considered and not
flagged"** section, and **"Could not determine"** absorbing anything below Medium confidence
instead of letting it become a hedged finding.
**Watch for:** false CRITICALs, or findings whose "Rule" line paraphrases a skill rather
than citing a section of it. Either is the signal to put this agent back on `opus` — the
tradeoff is real, it was taken deliberately for cost, and it is reversible in one line.
**Tools** `Read, Grep, Glob, Bash, Skill`
**Permissions** — No `Write`, no `Edit`: the allowlist omits both, so a fix is impossible at
the tool level rather than merely discouraged. It describes a fix in one line and never
emits a patch. Bash is read-only on `researcher`'s terms. Runs **no** typecheck and **no**
tests — that deterministic pre-gate belongs to `pr-self-review` Step 4.

**Input** — Explicit paths from the caller, else the local not-yet-merged union collected
per `pr-self-review` Step 1 (including its untracked-files requirement). An empty target is
reported as "nothing to review", never padded with findings.
**Output** — Findings in a fixed block format (rule / evidence / justification / confidence
/ fix direction), CRITICAL first, plus **Considered and not flagged**, **Could not
determine** and **Routing** (all three never omitted) and a severity summary. Routing splits
what it found in two: CRITICAL/HIGH findings become `A`-prefixed ids ready to append to the
plan's `## Remediation` — naming the step whose Files list a boundary fix needs widened —
while "Could not determine" entries go to the caller, with `INSIGHTS.md` named as the home
for any answer of "that divergence is deliberate". Gating is explicitly not its job, and
neither is fixing: it has no `Write` or `Edit`, so it emits the remediation lines and never
appends them.

**Rules based on**

| Rule | Source |
|---|---|
| Frontmatter schema; `model` selection; `Skill` required to invoke skills | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| Diff collection (Step 1), path → package → scope classification (Step 2), scope → candidate skills (Step 3), CRITICAL/HIGH/MEDIUM rubric (Step 6) — **referenced, not copied** | [`../skills/pr-self-review/SKILL.md`](../skills/pr-self-review/SKILL.md) |
| Backend ring rules, dependency direction, banned imports | [`../skills/onion-architecture/SKILL.md`](../skills/onion-architecture/SKILL.md) |
| Frontend placement, colocation, barrel-file rules | [`../skills/ui-architecture/SKILL.md`](../skills/ui-architecture/SKILL.md) |
| Engine purity (no DB/GitHub/fs), pipeline order, the grounding gate's veto | [`../skills/reviewer-core-engine/SKILL.md`](../skills/reviewer-core-engine/SKILL.md) |
| Module resolution for reading `INSIGHTS.md` before flagging — a recorded deliberate divergence is not a finding | [`../skills/engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md) |
| Do-not-touch globs, including `server/clones/**` | root [`AGENTS.md`](../../AGENTS.md) |
| Read-only Bash verb lists; never-omitted "could not determine"; `path:line` citations | [`researcher.md`](researcher.md) house style |

---

## document-writer

**Responsibility** — Turns an implemented change, a plan file or raw notes into
documentation that lands in the right file — a package `README.md`, `<module>/docs/`, or
`<module>/specs/` — following each destination directory's own published accept/reject
rules, and adds Mermaid diagrams where they carry structure prose cannot. **Does NOT** write
`INSIGHTS.md` by hand (that is the `engineering-insights` skill), does not touch source,
and does not research the internet (that is `researcher`).

**Model** `inherit` — construction work; prose quality tracks the session's model.
**Tools** `Read, Grep, Glob, Edit, Write, Bash, Skill` · **denied** `WebSearch, WebFetch`
**Permissions** — Writes `*.md` **only** — never source, tests, config, JSON or YAML.
`.claude/plans/**` is read-only here; that lifecycle belongs to `implementer`. May write
`INSIGHTS.md` **only** through the `engineering-insights` skill's Step 2 and only when the
caller explicitly asked for an insight to be recorded; otherwise it reports candidates. No
git history, no web access, do-not-touch globs.

**Input** — Source material in preference order: a plan file (`.claude/plans/` or its
`archive/`), a pasted implementer report, the diff, then the code. Never documents
behaviour absent from all four.
**Output** — Created or edited markdown, each file justified by the row of its destination
decision table, plus a report with **Insight candidates** and **Could not determine**, both
never omitted.

**Rules based on**

| Rule | Source |
|---|---|
| Frontmatter schema; `disallowedTools` as a subtractive guard; `Skill` required to invoke skills | [code.claude.com/docs/en/sub-agents](https://code.claude.com/docs/en/sub-agents) |
| What each destination accepts and rejects, and the `NN-feature-name.md` convention | [`docs/README.md`](../../docs/README.md), [`specs/README.md`](../../specs/README.md), [`server/docs/README.md`](../../server/docs/README.md), [`server/specs/README.md`](../../server/specs/README.md) |
| `INSIGHTS.md` module routing, section choice, specificity bar and duplicate check — deferred wholesale | [`../skills/engineering-insights/SKILL.md`](../skills/engineering-insights/SKILL.md) |
| Diagram-type decision guide; inline fenced blocks, never a checked-in image | [`../skills/mermaid-diagram/SKILL.md`](../skills/mermaid-diagram/SKILL.md) |
| "Read when" pointers a new doc must be linked from; do-not-touch globs | root [`AGENTS.md`](../../AGENTS.md), [`TESTING.md`](../../TESTING.md) |
| `git diff` never shows untracked files | root [`INSIGHTS.md`](../../INSIGHTS.md) Tool & Library Notes 2026-08-03 |
| Mandatory output template; never-omitted unresolved section | [`researcher.md`](researcher.md) house style |

---

## Choosing between the review agents

Several of these eight overlap enough to be mis-delegated. `description` is the sole
auto-delegation signal, so route by the question being asked:

| The question | Where it goes |
|---|---|
| "Execute the approved plan and verify it / where are we in the run?" | [`/implement`](../commands/implement.md) |
| "Build what the plan says" | [`implementer`](implementer.md) |
| "Did we build what the plan says?" | [`plan-verifier`](plan-verifier.md) |
| "Is this code in the right layer / folder?" | [`architecture-reviewer`](architecture-reviewer.md) |
| "Any bugs? general quality?" | `/code-review` (not an agent here) |
| "Security pass over the changes" | `security-review` |
| "Is this safe to open a PR with?" | [`pr-self-review`](../skills/pr-self-review/SKILL.md) skill — it gates on CRITICAL |
| "Cover this with tests" | [`test-writer`](test-writer.md) |
| "What are we building, and how do we know it is done?" | [`spec-creator`](spec-creator.md) |
| "Write down what we built" | [`document-writer`](document-writer.md) |
| "What did we learn?" | [`engineering-insights`](../skills/engineering-insights/SKILL.md) skill |

---

## Adding an agent

- Only `name` and `description` are required in the frontmatter. `description` is the sole
  automatic-delegation signal — end it with concrete trigger phrases, as all three agents do.
- Write an explicit `tools:` allowlist. Omitting it grants **every** tool.
- Add `Skill` if the agent must use this repo's skills. Without it, skill invocation fails
  silently — see root `INSIGHTS.md`, Tool & Library Notes 2026-08-09.
- Don't restate `CLAUDE.md` wholesale; subagents already receive it.
- Point at `pr-self-review` Steps 2–4 for path routing and test commands instead of copying
  the tables.
- Add a row to the At-a-glance table above and to the Agents table in
  [`../skills/README.md`](../skills/README.md).
