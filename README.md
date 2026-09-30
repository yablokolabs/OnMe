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
| The try-on itself, preserving face, hair, skin tone, pose and proportions | working — either a rented `fal-ai/image-apps-v2/virtual-try-on` or `gpt-image-2-codex` driven by the ChatGPT subscription logged in on the server; both called only through the OnMe backend |
| Upload progress, then "making your picture" | working |
| SQLite library of every look, with the outfit it used; works with no connection | working |
| Share a look, delete your photo, delete all looks, delete everything | working |
| Backend: one endpoint, token gate, size and rate limits, **nothing written to disk** | working |
| **A deployed backend** | **working** — live at `https://onme.yablokolabs.com`, behind its own named Cloudflare tunnel, with the tunnel and both services installed and enabled at boot |
| **A real try-on today** | **working** — there is still no `FAL_KEY`, so the backend uses the Codex subscription on that machine: `/health` reports `tryOnReady: true` with `tryOnProvider: codex`. Verified end to end through the live hostname: a person photo and a garment photo in, a 1037×1516 picture out in 45s, with the outfit reproduced and the face, hair, skin tone and pose unchanged. Adding a `FAL_KEY` later switches to the rented model with no rebuild |
| An outfit the image tool will not draw (a character or brand it recognises) | **refused, not faked** — the model's own moderation declines it, the backend answers 502, and the app says it could not make that picture. Nothing is shown in its place |
| **An installable Android or iOS build** | **not built** — no EAS project id and no APK or IPA artifact yet; the app runs from the dev server on either phone meanwhile (see *Getting it onto a phone*) |
| Accounts, sign-in, per-user entitlement | not built — the shared token is a throttle, not authentication |
| Generating on the device | not built, deliberately: there is no GPU here, so every generation happens off the device — rented from fal.ai, or made by the subscription login on the server |

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
- **The provider credential never reaches the app.** Either `FAL_KEY` or the Codex login on the
  server, and never both in the same picture. The app sends photos to OnMe's own endpoint and
  nothing else. When the subscription's access token is close to expiry the backend refreshes it
  against `auth.openai.com` and writes the new token back to the credential file it read — a token,
  never a photograph. `ONME_CODEX_REFRESH=off` stops even that.
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
       provider = fal  : queue: POST model -> poll status_url -> GET response_url
       provider = codex: POST /responses with both photos; the picture returns in the stream
  -> fal-ai/image-apps-v2/virtual-try-on        preserve_pose, 3:4
     or gpt-image-2-codex                      driven by the server's ChatGPT login
  -> one generated image
       fal:   a URL the phone downloads directly
       codex: the bytes — held in the backend's memory for minutes under an unguessable id, and
              collected by the phone from GET /look/<id>
  -> saved on the phone, in SQLite, never kept on the server
