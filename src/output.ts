/**
 * Everything that reaches stdout or stderr.
 *
 * Rule: structured data goes to stdout, progress and diagnostics go to stderr.
 * That is what makes `scriptivox-api get <id> --format srt > out.srt` produce a
 * clean file even while the command is printing status updates.
 */

export interface Emitter {
  /** The command's result. stdout. */
  data(value: unknown): void;
  /** Progress and status. stderr, and suppressed entirely in --json mode. */
  note(line: string): void;
  /** Raw text result with no trailing newline added. stdout. */
  raw(text: string): void;
}

export function createEmitter(json: boolean): Emitter {
  return {
    data(value: unknown) {
      if (json) {
        process.stdout.write(JSON.stringify(value, null, 2) + '\n');
        return;
      }
      process.stdout.write(formatHuman(value) + '\n');
    },
    note(line: string) {
      if (json) return;
      process.stderr.write(line + '\n');
    },
    raw(text: string) {
      process.stdout.write(text);
    },
  };
}

function formatHuman(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(formatHuman).join('\n');

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    );
    const width = Math.max(0, ...entries.map(([k]) => k.length));
    return entries
      .map(([k, v]) => `${k.padEnd(width)}  ${scalar(v)}`)
      .join('\n');
  }

  return String(value);
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Cents are fractional and exact on this API, so never round them away. */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
