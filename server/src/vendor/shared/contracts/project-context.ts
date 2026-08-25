import { z } from 'zod';

/**
 * Project Context — repo-scoped `.md` documents an agent or skill can attach
 * so their text is injected into the prompt under `## Project context`.
 *
 * `ProjectContextDocType` derivation: WHEN a repo-relative path matches more
 * than one root (e.g. `docs/specs/api.md`), THE SYSTEM derives its type from
 * the LEFT-MOST matching path segment (`docs/specs/api.md` -> `docs`).
 *
 * `ProjectContextInjected` is persisted on `RunTrace.project_context` and
 * written to the run log — NEITHER may ever carry document text, only
 * path/type/tokens/status metadata. Same rule as `PromptSectionMeta`
 * (reviewer-core/src/prompt.ts:110-118).
 */

export const ProjectContextDocType = z.enum(['specs', 'docs', 'insights']);
export type ProjectContextDocType = z.infer<typeof ProjectContextDocType>;

/** One discovered `.md` document under a configured search root. */
export const ProjectContextDoc = z.object({
  path: z.string().min(1),
  type: ProjectContextDocType,
  bytes: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  modified_at: z.string(),
});
export type ProjectContextDoc = z.infer<typeof ProjectContextDoc>;

/** Result of listing discoverable documents for a repo. */
export const ProjectContextListing = z.object({
  repo_id: z.string(),
  docs: z.array(ProjectContextDoc),
  truncated: z.boolean(),
  discovered_at: z.string(),
  roots: z.array(z.string()),
});
export type ProjectContextListing = z.infer<typeof ProjectContextListing>;

/** A document an agent or skill has attached, in injection order. */
export const ProjectContextAttachment = z.object({
  path: z.string().min(1),
  order: z.number().int().nonnegative(),
});
export type ProjectContextAttachment = z.infer<typeof ProjectContextAttachment>;

export const ProjectContextStatus = z.enum([
  'included',
  'truncated',
  'skipped_budget',
  'skipped_missing',
  'skipped_empty',
  'skipped_other_repo',
]);
export type ProjectContextStatus = z.infer<typeof ProjectContextStatus>;

/**
 * A resolved document as recorded on the run trace. NEVER carries document
 * text — only enough metadata to render the trace row and the run log line.
 */
export const ProjectContextInjected = z.object({
  path: z.string().min(1),
  type: ProjectContextDocType,
  tokens: z.number().int().nonnegative(),
  status: ProjectContextStatus,
  inherited_from: z.string().nullable(),
});
export type ProjectContextInjected = z.infer<typeof ProjectContextInjected>;

/**
 * The body of `GET /repos/:id/project-context/doc` — the one type in this
 * family that carries a document's text. Permitted because this is a
 * response body read once per drawer open, never persisted to
 * `RunTrace.project_context` and never written to the run log — which is
 * what the `ProjectContextInjected` no-text rule above actually protects
 * (D15). `text` is deliberately not `.min(1)`: a 0-byte document previews as
 * empty content, not an error (R7).
 *
 * `bytes` and `tokens` describe the returned `text`, not the whole document
 * — so both shrink when `truncated` is `true`. Worked example: a 12,000-char
 * `specs/big.md` requested through this route returns `truncated: true`,
 * `text` of length `MAX_DOC_CHARS` (8,000), `bytes: 8000`, and `tokens`
 * counted over that same returned text — the drawer always renders the
 * response's own numbers, so the figure beside the truncation label
 * describes exactly what is on screen (R8, D16).
 */
export const ProjectContextDocContent = z.object({
  path: z.string().min(1),
  type: ProjectContextDocType,
  bytes: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  text: z.string(),
  truncated: z.boolean(),
});
export type ProjectContextDocContent = z.infer<typeof ProjectContextDocContent>;
