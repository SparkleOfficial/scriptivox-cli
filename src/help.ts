import { CLI_VERSION } from './api.js';
import { DOCS_URL, KEYS_URL } from './config.js';

export const COMMANDS = [
  'transcribe',
  'upload',
  'status',
  'get',
  'list',
  'cancel',
  'delete',
  'balance',
  'service-status',
] as const;

export type CommandName = (typeof COMMANDS)[number];

export function isCommand(value: string | null): value is CommandName {
  return value !== null && (COMMANDS as readonly string[]).includes(value);
}

export function helpText(): string {
  return `scriptivox-api ${CLI_VERSION} — command-line client for the Scriptivox transcription API

Billed separately from scriptivox.com website plans: API usage draws down a
prepaid balance, and a website Pro subscription does not grant API credit.

USAGE
  scriptivox-api <command> [arguments] [options]

COMMANDS
  transcribe <url|file>   Transcribe a public URL, or upload a local file and transcribe it
                          (or pass --upload-id from a previous 'scriptivox-api upload')
  upload <file>           Upload a local file and print its upload_id (no transcription)
  status <id>             Show a job's current status
  get <id>                Print the transcript (add --format srt|vtt|text for captions)
  list                    List your transcriptions
  cancel <id>             Cancel a job before it starts transcribing (release its balance)
  delete <id>             Soft-delete a finished transcription
  balance                 Show remaining balance and estimated audio hours
  service-status          Show whether the API is taking new jobs right now, in one line
                          (no API key needed; exit 0, 3 or 4, see EXIT CODES)

TRANSCRIBE OPTIONS
  --language <code>       ISO 639-1 code, e.g. en, es, fr. Recommended: passing it is faster
                          and avoids auto-detect mistakes on short or code-switched audio
  --diarize               Label who said what
  --speakers <n>          Expected speaker count, 1-50. Requires --diarize
  --no-align              Skip word-level timestamps (ignored when --diarize is set)
  --webhook <url>         Receive an HMAC-signed callback instead of polling
  --wait                  Poll until the job completes or fails
  --idempotency-key <k>   Replay-safe retries; same key + same body returns the cached response

GET OPTIONS
  --format <f>            json (default), srt, vtt or text
  --max-words <n>         Caption segmentation, 1-50 (default 4)
  --max-chars <n>         Caption segmentation, 10-500 (default 80)
  --max-duration <n>      Caption segmentation, seconds, 1-60 (default 10)
  --no-sentence-aware     Do not break cues at sentence endings
  --speakers-in-captions <true|false|auto>
  --strip-chars <chars>   Remove these characters from cue text

LIST OPTIONS
  --status <s>            created, downloading, pending, processing, completed or failed
  --from <iso>            Inclusive lower bound on created_at
  --to <iso>              Exclusive upper bound on created_at
  --limit <n>             1-200 (default 50)
  --order <asc|desc>      Default desc
  --cursor <c>            next_cursor from a previous page

GLOBAL OPTIONS
  --api-key <key>         Overrides SCRIPTIVOX_API_KEY
  --base-url <url>        Overrides the API base URL
  --json                  Emit JSON on stdout; progress messages are suppressed
  --poll-interval <s>     Seconds between polls when waiting (default 5)
  --poll-timeout <s>      Seconds before giving up on --wait (default 600)
  -h, --help              Show this help
  -v, --version           Show the version

AUTHENTICATION
  export SCRIPTIVOX_API_KEY=sk_live_...
  Create a key at ${KEYS_URL}

EXAMPLES
  scriptivox-api transcribe https://example.com/meeting.mp3 --language en --diarize --wait
  scriptivox-api transcribe ./interview.m4a --diarize --speakers 2 --wait
  scriptivox-api get 4f3c... --format srt --max-words 3 > interview.srt
  scriptivox-api list --status completed --limit 20 --json
  scriptivox-api balance
  scriptivox-api service-status || echo "not taking new jobs right now"

EXIT CODES
  0  success
  1  usage error (bad arguments, missing API key)
  2  API error — the error code is printed on stderr
  3  service-status: new jobs are paused for maintenance
  4  service-status: could not check just now (this does not mean the API is down)

DOCUMENTATION
  ${DOCS_URL}
`;
}
