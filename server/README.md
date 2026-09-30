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
   502 the provider failed, or the model refused to draw it
   503 no try-on model configured on this boot

GET /look/<id>
   200 the picture a try-on just made, as image/png
   404 never handed out, or already expired
```

`GET /health` returns booleans, names and numbers only: whether it can generate, which model, the
limits, how many try-ons are in flight. It never returns key material — a test asserts that.

Photos travel as base64 inside one JSON body rather than as multipart: the body stays a single
contiguous stream the phone can report upload progress for, and the server needs no multipart
parser. The cost is base64's 4/3 inflation and both images in memory for one request, bounded by
`ONME_MAX_UPLOAD_BYTES`.

## The two promises

- **No photograph is written to disk.** The photos live in memory for the length of one request
  and are then dropped. No temp file, no cache, no bucket, no database. `scripts/smoke.js`
  snapshots the file tree before and after the run and fails if anything changed. A generated
  picture stays in memory too, for the few minutes it waits to be collected. The single write this
  server makes is not a photograph: a subscription access token that was close to expiry, put back
  in the credential file it came from, and only when it had to be refreshed.
- **A picture is never shown that this server did not generate.** With no provider the answer is a
  503; when the model refuses to draw something the answer is a 502. There is no fallback image, no
  stand-in and no retry loop that would spend the user's quota to collect the same refusal.
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
| `src/tryon/codex.js` | the subscription client: reads the Codex login, refreshes its token when it is close to expiry, posts both photos to the Codex event stream and reads the picture out of it |
| `src/tryon/looks.js` | the hand-off: a generated picture held in memory for minutes under an unguessable id, then forgotten |

HEIC is recognised and refused with the fix spelled out (`JPEG or PNG`, iOS *Most Compatible*),
rather than being passed on to fail at the provider. In practice the app never sends one:
`expo-image-picker` with `base64: true` re-encodes every pick to JPEG on both platforms.

## Two providers, one endpoint

Which model makes the picture is decided at boot, not by the client:

| Provider | When it is used | What comes back |
|---|---|---|
| `fal` | a `FAL_KEY` is set | a URL the app downloads directly |
| `codex` | no key, but a Codex login is on this machine | the picture itself, served back from `GET /look/<id>` |

`ONME_TRYON_PROVIDER=fal|codex` pins one; by default a rented model wins when there is a key for it,
because it is the dedicated try-on model. With neither, every try-on is a 503 decided before the
photos are read.

The subscription path has one limit worth knowing, and it is not a bug: the image tool moderates
what it draws. An outfit carrying a character or a brand it recognises is refused, and so is some
editing of a face — the backend turns that into the same 502 as any other failed generation rather
than showing something else.

## Configuration

`FAL_KEY`, or the Codex login on this machine, is the only credential, and it lives only here. See
the table in the repository README for every variable; the defaults are in `src/limits.js`,
`src/tryon/fal.js`, `src/tryon/codex.js` and `src/tryon/looks.js`.

## Run it

```bash
npm start          # node src/index.js
npm run dev        # same, with --watch
npm test           # 82 tests, no network
npm run smoke      # boots the real server twice, offline, and checks every refusal
```

The smoke test needs no key and contacts no provider: it proves the refusals, the health shape and
the nothing-on-disk claim by starting the server with an empty key and with a key that cannot work.
