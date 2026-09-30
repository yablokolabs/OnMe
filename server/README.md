# OnMe backend

One endpoint. Two photos in, one generated try-on out. Node 22 and `fetch`, **no dependencies at
all** — there is no tree to keep patched, and the whole service is small enough to read in a sitting.

```
POST /tryon?token=…
content-type: application/json
{
  "consentAt": "2026-09-30T09:00:00.000Z",
  "person": { "mimeType": "image/jpeg", "data": "<base64>" },
  "outfit": { "mimeType": "image/jpeg", "data": "<base64>" }
}

200 { "image": { "mimeType": "image/jpeg", "data": "<base64>" } }
   400 malformed / not an image / no consent asserted
   401 token required or wrong
   413 too large
   415 not JSON, or a photo format the model cannot take
   429 rate limited
   502 the provider failed
   503 no try-on model configured on this boot
```

`GET /health` returns booleans, names and numbers only: whether it can generate, which model, the
limits, how many try-ons are in flight. It never returns key material — a test asserts that.

Photos travel as base64 inside one JSON body rather than as multipart: the body stays a single
contiguous stream the phone can report upload progress for, and the server needs no multipart
parser. The cost is base64's 4/3 inflation and both images in memory for one request, bounded by
`ONME_MAX_UPLOAD_BYTES`.

## The two promises

- **Nothing is written to disk.** The photos live in memory for the length of one request and are
  then dropped. No temp file, no cache, no bucket, no database. `scripts/smoke.js` snapshots the
  file tree before and after the run and fails if anything changed.
- **Every refusal is decided before the photos are read.** The order is
  `405 → 401 → 503 (no model) → 415 → 413 (declared length) → 429 →` and only then is a byte of an
  image accepted. A request this server cannot serve is answered without it ever receiving a
  photograph of a person.

## Files

| File | What it holds |
|---|---|
| `src/index.js` | the whole API: routing, the checks in the order above, `readBody` (which drains an oversized request rather than destroying the socket), the abort on `res.on('close')`, and `/health` |
| `src/env.js` | where configuration comes from: `ONME_ENV_FILE` > `server/.env` > repository-root `.env`, with a real environment variable always winning |
| `src/limits.js` | the ceilings: 12 MB per photo, 40 MB per request, 6 try-ons a minute, 2 at once |
| `src/tryon/photos.js` | pure byte-signature sniffing (PNG/JPEG/WebP/HEIC), base64 validation, the required consent assertion |
| `src/tryon/fal.js` | the hand-rolled fal queue client: `POST` the model, poll `status_url`, `GET response_url` |

HEIC is recognised and refused with the fix spelled out (`JPEG or PNG`, iOS *Most Compatible*),
rather than being passed on to fail at the provider. In practice the app never sends one:
`expo-image-picker` with `base64: true` re-encodes every pick to JPEG on both platforms.

## Configuration

`FAL_KEY` is the only secret, and it lives only here. See the table in the repository README for
every variable; the defaults are in `src/limits.js` and `src/tryon/fal.js`.

## Run it

```bash
npm start          # node src/index.js
npm run dev        # same, with --watch
npm test           # 46 tests, no network
npm run smoke      # boots the real server twice, offline, and checks every refusal
```

The smoke test needs no key and contacts no provider: it proves the refusals, the health shape and
the nothing-on-disk claim by starting the server with an empty key and with a key that cannot work.
