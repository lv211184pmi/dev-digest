import { describe, it, expect } from 'vitest';
import {
  matchesRoot,
  docTypeFor,
  estimateTokens,
  toDoc,
} from '../src/modules/project-context/domain-services/discovery.js';

/** Hermetic — pure functions, no DB, no I/O. */

describe('matchesRoot', () => {
  it('matches a path with a root directory segment, ending .md', () => {
    expect(matchesRoot('specs/feature.md')).toBe(true);
    expect(matchesRoot('docs/guides/setup.md')).toBe(true);
    expect(matchesRoot('insights/notes.md')).toBe(true);
  });

  it('a multi-root path matches (README.md does not, at the repo root)', () => {
    expect(matchesRoot('docs/specs/api.md')).toBe(true);
    expect(matchesRoot('README.md')).toBe(false);
  });

  it('a bare root-named directory (no filename) never matches', () => {
    expect(matchesRoot('specs')).toBe(false);
  });

  it('a file NAMED after a root (not a directory segment) does not match', () => {
    expect(matchesRoot('specs.md')).toBe(false);
  });

  it('empty path does not match', () => {
    expect(matchesRoot('')).toBe(false);
  });

  it('a non-.md file under a root does not match', () => {
    expect(matchesRoot('specs/notes.txt')).toBe(false);
  });
});

describe('docTypeFor', () => {
  it('a single-root path derives that root as its type', () => {
    expect(docTypeFor('specs/feature.md')).toBe('specs');
    expect(docTypeFor('insights/notes.md')).toBe('insights');
  });

  it('a multi-root path derives the LEFT-MOST matching segment', () => {
    expect(docTypeFor('docs/specs/api.md')).toBe('docs');
  });

  it('returns null for a path matching no root', () => {
    expect(docTypeFor('README.md')).toBeNull();
  });
});

describe('estimateTokens', () => {
  it('is ceil(bytes / 4)', () => {
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });

  it('zero bytes → zero tokens', () => {
    expect(estimateTokens(0)).toBe(0);
  });
});

describe('toDoc', () => {
  it('happy path: projects a matching entry into the contract shape', () => {
    const doc = toDoc({ path: 'docs/guide.md', bytes: 40, modifiedAt: new Date('2026-01-01T00:00:00Z') });
    expect(doc).toEqual({
      path: 'docs/guide.md',
      type: 'docs',
      bytes: 40,
      tokens: 10,
      modified_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('a zero-byte file is still listed, with 0 tokens', () => {
    const doc = toDoc({ path: 'specs/empty.md', bytes: 0, modifiedAt: new Date('2026-01-01T00:00:00Z') });
    expect(doc).toEqual({
      path: 'specs/empty.md',
      type: 'specs',
      bytes: 0,
      tokens: 0,
      modified_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns null for an entry matching no root', () => {
    const doc = toDoc({ path: 'README.md', bytes: 10, modifiedAt: new Date() });
    expect(doc).toBeNull();
  });
});
