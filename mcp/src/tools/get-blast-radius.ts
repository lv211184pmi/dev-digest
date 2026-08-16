/**
 * `get_blast_radius` — what a pull request can impact, read from the code index.
 *
 * Single hop: `GET /pulls/:id/blast`. Deliberately the GET and never the POST —
 * the POST re-derives the LLM sentence and spends money, which a tool annotated
 * `readOnlyHint: true` must never do. The GET answers 200 with `summary: null`
 * when no sentence was ever derived, so the deterministic map still ships.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE. An empty map and an unknown map are
 * different answers, and only one of them is safe to report. A model that reads
 * `changed_symbols: []` concludes "nothing is affected, merge it"; if the real
 * reason was an unindexed repo, that conclusion is both wrong and expensive. So
 * `index.state === 'unavailable'` is raised as a `ToolError` carrying the
 * server's own explanation, never returned as a success with empty arrays. A
 * `partial` index is NOT routed there — a partial answer is still an answer, and
 * it travels with `index.explanation` plus `files_not_covered` so the caller can
 * see the shape of the hole.
 *
 * PROJECTION. The wire record is `PrBlastRecord`; we return a projection of it,
 * the same way `get_findings` returns 8 of `FindingRecord`'s 17 fields. Dropped:
 * `pr_id`, `head_sha`, `provider`, `model`, `cost_usd`, `tokens_in`,
 * `tokens_out`, `derived_at`, `is_stale` — LLM provenance and UI state, none of
 * which a calling model can act on. Kept and RESHAPED: the server sends
 * `changed_symbols` and `downstream` as two parallel arrays joined by symbol
 * name, which costs the model a join it will sometimes get wrong; here they are
 * pre-joined into one `changed_symbols` list.
 */

import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { PrBlastRecord } from '@devdigest/shared';
import type { CallOptions, Endpoints } from '../api/endpoints.js';
import { BLAST_CALLERS_MAX, BLAST_SYMBOLS_MAX, TOOL_PREFIX } from '../config.js';
import { toErrorResult, toolError } from '../domain/errors.js';
import { resolvePr, resolveRepo } from '../domain/resolve.js';
import { GET_BLAST_RADIUS_DESCRIPTION, GET_BLAST_RADIUS_TITLE } from './descriptions.js';
import { BlastRadiusOutput, GetBlastRadiusInput } from './schemas.js';

/**
 * Joins `downstream` onto `changed_symbols` by symbol name.
 *
 * Symbols with no downstream entry are KEPT, with empty caller/endpoint lists —
 * "this symbol changed and nothing visible calls it" is a real, useful finding,
 * and dropping it would silently shorten the map. The `index` block is what
 * distinguishes that from "we could not see its callers", which is exactly why
 * this projection never has to guess.
 */
function projectBlast(record: PrBlastRecord, repo: string, pr: number): BlastRadiusOutput {
  const byName = new Map(record.downstream.map((d) => [d.symbol, d]));

  const symbols = record.changed_symbols.slice(0, BLAST_SYMBOLS_MAX).map((sym) => {
    const impact = byName.get(sym.name);
    return {
      symbol: sym.name,
      kind: sym.kind,
      file: sym.file,
      line: sym.line,
      callers: (impact?.callers ?? []).slice(0, BLAST_CALLERS_MAX),
      // `caller_count` is the pre-cap total the server computed. Falling back to
      // the returned length (not 0) keeps the invariant `caller_count >=
      // callers.length` true even against an older API that omits the field.
      caller_count: impact?.caller_count ?? impact?.callers.length ?? 0,
      // True if the SERVER truncated, or if we just did — either way the listed
      // callers are not the whole story and the caller must be told.
      truncated:
        (impact?.truncated ?? false) || (impact?.callers.length ?? 0) > BLAST_CALLERS_MAX,
      endpoints_affected: impact?.endpoints_affected ?? [],
      crons_affected: impact?.crons_affected ?? [],
    };
  });

  return {
    repo,
    pr,
    summary: record.summary,
    index: {
      state: record.index.state,
      explanation: record.index.explanation,
      files_not_covered: record.index.files_not_covered,
    },
    totals: record.totals,
    changed_symbols: symbols,
    truncated: record.changed_symbols.length > BLAST_SYMBOLS_MAX,
  };
}

