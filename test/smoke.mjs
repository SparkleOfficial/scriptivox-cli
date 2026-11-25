import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

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
    'transcribe', 'upload', 'status', 'get', 'list', 'cancel', 'delete', 'balance', 'service-status',
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

// ─── service-status (service status Phase 8) ────────────────────────────────
//
// A stand-in for GET /v1/status on 127.0.0.1 (loopback only: nothing leaves the machine).
// It records each request's headers so the test can prove no key is sent.

const OPERATIONAL = {
  status: 'operational',
  accepting_new_jobs: true,
  maintenance: null,
  still_working: ['POST /v1/upload', 'POST /v1/transcribe', 'GET /v1/balance'],
  upcoming: [],
  checked_at: '2026-11-21T10:00:00.000Z',
  status_page: 'https://status.scriptivox.com',
};
const pause = (scope, name, message = null, back_by = null, routes = ['POST /v1/upload', 'POST /v1/transcribe']) => ({ scope, name, message, routes, back_by });
const BODIES = {
  operational: OPERATIONAL,
  planned: { ...OPERATIONAL, upcoming: [{ title: 'Planned upgrade', message: null, starts_at: '2026-11-22T02:00:00.000Z', ends_at: '2026-11-22T02:30:00.000Z' }] },
  uploads: {
    ...OPERATIONAL,
    status: 'maintenance',
    accepting_new_jobs: false,
    maintenance: { paused: [pause('upload', 'Starting new jobs and uploads', 'Planned upgrade.', '2026-11-21T10:40:00.000Z')], retry_after_seconds: 2400 },
    still_working: ['GET /v1/balance'],
  },
  link: {
    ...OPERATIONAL,
    status: 'maintenance',
    maintenance: { paused: [pause('link', 'Transcribing from a link to a video or social media site (such as TikTok, Instagram, Facebook, X or Snapchat)', null, null, ['POST /v1/transcribe'])], retry_after_seconds: 300 },
  },
  full: {
    ...OPERATIONAL,
    status: 'maintenance',
    accepting_new_jobs: false,
    maintenance: { paused: [pause('global', 'All of Scriptivox, reading included', 'Back shortly.')], retry_after_seconds: 300 },
    still_working: [],
  },
  unknown: { ...OPERATIONAL, status: 'unknown', accepting_new_jobs: null, still_working: null, upcoming: null },
};

