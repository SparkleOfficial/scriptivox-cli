# Changelog

## 1.2.0

- `transcribe --wait` prints why a job waits for its turn, or for a later try at a Google Drive link (the API's `progress` sentence), once per reason and per planned try, not on every poll. The status lines are as before.
- `status` shows `waiting` with the same sentence while a job waits.

## 1.1.0

- `scriptivox-api service-status`: whether the API is taking new jobs right now, in one line (GET /v1/status). It needs no API key and sends none. Exit `0` while new jobs are taken, `3` while they are paused for maintenance, `4` when the status could not be checked just now (this does not mean the API is down). `--json` prints the whole answer.
- `scriptivox-api status` with no id now says where to look for the API's own status.
- A request paused for maintenance (`MAINTENANCE`, exit 2 as before) now also prints how long to wait (from the `Retry-After` header), the time it is expected back if one was set, and a pointer to `service-status`.

## 1.0.2

- Help: `cancel` stops a job only before transcription starts.

## 1.0.0

- First release on npm.
