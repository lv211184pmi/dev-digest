/**
 * Public surface of the Smart Diff domain code. Consumers (helpers.ts,
 * service.ts) import from here, never reaching past it into ./build.js or
 * ./classify.js directly.
 */
export { buildSmartDiff } from './build.js';
export type { SmartDiffInputFile, SmartDiffInputFinding } from './build.js';
export { classifyPath } from './classify.js';
