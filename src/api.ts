import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliConfig } from './config.js';
import { DOCS_URL } from './config.js';

/**
 * Thin client over the public API operations this CLI uses. Mirrors the OpenAPI
 * document at https://platform.scriptivox.com/openapi.json one-to-one — one
 * method per operationId, no convenience endpoints that the API does not have.
 */

export interface ApiErrorBody {
  error?: { code?: string; message?: string; docs_url?: string; back_by?: string | null };
  retry_after?: number;
}

/**
 * An API failure carrying the server's machine-readable code, so callers (and
 * the shell) can branch on the reason rather than on a message string.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly docsUrl: string;
  readonly retryAfter?: number;
  /** On a 503 MAINTENANCE: when the pause is expected to end (ISO 8601, UTC), if a time was set. */
  readonly backBy?: string;

  constructor(status: number, body: ApiErrorBody | null, fallback: string, retryAfterHeader?: string | null) {
    const code = body?.error?.code ?? 'UNKNOWN_ERROR';
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.docsUrl = body?.error?.docs_url ?? `${DOCS_URL}/api-reference#error-codes`;
    // The Retry-After header (whole seconds) is what a 503 carries; the gateway's own 429 also puts it in the body.
    const fromHeader = retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim()) ? Number(retryAfterHeader.trim()) : undefined;
    this.retryAfter = fromHeader ?? body?.retry_after;
    this.backBy = typeof body?.error?.back_by === 'string' ? body.error.back_by : undefined;
  }
}

export interface Upload {
  upload_id: string;
  upload_url: string;
  expires_in: number;
  method: string;
  headers: Record<string, string>;
}

export interface TranscriptionOptions {
  language?: string | null;
  diarize?: boolean;
  speaker_count?: number;
  align?: boolean;
  webhook_url?: string;
}

export interface CaptionOptions {
  format?: 'json' | 'srt' | 'vtt' | 'text';
  max_words?: number;
  max_chars?: number;
  max_duration?: number;
  sentence_aware?: boolean;
  include_speakers?: 'true' | 'false' | 'auto';
  strip_chars?: string;
}

export interface Transcription {
  id: string;
  status: string;
  audio_duration_seconds?: number | null;
  cost_cents?: number | null;
  language?: string | null;
  created_at?: string;
  completed_at?: string | null;
  error?: { code: string; message: string } | null;
  result?: { full_transcript?: string } | null;
  [key: string]: unknown;
}

/** Statuses from which a job will never move again. */
export const TERMINAL_STATUSES = new Set(['completed', 'failed']);

export class ScriptivoxApi {
  constructor(private readonly config: CliConfig) {}

  // ─── Operations ──────────────────────────────────────────────────────────

  /** operationId: createUpload */
  createUpload(filename: string, idempotencyKey?: string): Promise<Upload> {
    return this.request<Upload>('POST', '/upload', {
      body: { filename },
      idempotencyKey,
    });
  }

  /** operationId: createTranscription (URL flow) */
  createTranscriptionFromUrl(
    url: string,
    options: TranscriptionOptions,
    idempotencyKey?: string
  ): Promise<Transcription> {
    return this.request<Transcription>('POST', '/transcribe', {
      body: { url, ...pruneUndefined(options) },
      idempotencyKey,
    });
  }

  /** operationId: createTranscription (upload flow) */
  createTranscriptionFromUpload(
    uploadId: string,
    options: TranscriptionOptions,
    idempotencyKey?: string
  ): Promise<Transcription> {
    return this.request<Transcription>('POST', '/transcribe', {
      body: { upload_id: uploadId, ...pruneUndefined(options) },
      idempotencyKey,
    });
  }

  /** operationId: getTranscription (JSON form) */
  getTranscription(id: string): Promise<Transcription> {
    return this.request<Transcription>('GET', `/transcribe/${encodeURIComponent(id)}`);
  }

