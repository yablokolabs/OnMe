/**
 * The Codex (ChatGPT subscription) try-on client.
 *
 * OnMe's second way to make a picture, for the case where there is no rented
 * image model to call but there *is* a ChatGPT subscription logged in on this
 * machine. It reads the same credential file the Codex CLI writes
 * (`~/.codex/auth.json`), and drives the same endpoint the CLI drives:
 *
 *   POST https://chatgpt.com/backend-api/codex/responses
 *   authorization: Bearer <subscription access token>
 *   chatgpt-account-id: <account id from the same file>
 *   originator: codex_cli_rs
 *   session_id: <a fresh uuid per try-on>
 *   { model, input: [...], tools: [{ type: 'image_generation' }], stream: true }
 *
 * The picture does not arrive as a URL. It arrives inside the event stream as an
 * `image_generation_call` item whose `result` is the PNG itself, base64 — so this
 * module hands back bytes and `index.js` decides how the app gets them.
 *
 * Three properties are worth knowing before reading the code:
 *
 *   1. **The subject of the photos is a person, and the model can refuse.** An
 *      outfit carrying a character or a logo can be declined by the image tool's
 *      moderation; so can some edits of a face. A refusal is reported as a
 *      refusal, not retried, because retrying a moderation decision spends the
 *      user's subscription quota to get the same answer.
 *   2. **Two photos, in order, is the whole product.** The instruction tells the
 *      model which image is the person and which is the garment, and to keep the
 *      person's face, hair, skin tone, pose and background. There is no slider
 *      for any of it, on purpose.
 *   3. **The access token expires.** When it is close to expiry this module
 *      refreshes it against `auth.openai.com` and writes the new token back to
 *      the credential file — the one place this server ever touches disk, and it
 *      holds no user photo, only a token. `ONME_CODEX_REFRESH=off` stops it.
 *
 * No token, no account id and no photo is ever logged, and none of it is
 * returned from an endpoint.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadServerEnv } from '../env.js';

loadServerEnv();

const DEFAULT_BASE = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_AUTH_BASE = 'https://auth.openai.com';
/** The agent model that decides to call the image tool. */
const DEFAULT_MODEL = 'gpt-6.1-sol';
/** The image model the tool resolves to. Reported, and overridable. */
const DEFAULT_IMAGE_MODEL = 'gpt-image-2-codex';
/** The OAuth client the Codex CLI logs in with; the refresh must use the same one. */
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REFRESH_SCOPE = 'openid profile email';

/** A generation took ~47s in testing; this is the ceiling, not the expectation. */
const DEFAULT_TIMEOUT_MS = 300_000;
/** Refresh this long before the token actually expires, so a slow call cannot lose the race. */
const REFRESH_MARGIN_MS = 120_000;

export function getCodexConfig() {
  return {
    authPath:
      process.env.ONME_CODEX_AUTH_PATH ?? path.join(os.homedir(), '.codex', 'auth.json'),
    base: process.env.ONME_CODEX_BASE ?? DEFAULT_BASE,
    authBase: process.env.ONME_CODEX_AUTH_BASE ?? DEFAULT_AUTH_BASE,
    model: process.env.ONME_CODEX_MODEL ?? DEFAULT_MODEL,
    imageModel: process.env.ONME_CODEX_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL,
    timeoutMs: positiveInt('ONME_CODEX_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    // Anything but an explicit off keeps the token fresh.
    refresh: !/^(0|false|no|off)$/i.test(String(process.env.ONME_CODEX_REFRESH ?? '').trim()),
  };
}

function positiveInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a subscription login is present at all.
 *
 * Boolean only — the token is never read out of this function, and the file is
 * not parsed here, so /health cannot leak a credential by accident.
 */
export function isCodexConfigured() {
  const { authPath } = getCodexConfig();
  try {
    return existsSync(authPath);
  } catch {
    return false;
  }
}

/** The `exp` of a JWT, in milliseconds, or 0 when it cannot be read. */
export function readJwtExpiry(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(claims?.exp) ? claims.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * The credential file, as far as this module needs it.
 *
 * Returns null rather than throwing for every way the file can be wrong, because
 * a missing or half-written login is a configuration state, not a crash.
 */
export function readCodexAuth({ authPath = getCodexConfig().authPath } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(authPath, 'utf8'));
  } catch {
    return null;
  }

  const tokens = parsed?.tokens ?? {};
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : '';
  const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : '';
  if (accessToken === '' || accountId === '') return null;

  return {
    authPath,
    document: parsed,
    accessToken,
    accountId,
    refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '',
    expiresAt: readJwtExpiry(accessToken),
  };
}

