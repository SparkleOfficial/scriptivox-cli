#!/usr/bin/env node
import { parseArgs, flagNumber, flagString } from './args.js';
import { ScriptivoxApi, ApiError, CLI_VERSION } from './api.js';
import { runCommand } from './commands.js';
import { UsageError } from './errors.js';
import { createEmitter } from './output.js';
import { helpText, isCommand } from './help.js';
import { DEFAULT_BASE_URL, NO_API_KEY_MESSAGE, type CliConfig } from './config.js';

/**
 * @scriptivox-api/cli — command-line client for the Scriptivox transcription API.
 *
 * Scope: https://api.scriptivox.com/v1 and nothing else. No session auth, no
 * dashboard, no web-app surface. See src/config.ts.
 *
 * Exit codes are part of the contract, because the point of a CLI is to be
 * scripted:
 *   0  success
 *   1  usage error — bad arguments, missing key, unreadable file
 *   2  API error — the machine-readable code is printed on stderr
 */

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_API = 2;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.flags.help || args.flags.h || args.command === 'help') {
    process.stdout.write(helpText());
    return EXIT_OK;
  }

  if (args.flags.version || args.flags.v || args.command === 'version') {
    process.stdout.write(CLI_VERSION + '\n');
    return EXIT_OK;
  }

  if (!args.command) {
    process.stdout.write(helpText());
    return EXIT_USAGE;
  }

  if (!isCommand(args.command)) {
    process.stderr.write(
      `Unknown command "${args.command}". Run \`scriptivox-api --help\` for the list.\n`
    );
    return EXIT_USAGE;
  }

  const json = args.flags.json === true || args.flags.json === 'true';
  const out = createEmitter(json);

  const apiKey =
    flagString(args.flags, 'api-key') ?? process.env.SCRIPTIVOX_API_KEY ?? '';
  if (!apiKey) {
    process.stderr.write(NO_API_KEY_MESSAGE + '\n');
    return EXIT_USAGE;
  }

  const config: CliConfig = {
    baseUrl: (
      flagString(args.flags, 'base-url') ??
      process.env.SCRIPTIVOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, ''),
    apiKey,
    json,
    pollIntervalSeconds: flagNumber(args.flags, 'poll-interval') ?? 5,
    pollTimeoutSeconds: flagNumber(args.flags, 'poll-timeout') ?? 600,
  };

  await runCommand(args.command, { api: new ScriptivoxApi(config), args, out });
  return EXIT_OK;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof ApiError) {
      // The code is the useful part for a script; the message is for a human.
      process.stderr.write(`${err.code}: ${err.message}\n`);
      if (err.retryAfter) {
        process.stderr.write(`Retry after ${err.retryAfter}s.\n`);
      }
      process.stderr.write(`See ${err.docsUrl}\n`);
      process.exitCode = EXIT_API;
      return;
    }

    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = EXIT_USAGE;
      return;
    }

    // Network failures and programming errors both land here. Print the
    // message rather than a stack: a stack trace from a CLI is noise unless
    // you are debugging the CLI itself.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Unexpected error: ${message}\n`);
    if (process.env.SCRIPTIVOX_DEBUG && err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exitCode = EXIT_API;
  });
