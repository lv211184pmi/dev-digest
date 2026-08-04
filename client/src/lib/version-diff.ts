import { createTwoFilesPatch } from "diff";
import type { PrFile } from "@/lib/types";

/**
 * Build a fake `PrFile` from two skill-body snapshots so the Versions tab can
 * reuse the existing `DiffViewer`/`FileCard` (built for real GitHub PR
 * patches) instead of a bespoke diff renderer. `createTwoFilesPatch` emits a
 * unified-diff header (`Index:`/`===`/`---`/`+++`) that `parsePatch` doesn't
 * expect — GitHub's own `PrFile.patch` starts at the first `@@` hunk — so we
 * strip everything before it.
 */
export function versionDiffToPrFile(name: string, oldBody: string, newBody: string): PrFile {
  const full = createTwoFilesPatch(name, name, oldBody, newBody, `v(old)`, `v(new)`);
  const hunkStart = full.indexOf("@@");
  const patch = hunkStart >= 0 ? full.slice(hunkStart) : "";
  const additions = (patch.match(/^\+(?!\+\+)/gm) ?? []).length;
  const deletions = (patch.match(/^-(?!--)/gm) ?? []).length;
  return { path: name, additions, deletions, patch: patch || null };
}
