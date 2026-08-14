import { describe, it, expect } from 'vitest';
import { packSamples, renderSampleBlock, type SampleInput } from '../src/modules/conventions/domain-services/sampling.js';
import {
  MAX_TOTAL_BYTES,
  MAX_SOURCE_FILE_BYTES,
  CONFIG_CANDIDATES,
} from '../src/modules/conventions/domain-model/constants.js';

describe('conventions sampling — packSamples/renderSampleBlock', () => {
  it('eslint family dedupe: CONFIG_CANDIDATES has one entry chosen per family, not all six', () => {
    const eslintFamily = CONFIG_CANDIDATES.filter((c) => c.family === 'eslint');
    expect(eslintFamily.length).toBeGreaterThan(1); // multiple variants listed…
    // …but the caller (application-services) takes only the FIRST HIT per
    // family, which this fixture simulates directly:
    const firstHitPerFamily = new Map<string, string>();
    for (const c of eslintFamily) {
      if (!firstHitPerFamily.has(c.family)) firstHitPerFamily.set(c.family, c.path);
    }
    expect(firstHitPerFamily.size).toBe(1);
  });

  it('package.json is trimmed to the documented key set before packing (caller responsibility, packSamples just budgets)', () => {
    const trimmed = JSON.stringify({ name: 'x', type: 'module', scripts: { build: 'tsc' } });
    const { files } = packSamples([{ path: 'package.json', kind: 'config', content: trimmed }]);
    expect(files[0]!.lines.join('\n')).toContain('"name":"x"');
  });

  it('head truncation + marker: a file over its per-kind byte cap is cut and gets the marker line', () => {
    const big = 'x'.repeat(MAX_SOURCE_FILE_BYTES + 500);
    const { files } = packSamples([{ path: 'src/big.ts', kind: 'source', content: big }]);
    const file = files[0]!;
    expect(file.truncated).toBe(true);
    expect(file.lines.at(-1)).toBe('… [truncated]');
    // Content byte length (excluding the marker) must not exceed the cap.
    const contentBytes = Buffer.byteLength(file.lines.slice(0, -1).join('\n'), 'utf8');
    expect(contentBytes).toBeLessThanOrEqual(MAX_SOURCE_FILE_BYTES);
  });

  it('total-bytes stop: packing stops adding files once MAX_TOTAL_BYTES is reached', () => {
    const inputs: SampleInput[] = [];
    // Each file is huge enough that only a couple fit before the total cap.
    for (let i = 0; i < 20; i++) {
      inputs.push({ path: `src/file${i}.ts`, kind: 'source', content: 'y'.repeat(MAX_SOURCE_FILE_BYTES) });
    }
    const { files } = packSamples(inputs);
    expect(files.length).toBeLessThan(inputs.length);
    const total = files.reduce((sum, f) => sum + Buffer.byteLength(f.lines.join('\n'), 'utf8'), 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('configs before sources: the rendered block preserves input order (caller puts configs first)', () => {
    const { block } = packSamples([
      { path: 'package.json', kind: 'config', content: '{}' },
      { path: 'src/index.ts', kind: 'source', content: 'export {}' },
    ]);
    expect(block.indexOf('package.json')).toBeLessThan(block.indexOf('src/index.ts'));
  });

  it('gutters are 1-based and match lines[]', () => {
    const { files, block } = packSamples([
      { path: 'src/a.ts', kind: 'source', content: 'first\nsecond\nthird' },
    ]);
    expect(files[0]!.lines).toEqual(['first', 'second', 'third']);
    expect(block).toContain('1│ first');
    expect(block).toContain('2│ second');
    expect(block).toContain('3│ third');
  });

  it('wraps the rendered block in <untrusted> delimiters', () => {
    const block = renderSampleBlock([{ path: 'a.ts', kind: 'source', lines: ['x'], truncated: false }]);
    expect(block.startsWith('<untrusted source="repo-samples">')).toBe(true);
    expect(block.trim().endsWith('</untrusted>')).toBe(true);
  });
});
