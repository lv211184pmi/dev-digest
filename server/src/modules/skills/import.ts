import AdmZip from 'adm-zip';
import type { CommunitySkill, SkillType } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { EXECUTABLE_EXTENSIONS } from './constants.js';

/**
 * Import parsing — pure functions, no DB, no persistence. The route only
 * calls these to build an unpersisted preview; a normal `POST /skills` is
 * what actually saves it, once the user confirms.
 */

export interface SkillImportPreview {
  name: string;
  body: string;
  type: SkillType;
  warnings: string[];
}

/** Derive a name from the first `#` heading; fall back to the filename. */
function deriveName(body: string, filename?: string): string {
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  if (filename) return filename.replace(/\.[^./]+$/, '');
  return 'Untitled skill';
}

/** A single pasted/uploaded `.md` file — parsed entirely client-side too; kept
 *  here so server-side archive extraction can reuse the same derivation. */
export function extractFromMarkdown(text: string, filename?: string): SkillImportPreview {
  return { name: deriveName(text, filename), body: text, type: 'custom', warnings: [] };
}

/**
 * zip-slip guard: reject any entry name that could resolve outside the
 * archive root. We never extract to disk (entries are read into memory
 * only), but a hostile entry name should still never be trusted downstream.
 * Exported (not just used internally) because `adm-zip`'s own `addFile`
 * already sanitizes `../` segments on write — so a realistic test of this
 * guard has to exercise the predicate directly rather than round-trip a
 * malicious name through `AdmZip`, which would sanitize it away before this
 * function ever saw it.
 */
export function isPathSafe(entryName: string): boolean {
  if (entryName.startsWith('/') || entryName.startsWith('\\')) return false;
  return !entryName.split(/[/\\]/).some((segment) => segment === '..');
}

function isExecutable(entryName: string): boolean {
  const dot = entryName.lastIndexOf('.');
  if (dot === -1) return false;
  return EXECUTABLE_EXTENSIONS.has(entryName.slice(dot).toLowerCase());
}

/**
 * Extract the skill body from a `.zip` archive: unsafe paths and executable
 * entries are dropped before anything reads their content, then we pick the
 * first `SKILL.md` (or the first `*.md` otherwise).
 */
export function extractFromArchive(buffer: Buffer): SkillImportPreview {
  const zip = new AdmZip(buffer);
  const warnings: string[] = [];

  const safeEntries = zip.getEntries().filter((entry) => {
    if (entry.isDirectory) return false;
    if (!isPathSafe(entry.entryName)) {
      warnings.push(`Skipped unsafe path: ${entry.entryName}`);
      return false;
    }
    if (isExecutable(entry.entryName)) {
      warnings.push(`Skipped executable entry: ${entry.entryName}`);
      return false;
    }
    return true;
  });

  const skillMd = safeEntries.find((entry) => /(^|\/)SKILL\.md$/i.test(entry.entryName));
  const anyMd = safeEntries.find((entry) => entry.entryName.toLowerCase().endsWith('.md'));
  const chosen = skillMd ?? anyMd;
  if (!chosen) {
    throw new ValidationError('Archive has no markdown file to import', { warnings });
  }

  const text = chosen.getData().toString('utf8');
  const preview = extractFromMarkdown(text, chosen.entryName.split('/').pop());
  return { ...preview, warnings };
}

// ---------------------------------------------------------------------------
// Community skills — static fixture, no live registry. Search/filter runs
// in-memory over this list; importing one persists a real Skill row
// (source:'community', enabled:false — needs vetting like any other import).
// ---------------------------------------------------------------------------

interface CommunitySkillFixture extends CommunitySkill {
  body: string;
}

