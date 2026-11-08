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
202 { "ok": true, "job": { "statusPath": "/tryon/jobs/<id>" } }
       only with `Prefer: respond-async`: the photos are checked and the request is
       answered at once, and the picture is made after it
   400 malformed / not an image / no consent asserted
   401 token required or wrong
   413 too large
   415 not JSON, or a photo format the model cannot take
   429 rate limited
   502 the provider failed, or the model refused to draw it
   503 no try-on model configured on this boot, or this month's pictures are spent
       ("Try again on 1 <next month>"); both are decided before the photos are read

GET /tryon/budget
   200 { "available": true, "resetsOn": "2026-12-01" }
       asked by the app before it offers an ad, so no ad buys a picture that will be refused

POST /report
   { "reason": "offensive" | "sexual" | "not-me" | "other", "model": "…", "note": "…" }
   202 { "ok": true }   the reason, the model and the first 200 characters of the note go to
                        the log; no picture is ever sent
   400 a reason not on the list, or not JSON
   413 over 4 KB

GET /privacy
   200 the privacy policy the Google Play listing links to, as text/html

GET /tryon/jobs/<id>
   200 { "status": "pending" }
       { "status": "done", "look": { "imageUrl": "…", … } }
       { "status": "failed", "error": "<a sentence for the user>" }
   404 never handed out, forgotten by a restart, or collected more than 10 minutes ago

GET /look/<id>
   200 the picture a try-on just made, as image/png
   404 never handed out, or already expired

GET /
   302 the page that hands out the build, when ONME_DOWNLOAD_URL is set — as it is
       by default, to this deployment's own page: a browser that opens this
       hostname came for the app, and this hostname is not the app
   404 as before when ONME_DOWNLOAD_URL is empty
```

`GET /health` returns booleans, names and numbers only: whether it can generate, which model, the
limits, how many try-ons are in flight, the month's count (`monthlyTryOns`) and how many reports
came in. It never returns key material — a test asserts that.

Photos travel as base64 inside one JSON body rather than as multipart: the body stays a single
contiguous stream the phone can report upload progress for, and the server needs no multipart
parser. The cost is base64's 4/3 inflation and both images in memory for one request, bounded by
`ONME_MAX_UPLOAD_BYTES`.

## The two promises

- **No photograph is written to disk.** The photos live in memory for the length of one try-on
  and are then dropped; for a job, that is until the model answers, not until the request ends. No temp file, no cache, no bucket, no database. `scripts/smoke.js`
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
| `src/env.js` | where configuration comes from: `ONME_ENV_FILE` alone when set, otherwise `server/.env` > repository-root `.env`, with a real environment variable always winning |
| `src/limits.js` | the ceilings: 12 MB per photo, 40 MB per request, 6 try-ons a minute, 2 at once |
| `src/budget.js` | the monthly ceiling: pictures per calendar month (UTC), counted in memory, `ONME_MONTHLY_TRYON_LIMIT` (default 600) |
| `src/privacy.js` | the privacy policy page, next to the code it describes |
| `src/tryon/photos.js` | pure byte-signature sniffing (PNG/JPEG/WebP/HEIC), base64 validation, the required consent assertion |
| `src/tryon/fal.js` | the hand-rolled fal queue client: `POST` the model, poll `status_url`, `GET response_url` |
| `src/tryon/codex.js` | the subscription client: reads the Codex login, refreshes its token when it is close to expiry, posts both photos to the Codex event stream and reads the picture out of it |
| `src/tryon/looks.js` | the hand-off: a generated picture held in memory for minutes under an unguessable id, then forgotten |
| `src/tryon/jobs.js` | try-ons sent as jobs: each job's outcome (never a photo) in memory under an unguessable id, kept 10 minutes after it ends |
| `src/tryon/modal.js` | the Modal client: both photos to OnMe's own FASHN VTON function, authenticated with a Modal proxy token, the PNG back |

HEIC is recognised and refused with the fix spelled out (`JPEG or PNG`, iOS *Most Compatible*),
rather than being passed on to fail at the provider. In practice the app never sends one:
`expo-image-picker` with `base64: true` re-encodes every pick to JPEG on both platforms.

## Three providers, one endpoint

Which model makes the picture is decided at boot, not by the client:

| Provider | When it is used | What comes back |
|---|---|---|
| `fal` | a `FAL_KEY` is set | a URL the app downloads directly |
| `modal` | no `FAL_KEY`, but `ONME_MODAL_URL` and both halves of the Modal proxy token are set | the picture itself, served back from `GET /look/<id>` |
| `codex` | neither, but a Codex login is on this machine | the picture itself, served back from `GET /look/<id>` |

`ONME_TRYON_PROVIDER=fal|modal|codex` pins one; by default a rented model wins when there is a key for it,
because it is the dedicated try-on model. With neither, every try-on is a 503 decided before the
photos are read.

The Modal function (`modal/onme_tryon.py`) takes the first free GPU of L4, A10G and L40S. A cold
start that has to wait for one can take minutes, which is longer than the Cloudflare tunnel holds a
request open (about 100 seconds); that is why the app sends every try-on as a job.

The subscription path has one limit worth knowing, and it is not a bug: the image tool moderates
what it draws. An outfit carrying a character or a brand it recognises is refused, and so is some
editing of a face — the backend turns that into the same 502 as any other failed generation rather
than showing something else.

## Configuration

`FAL_KEY`, or the Codex login on this machine, is the only credential, and it lives only here. See
the table in the repository README for every variable; the defaults are in `src/limits.js`,
`src/tryon/fal.js`, `src/tryon/codex.js` and `src/tryon/looks.js`.

`ONME_DOWNLOAD_URL` is the one default that names this deployment rather than a protocol detail:
the page the bare root hops to. Point it at another deployment's build page, or set it empty to
have the root answer `not_found` the way a pure API would — the API routes are untouched either
way, and a test walks both cases.

## Run it

```bash
npm start          # node src/index.js
npm run dev        # same, with --watch
npm test           # 82 tests, no network
npm run smoke      # boots the real server twice, offline, and checks every refusal
```

The smoke test needs no key and contacts no provider: it proves the refusals, the health shape and
the nothing-on-disk claim by starting the server with an empty key and with a key that cannot work.