/**
 * One line for the model to read at a glance; the map goes in structured content.
 *
 * Coverage is stated FIRST on a non-full index. The digest is the part a model
 * is most likely to act on without reading further, so burying "partial" behind
 * the counts would defeat the whole point of computing it.
 */
function digest(result: BlastRadiusOutput): string {
  const t = result.totals;
  const counts =
    `${t.symbols} changed symbol${t.symbols === 1 ? '' : 's'} · ` +
    `${t.callers} caller${t.callers === 1 ? '' : 's'} · ` +
    `${t.endpoints} endpoint${t.endpoints === 1 ? '' : 's'} · ` +
    `${t.crons} cron/job${t.crons === 1 ? '' : 's'}`;

  const head =
    result.index.state === 'full'
      ? `${result.repo}#${result.pr}: ${counts}`
      : `${result.repo}#${result.pr} — PARTIAL index coverage, this map is incomplete: ${counts}`;

  const parts = [head];
  if (result.summary) parts.push(result.summary);
  if (result.index.state !== 'full' && result.index.explanation) {
    parts.push(result.index.explanation);
  }
  if (result.truncated) parts.push(`Symbol list truncated to ${BLAST_SYMBOLS_MAX}.`);
  return parts.join(' ');
}

/** Resolve → fetch → gate on coverage → project. Throws `ToolError`; the handler converts. */
async function collectBlastRadius(
  endpoints: Endpoints,
  repoArg: string,
  prNumber: number,
  opts: CallOptions,
): Promise<BlastRadiusOutput> {
  const repo = await resolveRepo(endpoints, repoArg, opts);
  const pr = await resolvePr(endpoints, repo, prNumber, opts);
  const record = await endpoints.getBlastRadius(pr.id, opts);

  // The gate. See this file's header: an unusable index must not be reported as
  // an empty map. Two distinct causes, two next steps — an unimported file list
  // is not a broken index, and telling the caller to re-analyse the repo would
  // send them to rebuild something that is working.
  if (record.index.state === 'unavailable') {
    if (record.index.reason === 'no_changed_files') {
      throw toolError('blast_no_changed_files', repo.fullName, prNumber);
    }
    throw toolError(
      'blast_index_unavailable',
      repo.fullName,
      prNumber,
      // The server already composed the human explanation, so pass it through
      // rather than inventing a second, thinner one here.
      record.index.explanation,
    );
  }

  return projectBlast(record, repo.fullName, prNumber);
}

/**
 * Registers the tool on `server`. `deps` is an object rather than a bare
 * `Endpoints` so all five registrars are wired identically by `server.ts`.
 */
export function registerGetBlastRadius(server: McpServer, deps: { endpoints: Endpoints }): void {
  server.registerTool(
    `${TOOL_PREFIX}get_blast_radius`,
    {
      title: GET_BLAST_RADIUS_TITLE,
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: GetBlastRadiusInput,
      outputSchema: BlastRadiusOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        // The DevDigest API is a separate process with its own index state —
        // this tool reads the world, it does not compute over its arguments.
        openWorldHint: true,
      },
    },
    async (args, ctx): Promise<CallToolResult> => {
      try {
        const result = await collectBlastRadius(deps.endpoints, args.repo, args.pr, {
          signal: ctx.mcpReq.signal,
        });
        return {
          content: [{ type: 'text', text: digest(result) }],
          structuredContent: result,
        };
      } catch (e) {
        // The spread is load-bearing: `ToolErrorResult` is an interface, and
        // TypeScript gives implicit index signatures only to anonymous object
        // types, so the interface is not assignable to the SDK's
        // `CallToolResult` (`[x: string]: unknown`). A fresh literal is.
        return { ...toErrorResult(e) };
      }
    },
  );
}
