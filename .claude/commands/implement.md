---
description: Execute an approved plan file and drive the verification chain after it — implementer, plan-verifier (gate), architecture-reviewer, pr-self-review, document-writer. Starts from a plan; does not write specs or plans.
argument-hint: "[plan path] [--spec <path>] [--design <path…>] [free-text notes] | status | remediate"
allowed-tools: Read, Grep, Glob, Bash, Edit, Agent, Skill
---

# /implement — execute a plan and verify it

Argument: `$ARGUMENTS`

## What this command does not do

**It does not create a spec, and it does not write a plan.** Both of those run by hand,
before this command, because both need the caller in the loop on a judgement this command
cannot make for them:

| Run this yourself, first | Agent | Why it stays manual |
|---|---|---|
| Write or update the spec | `spec-creator` | It asks up to 3 blocking clarifications and returns a design-gap list you have to actually read. Automating past that produces a spec nobody agreed to |
| Approve the spec | you | Set `Status: agreed`. `implementation-planner` refuses a `draft` — that refusal is what makes approval real |
| Write the plan | `implementation-planner` | It asks the execution-mode question every time, and reports a requirement verdict with improvement instructions. Both are decisions, not steps |
| Approve the plan | you | Set `Status: approved`. Read the Steps and the Files lists — they are the implementer's scope fence, and this is your last chance to change them cheaply |

This command picks up at the **approved plan** and carries it to a reviewed, uncommitted
working tree. If no such plan exists it stops and tells you which of the four rows above
you are missing. It never fills one in itself.

## Inputs

Everything passed to this command is **written into the plan file** before the implementer
runs, under a `## Run inputs` section — never handed to it as prompt text. That is not
ceremony: `implementer.md` Step 0 refuses a prose description of intent, and the plan is the
only channel it trusts. Materialising the inputs into the plan keeps the fence intact, and
makes them auditable by `plan-verifier`, which reads the same file.

| Argument | Lands as | What it may do |
|---|---|---|
| a bare path ending `.md` under `.claude/plans/` | the plan to run | overrides phase detection |
| `--spec <path>` | `Spec:` under `## Run inputs` | names the acceptance-criteria source. `plan-verifier` verifies spec-backed requirements against **that** file's `## Acceptance criteria (EARS)` |
| `--design <path…>` | `Design assets:` — each mapped to the step(s) it informs | supplies visual detail for a step the plan **already has**: spacing, copy, which states are drawn, component grouping |
| free text (anything else) | `Run notes:` — **or a stop**, see below | clarifies something the plan already says |

### The spec must match the plan

If `--spec` names a file the plan's **Requirements** table does not cite, **stop**. Two
different specs behind one run means the plan was written against one contract and will be
verified against another. Say which spec the plan cites and ask which is right; do not pick,
and do not silently verify against both.

If the plan cites a spec and `--spec` was omitted, resolve it from the Requirements table's
`Source` column and record it anyway — `plan-verifier` should never have to go hunting.

### Design assets inform a step; they never add one

Record each asset against the steps it informs, and read it there. A screenshot is evidence
about **how** something the plan already describes should look. It is not a requirement
source. Concretely, an asset may **not** introduce a screen, a state, a route, a copy string
or a file that no step lists — and if one shows something the plan does not cover, that is a
**Deviation** to report, and the fix is a new plan, not a wider run.

Note the asset paths in the plan rather than pasting the images: the implementer reads them
itself, and only for the steps they are mapped to.

### Free text: clarification or requirement?

Apply one test before writing anything down:

> Does acting on this text change a step's **Files** list, add a **Done when**, or
> contradict a line the plan already states?

- **No** → it is a clarification. Write it verbatim under `Run notes:`, and add the line
  *"Run notes are non-scope-bearing: they explain the plan, they do not extend it."*
- **Yes** → it is a **requirement**, and it does not enter here. **Stop.** Tell the caller it
  needs `implementation-planner` (or `spec-creator`, if it changes what is being built at
  all), and say which of the three tests it tripped.

This is the one place scope creep gets in, and it gets in disguised as a helpful aside. A
requirement that arrives as an argument to a build command was never reviewed, never
traced to an id, and will never be verified — `plan-verifier` audits the plan, so anything
outside it is invisible to the only gate that would have caught it.

### The `## Run inputs` block

