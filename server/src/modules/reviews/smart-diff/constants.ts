import type { Severity, SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff classification constants. Path-only, first-match-wins ladder —
 * see the "Classification rules" table in the Smart Diff plan. Every
 * collection is a module-level `Set`/`RegExp` built once at import, not per
 * call: 500 files × ~17 trivial checks is sub-millisecond either way, but
 * there is no reason to rebuild the same Set on every request.
 */

// ---- Rule 1: boilerplate — generated/vendored directories ------------------
// Matched as a bare directory SEGMENT (never substring), so `src/distribution/`
// does not collide with `dist`, and `migrations` holds for any cloned repo's
// layout, not just `src/db/migrations/`.
export const BOILERPLATE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '__snapshots__',
  'vendor',
  'generated',
  '__generated__',
  'migrations',
  '.turbo',
]);

// ---- Rule 2: boilerplate — lockfile basenames -------------------------------
// Exact, well-known lockfile names across the package managers this repo (and
// any cloned repo) is likely to use.
export const BOILERPLATE_BASENAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
  'gemfile.lock',
]);

// ---- Rule 3: boilerplate — mechanical/generated basename patterns ----------
// Snapshots, generated output, type-declaration files, minified/sourcemap
// artifacts: none of these carry hand-written logic worth a reviewer's time.
export const BOILERPLATE_RES: RegExp[] = [
  /\.lock$/,
  /\.snap$/,
  /\.generated\./,
  /\.d\.ts$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];

// ---- Rule 4: boilerplate — docs/asset extensions ---------------------------
// Docs land here deliberately (see plan Decisions): the enum has exactly
// three values, a fourth role is out of scope, and "skim" fits docs fine.
export const BOILERPLATE_EXTS = new Set([
  'md',
  'mdx',
  'txt',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'csv',
]);

// ---- Rule 5: wiring — config basenames + patterns --------------------------
// Build/runtime config files: no business logic, but a misconfiguration here
// breaks the build or the environment, so it outranks boilerplate.
export const WIRING_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'procfile',
  '.dockerignore',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.editorconfig',
]);
export const WIRING_RES: RegExp[] = [
  /^\.env/,
  /\.config\.[a-z]+$/,
  /^tsconfig(\..+)?\.json$/,
  /^\.(eslintrc|prettierrc)/,
];

// ---- Rule 6: wiring — CI/deploy directories --------------------------------
export const WIRING_DIRS = new Set([
  '.github',
  '.circleci',
  '.gitlab',
  'ci',
  'deploy',
  'k8s',
  'helm',
  'charts',
  'infra',
  'terraform',
]);

// ---- Rule 7: wiring — data/config file extensions --------------------------
export const WIRING_EXTS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'tf', 'sql']);

// ---- Rule 8: wiring — tests -------------------------------------------------
// A first-class review signal ("the PR deleted the assertion") — a
// default-collapsed boilerplate group would hide that. Not core: it isn't the
// logic whose correctness is at stake.
export const TEST_RE = /\.(test|spec)\.[a-z]+$/;
export const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'e2e', 'spec', 'fixtures', '__mocks__']);

// ---- Rule 9: wiring — entrypoints/barrels ----------------------------------
// Deliberately NOT here: `schema.ts`, `constants.ts`, `page.tsx` — all hold
// real logic in this repo. This rule sits below rule 1, so a vendored
// `index.ts` (e.g. `client/src/vendor/ui/index.ts`) is boilerplate, not wiring.
export const ENTRYPOINT_BASENAMES = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'routes.ts',
  'routes.tsx',
  'app.ts',
  'app.tsx',
  'server.ts',
  'main.ts',
  'main.tsx',
  'layout.tsx',
  'providers.tsx',
]);

// ---- Sort / grouping ---------------------------------------------------------

/** Fixed group order — empty groups are omitted by the builder, never reordered. */
export const SMART_DIFF_ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** Ascending = worse. `none` (no findings) always sorts last; see build.ts. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** core+wiring changed lines above this are "too big to review in one pass". */
export const SMART_DIFF_TOO_BIG_LINES = 400;

/** `proposed_splits` is only useful once there is something to split between. */
export const SMART_DIFF_MIN_SPLIT_GROUPS = 2;

/**
 * Top-level path segments that are containers, not the split boundary
 * themselves — a bucket is named by the segment AFTER one of these when
 * present (e.g. `src/billing/x.ts` buckets as `billing`, not `src`).
 */
export const SPLIT_PASSTHROUGH_SEGMENTS = new Set(['src', 'app', 'lib', 'packages', 'apps']);