```

Three design points worth naming:

- **The refusals happen before the photos are read.** A request that is oversized, unauthenticated,
  wrongly typed, or arriving at an unconfigured backend is answered without the server ever
  receiving an image. Photos of a person are the most sensitive thing here, and there is no reason
  to accept them just to say no.
- **A picture the backend holds itself is held for minutes, in memory, under an unguessable id**
  (`server/src/tryon/looks.js`). The rented model returns a URL and the phone downloads from there,
  so nothing of OnMe's is in the path; the subscription returns the picture itself, so the backend
  hands it over and then forgets it. No disk, no store, and a server left running cannot accumulate
  pictures of people.
- **Both clients are hand-rolled on `fetch`.** `server/` has **no dependencies at all** — Node
  built-ins only, including the event-stream reader the subscription path needs. There is no tree to
  keep patched, and `/health` and the deploy stay tiny.

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
| `ONME_TRY_ON_MODEL` | server | override the rented model. |
| `ONME_PRESERVE_POSE`, `ONME_ASPECT_RATIO` | server | defaults `true` and `3:4`; the rented model's parameters. |
| `ONME_TRYON_PROVIDER` | server | `auto` (default), `fal` or `codex`. `auto` uses a rented model when there is a key for it, and otherwise the subscription. |
| `ONME_CODEX_AUTH_PATH` | **server only** | the Codex login to use. Defaults to `~/.codex/auth.json`, the file `codex login` writes. |
| `ONME_CODEX_MODEL`, `ONME_CODEX_IMAGE_MODEL` | server | defaults `gpt-6.1-sol` (the agent that calls the tool) and `gpt-image-2-codex` (the tool it calls). |
| `ONME_CODEX_BASE`, `ONME_CODEX_AUTH_BASE` | server | override the endpoints, for tests. |
| `ONME_CODEX_REFRESH` | server | `off` stops the one disk write in the server: putting a refreshed subscription token back. |
| `ONME_CODEX_TIMEOUT_MS` | server | one generation's ceiling. Default `300000`; a real one took ~45s. |
| `ONME_PUBLIC_BASE_URL` | server | the base the app should collect a picture from. Defaults to the request's own host, which is usually right. |
| `ONME_LOOK_TTL_MS`, `ONME_LOOK_MAX_ENTRIES`, `ONME_LOOK_MAX_BYTES` | server | how long a generated picture waits in memory and how many may wait. Defaults: 10 minutes, 32, 96 MB. |
| `ONME_CLIENT_TOKEN` | server | require a token on `/tryon`. |
| `ONME_MAX_IMAGE_BYTES`, `ONME_MAX_UPLOAD_BYTES`, `ONME_MAX_TRYONS_PER_MINUTE`, `ONME_MAX_CONCURRENT_TRYONS` | server | default 12 MB per photo, 40 MB per request, 6/min, 2 at once. |

Nothing in `server/` reads a `FAL_KEY` that came from the app, and `/health` is checked by a test
to make sure it never leaks a credential field.

## Verification

| What | How | Result |
|---|---|---|
| Backend behaviour | `node --test test/*.test.js` in `server/` | **82/82 passing** |
| The whole Codex path, offline | the same tests, against a fake subscription that speaks the real event stream | person photo first and garment second, the account id and a fresh session id on every call, `store: false`, the picture served back from `/look/<id>`, and a refusal and a missing picture both landing as 502 with nothing handed out |
| Backend end-to-end, offline | `npm run server:smoke` | **35 checks, 0 failures** — every refusal decided before billing, and `server/` is snapshotted before/after to prove nothing was written to disk |
| A real try-on, live | a real person photo and a real garment photo posted to `https://onme.yablokolabs.com/tryon` | **200 in 45s**, a 1037×1516 picture, collected from the URL the backend returned; the garment reproduced exactly and the identity unchanged when checked by a second model |
| App logic | `npm test` (client half) | **35/35 passing** — payload, endpoint, row mapping, and the upload request driven by a fake `XMLHttpRequest` |
| Types | `npx tsc --noEmit` | clean |
| Lint | `npx expo lint` | clean |
| The device path | `npm run preflight` against a local backend | passes in both states: an unconfigured backend (reports that it cannot make a picture yet, and that it refuses before reading a photo) and a configured one (415/400/400/404 all confirmed) |

The preflight makes no provider call and uploads no photograph: every probe it sends is rejected
before a generation could be paid for.

## Getting it onto a phone

The app is complete; what a phone run needs is a *reachable, configured* backend. In order:

1. **Give the backend a model.** Done, for now: there is no `FAL_KEY`, but there is a
   `codex login` on this machine, so the backend drives that subscription and `/health` reports
   `tryOnReady: true` with `tryOnProvider: codex`. Put a real `FAL_KEY` in the backend's `.env` and
   restart it to use the rented model instead. With neither, `/health` says `tryOnReady: false` and
   the app says so on screen — that is the honest state, not a bug.
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

### On an iPhone as well as an Android phone

The same URL works on both, and Metro serves each platform its own bundle, so an iPhone and an
Android phone can be open at once. What makes iOS work is not luck:

- **Every dependency is an Expo Go module** (`expo-*`, gesture-handler, reanimated, worklets,
  safe-area-context, screens). There is no bare or custom native code for Expo Go to refuse.
- **The one platform branch in the app is for iOS**: `KeyboardAvoidingView` uses
  `behavior="padding"` on iOS and none on Android (`src/components/Screen.tsx`). Nothing in the app
  is Android-only — no `ToastAndroid`, no `BackHandler`, no `translucent` status bar.
- **HEIC is already handled.** An iPhone camera produces HEIC, and the backend refuses HEIC bytes on
  purpose. `expo-image-picker` with `base64: true` re-encodes through `UIImage.jpegData` on iOS (and
  `Bitmap.CompressFormat.JPEG` on Android), so what the app uploads is **JPEG with bytes to match** —
  see the note at the top of `src/services/photos.ts`. A picked photo therefore arrives as JPEG even
  though the file it came from was not one.
- **Nothing needs plain `http://`.** The bundle is fetched over `exp://` and the backend is HTTPS, so
  iOS App Transport Security has nothing to block.

Verified for iOS rather than assumed (2026-09-30): the manifest over the tunnel answers
`expo-platform: ios` with `sdkVersion 57.0.0` and `runtimeVersion "exposdk:57.0.0"`, and the iOS
bundle builds and serves — HTTP 200, 6,036,948 bytes, carrying the current palette (`E860B0`) and
the logo asset, with no build errors in the journal beyond Metro's ordinary chatter.

Two things to know before relying on an iPhone:

- **Expo Go only ever supports one SDK: the latest.** The App Store build supports SDK 57 today.
  Once it moves to SDK 58 (in beta since 2026-09-15) a plain App Store install will no longer open
  this app, and the choice becomes upgrading the project or installing the pinned SDK 57 Expo Go
  build. Nothing about the app changes — only the client that can load it.
- **In Expo Go the photo permission prompt is Expo Go's wording, not OnMe's.** The
  `photosPermission` sentence in `app.json` lives in an app's own `Info.plist`, which Expo Go does
  not use. It reads correctly in a real build; in Expo Go it is cosmetic.

For an installable APK later: `npx eas build --profile preview --platform android`. For an IPA,
`--platform ios`, which additionally needs an Apple signing identity and — for anyone but the
account holder — a paid developer account. Both need an Expo login and an `extra.eas.projectId` in
`app.json`, neither of which exists yet, and either would bake in the same `EXPO_PUBLIC_*` values
this checkout already has.

The backend on this machine is on `127.0.0.1:8788` with its own tunnel and hostname, so it never
collides with the other app deployed here (which holds 8787 and `psst.yablokolabs.com`).
