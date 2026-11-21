/**
 * `scriptivox-api service-status`: GET /v1/status (operationId getServiceStatus) as one plain line
 * and an exit code a script can branch on.
 *
 * The rule this command keeps: a status that could not be read is "could not check", never "taking
 * new jobs". Only a body that is clearly the status call's answer counts; anything else (no answer,
 * an error page, a body without a known `status`) is exit 4.
 */

export interface ServiceStatusPause {
  scope: string;
  name: string;
  message: string | null;
  routes: string[];
  back_by: string | null;
}

export interface ServiceStatusWindow {
  title: string;
  message: string | null;
  starts_at: string;
  ends_at: string;
}

export interface ServiceStatus {
  status: 'operational' | 'maintenance' | 'unknown';
  accepting_new_jobs: boolean | null;
  maintenance: { paused: ServiceStatusPause[]; retry_after_seconds: number } | null;
  still_working: string[] | null;
  upcoming: ServiceStatusWindow[] | null;
  checked_at: string;
  status_page: string;
}

/** New jobs are taken (nothing paused, or only links to video sites). */
export const EXIT_TAKING_NEW_JOBS = 0;
/** New jobs are paused for maintenance. */
export const EXIT_PAUSED = 3;
/** The status could not be checked just now. Not the same as "down". */
export const EXIT_COULD_NOT_CHECK = 4;

export const STATUS_PAGE = 'https://status.scriptivox.com';

export const COULD_NOT_CHECK_LINE =
  `Could not check whether the Scriptivox API is taking new jobs right now. ` +
  `This does not mean it is down: see ${STATUS_PAGE}`;

export interface StatusLine {
  line: string;
  exitCode: number;
}

/** "2026-11-21T14:10:00.000Z" as "2026-11-21 14:10 UTC"; anything else as given. */
export function utc(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/** `Starting new jobs and uploads, expected back by 2026-11-21 10:40 UTC ("Planned upgrade.")` */
function pauseWords(p: ServiceStatusPause): string {
  const backBy = p.back_by ? `, expected back by ${utc(p.back_by)}` : '';
  const message = p.message?.trim() ? ` ("${p.message.trim()}")` : '';
  return `${p.name}${backBy}${message}`;
}

function retryWords(seconds: number | undefined): string {
  return typeof seconds === 'number' && seconds > 0 ? ` Try again in ${seconds} seconds.` : '';
}

/** True only for a body that has the status call's shape. */
export function isServiceStatus(body: unknown): body is ServiceStatus {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (b.status !== 'operational' && b.status !== 'maintenance' && b.status !== 'unknown') return false;
  if (b.status !== 'unknown' && typeof b.accepting_new_jobs !== 'boolean') return false;
  return true;
}

/** The one line and the exit code for a status body (or for no usable body at all). */
export function statusLine(body: unknown): StatusLine {
  if (!isServiceStatus(body) || body.status === 'unknown') {
    return { line: COULD_NOT_CHECK_LINE, exitCode: EXIT_COULD_NOT_CHECK };
  }
  const paused = body.maintenance?.paused ?? [];
  const retry = retryWords(body.maintenance?.retry_after_seconds);

  if (body.accepting_new_jobs === false) {
    // Full maintenance stops every call (still_working is empty); otherwise reads go on.
    const lead =
      Array.isArray(body.still_working) && body.still_working.length === 0
        ? 'The Scriptivox API is paused for maintenance'
        : 'New jobs are paused for maintenance';
    const what = paused.length ? `: ${paused.map(pauseWords).join('; ')}.` : '.';
    return { line: `${lead}${what}${retry} Jobs already accepted finish.`, exitCode: EXIT_PAUSED };
  }

  // Taking new jobs while part of one call is paused (links to video sites): exit 0, but say so.
  if (body.status === 'maintenance' && paused.length) {
    return {
      line: `The Scriptivox API is taking new jobs. Paused for maintenance: ${paused.map(pauseWords).join('; ')}.${retry}`,
      exitCode: EXIT_TAKING_NEW_JOBS,
    };
  }

  const next = body.upcoming?.[0];
  const planned = next ? ` Planned maintenance: ${next.title}, ${utc(next.starts_at)} to ${utc(next.ends_at)}.` : '';
  return { line: `The Scriptivox API is taking new jobs.${planned}`, exitCode: EXIT_TAKING_NEW_JOBS };
}
