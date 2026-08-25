/**
 * Configuration for the Scriptivox API CLI.
 *
 * Scope: this tool talks to the public transcription API at
 * https://api.scriptivox.com/v1 and nothing else. It is a peer of
 * @scriptivox/mcp-server — same API, different transport. There is no session
 * auth, no cookie handling, no dashboard access, and it never reads anything
 * from the web app.
 *
 * That separation is also why the package is @scriptivox-api/cli and the binary
 * is `scriptivox-api`. Scriptivox is two products: the scriptivox.com website,
 * whose Pro plan includes unlimited transcription, and this API, which is
 * pay-as-you-go against a prepaid balance. A website subscription grants no API
 * credit, and the two are billed independently. Naming the CLI after the
 * website would invite exactly that misunderstanding, so it is not.
 */

export const DEFAULT_BASE_URL = 'https://api.scriptivox.com/v1';
/**
 * The page about THIS tool, not the documentation index.
 *
 * Someone reading `--help` already has the CLI; what they are missing is the
 * rest of its surface — every flag, the exit-code contract, the scripting
 * notes. /docs/cli is that page. /docs is a level too high to be useful here.
 */
export const DOCS_URL = 'https://platform.scriptivox.com/docs/cli';
export const KEYS_URL = 'https://platform.scriptivox.com/keys';
export const BILLING_URL = 'https://platform.scriptivox.com/billing';

export interface CliConfig {
  baseUrl: string;
  apiKey: string;
  /** Emit machine-readable JSON on stdout instead of formatted text. */
  json: boolean;
  /** Seconds between polls when waiting for a job. */
  pollIntervalSeconds: number;
  /** Give up waiting after this many seconds. */
  pollTimeoutSeconds: number;
}

export const NO_API_KEY_MESSAGE = `No Scriptivox API key configured.

Set one of:
  export SCRIPTIVOX_API_KEY=sk_live_...
  scriptivox-api <command> --api-key sk_live_...

Create a key at ${KEYS_URL} and add credit at ${BILLING_URL}
($5 minimum, $0.20 per hour of audio).

Note: API usage is billed separately from scriptivox.com website plans. A Pro
subscription on the website does not grant API credit.`;
