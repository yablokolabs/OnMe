# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## What OnMe is

One job: **upload a full-body photo of yourself and a photo of an outfit, and see the outfit on
you.** No prompts, no sliders, no body settings. If a change makes the interface ask for more, it is
probably the wrong change.

## Rules that are not negotiable

- **Never fake a result.** If the model is not configured, or the provider fails, the app says so.
  There is no sample image that pretends to be the user.
- **The photos never leave the device except to the OnMe backend.** No third-party key ever reaches
  the app; the backend holds `FAL_KEY` and nothing else does.
- **Nothing is written to disk on the backend.** Photos are held in memory for the length of one
  request and then dropped.
- **No dependency in the backend.** `server/` is Node 22 built-ins and `fetch` only. That keeps
  `/health` and the deploy small, and there is no tree to keep patched.
- **No attribution footers.** No "generated with", "built with", or credit lines in the README, the
  app, comments or commit messages.