  /**
   * operationId: getTranscription with ?format=srt|vtt|text.
   * Returns the raw body, because the API answers text/plain or text/vtt here.
   */
  async exportTranscription(id: string, options: CaptionOptions): Promise<string> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(pruneUndefined(options))) {
      query.set(k, String(v));
    }
    const res = await this.fetch(
      'GET',
      `/transcribe/${encodeURIComponent(id)}?${query.toString()}`
    );
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, safeJson(text), text.slice(0, 200), res.headers.get('retry-after'));
    return text;
  }

  /** operationId: deleteTranscription */
  async deleteTranscription(id: string): Promise<void> {
    const res = await this.fetch('DELETE', `/transcribe/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, safeJson(text), text.slice(0, 200), res.headers.get('retry-after'));
    }
  }

  /** operationId: cancelTranscription */
  cancelTranscription(id: string): Promise<Transcription> {
    return this.request<Transcription>(
      'POST',
      `/transcribe/${encodeURIComponent(id)}/cancel`
    );
  }

  /** operationId: listTranscriptions */
  listTranscriptions(params: Record<string, string | number | undefined>) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(pruneUndefined(params))) {
      query.set(k, String(v));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.request<{ items: Transcription[]; next_cursor: string | null }>(
      'GET',
      `/transcriptions${suffix}`
    );
  }

  /** operationId: getBalance */
  getBalance() {
    return this.request<{
      balance_cents: number;
      reserved_cents: number;
      available_cents: number;
      price_per_hour_cents: number;
      estimated_hours_available?: number;
      deposit_url?: string;
    }>('GET', '/balance');
  }

  /**
   * operationId: getServiceStatus. Needs no API key, so none is sent. Returns
   * the parsed body as the API sent it, unchecked: serviceStatus.ts decides
   * whether it is a usable status (anything else is "could not check").
   */
  getServiceStatus(): Promise<unknown> {
    return this.request<unknown>('GET', '/status', { auth: false });
  }

  // ─── Composed helpers ────────────────────────────────────────────────────

  /**
   * Upload a local file: create the presigned URL, then PUT the bytes to it.
   * The file is read fully into memory because the API caps uploads at 5 GB and
   * Node's fetch cannot stream a request body without duplex support that is
   * still unavailable on every runtime we claim to support.
   */
  async uploadFile(path: string, idempotencyKey?: string): Promise<Upload> {
    const bytes = await readFile(path);
    const upload = await this.createUpload(basename(path), idempotencyKey);

    const res = await fetch(upload.upload_url, {
      method: upload.method || 'PUT',
      headers: upload.headers ?? {},
      body: new Uint8Array(bytes),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(
        res.status,
        safeJson(text),
        `Upload to the presigned URL failed with HTTP ${res.status}.`
      );
    }

    return upload;
  }

  /**
   * Poll until the job reaches a terminal status. `onTick` is called after each
   * poll so the caller owns all output — this module never writes to stdout.
   */
  async waitForCompletion(
    id: string,
    onTick?: (job: Transcription) => void
  ): Promise<Transcription> {
    const deadline = Date.now() + this.config.pollTimeoutSeconds * 1000;

    for (;;) {
      const job = await this.getTranscription(id);
      onTick?.(job);
      if (TERMINAL_STATUSES.has(job.status)) return job;

      if (Date.now() >= deadline) {
        throw new ApiError(
          408,
          {
            error: {
              code: 'CLI_POLL_TIMEOUT',
              message: `Gave up after ${this.config.pollTimeoutSeconds}s. The job is still running — check it later with: scriptivox-api status ${id}`,
            },
          },
          'Poll timeout'
        );
      }

      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  // ─── Transport ───────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string; auth?: boolean } = {}
  ): Promise<T> {
    const res = await this.fetch(method, path, opts.body, opts.idempotencyKey, opts.auth);
    const text = await res.text();

    if (!res.ok) {
      throw new ApiError(res.status, safeJson(text), text.slice(0, 200), res.headers.get('retry-after'));
    }

    if (!text) return undefined as T;
    const parsed = safeJson(text);
    if (parsed === null) {
      throw new ApiError(
        res.status,
        {
          error: {
            code: 'INVALID_RESPONSE',
            message: 'The API returned a body that is not JSON.',
          },
        },
        'Invalid response'
      );
    }
    return parsed as T;
  }

  private fetch(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    auth = true
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': `scriptivox-api-cli/${CLI_VERSION}`,
    };
    // GET /status needs no key: send none rather than an empty or real one.
    if (auth) headers.Authorization = this.config.apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Only sent when the caller asked for it. Without the header the endpoints
    // behave normally (no caching), which is the right default for a CLI where
    // most invocations are new work.
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    return fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

/**
 * Read from package.json at runtime so it can never drift from what npm
 * publishes — the same approach as mcp-server/src/config.ts. package.json sits
 * one level up from this file in the source tree (src/), in the compiled output
 * (dist/) and inside the installed package, so "../package.json" resolves in
 * every case. A hardcoded constant here was already wrong once: it claimed to
 * be kept in sync by a script that does not exist.
 */
function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION = readVersion();

function pruneUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
