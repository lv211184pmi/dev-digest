/* PR3 remediation: mergeRows' stale-attachment-path branch (an attached path
   with no matching discovered document — the C2/R14-boundary case) and
   attachedTokens' matching fallback had zero test coverage anywhere,
   despite both being named, non-obvious, intentionally-preserved behaviors
   documented in helpers.ts's own comments. */
import { describe, it, expect } from "vitest";
import type { ProjectContextDoc } from "@devdigest/shared";
import { mergeRows, attachedTokens } from "./helpers";

const DOCS: ProjectContextDoc[] = [
  { path: "docs/a.md", type: "docs", bytes: 100, tokens: 25, modified_at: "2026-08-25T00:00:00Z" },
  { path: "specs/b.md", type: "specs", bytes: 200, tokens: 50, modified_at: "2026-08-25T00:00:00Z" },
];

describe("mergeRows", () => {
  it("keeps a stale attached path visible and detachable, with no matching document", () => {
    const rows = mergeRows(DOCS, ["docs/deleted.md"]);
    const stale = rows.find((r) => r.path === "docs/deleted.md");
    expect(stale).toEqual({ path: "docs/deleted.md", doc: null, attached: true });
    // Still positioned in the attached group, ahead of every unattached row.
    expect(rows[0]).toBe(stale);
  });

  it("places a stale attachment among real ones in the attached order given, not sorted", () => {
    const rows = mergeRows(DOCS, ["docs/a.md", "docs/deleted.md"]);
    expect(rows.map((r) => r.path)).toEqual(["docs/a.md", "docs/deleted.md", "specs/b.md"]);
    expect(rows[1]).toEqual({ path: "docs/deleted.md", doc: null, attached: true });
  });

  it("handles the empty-docs and nothing-attached cases without throwing", () => {
    expect(mergeRows([], [])).toEqual([]);
    expect(mergeRows(DOCS, [])).toHaveLength(DOCS.length);
    expect(mergeRows([], ["docs/deleted.md"])).toEqual([
      { path: "docs/deleted.md", doc: null, attached: true },
    ]);
  });
});

describe("attachedTokens", () => {
  it("contributes 0 for a stale attached path rather than throwing or producing NaN", () => {
    expect(attachedTokens(DOCS, ["docs/deleted.md"])).toBe(0);
  });

  it("sums real documents and treats a stale path among them as 0", () => {
    expect(attachedTokens(DOCS, ["docs/a.md", "docs/deleted.md", "specs/b.md"])).toBe(75);
  });

  it("returns 0 for an empty attached set", () => {
    expect(attachedTokens(DOCS, [])).toBe(0);
  });
});
