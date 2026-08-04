/* skill-import.ts — client-side markdown parsing for the "paste/upload a
   plain .md" import path (no server round-trip needed — mirrors the server's
   extractFromMarkdown in server/src/modules/skills/import.ts; only .zip
   archives need the server since only it can safely unzip + strip
   executables). */

/** Derive a skill name from the first `#` heading; fall back to the filename. */
export function deriveSkillName(body: string, filename?: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  if (filename) return filename.replace(/\.[^./]+$/, "");
  return "Untitled skill";
}

/** ~Token count for display only (chars/4 heuristic — no client-side tokenizer). */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.round(text.length / 4));
}
