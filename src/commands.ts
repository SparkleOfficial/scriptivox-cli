import { stat } from 'node:fs/promises';
import { ScriptivoxApi, ApiError, type Transcription } from './api.js';
import { flagBool, flagNumber, flagString, type ParsedArgs } from './args.js';
import { formatCents, formatDuration, type Emitter } from './output.js';
import type { CommandName } from './help.js';
import { UsageError } from './errors.js';

export { UsageError };

/**
 * One function per command. Each returns nothing and writes through `out`;
 * failures throw (ApiError for anything the server rejected, UsageError for
 * anything the caller got wrong) and are turned into exit codes in index.ts.
 */

export interface CommandContext {
  api: ScriptivoxApi;
  args: ParsedArgs;
  out: Emitter;
}

export async function runCommand(
  name: CommandName,
  ctx: CommandContext
): Promise<void> {
  switch (name) {
    case 'transcribe': return transcribe(ctx);
    case 'upload': return upload(ctx);
    case 'status': return status(ctx);
    case 'get': return get(ctx);
    case 'list': return list(ctx);
    case 'cancel': return cancel(ctx);
    case 'delete': return remove(ctx);
    case 'balance': return balance(ctx);
  }
}

// ─── transcribe ─────────────────────────────────────────────────────────────

async function transcribe({ api, args, out }: CommandContext): Promise<void> {
  const target = args.positionals[0];
  const uploadId = flagString(args.flags, 'upload-id');

  if (!target && !uploadId) {
    throw new UsageError(
      'transcribe needs a URL, a file path, or --upload-id from a previous `scriptivox-api upload`.'
    );
  }
  if (target && uploadId) {
    throw new UsageError(
      'Pass either a URL/file or --upload-id, not both — the API accepts exactly one source.'
    );
  }

  const idempotencyKey = flagString(args.flags, 'idempotency-key');

  const options = {
    language: flagString(args.flags, 'language', 'lang'),
    diarize: flagBool(args.flags, 'diarize'),
    speaker_count: flagNumber(args.flags, 'speakers', 'speaker-count'),
    // --no-align maps to align:false. Left undefined otherwise so the API's own
    // default (true) applies rather than us restating it.
    align: flagBool(args.flags, 'no-align') === true ? false : undefined,
    webhook_url: flagString(args.flags, 'webhook', 'webhook-url'),
  };

  if (options.speaker_count !== undefined && !options.diarize) {
    throw new UsageError(
      '--speakers requires --diarize; the API rejects a speaker count without diarization.'
    );
  }

  let job: Transcription;

  if (uploadId) {
    out.note(`Submitting upload ${uploadId} …`);
    job = await api.createTranscriptionFromUpload(uploadId, options, idempotencyKey);
  } else if (isHttpUrl(target)) {
    out.note(`Submitting ${target} …`);
    job = await api.createTranscriptionFromUrl(target, options, idempotencyKey);
  } else {
    await assertReadableFile(target);
    out.note(`Uploading ${target} …`);
    const uploaded = await api.uploadFile(target, idempotencyKey);
    out.note(`Uploaded (upload_id ${uploaded.upload_id}). Submitting …`);
    job = await api.createTranscriptionFromUpload(uploaded.upload_id, options);
  }

  if (!flagBool(args.flags, 'wait')) {
    out.note(`Job ${job.id} accepted. Poll it with: scriptivox-api status ${job.id}`);
    out.data(job);
    return;
  }

  let lastStatus = '';
  const finished = await api.waitForCompletion(job.id, (tick) => {
    if (tick.status !== lastStatus) {
      lastStatus = tick.status;
      out.note(`  ${tick.status} …`);
    }
  });

  if (finished.status === 'failed') {
    throw new ApiError(
      200,
      { error: finished.error ?? undefined },
      'The transcription failed.'
    );
  }

  out.note(
    `Completed in ${formatDuration(finished.audio_duration_seconds)} of audio, ` +
      `${formatCents(finished.cost_cents)}.`
  );
  out.data(finished);
}

// ─── upload ─────────────────────────────────────────────────────────────────

async function upload({ api, args, out }: CommandContext): Promise<void> {
  const path = args.positionals[0];
  if (!path) throw new UsageError('upload needs a file path.');
  await assertReadableFile(path);

  out.note(`Uploading ${path} …`);
  const result = await api.uploadFile(path, flagString(args.flags, 'idempotency-key'));
  out.note(
    `Uploaded. Transcribe it with: scriptivox-api transcribe --upload-id ${result.upload_id}`
  );
  out.data(result);
}

