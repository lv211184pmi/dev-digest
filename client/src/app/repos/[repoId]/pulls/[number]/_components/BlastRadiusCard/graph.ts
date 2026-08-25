import type { DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

/**
 * Builds the mermaid source for the Graph view: changed symbol → caller file →
 * endpoint/cron.
 *
 * Pure and separate from the component because the escaping below is the whole
 * risk of this view, and escaping is far easier to test as a string function
 * than through a rendered diagram. `MermaidDiagram` validates with
 * `mermaid.parse({ suppressErrors: true })` and renders nothing on junk, so a
 * bug here fails silently — which is exactly why it gets its own tests.
 *
 * TWO ESCAPING RULES, both load-bearing:
 *  - **Node ids** must be `[A-Za-z0-9_]`. Real inputs are file paths and
 *    endpoint strings carrying `/`, `.`, `:`, `-` and spaces, every one of
 *    which either breaks the parse or silently changes the shape. So ids are
 *    generated (`n0`, `n1`, …) and never derived from the text.
 *  - **Labels** are quoted, and any `"` inside becomes `#quot;` — mermaid's own
 *    entity escape. A raw quote closes the label early and swallows the rest of
 *    the line.
 *
 * Symbol and caller-file nodes also carry a `click ... href` line — the graph's
 * equivalent of the Tree view's `PathLink` — quoted and escaped the same way.
 */

/**
 * Makes arbitrary repo text safe inside a quoted mermaid label.
 *
 * Three separate hazards, all of which produce a BLANK diagram rather than an
 * error, because `MermaidDiagram` parses with `suppressErrors: true`:
 *  - `"` closes the label early and swallows the rest of the line.
 *  - a newline ends the statement mid-label.
 *  - a backtick opens mermaid's markdown-string mode, which changes how the
 *    rest of the label is parsed.
 */
function label(text: string): string {
  return text
    .replace(/"/g, "#quot;")
    .replace(/`/g, "'")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/**
 * Makes a GitHub blob URL safe inside a quoted mermaid `click ... href` string.
 * `githubBlobUrl` percent-encodes path segments, so a raw `"` should never
 * occur — this is defense in depth, mirroring `label`'s escaping above.
 */
function hrefLabel(url: string): string {
  return url.replace(/"/g, "%22");
}

/** Last path segment, so a deep path does not dominate the diagram's width. */
function shortPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.length > 0 ? base : path;
}

export interface BlastGraphOptions {
  /** Caller files per symbol. Beyond this the diagram stops being readable. */
  maxCallersPerSymbol?: number;
  /** Endpoint/cron leaves per caller file, for the same reason. */
  maxLeavesPerFile?: number;
  /** Declaration `file`/`line` per changed symbol, for the symbol node's link. */
  declByName?: Map<string, { file: string; line: number }>;
  /** `owner/name`, for sha-pinned GitHub links — same source the Tree view's
   *  `PathLink` uses. Without both, graph nodes render unlinked. */
  repoFullName?: string | null;
  headSha?: string | null;
}

/**
 * Returns mermaid source, or `""` when there is nothing worth drawing.
 *
 * An empty string is the signal to render the `graph.empty` copy instead — a
 * flowchart with nodes but no edges reads as "we found nothing", which is the
 * one impression this whole feature exists to avoid giving by accident.
 */
export function buildBlastGraph(
  downstream: DownstreamImpact[],
  options: BlastGraphOptions = {},
): string {
  const maxCallers = options.maxCallersPerSymbol ?? 4;
  // Endpoints fan out per caller FILE, so an unbounded leaf count is what
  // actually makes the SVG unreadable — a single popular route file can carry a
  // dozen. The tree view is the exhaustive one; the graph is for shape.
  const maxLeaves = options.maxLeavesPerFile ?? 6;
  const { declByName, repoFullName, headSha } = options;
  // No repo/sha means no honest link, same rule `PathLink` follows in the Tree
  // view — a URL guessed against the wrong ref is worse than an unlinked node.
  const canLink = Boolean(repoFullName && headSha);

  const lines: string[] = ["flowchart LR"];
  const ids = new Map<string, string>();
  let next = 0;

  /** One id per distinct label, so a file called by two symbols is one node. */
  const idFor = (key: string): string => {
    const existing = ids.get(key);
    if (existing) return existing;
    const id = `n${next++}`;
    ids.set(key, id);
    return id;
  };

  /** `click <id> href "<url>" _blank` — same GitHub blob URL the Tree view's
   *  `PathLink` builds. `_blank` must stay unquoted: mermaid only reads it as
   *  the anchor's `target` when bare, and silently drops it as a no-op tooltip
   *  when quoted. */
  const pushClick = (id: string, file: string, line?: number) => {
    if (!canLink) return;
    const url = githubBlobUrl(repoFullName as string, headSha as string, file, line);
    lines.push(`  click ${id} href "${hrefLabel(url)}" _blank`);
  };

  let edges = 0;

  for (const impact of downstream) {
    const callerFiles = [...new Set(impact.callers.map((c) => c.file))];
    if (callerFiles.length === 0) continue;

    const symId = idFor(`sym:${impact.symbol}`);
    lines.push(`  ${symId}["${label(impact.symbol)}()"]`);
    const decl = declByName?.get(impact.symbol);
    if (decl) pushClick(symId, decl.file, decl.line > 0 ? decl.line : undefined);

    for (const file of callerFiles.slice(0, maxCallers)) {
      const fileId = idFor(`file:${file}`);
      lines.push(`  ${fileId}["${label(shortPath(file))}"]`);
      lines.push(`  ${symId} --> ${fileId}`);
      edges++;
      // First caller's line for this file wins — the graph collapses callers
      // to one node per file, so there is no single "right" line to pick.
      const firstCaller = impact.callers.find((c) => c.file === file);
      pushClick(fileId, file, firstCaller && firstCaller.line > 0 ? firstCaller.line : undefined);

      for (const endpoint of impact.endpoints_affected.slice(0, maxLeaves)) {
        const epId = idFor(`ep:${endpoint}`);
        lines.push(`  ${epId}(["${label(endpoint)}"])`);
        lines.push(`  ${fileId} --> ${epId}`);
        edges++;
      }
      for (const cron of impact.crons_affected.slice(0, maxLeaves)) {
        const cronId = idFor(`cron:${cron}`);
        lines.push(`  ${cronId}[/"${label(cron)}"/]`);
        lines.push(`  ${fileId} --> ${cronId}`);
        edges++;
      }
    }
  }

  return edges === 0 ? "" : [...new Set(lines)].join("\n");
}
