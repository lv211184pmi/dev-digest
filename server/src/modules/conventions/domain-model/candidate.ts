import type { ConventionCategoryValue } from './constants.js';

/** What the model returns for one candidate — its own claim, not yet checked. */
export interface ConventionEvidence {
  file: string;
  line: number;
  snippet: string;
}

export interface RawConventionCandidate {
  category: ConventionCategoryValue;
  rule: string;
  evidence: ConventionEvidence;
  confidence: number;
}

/** A candidate that passed grounding — evidence is rebuilt from real sampled bytes. */
export interface GroundedConvention {
  category: ConventionCategoryValue;
  rule: string;
  confidence: number;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
}

export interface DroppedConvention {
  candidate: RawConventionCandidate;
  reason: string;
}
