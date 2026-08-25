/**
 * Static configuration for the DevDigest MCP server.
 *
 * Everything here is read once at module load from `process.env` (operator
 * controlled, never attacker controlled) and frozen into a constant. There is no
 * secret in this file: the local Fastify API runs without auth, so the only
 * thing configurable is where it lives and how long we are willing to wait.
 *
 * NOTE: stdout is the JSON-RPC channel — nothing in `src/**` may `console.log`.
 * A bad env value therefore falls back to its default silently rather than
 * warning; the caller sees the effective behaviour, not a corrupted protocol.
 */

/** Base URL of the local DevDigest Fastify API. Trailing slashes are dropped so
 *  `${API_BASE}${path}` never produces a double slash. */
export const API_BASE = (process.env.DEVDIGEST_API_BASE ?? 'http://localhost:3001').replace(
  /\/+$/,
  '',
);

/**
 * Reads a positive-integer env var, falling back to `fallback` when it is
 * absent, non-numeric, zero or negative. Deliberately total: a typo in the
 * host's env block must not stop the server from starting.
 */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// ---- Run polling -----------------------------------------------------------

/** Hard cap on how long `run_agent_on_pr` blocks before returning `still_running`. */
export const RUN_TIMEOUT_MS = positiveIntEnv('DEVDIGEST_MCP_RUN_TIMEOUT_MS', 300_000);

/** Gap between run-status polls. 2s ⇒ 30 req/min, safely under the API's 120/min. */
export const POLL_INTERVAL_MS = 2000;

/** Delay before the FIRST poll — a fast review can already be done by then. */
export const FIRST_DELAY_MS = 1000;

/** Poll errors tolerated in a row before we give up and hand back the run_id. */
export const MAX_CONSECUTIVE_POLL_ERRORS = 3;

// ---- Response shaping (principle #3: concise structured response) ----------

/** Findings returned when the caller does not ask for a different number. */
export const DEFAULT_MAX_FINDINGS = 20;

/** Truncation caps, in characters. LLM-authored prose is the biggest token risk. */
export const RATIONALE_MAX = 400;
export const SUGGESTION_MAX = 300;
export const SUMMARY_MAX = 500;
/** Cap on the slice of an API error message we are willing to echo back. */
export const ERROR_MAX = 300;

/** Conventions markdown cap — the skill body is ~800 tokens, this is the guard rail. */
export const CONVENTIONS_MD_MAX = 20_000;

/** Evidence files listed alongside the conventions markdown. */
export const EVIDENCE_FILES_MAX = 20;

/**
 * Changed symbols returned by `get_blast_radius`.
 *
 * Distinct from the server's own 20-callers-PER-SYMBOL cap: this bounds the
 * outer list, so the worst case is 20 symbols × 20 callers rather than
 * unbounded. A PR touching more than 20 symbols is one no reviewer reads
 * symbol-by-symbol anyway, and `truncated` tells the caller it happened.
 */
export const BLAST_SYMBOLS_MAX = 20;

/**
 * Callers listed per symbol by `get_blast_radius`.
 *
 * Tighter than the server's 20, deliberately. The card can afford 20 rows
 * because a human scans them; a model pays for all 20 × 20 = 400 of them in
 * tokens and acts on the top few. `caller_count` still reports the server's
 * true pre-cap total, so nothing is hidden — only unlisted.
 */
export const BLAST_CALLERS_MAX = 5;

// ---- Tool naming -----------------------------------------------------------

/**
 * Escape hatch for hosts that flatten tool names across servers. Empty by
 * default: Claude Code already namespaces client-side as `mcp__devdigest__*`.
 */
export const TOOL_PREFIX = process.env.DEVDIGEST_MCP_TOOL_PREFIX ?? '';
