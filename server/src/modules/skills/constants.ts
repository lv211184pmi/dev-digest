/** Constants for the skills module. */

/** Initial version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/**
 * Archive-import guard: entries with one of these extensions are dropped
 * before anything reads their content — "executable parts of the archive are
 * not processed."
 */
export const EXECUTABLE_EXTENSIONS = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.exe',
  '.bat',
  '.cmd',
  '.ps1',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.dll',
  '.so',
  '.dylib',
  '.app',
  '.jar',
  '.msi',
  '.com',
  '.scr',
  '.vbs',
  '.wsf',
]);
