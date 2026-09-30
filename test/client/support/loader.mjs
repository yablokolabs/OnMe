/**
 * Node module hooks for testing the app's real modules offline.
 *
 *   - resolves the app's `@/…` path alias, with no bundler involved
 *   - resolves extensionless relative imports the way Metro does
 *
 * Node strips the TypeScript types itself, so the code under test is the file
 * that ships — not a copy, and not a re-implementation.
 *
 * No React Native stub is registered here, because the modules under test do not
 * import React Native: the transport, the payload and the row mapping are all
 * deliberately free of it, which is what makes them measurable from a terminal.
 * A module that needs React Native to load is a module that should be tested on
 * a device instead.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.json'];

/** Metro-style resolution: try the exact path, then a suffix, then an index file. */
function resolveFile(basePath) {
  if (existsSync(basePath) && statSync(basePath).isFile()) return basePath;

  for (const extension of EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(basePath, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  const target = specifier.startsWith('@/')
    ? path.join(REPO_ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.') && context.parentURL?.startsWith('file:')
      ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      : null;

  if (target !== null) {
    const resolved = resolveFile(target);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }

  return next(specifier, context);
}
