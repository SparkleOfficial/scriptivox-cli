import { UsageError } from './errors.js';

/**
 * Argument parsing.
 *
 * Hand-rolled rather than pulled from npm: the package has zero runtime
 * dependencies on purpose, so `npx @scriptivox-api/cli` is one small download and
 * there is no third-party code between a user's API key and the API.
 */

export interface ParsedArgs {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const name = arg.slice(2);
      const next = argv[i + 1];
      // `--diarize` and `--diarize true` both mean true; a following value is
      // only consumed when it does not look like another flag.
      if (next !== undefined && !next.startsWith('-')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      // Short flags are aliases only; there is no bundling (-abc).
      flags[arg.slice(1)] = true;
      continue;
    }

    positionals.push(arg);
  }

  const command = positionals.length > 0 ? positionals[0] : null;
  return { command, positionals: positionals.slice(1), flags };
}

export function flagString(
  flags: Record<string, string | boolean>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const v = flags[name];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

export function flagBool(
  flags: Record<string, string | boolean>,
  ...names: string[]
): boolean | undefined {
  for (const name of names) {
    const v = flags[name];
    if (v === undefined) continue;
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return undefined;
}

/**
 * Returns undefined for an absent flag and throws for one that is present but
 * not a number — silently coercing `--limit abc` to NaN would send a nonsense
 * query and blame the server for the 400.
 */
export function flagNumber(
  flags: Record<string, string | boolean>,
  ...names: string[]
): number | undefined {
  for (const name of names) {
    const v = flags[name];
    if (v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new UsageError(`--${name} expects a number, got "${String(v)}".`);
    }
    return n;
  }
  return undefined;
}
