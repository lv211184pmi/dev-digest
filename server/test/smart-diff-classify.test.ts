import { describe, it, expect } from 'vitest';
import { classifyPath, normalizePath } from '../src/modules/reviews/smart-diff/classify.js';
import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Table-driven coverage of the Smart Diff classification ladder (see plan
 * "Classification rules"). `classifyPath` is a pure function of the path
 * alone, so this is a plain unit test — no DB, no fixtures.
 */
const CASES: [string, SmartDiffRole][] = [
  // lockfiles at root and nested (rule 2)
  ['pnpm-lock.yaml', 'boilerplate'],
  ['packages/app/pnpm-lock.yaml', 'boilerplate'],
  // generated/vendored directories (rule 1)
  ['client/dist/main.js', 'boilerplate'],
  ['.next/static/a.js', 'boilerplate'],
  ['src/db/migrations/0001.sql', 'boilerplate'],
  // mechanical/generated basename patterns (rule 3)
  ['src/__snapshots__/Component.tsx.snap', 'boilerplate'],
  ['src/api.generated.ts', 'boilerplate'],
  ['src/types.d.ts', 'boilerplate'],
  // rule 1 beats rule 9: a vendored index.ts is boilerplate, not an entrypoint
  ['client/src/vendor/ui/index.ts', 'boilerplate'],
  // docs/asset extensions (rule 4)
  ['README.md', 'boilerplate'],
  // wiring: config basenames/patterns (rule 5)
  ['Dockerfile', 'wiring'],
  ['vitest.config.ts', 'wiring'],
  ['.env.example', 'wiring'],
  // wiring: CI/deploy directories (rule 6)
  ['.github/workflows/ci.yml', 'wiring'],
  // wiring: data/config extensions (rule 7)
  ['package.json', 'wiring'],
  // wiring: tests (rule 8)
  ['server/test/a.test.ts', 'wiring'],
  ['e2e/login.spec.ts', 'wiring'],
  // wiring: entrypoints/barrels (rule 9)
  ['server/src/app.ts', 'wiring'],
  // default fallback: core (rule 10) — schema/constants/service files hold
  // real logic and must not be misfiled as wiring or boilerplate
  ['server/src/modules/reviews/service.ts', 'core'],
  // case-insensitive matching
  ['SERVER/SRC/APP.TS', 'wiring'],
  // normalization: leading ./ stripped before classifying
  ['./src/a.ts', 'core'],
  // segment match, never substring: `distribution` must not hit the `dist` rule
  ['src/distribution/rates.ts', 'core'],
  // rule 3: mechanical/generated basename patterns not yet pinned by a case —
  // .min.(js|css) and .map, plus the bare .lock$ pattern distinct from rule 2's
  // exact lockfile-name list
  ['src/vendor-bundle.min.js', 'boilerplate'],
  ['src/app.js.map', 'boilerplate'],
  ['config/custom.lock', 'boilerplate'],
  // rule 5: bare wiring basenames beyond Dockerfile, plus the tsconfig / eslintrc
  // regexes (fire before rule 7's generic json extension match)
  ['Makefile', 'wiring'],
  ['.gitignore', 'wiring'],
  ['tsconfig.json', 'wiring'],
  ['.eslintrc.json', 'wiring'],
  // rule 9: a genuine (non-vendored) entrypoint actually hits the rule — the
  // existing vendored-index.ts case only proves rule 1 overrides it, not that
  // rule 9 fires on its own
  ['src/components/index.ts', 'wiring'],
  ['client/src/app/layout.tsx', 'wiring'],
];

describe('classifyPath', () => {
  it.each(CASES)('%s → %s', (path, expected) => {
    expect(classifyPath(path)).toBe(expected);
  });
});

describe('normalizePath', () => {
  it('strips a leading ./', () => {
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts');
  });

  it('strips a git a/ or b/ prefix', () => {
    expect(normalizePath('a/src/a.ts')).toBe('src/a.ts');
    expect(normalizePath('b/src/a.ts')).toBe('src/a.ts');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\a.ts')).toBe('src/a.ts');
  });
});
