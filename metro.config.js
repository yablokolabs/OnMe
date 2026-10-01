/**
 * Metro configuration.
 *
 * The app is built for phones, but `app.json` also declares a web target and
 * `npm run web` exists, so the web bundle has to build. `expo-sqlite` ships its
 * SQLite build as WebAssembly, and Metro only copies a `.wasm` file when the
 * extension is on its asset list — otherwise it tries to parse the binary as a
 * module and the bundle fails to resolve `wa-sqlite.wasm`.
 *
 * The dev server also has to be cross-origin isolated: SQLite's web worker
 * needs `SharedArrayBuffer`, and browsers only expose that to documents sent
 * with both of these headers.
 */

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (request, response, next) => {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  return middleware(request, response, next);
};

module.exports = config;
