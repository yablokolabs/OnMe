# OnMe

**See it on you.**

A full-body photo of yourself. A photo of an outfit you love. OnMe shows you wearing it — your
face, your hair, your skin tone, your pose, your proportions — in one tap.

No prompts. No sliders. No body settings. Nothing to type. Two photos in, one picture out.

The whole product turns on one idea: an outfit you are considering should be *seen on you*, not on
a model who is four inches taller than you in a studio light you will never stand in. So the app
does not offer a "body type" dropdown to approximate you with — it takes your actual photograph and
keeps it as the person in the picture. If a result stops looking like the person who took the
photo, nothing else it gets right matters.

## What is built, and what is not

Be precise about this, because the demo is easy to overstate:

| Piece | State |
|---|---|
| Choose a full-body photo of yourself; OnMe keeps it so later try-ons only need the outfit | working |
| Choose the outfit — camera or Files | working |
| Photo copies held in the app's own storage, so an expiring picker cache cannot break a look | working |
| The try-on itself, preserving face, hair, skin tone, pose and proportions | working — `fal-ai/image-apps-v2/virtual-try-on`, called through the OnMe backend |
| Upload progress, then "making your picture" | working |
| SQLite library of every look, with the outfit it used; works with no connection | working |
| Share a look, delete your photo, delete all looks, delete everything | working |
| Backend: one endpoint, token gate, size and rate limits, **nothing written to disk** | working |
| **A deployed backend** | **working** — live at `https://onme.yablokolabs.com`, behind its own named Cloudflare tunnel, with the tunnel and both services installed and enabled at boot |
| **A real try-on today** | **not possible yet** — there is no `FAL_KEY` on the server, so `/health` reports `tryOnReady: false` and the app repeats that sentence on screen. Adding the key needs no rebuild: it never reaches the app |
| **An installable Android build** | **not built** — no EAS project id and no APK artifact yet; the app is run from the dev server meanwhile (see *Getting it onto a phone*) |
| Accounts, sign-in, per-user entitlement | not built — the shared token is a throttle, not authentication |
| Generating on the device | not built, deliberately: there is no GPU here, so every generation is a rented one |

**The app never fakes the missing half.** With no model configured, the backend answers
`503 This OnMe backend has no try-on model configured, so it cannot make a picture yet.` before it
reads a single byte of the upload, the app shows that sentence, and no screen offers a placeholder
image that pretends to be you. Showing a stock photo of someone else in the outfit, on a screen
whose whole premise is *this is what it would look like on you*, is the one thing this product
cannot afford to do.

## The flow

1. **You, once** — `Try something on` opens the photo picker. A full-body photo standing, in
   reasonably even light. OnMe copies it into its own storage, so the next try-on skips this step.
2. **The outfit** — the same picker for the piece you are considering. A flat-lay, a product shot
   or a photo on a hanger all work; the model wants the garment, not the model wearing it.
3. **The picture** — the two frames upload to the OnMe backend and the try-on runs. You see the
   upload run, then the generation, because both stages are real and one of them is slow.
4. **Your looks** — the finished picture is downloaded to the phone and joins the library, with the
   outfit photo it was made from. Open one to see it full-screen, share it, or delete it.

## What happens to the photos

- Both photos go to the OnMe backend, and the backend passes them to the try-on model to make the
  picture. That is the only thing either photo is ever used for.
- **The backend writes nothing to disk.** The two photos live in memory for the length of one
  request and are then dropped — no temp file, no cache, no log of the image data.
- **`FAL_KEY` never reaches the app.** The provider credential exists only in the backend's
  environment. The app sends photos to OnMe's own endpoint and nothing else.
- The generated picture is downloaded to the phone, which is why looks keep working offline.
- Everything OnMe keeps is on the phone, and Settings can delete each part of it separately:
  the photo of you, every look, or all of it.

## Architecture

```
full-body photo of you  +  outfit photo        (both on the phone)
  -> Expo app (expo-router, expo-sqlite)       picks, copies, remembers
       POST /tryon                             JSON, base64 photos, consent timestamp
       Authorization: ?token=…                 only when ONME_CLIENT_TOKEN is set
  -> OnMe backend (Node 22, built-ins only)
       refuse before reading: 405 -> 401 -> 503 (no model) -> 415 -> 413 -> 429
       sniff the bytes: must really be PNG/JPEG/WebP; HEIC is refused with a fix
       fal queue: POST model -> poll status_url -> GET response_url
  -> fal-ai/image-apps-v2/virtual-try-on        preserve_pose, 3:4
  -> one generated image -> back to the phone, saved in SQLite, never on the server
```

Two design points worth naming:

- **The refusals happen before the photos are read.** A request that is oversized, unauthenticated,
  wrongly typed, or arriving at an unconfigured backend is answered without the server ever
  receiving an image. Photos of a person are the most sensitive thing here, and there is no reason
  to accept them just to say no.
- **The queue client is hand-rolled on `fetch`.** `server/` has **no dependencies at all** — Node
  built-ins only. There is no tree to keep patched, and `/health` and the deploy stay tiny.

## Running it

```bash
npm install
cp .env.example .env          # then edit it

npm run server:dev            # the backend — PORT 8787, every interface by default
PORT=8788 npm run server:dev  # …or another port, if 8787 is already serving something

npm start                     # the app (Expo)

# or point the app at a backend that is already running
EXPO_PUBLIC_ONME_BACKEND_URL=https://onme.example.com npm start
```

