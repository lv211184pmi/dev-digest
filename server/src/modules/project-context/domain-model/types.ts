/**
 * Internal shapes for the project-context module — NOT contract types (those
 * live in `@devdigest/shared`'s `contracts/project-context.ts`). Nothing here
 * imports Fastify, Drizzle or `node:fs`; this ring holds plain data only.
 */

/** One raw match from a clone walk, before it becomes a `ProjectContextDoc`. */
export interface DiscoveredFileEntry {
  /** Repo-relative, posix-separated. */
  path: string;
  bytes: number;
  modifiedAt: Date;
}