/** The try-on instruction. Two images follow it, person first, garment second. */
export function buildTryOnPrompt() {
  return [
    'You are OnMe, a virtual try-on engine.',
    'Two photos follow. IMAGE 1 is the person. IMAGE 2 is the garment.',
    'Put the garment from IMAGE 2 on the person in IMAGE 1 and produce one photorealistic image.',
    'Keep the person exactly as they are: same face, same hair, same skin tone, same body and same pose.',
    'Keep the same background, the same camera angle and the same framing.',
    'Reproduce the garment faithfully: the same colours, the same print or graphic, the same cut, the same length.',
    'Change nothing else. Do not restyle the person, do not slim them, do not move them, do not add anything to the scene.',
  ].join(' ');
}

/** A data URI, the shape the input image part wants. */
export function toDataUri(base64, mimeType) {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * The size of a PNG, read from its own header.
 *
 * The try-on output is a PNG, so this is the honest way to report a size without
 * an image library. Anything that is not a PNG is reported as 0×0 rather than
 * guessed at, which is what the app already renders for an unknown size.
 */
export function readPngSize(bytes) {
  const isPng =
    Buffer.isBuffer(bytes) &&
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (!isPng) return { width: 0, height: 0 };
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Reads one event stream to its image.
 *
 * The stream carries several item types and the picture arrives only when the
 * image tool finishes. Both terminal shapes are handled: an item that carries a
 * `result`, and an item that reports `failed` — the second is the moderation
 * refusal path, and it is the one that must not be mistaken for "no image".
 */
export async function readImageFromStream({ stream, onProgress }) {
  const decoder = new TextDecoder();
  let buffer = '';
  let failure = '';

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });

    // Events are newline-delimited; the last element may be a partial line.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith('data:')) continue;

      let event;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      const item = event?.item;
      if (event?.type === 'response.output_item.done' && item?.type === 'image_generation_call') {
        if (typeof item.result === 'string' && item.result !== '') {
          return { ok: true, base64: item.result };
        }
        // No result and no id of a later event to wait for: this call is over.
        failure = item.status === 'failed' ? 'the image tool refused this request' : 'the image tool returned nothing';
        onProgress?.(failure);
      }

      if (event?.type === 'response.failed') {
        const detail = event?.response?.error?.message ?? 'the model reported a failed response';
        return { ok: false, error: String(detail).slice(0, 200) };
      }

      if (event?.type === 'error') {
        const detail = event?.error?.message ?? event?.message ?? 'the stream reported an error';
        return { ok: false, error: String(detail).slice(0, 200) };
      }
    }
  }

  return {
    ok: false,
    error: failure === '' ? 'the model returned no image' : failure,
  };
}

/**
 * Swaps the stored access token for a fresh one.
 *
 * The refresh is deliberately non-fatal: when it fails, the old token is still
 * used and the call either succeeds or reports the real rejection. What must not
 * happen is a try-on refused because a bookkeeping call failed.
 */