The app runs with no backend configured: the try-on screen explains that it has nowhere to send the
photos instead of failing with a network error.

| Script | What it does |
|---|---|
| `npm start` | Expo dev server (add `--android`, `--ios`, `--web`) |
| `npm run server:dev` | backend on `PORT` (default `8787`) and `HOST` (default `0.0.0.0`, so set `HOST=127.0.0.1` for loopback only) |
| `npm test` | backend tests, then the app's own tests |
| `npm run server:smoke` | boots the real server offline and walks every refusal — spends nothing |
| `npm run preflight` | asks one question: **will the app's exact URL make a picture right now?** |
| `npm run lint` | `expo lint` |
| `npm run icons` | rebuilds the launcher icon, the splash, the adaptive layers, the favicon and the in-app logo tile from `assets/brand/onme-logo.png` (needs `ffmpeg`) |

### Configuration

One `.env` at the repository root is read by both sides.

| Variable | Side | Notes |
|---|---|---|
| `EXPO_PUBLIC_ONME_BACKEND_URL` | app | public. Must be `https://` in a release build — a photo of a person is not sent over plain `http`, and the app refuses instead of doing it silently. |
| `EXPO_PUBLIC_ONME_BACKEND_TOKEN` | app | public by construction (it ships in the bundle). Send it only when the backend sets `ONME_CLIENT_TOKEN`. |
| `FAL_KEY` | **server only** | never bundled, never logged, never returned by an endpoint, never named `EXPO_PUBLIC_*`. |
| `ONME_TRY_ON_MODEL` | server | override the model. |
| `ONME_PRESERVE_POSE`, `ONME_ASPECT_RATIO` | server | defaults `true` and `3:4`. |
| `ONME_CLIENT_TOKEN` | server | require a token on `/tryon`. |
| `ONME_MAX_IMAGE_BYTES`, `ONME_MAX_UPLOAD_BYTES`, `ONME_MAX_TRYONS_PER_MINUTE`, `ONME_MAX_CONCURRENT_TRYONS` | server | default 12 MB per photo, 40 MB per request, 6/min, 2 at once. |

Nothing in `server/` reads a `FAL_KEY` that came from the app, and `/health` is checked by a test
to make sure it never leaks a credential field.

## Verification

| What | How | Result |
|---|---|---|
| Backend behaviour | `node --test test/*.test.js` in `server/` | **46/46 passing** |
| Backend end-to-end, offline | `npm run server:smoke` | **25 checks, 0 failures** — every refusal decided before billing, and `server/` is snapshotted before/after to prove nothing was written to disk |
| App logic | `npm test` (client half) | **35/35 passing** — payload, endpoint, row mapping, and the upload request driven by a fake `XMLHttpRequest` |
| Types | `npx tsc --noEmit` | clean |
| Lint | `npx expo lint` | clean |
| The device path | `npm run preflight` against a local backend | passes in both states: an unconfigured backend (reports that it cannot make a picture yet, and that it refuses before reading a photo) and a configured one (415/400/400/404 all confirmed) |

The preflight makes no provider call and uploads no photograph: every probe it sends is rejected
before a generation could be paid for.

## Getting it onto a phone

The app is complete; what a phone run needs is a *reachable, configured* backend. In order:

1. **Give the backend a model.** Put a real `FAL_KEY` in the backend's `.env` and restart it. Until
   then `/health` says `tryOnReady: false` and the app will say so on screen — that is the honest
   state, not a bug.
2. **Give it an https URL.** Done: the named tunnel in `deploy/cloudflared-config.yml` serves
   `https://onme.yablokolabs.com` from the loopback-only backend. A phone cannot reach `127.0.0.1`,
   and a release build refuses a plain `http://` backend on purpose.
3. **Point the app at it.** Done: `.env` carries `EXPO_PUBLIC_ONME_BACKEND_URL` and the matching
   `EXPO_PUBLIC_ONME_BACKEND_TOKEN`, and `npm run preflight` passes against the live hostname.
4. **Run it on the phone.** With no APK yet, the app runs from the dev server, which the second
   hostname exposes to the phone: Metro listens on `127.0.0.1:8091` and the tunnel maps
   `onme-dev.yablokolabs.com` to it, so no native build and no Expo account are involved.

   The dev server runs as a transient systemd unit, so it is not started at boot:

   ```bash
   sudo systemd-run --unit=onme-dev-server --uid=azureuser --gid=azureuser \
     -p Environment=HOME=/home/azureuser \
     -p Environment=EXPO_PACKAGER_PROXY_URL=https://onme-dev.yablokolabs.com \
     -p WorkingDirectory="$PWD" \
     "$PWD/node_modules/expo/bin/cli" start --tunnel --port 8091
   ```

   The `EXPO_PACKAGER_PROXY_URL` is what makes Metro advertise the public hostname instead of
   `127.0.0.1:8091`. In Expo Go on the phone, *Enter URL manually* → `exp://onme-dev.yablokolabs.com`.

   A dev server is not a way to ship the app, and this hostname should not outlive that use: delete
   the `onme-dev` ingress rule once a real build exists.

For an installable APK later: `npx eas build --profile preview --platform android`. That needs an
Expo login and an `extra.eas.projectId` in `app.json`, neither of which exists yet, and it would bake
in the same `EXPO_PUBLIC_*` values this checkout already has.

The backend on this machine is on `127.0.0.1:8788` with its own tunnel and hostname, so it never
collides with the other app deployed here (which holds 8787 and `psst.yablokolabs.com`).
