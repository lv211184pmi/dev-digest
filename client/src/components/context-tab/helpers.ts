/* helpers.ts — pure logic for ContextTab, kept out of the component so the
   corner cases (empty set, all-attached, all-filtered-out, stale attached
   path, first/last drag index) are testable without rendering. There is no
   staged set to diff against any more (D25 supersedes D9's staged/Save
   model) — the merged list renders the persisted `attached` set directly. */
import type { ProjectContextDoc } from "@devdigest/shared";

/**
 * Move the item at `from` to `to`, splice-based, matching the precedent in
 * `AgentEditor/_components/SkillsTab/SkillsTab.tsx`. Out-of-range indices
 * (including the empty-list and single-item cases) are a no-op — dragging
 * never throws and never drops an item.
 */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return list.slice();
  }
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list.slice();
  next.splice(to, 0, moved);
  return next;
}

/** The running ≈token total of the attached set (R7), from each discovered
    document's own `tokens` count. An attached path with no matching
    discovered document (stale attachment) contributes 0 rather than
    throwing. */
export function attachedTokens(docs: ProjectContextDoc[], attached: string[]): number {
  const byPath = new Map(docs.map((d) => [d.path, d.tokens]));
  return attached.reduce((sum, path) => sum + (byPath.get(path) ?? 0), 0);
}

/**
 * Split a repo-relative path into its filename and containing directory
 * (R6): the filename is everything after the last `/`; `dir` is the rest
 * *including* its trailing `/`, or `''` for a path directly under a search
 * root (e.g. `specs.md` at the repo root → `{ dir: "", file: "specs.md" }`;
 * `specs/api.md` → `{ dir: "specs/", file: "api.md" }`).
 */
export function splitPath(path: string): { dir: string; file: string } {
  const i = path.lastIndexOf("/");
  if (i === -1) return { dir: "", file: path };
  return { dir: path.slice(0, i + 1), file: path.slice(i + 1) };
}

/** One row of the merged Context tab list — either a discovered document
    (`doc` set) or an attached path whose document is no longer discovered
    (`doc: null`, the C2/R14-boundary case: still visible and detachable, per
    v1's own remediation comment `ContextTab.tsx:74-87`, carried forward). */
export interface Row {
  path: string;
  doc: ProjectContextDoc | null;
  attached: boolean;
}

/**
 * Merge discovered documents and the attached path set into one list (R14):
 * attached paths first, in `attached`'s own order (the injection order),
 * then every unattached discovered document in path order. An attached path
 * with no matching discovered document still produces a row — it stays
 * visible and detachable rather than disappearing along with its checkbox.
 */
export function mergeRows(docs: ProjectContextDoc[], attached: string[]): Row[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const attachedSet = new Set(attached);

  const attachedRows: Row[] = attached.map((path) => ({
    path,
    doc: byPath.get(path) ?? null,
    attached: true,
  }));

  const unattachedRows: Row[] = docs
    .filter((d) => !attachedSet.has(d.path))
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((doc) => ({ path: doc.path, doc, attached: false }));

  return [...attachedRows, ...unattachedRows];
}

/** Case-insensitive substring match over `row.path` (R11). An empty or
    whitespace-only query returns the input unchanged — filtering never
    changes the attachment set (R12), only what's rendered. */
export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.path.toLowerCase().includes(q));
}