// ─── status ─────────────────────────────────────────────────────────────────

async function status({ api, args, out }: CommandContext): Promise<void> {
  const id = requireId(args, 'status');
  const job = await api.getTranscription(id);

  if (args.flags.json) {
    out.data(job);
    return;
  }

  out.data({
    id: job.id,
    status: job.status,
    language: job.language ?? '—',
    duration: formatDuration(job.audio_duration_seconds),
    cost: formatCents(job.cost_cents),
    created: job.created_at ?? '—',
    completed: job.completed_at ?? '—',
    error: job.error ? `${job.error.code}: ${job.error.message}` : undefined,
  });
}

// ─── get ────────────────────────────────────────────────────────────────────

async function get({ api, args, out }: CommandContext): Promise<void> {
  const id = requireId(args, 'get');
  const format = (flagString(args.flags, 'format') ?? 'json') as
    | 'json' | 'srt' | 'vtt' | 'text';

  if (!['json', 'srt', 'vtt', 'text'].includes(format)) {
    throw new UsageError(`--format must be json, srt, vtt or text (got "${format}").`);
  }

  if (format === 'json') {
    const job = await api.getTranscription(id);
    if (args.flags.json) {
      out.data(job);
    } else {
      // Without --json the useful thing to print is the transcript itself, not
      // a dump of the envelope around it.
      out.raw((job.result?.full_transcript ?? '') + '\n');
    }
    return;
  }

  const body = await api.exportTranscription(id, {
    format,
    max_words: flagNumber(args.flags, 'max-words'),
    max_chars: flagNumber(args.flags, 'max-chars'),
    max_duration: flagNumber(args.flags, 'max-duration'),
    sentence_aware:
      flagBool(args.flags, 'no-sentence-aware') === true ? false : undefined,
    include_speakers: flagString(args.flags, 'speakers-in-captions') as
      | 'true' | 'false' | 'auto' | undefined,
    strip_chars: flagString(args.flags, 'strip-chars'),
  });

  out.raw(body.endsWith('\n') ? body : body + '\n');
}

// ─── list ───────────────────────────────────────────────────────────────────

async function list({ api, args, out }: CommandContext): Promise<void> {
  const page = await api.listTranscriptions({
    status: flagString(args.flags, 'status'),
    from: flagString(args.flags, 'from'),
    to: flagString(args.flags, 'to'),
    limit: flagNumber(args.flags, 'limit'),
    order: flagString(args.flags, 'order'),
    cursor: flagString(args.flags, 'cursor'),
  });

  if (args.flags.json) {
    out.data(page);
    return;
  }

  if (page.items.length === 0) {
    out.note('No transcriptions matched.');
    return;
  }

  for (const item of page.items) {
    out.raw(
      [
        item.id,
        item.status.padEnd(11),
        formatDuration(item.audio_duration_seconds).padStart(9),
        formatCents(item.cost_cents).padStart(9),
        item.created_at ?? '',
      ].join('  ') + '\n'
    );
  }

  if (page.next_cursor) {
    out.note(`More results. Next page: --cursor ${page.next_cursor}`);
  }
}

// ─── cancel / delete / balance ──────────────────────────────────────────────

async function cancel({ api, args, out }: CommandContext): Promise<void> {
  const id = requireId(args, 'cancel');
  const result = await api.cancelTranscription(id);
  out.note('Cancelled. The reserved balance was released; you were not charged.');
  out.data(result);
}

async function remove({ api, args, out }: CommandContext): Promise<void> {
  const id = requireId(args, 'delete');
  await api.deleteTranscription(id);
  out.note(`Deleted ${id}.`);
  if (args.flags.json) out.data({ id, deleted: true });
}

async function balance({ api, args, out }: CommandContext): Promise<void> {
  const b = await api.getBalance();

  if (args.flags.json) {
    out.data(b);
    return;
  }

  out.data({
    available: formatCents(b.available_cents),
    reserved: formatCents(b.reserved_cents),
    total: formatCents(b.balance_cents),
    'price/hour': formatCents(b.price_per_hour_cents),
    'hours left': b.estimated_hours_available?.toFixed(1) ?? '—',
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function requireId(args: ParsedArgs, command: string): string {
  const id = args.positionals[0];
  if (!id) throw new UsageError(`${command} needs a transcription ID.`);
  return id;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function assertReadableFile(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new UsageError(`${path} is not a file.`);
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(
      `Cannot read ${path}. Pass a readable local file, or an http(s) URL to transcribe from.`
    );
  }
}
