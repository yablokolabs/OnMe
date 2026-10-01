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
| **An installable Android build** | **built** — a release APK is downloadable at `https://onme-dl.yablokolabs.com/OnMe-1.0.0.apk` (arm64-v8a, debug-signed, `versionCode 1`, `minSdk 24`, `targetSdk 36`). Built locally with Gradle against the same `EXPO_PUBLIC_*` values in `.env`, so it talks to the live backend. See *Getting it onto a phone* |
| An installable iOS build | not built — needs an Apple signing identity and an Expo project id |
| **A demo video** | **built** — 54s, 1920×1080, narrated: `https://onme-dl.yablokolabs.com/OnMe-demo.mp4`. Composed in `videos/` with [videowright](https://github.com/scosman/videowright); the reveal in it is a real try-on made by the live backend, and every app screen in it is a capture of the app itself |
| **OnMe Pro** — ten free try-ons per install, then either a subscription or a rewarded video | **built, and live in the shipped APK** — the counters live in SQLite, the purchase goes through RevenueCat, and the rewarded video through Google Mobile Ads. The APK is built against a RevenueCat **Test Store** key, so a purchase can be completed and restored with no Play listing; with `EXPO_PUBLIC_REVENUECAT_KEY` empty the build has no store at all and the ten free pictures are the whole app. See *What it charges for* |
| Accounts, sign-in, per-user entitlement | not built — the shared token is a throttle, not authentication. Pro needs no account: RevenueCat ties the receipt to the store account this phone is signed in to |
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

## What it charges for

Ten try-ons per install are free. After that there are two ways to get one more picture, and both
are already wired into the app:

- **OnMe Pro** — a monthly subscription that removes the count. The screen is RevenueCat's **own
paywall** (`react-native-purchases-ui`, `RevenueCatUI.presentPaywallIfNeeded`), presented from the
dashboard so that what it says about price, trial and what Pro includes can change — per audience,
A/B tested — without a store release; the entitlement it grants is `yabloko_labs_pro`. A hosted
paywall has to exist before one can be shown, and that is a dashboard fact the app cannot see, so
"nothing was presented" falls back to buying the offering's package directly and a build pointed at
a bare project still sells. The price on the button comes from the offering, so no screen in this
app can invent one.
- **A rewarded video** — one more picture, offered at the moment the free ones run out and nowhere
else: it never plays on its own and never covers the picture someone just made. It is Google's own
test ad unit until a real AdMob unit id replaces it, so the ads are really served and earn nothing.

Both are counted in the same place the pictures are. `credits` in `onme.db` holds two integers —
`used` and `bonus` — the arithmetic between them and the free ten lives in
`src/services/allowance.ts`, and a picture is written down **after** the file is on the phone: a
refused or failed try-on costs nothing. *Delete everything* resets those counters along with
everything else, because the screen promises it removes what OnMe holds. A subscription survives
that, because it is not in the database at all — it is restored from the store in one tap.

Ad revenue is reported to RevenueCat as well. This is the manual integration from its
ad-monetisation docs: every event Google reports (loaded, impression, click, paid, failed) goes to
`Purchases.adTracker` under one impression id per ad, so ad money and purchase money are counted in
the same charts. That is what *RevenueCat Ads* is — not a different way to serve an ad, a careful way
to count one — and a debug build shows the events under *Ads → Sandbox data*.

The published build carries a RevenueCat **Test Store** key (`test_…`) in
`EXPO_PUBLIC_REVENUECAT_KEY`, which is why the paywall can be walked end to end right now: that
project's default offering serves `monthly`, `yearly` and `lifetime` packages, the paywall takes the
monthly one, and a completed or restored purchase is what flips the entitlement to
`yabloko_labs_pro`. A Test
Store purchase takes a fake card and earns nothing. It also costs the build its non-debuggable
status — the SDK refuses a Test Store key in a build that is not debuggable, so
`plugins/with-test-store-android.js` marks the release build debuggable while such a key is
configured, and the APK grows accordingly. The entitlement has to be attached to the product in the
dashboard and spelled the way the project spells it — `yabloko_labs_pro` here — and `PRO_ENTITLEMENT`
in `src/services/purchases.ts` is the one place that name lives. If they disagree, the paywall says
so plainly ("the store finished that, but Pro is not active yet") instead of failing silently.

What is still missing to make any of it real money: a store listing to sell from (a purchase needs
one, and the APK here is a sideload), real products carrying the `yabloko_labs_pro` entitlement, and your own
AdMob app id and unit id. The code is ready for all three; none of them can be conjured from this
machine. Two things worth knowing before the ad side earns anything: AdMob only reports
per-impression revenue once *Impression-level ad revenue* is switched on in its dashboard, and
RevenueCat's ad charts want Charts v3 — without the first, the tracker receives impressions and no
money.

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

**Expo Go is no longer enough.** OnMe now carries two native modules — RevenueCat's purchases SDK
and Google Mobile Ads — so the app needs a build of its own: `npx expo run:android`, or the release
APK from the download folder. In Expo Go it stops at the first import of either SDK. The web target
is unaffected: Metro resolves `services/ads.web.ts` for it, so the browser bundle and the capture
run in `videos/` keep working.

| Script | What it does |
|---|---|
| `npm start` | Expo dev server (add `--android`, `--ios`, `--web`) |
| `npm run server:dev` | backend on `PORT` (default `8787`) and `HOST` (default `0.0.0.0`, so set `HOST=127.0.0.1` for loopback only) |
| `npm test` | backend tests, then the app's own tests |
| `npm run server:smoke` | boots the real server offline and walks every refusal — spends nothing |
| `npm run preflight` | asks one question: **will the app's exact URL make a picture right now?** |
| `npm run lint` | `expo lint` |
| `npm run icons` | rebuilds the launcher icon, the splash, the adaptive layers, the favicon and the in-app logo tile from `assets/brand/onme-logo.png` (needs `ffmpeg`). The logo is a rounded tile sitting on a **white canvas**, which is the trap here: the script measures the tile on each axis, cuts a fraction of a percent inside its antialiased edge, and cuts the mask from the tile's own outline, found by scanning every row and column for where the artwork begins — the outline is not a circle, so a modelled corner leaves canvas wedges in every corner, and canvas anywhere is a pale rim around the icon on a phone. The launcher icon is then made **full bleed**: the tile's rounded corners would otherwise show as wedges inside the launcher's own mask. The adaptive icon's two layers get the same treatment: the background is built from the artwork's own edge colours carried outwards, because a flat colour behind the foreground shows through the launcher's mask as a ring around the logo — the same border again, in the one place the artwork itself cannot hide it — and the monochrome layer takes its shape from the artwork's alpha channel rather than its luminance, which otherwise leaves an opaque white square for Android to tint into a blank tile. Android packages the `mipmap-*` copies that `npx expo prebuild` makes from this file, so re-run prebuild before the next APK |
| `npm run web` | the app's web target. `metro.config.js` puts `wasm` on Metro's asset list (for `expo-sqlite`) and sends the two headers that make the dev server cross-origin isolated, so the bundle builds and SQLite's worker can use `SharedArrayBuffer` |

### Configuration

One `.env` at the repository root is read by both sides.

| Variable | Side | Notes |
|---|---|---|
| `EXPO_PUBLIC_ONME_BACKEND_URL` | app | public. Must be `https://` in a release build — a photo of a person is not sent over plain `http`, and the app refuses instead of doing it silently. |
| `EXPO_PUBLIC_ONME_BACKEND_TOKEN` | app | public by construction (it ships in the bundle). Send it only when the backend sets `ONME_CLIENT_TOKEN`. |
| `EXPO_PUBLIC_REVENUECAT_KEY` | app | the public SDK key for this build's store: the Android app's `goog_…` key from the RevenueCat project, or a `test_…` Test Store key — which is what the published APK was built with. Public by construction: it can read offerings and start a purchase, it cannot read a customer list. Empty means no store, and the free allowance is the whole product. What this is *not*: a RevenueCat project id (`proja…`) names the dashboard container and is what the server API v2 addresses; the client SDK only ever takes a key. |
| `androidAppId`, `iosAppId` in `app.json`, and the ad unit in `src/services/ads.ts` | app | Google's test ids, so test ads are really served. Replace all three with your own AdMob ids to earn anything. |
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
| `ONME_DOWNLOAD_URL` | server | where a bare visit to the backend's own hostname is sent. That hostname serves the API, so somebody who opens it in a browser used to get `{"error":"not_found"}`; with this set — it defaults to this deployment's download page — the root answers a 302 to the build, and an empty value turns the hop off. |
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
| The release APK | `./gradlew assembleRelease` in `android/`, then `aapt`, `apksigner` and `unzip` against the artifact | **BUILD SUCCESSFUL**, 64,223,903 bytes, package `com.yablokolabs.onme`, `versionCode 1`/`versionName 1.0.0`, `minSdk 24`, `targetSdk 36`, arm64-v8a only, the same debug certificate, and `android:debuggable` reading `true` — which the Test Store key requires, since RevenueCat's SDK refuses a non-debuggable build and `DefaultIsDebugBuildProvider` reads exactly that manifest flag. React Native's dev support does *not* follow it: `ReactBuildConfig` is generated per build type and the shipped copy comes from the `ReactAndroid_release` source set, so the app still loads the bundle inside the APK. The price is size — a debuggable build keeps dex debug info and full resource paths, 51.1 → 61.0 MiB across the two SDK additions, and 0.2 MiB more for the icon's full-bleed layers — and no store would accept it, which is what the plugin gating on the key is for. The bundled JS carries the live backend hostname, the Test Store key, the entitlement `yabloko_labs_pro`, the `presentPaywallIfNeeded` call, the rewarded ad unit and the `tryon_extra_picture` placement, and the RevenueCat ad tracker — and the hosted paywall is really linked rather than merely imported: `com.revenuecat.purchases.ui.revenuecatui.*` is in the dex, not just requested in the manifest. The two SDKs are really in the build, not just imported: `com.android.vending.BILLING`, `com.google.android.gms.permission.AD_ID` and the ads-services permissions are declared, and `com.google.android.gms.ads.APPLICATION_ID` is in the manifest with the app id from `app.json`. The `ic_launcher`/`ic_launcher_round` inside it are the current full-bleed icon: the packaged 192×192 and 144×144 webps were sampled at their corners and are the icon's own colours (a salmon `253,171,171` top-left) rather than white |
| The app's web target | `npx expo export --platform web` | 6 static routes (`/`, `/tryon`, `/look`, `/settings`, `/_sitemap`, `/+not-found`); it is where the demo video's screenshots of the app come from |
| The demo video | `tsc --noEmit` and `biome check` in `videos/`, then a frame-by-frame render | 3257 frames, 54.28s, 1920×1080 @ 60fps, h264 + AAC stereo; audio mean −17.8 dB / peak −0.9 dB; 14 sampled frames all distinct |

The preflight makes no provider call and uploads no photograph: every probe it sends is rejected
before a generation could be paid for.

## The demo video

`https://onme-dl.yablokolabs.com/OnMe-demo.mp4` — 54 seconds, 1920×1080, narrated by an AI voice
over a quiet ambient bed. It walks the two-photo flow, the press, the wait, and the reveal; the
picture it reveals is a **real** try-on made by the live backend, and the two photos it starts from
are the two that went in. It closes on the one address that gets you the app —
`onme-dl.yablokolabs.com/OnMe-1.0.0.apk`, not the backend's own hostname.

Every app screen in it is a capture of the app's own build (`videos/assets/app/`), so the labels
and buttons in the video are the ones the app has — including the press on **See it on you**,
which is drawn on that button's own rectangle in the capture, and the waiting screen, which came
from a real request.

It lives in `videos/` as its own project ([videowright](https://github.com/scosman/videowright):
the video is HTML and CSS, rendered frame by frame). `videos/README.md` covers building it;
`videos/videos/demo_video/PLAN.md` covers why it says what it says, and
`videos/videos/demo_video/audio/audio_plan.md` documents the mix.

## Getting it onto a phone

The app is complete; what a phone run needs is a *reachable, configured* backend. In order:

0. **Install the APK.** Download `https://onme-dl.yablokolabs.com/OnMe-1.0.0.apk` on the phone
   and open it; Android will ask to allow installing from this source, because the APK is signed
   with the Android **debug** keystore rather than a release key. That signature is fine for
   testing on a phone you own and it is not fit for Play — it is one keystore shared by every
   debug build of anything, so it can only ever be a sideload. Rebuild it after a code change with:

   ```bash
   cd android
   JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ANDROID_HOME=$HOME/Android/sdk ./gradlew assembleRelease
   # artifact: android/app/build/outputs/apk/release/app-release.apk
   ```

   `android/` and `ios/` are gitignored — they are generated, and `npx expo prebuild` recreates
   them. The build above needs JDK 21 and the Android SDK; everything else it needs is applied by
   `plugins/with-test-store-android.js` during prebuild, so **`npx expo prebuild` produces a
   correct project on its own**. That plugin exists because a generated directory makes every hand
   edit a trap — prebuild drops them silently, which has already cost this project two builds:

   - `android/gradle.properties`: `reactNativeArchitectures=arm64-v8a` (without it the build
     compiles all four ABIs and the APK balloons), a 3 GB `org.gradle.jvmargs` (the default 2 GB
     runs out against three native SDKs), and `RNGMA_ANDROID_BACKEND=classic`, which
     `react-native-google-mobile-ads` reads before falling back to a `rootProject.ext` lookup an
     Expo project never defines — without it the build dies inside that module's own `build.gradle`.
   - `android/app/build.gradle`: `debuggable true` on the release build type, **only while the app
     is built with a Test Store key.** RevenueCat's SDK deliberately crashes a Test Store key in a
     build that is not debuggable (`DefaultIsDebugBuildProvider` reads the manifest's debuggable
     flag) so that such a build can never reach a store by accident. This app's shipping mode — a
     debug-signed sideload with no store listing to use a real key with — is exactly that case. The
     flag follows the key: configure
     a real `goog_…` key and prebuild leaves it out. It does **not** turn on React Native's dev
     support, which follows the *build type* — the APK still carries and loads its own JS bundle.

   Because the launcher icons under `android/app/src/main/res/mipmap-*/` are written *by* prebuild
   from `assets/images/icon.png`, a change to the icon needs `npm run icons` **and** a prebuild
   before the next APK, or the build keeps shipping the old one. Publishing a new build is a copy
   into the download folder:

   ```bash
   cp android/app/build/outputs/apk/release/app-release.apk ~/onme-downloads/OnMe-<version>.apk
   ```

   `onme-downloads/` is served by a small static file server on `127.0.0.1:8093` (a transient
   systemd unit, `onme-dl`) behind the `onme-dl.yablokolabs.com` ingress rule in
   `deploy/cloudflared-config.yml`. It exists to move build output — the APK, the demo video, the
   store-sized icon and a couple of screenshots, and the audio candidates that were picked for the
   video — to a phone, with no other exposure:

   | File | What it is |
   |---|---|
   | `OnMe-1.0.0.apk` | the sideloadable build |
   | `OnMe-demo.mp4` | the demo video |
   | `OnMe-demo-frames.png` | eight frames of it, t = 3/9/15/21/28.5/38/42/53.5s |
   | `OnMe-demo-reveal.png` | the reveal frame, full resolution |
   | `OnMe-icon-1024.png` | the app icon, 1024×1024, full bleed — byte-identical to `assets/images/icon.png`, so the store-sized icon and the one inside the APK are the same file |
   | `OnMe-screen-home.png`, `OnMe-screen-tryon.png` | screenshots of the app at phone resolution, no device frame |
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
4. **Or run it from the dev server.** The APK in step 0 is the way to install it; this path needs
   no build at all and is still useful while changing code. Metro listens on `127.0.0.1:8091` and
   the tunnel maps `onme-dev.yablokolabs.com` to it, so neither a native build nor an Expo account
   is involved.

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

**This section is the record of a JS-only app, and the app is not one any more** (2026-10-01): the
RevenueCat and Google Mobile Ads SDKs are native modules, so neither phone opens OnMe in Expo Go
now — see *Expo Go is no longer enough* above for what that changed, and *Getting it onto a phone*
for what an install takes instead. Metro still serves each platform its own bundle, which is what
the checks below are about.

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

The APK in step 0 was built without EAS: `npx expo prebuild --platform android` (already run) plus
Gradle, which needs no Expo account, no cloud build and no project id. Its one real limitation is
the debug signature — a build to hand to anyone outside this machine should go through EAS
(`npx eas build --profile preview --platform android`), which needs an Expo login and an
`extra.eas.projectId` in `app.json` and produces a real release signature. Either route bakes in
the same `EXPO_PUBLIC_*` values this checkout already has, so the backend URL is fixed at build
time: point `.env` at a different backend and the app must be rebuilt.

An IPA is the same idea with a much higher bar: an Apple signing identity plus — for anyone but
the account holder — a paid developer account.

The backend on this machine is on `127.0.0.1:8788` with its own tunnel and hostname, so it never
collides with the other app deployed here (which holds 8787 and `psst.yablokolabs.com`).
