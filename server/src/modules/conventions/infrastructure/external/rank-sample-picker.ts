import type { RepoIntel } from '../../../repo-intel/types.js';
import type { SamplePicker } from '../../domain-services/ports.js';

/**
 * `SamplePicker` over `RepoIntel.getConventionSamples` — a 1-method port
 * rather than depending on the full ~20-method `RepoIntel` facade directly
 * (that's a legitimate port too, but the adapter here is 4 lines and the
 * hermetic fake in tests is 1).
 */
export class RankSamplePicker implements SamplePicker {
  constructor(private readonly repoIntel: RepoIntel) {}

  rankedPaths(repoId: string, n: number): Promise<string[]> {
    return this.repoIntel.getConventionSamples(repoId, n);
  }
}
