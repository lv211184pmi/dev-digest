/**
 * blast module — domain constants.
 *
 * No imports outside this ring except `MAX_CALLERS_PER_SYMBOL`, which is
 * RE-EXPORTED rather than copied so the number has one definition. Note that
 * this module is the only place that *applies* it: the repo-intel facade
 * deliberately returns every resolved caller so this ring can report an honest
 * pre-cap `caller_count` and attribute endpoints across all of them (see
 * `repo-intel/service.ts`'s `tryPersistentBlast`). One number, one owner.
 */

export { MAX_CALLERS_PER_SYMBOL } from '../../repo-intel/constants.js';

/**
 * Hard clamp on the stored summary. The model is asked for 1-2 sentences; this
 * is the backstop for when it ignores that, so a runaway response can never
 * bloat the row or the card.
 */
export const MAX_SUMMARY_CHARS = 400;