Append to the plan file, before `## Steps`:

```markdown
## Run inputs

Added by `/implement` on <YYYY-MM-DD>. Supporting material only — nothing here widens the
scope set by `## Steps`.

- **Spec:** `client/specs/2026-08-22-stale-index-badge.md` — cited by R1, R2
- **Design assets:**
  - `docs/design/badge-states.png` → informs Step 3 (the four badge states and their copy)
- **Run notes:** <the caller's text, verbatim>
  Run notes are non-scope-bearing: they explain the plan, they do not extend it.
```

## The chain

```
⟨/clear — fresh context⟩
  → implementer
  → plan-verifier          ◄── GATE ──┐ not met / partially met
  → architecture-reviewer  ◄── LOOP ──┤ findings, or a question for you
  → pr-self-review         ◄── GATE ──┘ any CRITICAL blocks the PR
  → document-writer        (also sets the spec's Status: shipped)
  → engineering-insights
  → the caller reviews and commits

  all three arrows return to: remediate the plan → implementer → re-verify
```

`architecture-reviewer` runs only when `server/`, `client/` or `reviewer-core/` moved.

Two positions are fixed and are **not** a matter of taste:

- **`plan-verifier` runs immediately after `implementer`.** It is the cheapest agent in the
  chain (Sonnet, read-only) and it is a gate: a boundary review of half-built code returns
  findings about scaffolding, and on a remediation cycle everything downstream would run
  twice. It also needs a working tree containing *only* what the plan listed — anything that
  writes before it drops unplanned files in front of its scope proof and out-of-scope
  check.
- **`pr-self-review` runs last**, once the tree has stopped moving. Its own Step 6 re-run
  discipline invalidates it on any later edit.

## Phase detection (do this first, every invocation)

Never guess where the chain is. Establish it:

```sh
ls .claude/plans/*.md .claude/plans/archive/*.md 2>/dev/null
grep -H "^Status:" .claude/plans/*.md .claude/plans/archive/*.md 2>/dev/null
git status --porcelain --untracked-files=all
```

| What you find | Next action |
|---|---|
| `status` was passed as the argument | Report the table below and stop. **Run nothing** |
| `remediate` was passed | Apply the mechanical move in "Iterating on review findings", then `implementer` |
| No plan file at all | **Stop.** Name the manual steps above that are missing. Do not write a plan |
| Plan at `Status: draft`, or carrying a blocking open question | **Stop.** Show the caller the blocking questions — the plan is not ready to hand off |
| Plan at `Status: approved`, tree clean | **Tell the caller to `/clear` first**, then run `implementer` |
| Plan in `archive/` at `Status: implemented`, or in place at `Status: blocked` | `plan-verifier` |
| `plan-verifier` reported any `not met` / `partially met` | The remediation loop in "Iterating on review findings" |
| `plan-verifier` clean | The remaining steps, in chain order, skipping per the table at the end |
| More than one plan matches and no path was given | **Stop and ask which.** Do not pick |

A plan path passed as the argument overrides the search — use it and say so.

## The context reset before `implementer`

The planning → building handoff is a **file, not a conversation**
(`.claude/agents/README.md`). Ask the caller to `/clear` before the implementer runs. Do
not paste the plan's contents into the invocation as a shortcut: the implementer reads the
file itself, and a prose summary in the prompt is exactly what its Step 0 is written to
refuse.

## Iterating on review findings (`/implement remediate`)

`plan-verifier`, `architecture-reviewer` and `pr-self-review` are all read-only —
`architecture-reviewer` has no `Write` or `Edit` at the tool level, so it *describes* a fix
in one line and cannot apply one. None of the three closes its own loop. This command does,
and it is the same machinery in all three cases: **a finding becomes a plan requirement, and
the implementer runs against it.** Nothing is fixed off a review comment directly.

### Two kinds of output, two different routes

A review returns findings **and** questions, and they are not the same thing.

**Findings — the reviewer knows what is wrong.** Route them into a `## Remediation` block on
the plan, exactly like `plan-verifier`'s directive:

1. `mv .claude/plans/archive/<file>.md .claude/plans/<file>.md` — skip if never archived.
2. Set `Status: approved`.
3. Append or extend `## Remediation` with one id per finding. `plan-verifier` supplies its
   directive verbatim and keeps the plan's own `R` ids; `architecture-reviewer` supplies
   `A1`, `A2`, … from its Routing block, prefixed `A` so they never collide. Copy each
   finding's rule citation and `path:line` in as its evidence, and **add nothing else** —
   this is a transcription, not a rewrite.
4. **If the fix needs a path no step lists** — a boundary fix usually means moving code to a
   different ring — extend that step's **Files** list in the same edit, and record in the
   `## Remediation` block which id required it. The implementer's scope fence is the Files
   list; widening it silently is exactly what the fence exists to prevent, so widen it
   *visibly*, where `plan-verifier` will audit the widening.
5. Re-run `implementer` — it reads `## Remediation` and treats **only** those ids as in
   scope — then `plan-verifier`, then the reviewer that raised the findings.

Do not edit the failed requirements themselves, re-scope them, or downgrade one to an open
question to get a clean run. If a requirement turns out to be *wrong* rather than unmet,
that is a plan change: stop, say so, and send the caller back to `implementation-planner`
by hand.

**Questions — the reviewer does not know, and is asking you.** These arrive in
"Could not determine", and no amount of re-running produces an answer. Put them to the
caller, and route the answer by which it is:

- **"That is deliberate."** Record it with the `engineering-insights` skill, in the module's
  own `INSIGHTS.md`, with the reasoning. `architecture-reviewer` reads `INSIGHTS.md` before
  flagging and treats a recorded deliberate divergence as **not a finding** — so the answer
  closes the question permanently, and the re-review clears it without being told. This is
  the only route that stops the same question coming back next feature.
- **"No, that is a real gap."** It becomes a finding: give it an `A` id and take the route
  above.
- **"I do not know yet."** Leave it open, state it in the run summary, and do not let it
  block the rest. An unanswered question is not a CRITICAL.

### What re-runs, and how far back

After any remediation the tree has changed, so:

| Ran again | Why |
|---|---|
| `plan-verifier` | always — the scope proof must see the new paths, and the widened Files list is a plan change it audits |
| the reviewer that raised the finding | to confirm the fix, not to hunt fresh ground |
| `pr-self-review` | **from Step 1**, always, if it had already run — its own Step 6 re-run discipline forbids re-checking only the file that changed |

Do **not** re-run reviewers that raised nothing, on a tree whose change they already cleared.

### The loop is bounded

**At most two remediation cycles per reviewer.** If a third would be needed, stop and hand
it to the caller with what is still open. A finding that survives two scoped fixes is
usually not a bug in the code — it is a plan that put something in the wrong place, and the
fix is `implementation-planner`, not another pass. Say that plainly rather than grinding.

Never resolve a finding by weakening the rule, editing the plan's `Out of scope` to cover
it, or downgrading its severity. If you disagree with a finding, that is the "deliberate
divergence" route above — argued, recorded in `INSIGHTS.md`, and visible next time.

## Cost discipline

- Only `implementer` and `document-writer` write. Everything else is read-only — never
  re-run a reviewer on an unchanged tree.
- Verification commands come from **Step 4 of
  `.claude/skills/pr-self-review/SKILL.md`**: the lane split, `--reporter=dot`, and the rule
  that a skipped suite is not a passing suite. Never bare `cd server && pnpm test`.
- A plan past ~8 steps or 2 packages should have been split into phase plans. If you are
  handed one that was not, run the phases as separate `implementer` → `plan-verifier`
  cycles rather than one long run.

## Skipping steps

Legitimately skippable, and only for the stated reason — say which reason applied:

| Step | Skip when |
|---|---|
| `architecture-reviewer` | nothing under `server/`, `client/` or `reviewer-core/` moved |
| `document-writer` | no user-visible behaviour, and no new route, hook, page or contract |

`plan-verifier` and `pr-self-review` are **not** on that list. They are the two gates.

## Tests

There is **no `test-writer` step** — it was taken out of the chain on 2026-08-22. Tests are
written by the `implementer`, from steps the plan named, with the testing skill bound on
those steps (`implementation-planner` Step 4 is required to do this on every plan).

So when `plan-verifier` reports the run complete and the change added behaviour with no test
file in the tree, that is a **finding, not a preference**: say so plainly and name
[`test-writer`](../agents/test-writer.md) as the by-hand fix. It is still a working agent —
it is just no longer automatic, which means nothing will notice a missing test unless you
do.
