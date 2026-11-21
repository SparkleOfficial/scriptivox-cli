# @scriptivox-api/cli

Command-line client for the [Scriptivox](https://platform.scriptivox.com/docs) transcription API.
Transcribe recorded audio and video from your shell or a script — 119 languages, speaker
diarization, word-level timestamps, and SRT / WebVTT / plain-text export.

It is a peer of [`@scriptivox/mcp-server`](https://www.npmjs.com/package/@scriptivox/mcp-server):
same API, different transport.

## This is the API, not the website

Scriptivox is two products, billed independently:

| | [scriptivox.com](https://www.scriptivox.com) | This API |
| --- | --- | --- |
| What it is | Web app you sign in to | REST API you call with a key |
| Billing | Subscription — Pro includes unlimited transcription | Pay as you go, $0.20 per hour of audio |
| Balance | n/a | Prepaid, $5 minimum |

**A website subscription does not grant API credit.** Even on Pro, API calls draw down a separate
prepaid balance. That is why this package is `@scriptivox-api/cli` and the command is
`scriptivox-api` rather than `scriptivox`.

## Scope

This tool talks to `https://api.scriptivox.com/v1` and nothing else. Authentication is an
`sk_live_…` API key — there is no session login, no cookie handling, and no access to the web app
or the developer dashboard. Every command maps one-to-one to an operation in the
[OpenAPI specification](https://platform.scriptivox.com/openapi.json).

## Install

```bash
npm install -g @scriptivox-api/cli
# or run it without installing
npx @scriptivox-api/cli --help
```

Requires Node 18 or newer. No runtime dependencies.

## Authenticate

Create a key at [platform.scriptivox.com/keys](https://platform.scriptivox.com/keys) and add
credit at [/billing](https://platform.scriptivox.com/billing) — $0.20 per hour of audio, $5
minimum deposit.

```bash
export SCRIPTIVOX_API_KEY=sk_live_...
```

Or pass `--api-key` per command.

## Use

```bash
# Transcribe a public URL and wait for the result
scriptivox-api transcribe https://example.com/meeting.mp3 --language en --diarize --wait

# Upload a local file, transcribe it, wait
scriptivox-api transcribe ./interview.m4a --diarize --speakers 2 --wait

# Export captions (stdout is clean — progress goes to stderr)
scriptivox-api get 4f3c... --format srt --max-words 3 > interview.srt
scriptivox-api get 4f3c... --format vtt --speakers-in-captions true > interview.vtt

# Inspect and manage jobs
scriptivox-api status 4f3c...
scriptivox-api list --status completed --limit 20 --json
scriptivox-api cancel 4f3c...
scriptivox-api delete 4f3c...

# Check your balance
scriptivox-api balance

# Is the API taking new jobs right now? One line, no API key needed
scriptivox-api service-status
```

Run `scriptivox-api --help` for every flag.

## Scripting

Structured output goes to **stdout**, progress and diagnostics to **stderr**, so redirection
produces clean files even while the command is reporting status. `--json` emits JSON on stdout and
silences the progress messages entirely.

Exit codes are part of the contract:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Usage error — bad arguments, missing API key, unreadable file |
| `2` | API error — the machine-readable error code is printed on stderr |
| `3` | `service-status` only: new jobs are paused for maintenance |
| `4` | `service-status` only: the status could not be checked just now (this does not mean the API is down) |

```bash
if ! scriptivox-api transcribe ./call.mp3 --wait --json > result.json; then
  echo "transcription failed with exit $?" >&2
fi
```

## Maintenance

Now and then part of the API is paused for maintenance. A paused request fails with exit 2 and says so
on stderr: `MAINTENANCE` with our message, how long to wait (`Retry after 300s.`), the time it is
expected back if we set one, and a pointer to `service-status`. Nothing was created or charged, so run
it again later. Jobs already accepted always finish.

`scriptivox-api service-status` says whether the API is taking new jobs, in one line, before you
send any. It calls `GET /v1/status`, which needs no API key (none is sent):

```bash
$ scriptivox-api service-status
New jobs are paused for maintenance: Starting new jobs and uploads, expected back by 2026-11-21 10:40 UTC ("Planned upgrade."). Try again in 2400 seconds. Jobs already accepted finish.
$ echo $?
3
```

It exits `0` while new jobs are taken (also when only links to video and social media sites are
paused: uploads and other file links still work, and the line names the pause), `3` while new jobs
are paused, and `4` when the status could not be checked just now, which does not mean the API is
down. `--json` prints the whole answer. Uptime and incident history:
[status.scriptivox.com](https://status.scriptivox.com).

## Things worth knowing

- **`transcribe` returns before the work is done.** Without `--wait` you get a job ID; input
  problems (unreachable URL, unsupported media, audio too long) surface later on `status`, with
  `status: failed` and an `error.code`. Check the poll path, not just the submit call.
- **Pass `--language` when you know it.** Auto-detection works most of the time but mis-routes on
  short clips, code-switched audio, and files that open with music. Passing the language is also
  faster, because the model skips its detection pass.
- **`--speakers` needs `--diarize`.** It is a prior, not a hard cap: asking for 5 may yield 6.
- **Failed and cancelled jobs are free.** The reserved balance is released.
- **`--idempotency-key` makes retries safe.** The same key with the same body replays the cached
  response for 24 hours instead of starting a second, separately-billed job.

## Develop

```bash
npm install
npm run build
npm test        # offline smoke tests: arg parsing, help, exit codes
```

`test/smoke.mjs` never touches the network. Keep it that way — it is the guard that stops a
refactor from silently changing an exit code that scripts depend on.

## License

MIT
