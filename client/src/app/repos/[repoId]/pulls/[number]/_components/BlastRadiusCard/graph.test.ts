/**
 * `buildBlastGraph`.
 *
 * Escaping is the entire risk here. `MermaidDiagram` validates with
 * `mermaid.parse({ suppressErrors: true })` and renders NOTHING when the source
 * is malformed — so a bad node id or an unescaped quote does not throw, it just
 * makes the Graph tab silently blank. These tests are the only thing standing
 * between that and production.
 */

import { describe, it, expect } from "vitest";
import type { DownstreamImpact } from "@devdigest/shared";
import { buildBlastGraph } from "./graph";

function impact(over: Partial<DownstreamImpact> = {}): DownstreamImpact {
  return {
    symbol: "rateLimit",
    callers: [{ name: "registerPublicRoutes", file: "src/api/public/index.ts", line: 23 }],
    endpoints_affected: ["GET /api/public/items"],
    crons_affected: [],
    caller_count: 1,
    truncated: false,
    ...over,
  };
}

describe("buildBlastGraph", () => {
  it("emits a left-to-right flowchart of symbol → file → endpoint", () => {
    const chart = buildBlastGraph([impact()]);

    expect(chart.startsWith("flowchart LR")).toBe(true);
    expect(chart).toContain('"rateLimit()"');
    expect(chart).toContain('"index.ts"');
    expect(chart).toContain('"GET /api/public/items"');
    // Two hops: symbol → file, file → endpoint.
    expect(chart.match(/-->/g)).toHaveLength(2);
  });

  it("never derives a node id from text — ids are generated and id-safe", () => {
    const chart = buildBlastGraph([impact()]);

    for (const line of chart.split("\n").slice(1)) {
      const id = line.trim().split(/[[("\s]/)[0];
      if (id && id !== "") expect(id).toMatch(/^n\d+$/);
    }
  });

  it("escapes a quote in a label instead of ending it early", () => {
    const chart = buildBlastGraph([
      impact({ symbol: 'weird"name', endpoints_affected: [], crons_affected: [] }),
    ]);

    expect(chart).toContain("#quot;");
    // The raw quote must not survive inside the label text.
    expect(chart).not.toContain('weird"name');
  });

  it("neutralises a backtick, which would flip mermaid into markdown-string mode", () => {
    const chart = buildBlastGraph([
      impact({ symbol: "tpl`name", endpoints_affected: [], crons_affected: [] }),
    ]);

    expect(chart).not.toContain("`");
    expect(chart).toContain("tpl'name");
  });

  it("collapses a newline, which would end the statement mid-label", () => {
    const chart = buildBlastGraph([
      impact({ symbol: "two\nlines", endpoints_affected: [], crons_affected: [] }),
    ]);

    // Every line must still be a single well-formed statement.
    expect(chart).toContain('"two lines()"');
    for (const line of chart.split("\n").slice(1)) {
      expect(line.split('"').length % 2).toBe(1);
    }
  });

  it("caps endpoint leaves per file so one popular route file cannot swamp the SVG", () => {
    const chart = buildBlastGraph(
      [
        impact({
          endpoints_affected: Array.from({ length: 20 }, (_, i) => `GET /r${i}`),
          crons_affected: [],
        }),
      ],
      { maxLeavesPerFile: 3 },
    );

    // 1 symbol→file edge + 3 file→endpoint edges.
    expect(chart.match(/-->/g)).toHaveLength(4);
  });

  it("reuses one node for a file reached by two different symbols", () => {
    const chart = buildBlastGraph([
      impact({ symbol: "a", endpoints_affected: [], crons_affected: [] }),
      impact({ symbol: "b", endpoints_affected: [], crons_affected: [] }),
    ]);

    // One file node declaration, not two — otherwise the graph shows a shared
    // dependency as two unrelated leaves.
    expect(chart.match(/"index\.ts"/g)).toHaveLength(1);
    expect(chart.match(/-->/g)).toHaveLength(2);
  });

  it("returns an empty string when there is nothing to draw", () => {
    // A node-only chart would read as "we found nothing", which is exactly the
    // impression this feature must not give by accident. The caller renders the
    // explicit `graph.empty` copy instead.
    expect(buildBlastGraph([])).toBe("");
    expect(buildBlastGraph([impact({ callers: [] })])).toBe("");
  });

  it("caps the caller files per symbol so the diagram stays readable", () => {
    const many = impact({
      callers: Array.from({ length: 12 }, (_, i) => ({
        name: `c${i}`,
        file: `src/c${i}.ts`,
        line: i + 1,
      })),
      endpoints_affected: [],
      crons_affected: [],
    });

    const chart = buildBlastGraph([many], { maxCallersPerSymbol: 3 });
    expect(chart.match(/-->/g)).toHaveLength(3);
  });

  it("distinguishes crons from endpoints by node shape", () => {
    const chart = buildBlastGraph([
      impact({ endpoints_affected: ["GET /x"], crons_affected: ["nightly-sweep"] }),
    ]);

    expect(chart).toContain('(["GET /x"])');
    expect(chart).toContain('[/"nightly-sweep"/]');
  });

  describe("node links — same GitHub blob URLs the Tree view's PathLink builds", () => {
    it("emits no click lines without a repo full name and head sha", () => {
      const chart = buildBlastGraph([impact()], {
        declByName: new Map([["rateLimit", { file: "src/rate-limit.ts", line: 8 }]]),
      });

      expect(chart).not.toContain("click ");
    });

    it("links the symbol node to its declaration, and the caller-file node to its file", () => {
      const chart = buildBlastGraph([impact()], {
        declByName: new Map([["rateLimit", { file: "src/rate-limit.ts", line: 8 }]]),
        repoFullName: "acme/api",
        headSha: "sha1",
      });

      // `_blank` must stay a bare token — mermaid only binds it as the link's
      // target when unquoted (verified against the actual mermaid parser).
      expect(chart).toContain(
        'click n0 href "https://github.com/acme/api/blob/sha1/src/rate-limit.ts#L8" _blank',
      );
      expect(chart).toContain(
        'click n1 href "https://github.com/acme/api/blob/sha1/src/api/public/index.ts#L23" _blank',
      );
    });

    it("omits the declaration link when the symbol has no entry in declByName", () => {
      const chart = buildBlastGraph([impact()], {
        repoFullName: "acme/api",
        headSha: "sha1",
      });

      // Caller-file link still present; only the symbol's own click is skipped.
      expect(chart).not.toContain("n0 href");
      expect(chart).toContain(
        'click n1 href "https://github.com/acme/api/blob/sha1/src/api/public/index.ts#L23" _blank',
      );
    });

    it("percent-encodes a literal quote in a path so it cannot close the click string early", () => {
      const chart = buildBlastGraph(
        [impact({ callers: [{ name: "c", file: 'weird"file.ts', line: 1 }] })],
        { repoFullName: "acme/api", headSha: "sha1" },
      );

      const clickLine = chart.split("\n").find((line) => line.includes("click "));
      expect(clickLine).toBeDefined();
      // Exactly the opening and closing quote of the href string — a raw `"`
      // from the file name would add a third and split the statement.
      expect(clickLine!.match(/"/g)).toHaveLength(2);
      expect(clickLine).not.toContain('"file.ts');
    });
  });
});
