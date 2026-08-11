import type { SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_BASENAMES,
  BOILERPLATE_DIRS,
  BOILERPLATE_EXTS,
  BOILERPLATE_RES,
  ENTRYPOINT_BASENAMES,
  TEST_DIRS,
  TEST_RE,
  WIRING_BASENAMES,
  WIRING_DIRS,
  WIRING_EXTS,
  WIRING_RES,
} from './constants.js';

/**
 * Pure domain code — no `db/schema`, no `db/rows.js`, no `fastify`, no
 * `drizzle-orm`, no `this`. Path classification is a function of the path
 * alone; findings never feed it (see plan "Classification rules").
 */

/**
 * Normalize a raw path for matching: backslashes to forward slashes, strip a
 * leading `./` and a git `a/`/`b/` prefix. Case is left intact here —
 * `classifyPath` lowercases separately for matching only, while Smart Diff's
 * finding-path join (build.ts) stays case-sensitive on this normalized form.
 */
export function normalizePath(raw: string): string {
  let p = raw.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  if (/^[ab]\//.test(p)) p = p.slice(2);
  return p;
}

function basenameAndExt(path: string): { basename: string; ext: string } {
  const segments = path.split('/');
  const basename = segments[segments.length - 1] ?? '';
  const dot = basename.lastIndexOf('.');
  // A leading-dot-only basename (e.g. `.gitignore`) has no extension.
  const ext = dot > 0 ? basename.slice(dot + 1) : '';
  return { basename, ext };
}

/**
 * Classify a single path into a Smart Diff role. First-match-wins, evaluated
 * top to bottom against the ladder in the plan. Matching is case-insensitive
 * and uses `Set` lookups on the basename and on directory SEGMENTS — never a
 * substring test, so `src/distribution/rates.ts` does not hit the `dist`
 * rule — plus a handful of anchored regexes on the basename.
 */
export function classifyPath(raw: string): SmartDiffRole {
  const normalized = normalizePath(raw).toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const { basename, ext } = basenameAndExt(normalized);

  // Rule 1 — boilerplate: generated/vendored directories. Above rule 9 so a
  // vendored `index.ts` classifies as boilerplate, not an entrypoint.
  if (segments.some((s) => BOILERPLATE_DIRS.has(s))) return 'boilerplate';

  // Rule 2 — boilerplate: known lockfile basenames.
  if (BOILERPLATE_BASENAMES.has(basename)) return 'boilerplate';

  // Rule 3 — boilerplate: mechanical/generated basename patterns.
  if (BOILERPLATE_RES.some((re) => re.test(basename))) return 'boilerplate';

  // Rule 4 — boilerplate: docs/asset extensions.
  if (BOILERPLATE_EXTS.has(ext)) return 'boilerplate';

  // Rule 5 — wiring: config basenames + patterns.
  if (WIRING_BASENAMES.has(basename)) return 'wiring';
  if (WIRING_RES.some((re) => re.test(basename))) return 'wiring';

  // Rule 6 — wiring: CI/deploy directories.
  if (segments.some((s) => WIRING_DIRS.has(s))) return 'wiring';

  // Rule 7 — wiring: data/config file extensions.
  if (WIRING_EXTS.has(ext)) return 'wiring';

  // Rule 8 — wiring: tests (a first-class review signal, not boilerplate).
  if (TEST_RE.test(basename)) return 'wiring';
  if (segments.some((s) => TEST_DIRS.has(s))) return 'wiring';

  // Rule 9 — wiring: entrypoints/barrels.
  if (ENTRYPOINT_BASENAMES.has(basename)) return 'wiring';

  // Rule 10 — default: core. Misfiling a lockfile as core costs one collapsed
  // group; misfiling real logic as boilerplate hides a bug. Fail toward
  // visibility.
  return 'core';
}
