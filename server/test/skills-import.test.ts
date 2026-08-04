import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import {
  extractFromArchive,
  extractFromMarkdown,
  getCommunitySkillBody,
  isPathSafe,
  searchCommunitySkills,
} from '../src/modules/skills/import.js';
import { ValidationError } from '../src/platform/errors.js';

/**
 * Skills import parsing — pure functions, no DB, no network. Covers markdown
 * name derivation and the archive-import security gates (zip-slip guard,
 * executable stripping) that back "виконувані частини архіву не обробляються."
 */
describe('extractFromMarkdown', () => {
  it('derives the name from the first # heading', () => {
    const preview = extractFromMarkdown('# My Rule\n\nBody text.');
    expect(preview.name).toBe('My Rule');
    expect(preview.body).toBe('# My Rule\n\nBody text.');
    expect(preview.type).toBe('custom');
    expect(preview.warnings).toEqual([]);
  });

  it('falls back to the filename when there is no heading', () => {
    const preview = extractFromMarkdown('Just some text, no heading.', 'no-then-chains.md');
    expect(preview.name).toBe('no-then-chains');
  });

  it('falls back to a generic name when neither a heading nor a filename is given', () => {
    const preview = extractFromMarkdown('no heading here');
    expect(preview.name).toBe('Untitled skill');
  });

  it('ignores a # that is not on its own line (not a real heading)', () => {
    const preview = extractFromMarkdown('See issue #123 for context.\n\nMore text.', 'ticket.md');
    expect(preview.name).toBe('ticket');
  });
});

function zipWithEntries(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

describe('extractFromArchive', () => {
  it('extracts the body from a SKILL.md at the archive root', () => {
    const buf = zipWithEntries({ 'SKILL.md': '# Root Skill\n\nBody.' });
    const preview = extractFromArchive(buf);
    expect(preview.name).toBe('Root Skill');
    expect(preview.warnings).toEqual([]);
  });

  it('prefers SKILL.md over another markdown file in the same archive', () => {
    const buf = zipWithEntries({
      'README.md': '# Not this one',
      'SKILL.md': '# The Real Skill',
    });
    const preview = extractFromArchive(buf);
    expect(preview.name).toBe('The Real Skill');
  });

  it('falls back to the first .md file when there is no SKILL.md', () => {
    const buf = zipWithEntries({ 'rules/my-rule.md': '# My Rule' });
    const preview = extractFromArchive(buf);
    expect(preview.name).toBe('My Rule');
  });

  it('strips executable entries before ever reading their content', () => {
    const buf = zipWithEntries({
      'SKILL.md': '# Guarded Skill',
      'install.sh': '#!/bin/sh\nrm -rf /',
      'payload.exe': 'not really a PE binary',
    });
    const preview = extractFromArchive(buf);
    expect(preview.name).toBe('Guarded Skill');
    expect(preview.warnings.some((w) => w.includes('install.sh'))).toBe(true);
    expect(preview.warnings.some((w) => w.includes('payload.exe'))).toBe(true);
  });

  it('throws when the archive has no usable markdown left after filtering', () => {
    const buf = zipWithEntries({ 'run.sh': '#!/bin/sh\necho hi' });
    expect(() => extractFromArchive(buf)).toThrow(ValidationError);
  });
});

describe('isPathSafe (zip-slip guard)', () => {
  // `adm-zip`'s own `addFile` already sanitizes `../` segments on write, so a
  // realistic malicious entry name (crafted by some OTHER zip tool) has to be
  // tested against the predicate directly rather than round-tripped through
  // AdmZip, which would sanitize it away before extractFromArchive ever saw it.
  it('rejects entries that walk up out of the archive root', () => {
    expect(isPathSafe('../../etc/evil.md')).toBe(false);
    expect(isPathSafe('nested/../../evil.md')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isPathSafe('/etc/evil.md')).toBe(false);
    expect(isPathSafe('\\Windows\\evil.md')).toBe(false);
  });

  it('accepts normal relative paths', () => {
    expect(isPathSafe('SKILL.md')).toBe(true);
    expect(isPathSafe('rules/my-rule.md')).toBe(true);
  });
});

describe('community skills fixture', () => {
  it('search filters by query text across name and description', () => {
    const results = searchCommunitySkills('injection');
    expect(results.some((r) => r.name === 'sql-injection-gate')).toBe(true);
    expect(results.every((r) => 'body' in r === false)).toBe(true); // body never leaks into search results
  });

  it('search filters by language', () => {
    const results = searchCommunitySkills(undefined, 'TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.lang === 'TypeScript')).toBe(true);
  });

  it('"All languages" / "any" do not filter anything out', () => {
    const all = searchCommunitySkills();
    expect(searchCommunitySkills(undefined, 'All languages')).toHaveLength(all.length);
  });

  it('getCommunitySkillBody resolves a real fixture by repo+name', () => {
    const found = getCommunitySkillBody('secdev/agent-skills', 'owasp-top-10-review');
    expect(found?.body).toContain('OWASP Top 10');
  });

  it('getCommunitySkillBody returns undefined for an unknown fixture', () => {
    expect(getCommunitySkillBody('nobody/nothing', 'made-up')).toBeUndefined();
  });
});