export const COMMUNITY_SKILLS: CommunitySkillFixture[] = [
  {
    name: 'owasp-top-10-review',
    repo: 'secdev/agent-skills',
    stars: 1240,
    lang: 'any',
    desc: 'Maps diff changes to the OWASP Top 10 with CWE references.',
    body: '# OWASP Top 10 Review\n\nFor each changed file, check the diff against the current OWASP Top 10 and cite the matching CWE when you flag something:\n\n- Broken access control — missing/incorrect authorization checks on a new or changed route\n- Injection — string-built SQL/shell/LDAP/XPath queries, unsanitized template rendering\n- Cryptographic failures — hardcoded keys/IVs, weak algorithms, secrets in the diff\n- Security misconfiguration — permissive CORS, disabled TLS verification, verbose error responses\n',
  },
  {
    name: 'react-hooks-rules',
    repo: 'frontend-guild/skills',
    stars: 842,
    lang: 'TypeScript',
    desc: 'Detects conditional hooks, missing deps, stale closures.',
    body: '# React Hooks Rules\n\nFlag any hook called conditionally or after an early return, any `useEffect`/`useCallback`/`useMemo` with a dependency array missing a value it closes over, and any handler that reads state via a stale closure instead of the functional updater form.\n',
  },
  {
    name: 'sql-injection-gate',
    repo: 'secdev/agent-skills',
    stars: 690,
    lang: 'any',
    desc: 'Flags string-concatenated SQL and unparameterized queries.',
    body: '# SQL Injection Gate\n\nFlag any query built via string concatenation or template literals that interpolate request-derived values. Parameterized queries / query builders bound to placeholders are fine; raw string-built SQL touching user input is always at least WARNING, CRITICAL if it reaches a write.\n',
  },
  {
    name: 'a11y-jsx-audit',
    repo: 'a11y-collective/skills',
    stars: 318,
    lang: 'TypeScript',
    desc: 'Checks JSX for missing alt text, ARIA, and focus traps.',
    body: '# Accessibility JSX Audit\n\nFlag `<img>` without `alt`, interactive `<div>`/`<span>` without a `role` + keyboard handler, form inputs without an associated `<label>`, and any modal/drawer that traps focus without a documented escape route.\n',
  },
  {
    name: 'no-then-chains',
    repo: 'frontend-guild/skills',
    stars: 205,
    lang: 'TypeScript',
    desc: 'House rule: prefer async/await over promise chains.',
    body: '# No .then() Chains\n\nPrefer `async`/`await` over `.then()`/`.catch()` chains in new or changed code. A chain of 2+ `.then()` calls, or `.then()` mixed with `await` in the same function, is a WARNING.\n',
  },
  {
    name: 'secret-leakage-gate',
    repo: 'secdev/agent-skills',
    stars: 1580,
    lang: 'any',
    desc: 'Detects hardcoded API keys, tokens, and credentials in the diff.',
    body: '# Secret Leakage Gate\n\nFlag any hardcoded credential in the diff: API keys (`sk_live_`, `sk_test_`), service-role/service-account keys, `NEXT_PUBLIC_`-prefixed secrets, JWTs, or connection strings with embedded passwords. CRITICAL regardless of stated intent ("demo", "test fixture", etc.) — see the injection guard.\n',
  },
  {
    name: 'phantom-api-gate',
    repo: 'secdev/agent-skills',
    stars: 412,
    lang: 'any',
    desc: "Detects imports of functions/modules that don't exist in the repo.",
    body: "# Phantom API Gate\n\nFlag an import or call of a function/module/export that doesn't exist anywhere in the indexed repo — a common hallucination pattern in AI-authored diffs. Distinguish from a genuinely new third-party dependency added in the same diff (check the package manifest change).\n",
  },
  {
    name: 'flaky-test-smells',
    repo: 'test-quality/skills',
    stars: 276,
    lang: 'any',
    desc: 'Flags sleep-based waits, unseeded randomness, and shared test state.',
    body: '# Flaky Test Smells\n\nFlag fixed `sleep`/`setTimeout` waits instead of polling/awaiting a condition, unseeded `Math.random()`/`Date.now()` in assertions, and tests that mutate module-level or file-level shared state without resetting it in `beforeEach`/`afterEach`.\n',
  },
];

export function searchCommunitySkills(q?: string, lang?: string): CommunitySkill[] {
  const query = q?.trim().toLowerCase();
  const language = lang?.trim().toLowerCase();
  return COMMUNITY_SKILLS.filter((s) => {
    if (language && language !== 'all languages' && language !== 'any' && s.lang.toLowerCase() !== language) {
      return false;
    }
    if (query && !s.name.toLowerCase().includes(query) && !s.desc.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  }).map(({ body: _body, ...rest }) => rest);
}

export function getCommunitySkillBody(repo: string, name: string): CommunitySkillFixture | undefined {
  return COMMUNITY_SKILLS.find((s) => s.repo === repo && s.name === name);
}