export async function refreshCodexAuth({ auth, fetchImpl, config = getCodexConfig() }) {
  if (!config.refresh) return { ok: false, error: 'codex-refresh-disabled' };
  if (auth.refreshToken === '') return { ok: false, error: 'no refresh token in the Codex login' };

  let response;
  try {
    response = await (fetchImpl ?? globalThis.fetch)(`${config.authBase}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
        scope: REFRESH_SCOPE,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { ok: false, error: `codex refresh failed: ${describe(error).slice(0, 200)}` };
  }

  if (!response.ok) return { ok: false, error: `codex refresh failed: HTTP ${response.status}` };

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: 'codex refresh returned a non-JSON response' };
  }

  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
  if (accessToken === '') return { ok: false, error: 'codex refresh returned no access token' };

  const document = {
    ...auth.document,
    tokens: {
      ...auth.document?.tokens,
      access_token: accessToken,
      // A refresh may or may not rotate the refresh token; keep the old one when
      // it does not send a new one.
      refresh_token:
        typeof payload.refresh_token === 'string' && payload.refresh_token !== ''
          ? payload.refresh_token
          : auth.refreshToken,
      id_token: typeof payload.id_token === 'string' ? payload.id_token : auth.document?.tokens?.id_token,
    },
    last_refresh: new Date().toISOString(),
  };

  // Written atomically, and never fatally: a read-only credential file must not
  // stop the try-on that is already holding a usable token.
  try {
    const temporary = `${auth.authPath}.onme-${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(document, null, 2), { mode: 0o600 });
    renameSync(temporary, auth.authPath);
  } catch {
    return { ok: true, accessToken, accountId: auth.accountId, persisted: false };
  }

  return { ok: true, accessToken, accountId: auth.accountId, persisted: true };
}

/** A usable token: the stored one when it is fresh enough, a refreshed one otherwise. */
export async function ensureAccessToken({ fetchImpl, config = getCodexConfig() } = {}) {
  const auth = readCodexAuth({ authPath: config.authPath });
  if (!auth) {
    return {
      ok: false,
      error: `no Codex login found at ${config.authPath} — run \`codex login\` on this machine`,
    };
  }

  // 0 means the expiry could not be read; an opaque token is still worth trying.
  const expiring = auth.expiresAt > 0 && auth.expiresAt - Date.now() < REFRESH_MARGIN_MS;
  if (!expiring) return { ok: true, accessToken: auth.accessToken, accountId: auth.accountId };

  const refreshed = await refreshCodexAuth({ auth, fetchImpl, config });
  if (refreshed.ok) return refreshed;

  // The rejection from the API is more specific than the refresh failure, so the
  // call goes ahead with what is stored and reports what actually happens.
  return { ok: true, accessToken: auth.accessToken, accountId: auth.accountId, refreshError: refreshed.error };
}

/**
 * One try-on through the subscription: two photos in, one PNG out.
 *
 * @param {{ person: { mimeType: string, data: string }, outfit: { mimeType: string, data: string } }} photos
 */
export async function runVirtualTryOn({ photos, fetchImpl, signal, onProgress }) {
  const config = getCodexConfig();

  const token = await ensureAccessToken({ fetchImpl, config });
  if (!token.ok) return { ok: false, error: token.error };
  if (token.refreshError) onProgress?.(token.refreshError);

  const body = {
    model: config.model,
    instructions: 'You are an image editing engine. Always use the image generation tool to produce the requested picture.',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: buildTryOnPrompt() },
          { type: 'input_image', image_url: toDataUri(photos.person.data, photos.person.mimeType) },
          { type: 'input_image', image_url: toDataUri(photos.outfit.data, photos.outfit.mimeType) },
        ],
      },
    ],
    tools: [{ type: 'image_generation' }],
    tool_choice: 'auto',
    stream: true,
    // Nothing is left on OpenAI's side to be cleaned up later.
    store: false,
  };

  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await (fetchImpl ?? globalThis.fetch)(`${config.base}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        'chatgpt-account-id': token.accountId,
        originator: 'codex_cli_rs',
        session_id: randomUUID(),
        'OpenAI-Beta': 'responses=experimental',
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'user-agent': 'codex_cli_rs',
      },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (error) {
    return { ok: false, error: `codex request failed: ${describe(error).slice(0, 200)}` };
  }

  if (!response.ok) {
    // The body may explain the refusal (a plan without image access, a spent
    // quota) but it is not the app's business, so only the status travels.
    return { ok: false, error: `codex request failed: HTTP ${response.status}` };
  }
  if (!response.body) return { ok: false, error: 'codex returned no event stream' };

  onProgress?.(`submitted ${config.model}`);
  const image = await readImageFromStream({ stream: response.body, onProgress });
  if (!image.ok) return image;

  const bytes = Buffer.from(image.base64, 'base64');
  if (bytes.length === 0) return { ok: false, error: 'codex returned an empty image' };

  const { width, height } = readPngSize(bytes);
  return {
    ok: true,
    image: { bytes, contentType: 'image/png', width, height },
    model: config.imageModel,
  };
}
