/**
 * OnMe backend configuration.
 *
 * Pipeline:
 *   two photos on the phone -> OnMe Expo app -> secure upload -> OnMe backend
 *   -> the try-on model -> one generated image -> back on the phone, saved there.
 *
 * The backend endpoint and its optional shared token are public values (they ship
 * inside the app bundle); neither is a secret. The shared token is a throttle,
 * not authentication — real authorization (checking that the caller is entitled
 * to a generation) is a server-side feature that lands before public release.
 *
 * NEVER put FAL_KEY (or any renamed variant such as `EXPO_PUBLIC_FAL_KEY`) in this
 * app: it is a server-side secret and only ever belongs on the backend.
 */

export const ONME_BACKEND_URL = (process.env.EXPO_PUBLIC_ONME_BACKEND_URL ?? '').replace(/\/+$/, '');
/** Optional shared token, only needed when the backend sets ONME_CLIENT_TOKEN. */
export const ONME_BACKEND_TOKEN = process.env.EXPO_PUBLIC_ONME_BACKEND_TOKEN ?? '';

/** `https://host[:port][/path]` — the only shape a backend URL may take. */
const BACKEND_URL_PATTERN = /^(https?|wss?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i;

export function isBackendConfigured(): boolean {
  return ONME_BACKEND_URL.length > 0;
}

/** True in a development build, where an insecure local backend is acceptable. */
function isDevelopmentBuild(): boolean {
  return typeof globalThis !== 'undefined' && (globalThis as { __DEV__?: unknown }).__DEV__ === true;
}

export interface TryOnEndpointRequest {
  /** `https://host[:port][/path]/tryon` for the generation endpoint. */
  url: string;
}

export interface TryOnEndpointOptions {
  baseUrl: string;
  token?: string;
  development?: boolean;
}

/**
 * Builds the endpoint a try-on is sent to.
 *
 * Production requires TLS. A photo of a person is the most private thing this app
 * handles, and the backend holds provider credentials, so a release build refuses
 * to send one over plain `http://` instead of silently posting it in the clear. A
 * development build may point at a plain `http://` host on the local network (a
 * phone on the same LAN as a dev server, for example).
 */
export function buildTryOnEndpoint(
  options: TryOnEndpointOptions
): TryOnEndpointRequest | { error: string } {
  const baseUrl = (options.baseUrl ?? '').trim().replace(/\/+$/, '');

  if (baseUrl === '') {
    return {
      error: 'OnMe needs EXPO_PUBLIC_ONME_BACKEND_URL to make a picture. Add it and rebuild.',
    };
  }

  const match = BACKEND_URL_PATTERN.exec(baseUrl);
  if (!match) {
    return {
      error: `"${baseUrl}" is not a valid OnMe backend URL. Use https://your-onme-backend.example.com.`,
    };
  }

  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const basePath = match[3] ?? '';
  const secure = scheme === 'https' || scheme === 'wss';

  if (!secure && options.development !== true) {
    return {
      error:
        'OnMe will not send a photo of you over an insecure connection in a release build. Use an https:// backend URL.',
    };
  }

  const query = new URLSearchParams();
  const token = options.token ?? '';
  if (token !== '') query.set('token', token);

  // `ws`/`wss` are accepted in configuration for backward compatibility, but a
  // try-on is HTTP, so the transport scheme is http/https either way.
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
  return { url: `${secure ? 'https' : 'http'}://${authority}${basePath}/tryon${suffix}` };
}

/** Resolves the endpoint from the configured environment. */
export function resolveTryOnEndpoint(): TryOnEndpointRequest | { error: string } {
  return buildTryOnEndpoint({
    baseUrl: ONME_BACKEND_URL,
    token: ONME_BACKEND_TOKEN,
    development: isDevelopmentBuild(),
  });
}
