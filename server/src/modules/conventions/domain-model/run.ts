export type ConventionRunStatus = 'queued' | 'running' | 'done' | 'failed';

export const ACTIVE_RUN_STATUSES: readonly ConventionRunStatus[] = ['queued', 'running'];

export function isActiveStatus(status: ConventionRunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/** True once an active run has been sitting untouched longer than `staleMs` —
 *  a job that died without ever flipping status away from queued/running. */
export function isStaleActiveRun(createdAt: Date, staleMs: number, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > staleMs;
}
