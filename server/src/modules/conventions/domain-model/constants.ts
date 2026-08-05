/**
 * conventions module — domain constants. No imports outside this ring: every
 * value here is a plain literal, never a Zod schema or a DB enum re-export,
 * so this file stays framework-free (see `.claude/skills/onion-architecture`).
 */

/** Mirrors the DB/contract enum — kept as a plain literal union here on purpose. */
export const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error_handling',
  'testing',
  'typing',
  'imports',
  'logging',
  'api_design',
  'other',
] as const;
export type ConventionCategoryValue = (typeof CONVENTION_CATEGORIES)[number];

/** How many rank-ordered source files `SamplePicker.rankedPaths` is asked for. */
export const SOURCE_SAMPLE_N = 12;

/** Hard cap on config files pulled into the prompt (one per family, see below). */
export const MAX_CONFIG_FILES = 5;

export const MAX_SOURCE_FILE_BYTES = 8_000;
export const MAX_CONFIG_FILE_BYTES = 4_000;
export const MAX_TOTAL_BYTES = 96_000; // ~24k tokens

export const TRUNCATION_MARKER = '… [truncated]';

/** A run older than this while still queued/running is treated as abandoned. */
export const STALE_RUN_MS = 10 * 60 * 1000;

/** Kept under JobRunner's 120s hard timeout so our own message wins the race. */
export const LLM_TIMEOUT_MS = 90_000;
export const LLM_MAX_TOKENS = 2500;
export const LLM_MAX_RETRIES = 1;

export const CONVENTIONS_JOB_KIND = 'conventions-extract';
export const CONVENTION_EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/** The reason recorded when a repo yields zero samples (unindexed, or the flag is off). */
export const NOT_INDEXED_ERROR = 'repo is not indexed yet';

export interface ConfigCandidatePath {
  family: string;
  path: string;
}

/**
 * Config files to probe DIRECTLY, never ranked: `repoIntel`'s file-rank walk
 * only indexes `.ts/.tsx/.js/.jsx/.mjs/.cjs` (`repo-intel/constants.ts`) and
 * separately filters out anything matching `eslint`/`prettier`/`.config.`
 * (`repo-intel/service.ts` `JUNK_PATH_PATTERNS`), so a config file can never
 * appear in the ranked source list — it has to be fetched by exact path.
 *
 * Ordered by family so the caller can take the FIRST HIT per family (never
 * burning multiple slots on e.g. six eslint config variants); capped at
 * `MAX_CONFIG_FILES` families.
 */
export const CONFIG_CANDIDATES: ConfigCandidatePath[] = [
  { family: 'package', path: 'package.json' },
  { family: 'ts', path: 'tsconfig.json' },
  { family: 'ts', path: 'jsconfig.json' },
  { family: 'eslint', path: '.eslintrc.json' },
  { family: 'eslint', path: '.eslintrc.js' },
  { family: 'eslint', path: '.eslintrc.cjs' },
  { family: 'eslint', path: 'eslint.config.js' },
  { family: 'eslint', path: 'eslint.config.mjs' },
  { family: 'prettier', path: '.prettierrc' },
  { family: 'prettier', path: '.prettierrc.json' },
  { family: 'prettier', path: 'prettier.config.js' },
  { family: 'editor', path: '.editorconfig' },
];

/** Keys kept from `package.json` — trims dependency-list noise to what states intent. */
export const PACKAGE_JSON_KEYS = [
  'name',
  'type',
  'packageManager',
  'engines',
  'scripts',
  'dependencies',
  'devDependencies',
] as const;