async function withStatusServer(answer, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    const { status = 200, type = 'application/json', body, headers = {} } = answer(req);
    res.writeHead(status, { 'content-type': type, ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}/v1`, seen);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

test('--help lists service-status and its exit codes 3 and 4', async () => {
  const { stdout } = await run(['--help']);
  assert.match(stdout, /service-status/);
  assert.match(stdout, /3 {2}service-status: new jobs are paused/);
  assert.match(stdout, /4 {2}service-status: could not check/);
});

test('service-status needs no API key, sends none, and prints one line', async () => {
  await withStatusServer(() => ({ body: BODIES.operational }), async (base, seen) => {
    const { code, stdout, stderr } = await run(['service-status'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, 'The Scriptivox API is taking new jobs.\n');
    assert.doesNotMatch(stderr, /No Scriptivox API key/);
    assert.equal(seen[0].url, '/v1/status');
    assert.equal(seen[0].headers.authorization, undefined);
    // A key given anyway is still not sent to the status call.
    await run(['service-status', '--api-key', 'sk_live_not_sent'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(seen[1].headers.authorization, undefined);
  });
});

test('service-status: new jobs paused is exit 3 with what, our message, the time and the wait', async () => {
  await withStatusServer(() => ({ body: BODIES.uploads }), async (base) => {
    const { code, stdout } = await run(['service-status'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 3);
    assert.equal(
      stdout,
      'New jobs are paused for maintenance: Starting new jobs and uploads, expected back by 2026-11-21 10:40 UTC ("Planned upgrade."). Try again in 2400 seconds. Jobs already accepted finish.\n',
    );
    assert.equal(stdout.trim().split('\n').length, 1, 'one line');
  });
});

test('service-status: full maintenance is exit 3; a link-only pause is exit 0 and still named', async () => {
  await withStatusServer(() => ({ body: BODIES.full }), async (base) => {
    const { code, stdout } = await run(['service-status'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 3);
    assert.match(stdout, /^The Scriptivox API is paused for maintenance: All of Scriptivox, reading included \("Back shortly\."\)\./);
  });
  await withStatusServer(() => ({ body: BODIES.link }), async (base) => {
    const { code, stdout } = await run(['service-status'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 0, 'uploads and file links are still taken');
    assert.match(stdout, /^The Scriptivox API is taking new jobs\. Paused for maintenance: Transcribing from a link to a video or social media site/);
    assert.doesNotMatch(stdout, /youtube/i);
  });
  await withStatusServer(() => ({ body: BODIES.planned }), async (base) => {
    const { code, stdout } = await run(['service-status'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 0);
    assert.equal(stdout, 'The Scriptivox API is taking new jobs. Planned maintenance: Planned upgrade, 2026-11-22 02:00 UTC to 2026-11-22 02:30 UTC.\n');
  });
});

test('service-status: "unknown", an error page, an error answer or no answer is exit 4, never "taking new jobs"', async () => {
  const cases = [
    () => ({ body: BODIES.unknown }),
    () => ({ type: 'text/html', body: '<html>challenge</html>' }),
    () => ({ body: {} }),
    () => ({ status: 503, body: { error: { code: 'MAINTENANCE', message: 'paused' } } }),
    () => ({ status: 500, type: 'text/plain', body: 'oops' }),
  ];
  for (const answer of cases) {
    await withStatusServer(answer, async (base) => {
      const { code, stdout } = await run(['service-status'], { SCRIPTIVOX_BASE_URL: base });
      assert.equal(code, 4, `${JSON.stringify(answer())} should be "could not check"`);
      assert.match(stdout, /^Could not check whether the Scriptivox API is taking new jobs right now\. This does not mean it is down/);
      assert.doesNotMatch(stdout, /is taking new jobs\./);
    });
  }
  const { code, stdout } = await run(['service-status']); // the discard port: no answer at all
  assert.equal(code, 4);
  assert.match(stdout, /status\.scriptivox\.com/);
});

test('service-status --json prints the body as the API sent it, with the same exit codes', async () => {
  await withStatusServer(() => ({ body: BODIES.uploads }), async (base) => {
    const { code, stdout } = await run(['service-status', '--json'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 3);
    assert.deepEqual(JSON.parse(stdout), BODIES.uploads);
  });
  const { code, stdout, stderr } = await run(['service-status', '--json']);
  assert.equal(code, 4);
  assert.equal(stdout, '', 'nothing on stdout when there is no status to print');
  assert.match(stderr, /Could not check/);
});

test('status with no id points to service-status', async () => {
  const { code, stderr } = await run(['status', '--api-key', 'sk_live_test']);
  assert.equal(code, 1);
  assert.match(stderr, /needs a transcription ID\. To see whether the API is taking new jobs, run: scriptivox-api service-status/);
});

test('a paused job says the wait, the time and where to look, and stays exit 2', async () => {
  const paused = () => ({
    status: 503,
    headers: { 'retry-after': '2400' },
    body: { error: { code: 'MAINTENANCE', message: 'Moving uploads to new servers.', scope: 'upload', back_by: '2026-11-21T10:40:00.000Z', status_url: 'https://api.scriptivox.com/v1/status' } },
  });
  await withStatusServer(paused, async (base) => {
    const { code, stderr } = await run(['transcribe', 'https://example.com/a.mp3', '--api-key', 'sk_live_test'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 2, 'an API refusal keeps its exit code');
    assert.match(stderr, /MAINTENANCE: Moving uploads to new servers\./);
    assert.match(stderr, /Retry after 2400s\./);
    assert.match(stderr, /Expected back by 2026-11-21 10:40 UTC\./);
    assert.match(stderr, /See what is paused with: scriptivox-api service-status/);
  });
});

// ─── why a job waits (scriptivox wait reasons Phase 3, 24 Nov 2026) ─────────
// --wait prints the API's own sentence once per reason (and per planned Google Drive try), never on every poll;
// status shows it while the job waits.

test('--wait prints why a job waits once per reason and per planned try; status shows it', async () => {
  const ID = 'b2c3d4e5-f6a7-4901-8cde-f12345678901';
  const share = { reason: 'account_drive_limit', since: '2026-11-24T12:00:00Z', retry_at: null };
  const sayShare = 'Waiting: Google Drive links on this account download 3 at a time. This one starts by itself when one of yours finishes.';
  const retry = (at, mins) => ({
    waiting: { reason: 'drive_retry', since: '2026-11-24T12:01:00Z', retry_at: at },
    progress: `Google Drive did not send this file just now. Trying again at ${at.slice(11, 16)} UTC (in about ${mins} minutes). Nothing is charged while it waits.`,
  });
  const polls = [
    { status: 'created', waiting: share, progress: sayShare },
    { status: 'created', waiting: share, progress: sayShare },
    { status: 'downloading', ...retry('2026-11-24T12:06:00Z', 5) },
    { status: 'downloading', ...retry('2026-11-24T12:06:00Z', 4) },
    { status: 'downloading', ...retry('2026-11-24T12:16:00Z', 10) },
    { status: 'processing', progress: 'Transcription is in progress.' },
    { status: 'completed', progress: 'Transcription completed successfully.', audio_duration_seconds: 60, cost_cents: 0.33, result: { full_transcript: 'hi' } },
  ];
  let n = 0;
  const answer = (req) => {
    if (req.method === 'POST') return { body: { id: ID, status: 'created', message: 'ok' } };
    if (req.url.startsWith(`/v1/transcribe/${ID}`)) return { body: { id: ID, ...polls[Math.min(n++, polls.length - 1)] } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'no' } } };
  };
  await withStatusServer(answer, async (base) => {
    const { code, stderr } = await run(
      ['transcribe', 'https://drive.google.com/file/d/x/view', '--wait', '--poll-interval', '0', '--api-key', 'sk_live_test'],
      { SCRIPTIVOX_BASE_URL: base },
    );
    assert.equal(code, 0, stderr);
    const lines = stderr.split('\n');
    assert.equal(lines.filter((l) => l.includes(sayShare)).length, 1, 'the share line once');
    assert.equal(lines.filter((l) => l.includes('Trying again at 12:06 UTC')).length, 1, 'one line per planned try, not per poll');
    assert.equal(lines.filter((l) => l.includes('Trying again at 12:16 UTC')).length, 1, 'a new try time is a new line');
    assert.ok(lines.some((l) => l.trim() === 'processing …'));
  });
  n = 0;
  await withStatusServer(answer, async (base) => {
    const { code, stdout } = await run(['status', ID, '--api-key', 'sk_live_test'], { SCRIPTIVOX_BASE_URL: base });
    assert.equal(code, 0);
    assert.match(stdout, /waiting.*Google Drive links on this account download 3 at a time/);
  });
});
