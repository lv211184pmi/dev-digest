/**
 * Approved tool text — titles and descriptions — in ONE place.
 *
 * These strings are the only documentation the model ever sees about DevDigest's
 * tools, and they are user-approved verbatim text. Do NOT shorten, re-word,
 * re-wrap, "tighten", or strip the markdown emphasis: MCP descriptions are read
 * as text by the model and the emphasis is deliberate. A test asserts each
 * registered tool's description is byte-identical to the const below, so any
 * edit here that is not also an approved plan change fails the suite.
 *
 * Register them from these consts — never as an inline string at the call site.
 */

/** Title prefix shared by every tool, so hosts that flatten names still show DevDigest. */
export const LIST_AGENTS_TITLE = 'DevDigest · List Agents';
export const RUN_AGENT_ON_PR_TITLE = 'DevDigest · Run Agent on PR';
export const GET_FINDINGS_TITLE = 'DevDigest · Get Findings';
export const GET_CONVENTIONS_TITLE = 'DevDigest · Get Conventions';
export const GET_BLAST_RADIUS_TITLE = 'DevDigest · Get Blast Radius';

export const LIST_AGENTS_DESCRIPTION = `List the reviewer agents configured in this local DevDigest workspace. Call this FIRST when you do not already know which agent to use — the \`name\` values it returns are exactly the strings \`run_agent_on_pr\` accepts for its \`agent\` argument.

Terminology: an **agent** is a configured LLM reviewer — a provider, a model, a system prompt, and a set of linked skills. A **run** is one execution of one agent over one pull request. A **review** is the result a run produces: a verdict plus findings.

Typical agents are role-shaped (\`General Reviewer\`, \`Security Reviewer\`, \`Performance Reviewer\`, \`Test Quality Reviewer\`), so pick by what you want checked. Disabled agents are listed too and are marked \`enabled: false\`; they still run if you ask for them.

Read-only. Makes no LLM call and costs nothing. Requires the DevDigest API to be running locally.`;

export const RUN_AGENT_ON_PR_DESCRIPTION = `Run one DevDigest reviewer agent over one pull request, WAIT for it to finish, and return the verdict and findings. This does the whole job in a single call — it resolves the repo, PR and agent, starts the run, polls until it completes, and returns the result. On the happy path you do not need to call anything else.

COST: this spends real money. It makes LLM calls against the agent's configured model. Do not call it speculatively, and never in a loop over agents.

TIME: a review usually takes 20–90 seconds; this call blocks for up to 5 minutes. If that cap is hit it returns \`status: "still_running"\` with a \`run_id\` — call \`get_findings\` with the same \`repo\`/\`pr\` (or that \`run_id\`) a minute later. Do not re-run the review; it is already in flight.

The PR must already be imported into DevDigest. If it is not, the error tells you how to import it.

RESULT: a \`verdict\` (\`request_changes\` | \`approve\` | \`comment\`), a 0–100 \`score\` where higher is better, severity counts, and up to 20 findings ordered most-severe-first. If more exist, \`truncated\` is true and \`total_findings\` gives the real number.`;

export const GET_FINDINGS_DESCRIPTION = `Return the result of a review that has ALREADY run for a pull request. No LLM call, no cost.

Use it: after \`run_agent_on_pr\` returned \`status: "still_running"\`; to re-read a review you saw earlier; or to find out what an agent already said about a PR without paying for a new run.

\`agent\` is optional — omit it to get the most recent review by any agent for that PR, and the response tells you which agent produced it. \`run_id\` addresses one exact run and takes precedence over \`agent\` when both are given.

Dismissed findings are excluded. Results are capped (default 20, most severe first); raise \`max_findings\` only if you actually need the long tail.

If the PR has never been reviewed, the response says so and points you at \`run_agent_on_pr\`.`;

export const GET_CONVENTIONS_DESCRIPTION = `Return the coding conventions DevDigest extracted from a repository — the merged, human-accepted rule set as markdown, plus the files those rules were learned from.

Use it before writing or reviewing code in that repo so your output matches the house style, and to check whether a rule you are about to assert is actually this repo's convention rather than a general preference.

The markdown contains rule sentences and \`path:line\` citations only — never source snippets. Conventions come from an extraction run that a human reviews and accepts in the DevDigest UI, so they reflect decisions, not guesses. If no run has happened or nothing has been accepted yet, this tells you exactly what to do next.

Read-only, no LLM call.`;

export const GET_BLAST_RADIUS_DESCRIPTION = `Map what a pull request can impact: the symbols it changes, the callers that depend on them, and the HTTP endpoints and cron jobs downstream of those callers. Use it before reviewing or merging a PR to find blast damage the diff itself does not show — a one-line change to a helper that twelve routes call.

Every node comes from DevDigest's code index — symbols, the resolved call graph, and a two-level walk of the reverse import graph. Nothing here is inferred by a model. The only model-written field is \`summary\`, one or two sentences describing the nodes below it; it can never add a caller or an endpoint that the index did not report.

READ \`index.state\` BEFORE YOU CONCLUDE ANYTHING. It is \`full\`, \`partial\` or \`unavailable\`. On \`partial\` the map is real but incomplete — \`explanation\` says why and \`files_not_covered\` names the changed files the index could not see, whose symbols are missing from the map entirely. An empty \`changed_symbols\` on a \`partial\` index means "we could not tell", NOT "nothing is affected". A repo with no usable index returns an error rather than an empty map, for the same reason.

Callers are capped at 20 per symbol, highest file-rank first; \`caller_count\` gives the true total. Endpoint attribution is file-level, so downstream endpoints are POTENTIALLY touched rather than certainly.

Read-only. Makes no LLM call and costs nothing — the summary is served from cache, and this tool never triggers a derivation.`;
