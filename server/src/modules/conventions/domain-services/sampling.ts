import {
  MAX_CONFIG_FILE_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_TOTAL_BYTES,
  TRUNCATION_MARKER,
} from '../domain-model/constants.js';

/**
 * Pure sample packing + prompt rendering. Callers (application-services)
 * gather already-read file contents — via the `RepoFileReader` /
 * `SamplePicker` ports — in the order they want them prioritized (configs
 * first, then sources in rank order); this module never fetches anything
 * and never reorders the input.
 */

export type SampleKind = 'config' | 'source';

export interface SampleInput {
  path: string;
  kind: SampleKind;
  content: string;
}

export interface SampledFile {
  path: string;
  kind: SampleKind;
  /** The (possibly truncated) file content, one entry per line — this is what
   *  grounding checks citations against, so a citation past the cut is
   *  correctly rejected. */
  lines: string[];
  truncated: boolean;
}

export interface PackedSamples {
  files: SampledFile[];
  block: string;
}

/**
 * Enforce per-file and total byte budgets, truncating from the head (keep the
 * beginning, cut the tail) and appending `TRUNCATION_MARKER`. Stops adding
 * files once `MAX_TOTAL_BYTES` is reached — a later file is dropped whole
 * rather than included empty.
 */
export function packSamples(inputs: SampleInput[]): PackedSamples {
  const files: SampledFile[] = [];
  let totalBytes = 0;

  for (const input of inputs) {
    if (totalBytes >= MAX_TOTAL_BYTES) break;

    const perFileCap = input.kind === 'config' ? MAX_CONFIG_FILE_BYTES : MAX_SOURCE_FILE_BYTES;
    const cap = Math.min(perFileCap, MAX_TOTAL_BYTES - totalBytes);

    const contentBytes = Buffer.byteLength(input.content, 'utf8');
    const truncated = contentBytes > cap;
    const kept = truncated ? truncateToBytes(input.content, cap) : input.content;

    const lines = kept.split('\n');
    if (truncated) lines.push(TRUNCATION_MARKER);

    files.push({ path: input.path, kind: input.kind, lines, truncated });
    totalBytes += Buffer.byteLength(kept, 'utf8');
  }

  return { files, block: renderSampleBlock(files) };
}

/** Truncate from the head: keep the beginning up to `maxBytes`, drop the tail. */
function truncateToBytes(content: string, maxBytes: number): string {
  return Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8');
}

/**
 * Render every sampled file with a 1-based line-number gutter so the model's
 * `evidence.line` citation is checkable against real text, wrapped in
 * `<untrusted>` since repo contents are attacker-influenceable.
 */
export function renderSampleBlock(files: SampledFile[]): string {
  const sections = files.map((f) => {
    const width = String(f.lines.length).length;
    const gutter = f.lines
      .map((line, i) => `${String(i + 1).padStart(width, ' ')}│ ${line}`)
      .join('\n');
    return `=== ${f.path} ===\n${gutter}`;
  });
  return `<untrusted source="repo-samples">\n${sections.join('\n\n')}\n</untrusted>`;
}
