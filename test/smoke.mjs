import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Offline smoke tests for @scriptivox-api/cli.
 *
 * Nothing here touches the network. The point is that argument parsing, the
 * help surface, the missing-key path and the exit codes behave — a CLI whose
 * exit code lies is worse than no CLI, because scripts trust it.
 *
 * Run with: npm --prefix cli test
 */

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, '..', 'dist', 'index.js');

/** Runs the built CLI with no inherited API key, and never throws on non-zero. */
async function run(args, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENTRY, ...args], {
      env: {
        ...process.env,
        SCRIPTIVOX_API_KEY: '',
        SCRIPTIVOX_BASE_URL: 'http://127.0.0.1:9/v1', // discard port: never connects
        ...env,
      },
      timeout: 20_000,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

test('--help exits 0 and lists every command', async () => {
  const { code, stdout } = await run(['--help']);
  assert.equal(code, 0);
  for (const cmd of [
    'transcribe', 'upload', 'status', 'get', 'list', 'cancel', 'delete', 'balance',
  ]) {
    assert.ok(stdout.includes(cmd), `help is missing the ${cmd} command`);
  }
});

test('--help documents the exit-code contract', async () => {
  const { stdout } = await run(['--help']);
  assert.match(stdout, /EXIT CODES/);
});

test('--version prints a bare semver', async () => {
  const { code, stdout } = await run(['--version']);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('no arguments prints help and exits 1', async () => {
  const { code, stdout } = await run([]);
  assert.equal(code, 1);
  assert.match(stdout, /USAGE/);
});

test('an unknown command exits 1 and says so on stderr', async () => {
  const { code, stderr } = await run(['definitely-not-a-command']);
  assert.equal(code, 1);
  assert.match(stderr, /Unknown command/);
});

test('a missing API key exits 1 and points at the key page', async () => {
  const { code, stderr } = await run(['balance']);
  assert.equal(code, 1);
  assert.match(stderr, /No Scriptivox API key/);
  assert.match(stderr, /platform\.scriptivox\.com\/keys/);
});

test('--api-key satisfies the key check without an env var', async () => {
  // Reaches the network layer and fails to connect, which is exactly the point:
  // it got past argument handling. That is exit 2 (API error), not 1 (usage).
  const { code, stderr } = await run(['balance', '--api-key', 'sk_live_test']);
  assert.equal(code, 2);
  assert.doesNotMatch(stderr, /No Scriptivox API key/);
});

test('transcribe with no source is a usage error, not a network call', async () => {
  const { code, stderr } = await run(['transcribe', '--api-key', 'sk_live_test']);
  assert.equal(code, 1);
  assert.match(stderr, /needs a URL, a file path, or --upload-id/);
});

test('transcribe rejects both a source and --upload-id', async () => {
  const { code, stderr } = await run([
    'transcribe', 'https://example.com/a.mp3',
    '--upload-id', 'abc', '--api-key', 'sk_live_test',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /not both/);
});

test('--speakers without --diarize is refused before any request', async () => {
  const { code, stderr } = await run([
    'transcribe', 'https://example.com/a.mp3',
    '--speakers', '2', '--api-key', 'sk_live_test',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /--speakers requires --diarize/);
});

test('a non-numeric --speakers is refused rather than coerced to NaN', async () => {
  const { code, stderr } = await run([
    'transcribe', 'https://example.com/a.mp3',
    '--speakers', 'two', '--diarize', '--api-key', 'sk_live_test',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /expects a number/);
});

test('an unreadable file is a usage error naming the file', async () => {
  const { code, stderr } = await run([
    'transcribe', './definitely-not-a-real-file.mp3', '--api-key', 'sk_live_test',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /Cannot read/);
});

test('an unsupported --format is refused before any request', async () => {
  const { code, stderr } = await run([
    'get', 'some-id', '--format', 'docx', '--api-key', 'sk_live_test',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /--format must be json, srt, vtt or text/);
});

test('status and get require an id', async () => {
  for (const cmd of ['status', 'get', 'cancel', 'delete']) {
    const { code, stderr } = await run([cmd, '--api-key', 'sk_live_test']);
    assert.equal(code, 1, `${cmd} should exit 1 without an id`);
    assert.match(stderr, /needs a transcription ID/);
  }
});

test('--version matches package.json', async () => {
  // These drift silently: `npm version` bumps package.json, and a hard-coded
  // VERSION constant in the source keeps reporting the old number to every
  // script that logs it. A published CLI whose --version lies is worse than one
  // with no --version at all.
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  const { code, stdout } = await run(['--version']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test('--help points at the documentation page, not just npm', async () => {
  // /docs/cli exists so the CLI is findable by name; the help output is where
  // someone already holding the tool goes looking for the rest of it.
  const { stdout } = await run(['--help']);
  assert.match(stdout, /platform\.scriptivox\.com/);
});
