/**
 * Row mapping and validation for the OnMe store.
 *
 * Kept separate from the SQLite calls so the shape of the data can be tested in
 * plain Node, where there is no database and no device.
 *
 * A whole look is stored as JSON in `payload`, alongside the few columns the list
 * sorts on. That keeps the schema migration-free while the shape is still moving,
 * without giving up a real query for the list.
 *
 * `fromLookRow` is also the single definition of a usable look: one corrupted row
 * becomes *no row* rather than a screen that cannot open.
 */

import type { Look, StoredImage } from '@/types/onme';

export interface LookRow {
  id: string;
  created_at: string;
  /** Epoch milliseconds, so the list can sort without parsing JSON. */
  created_ms: number;
  payload: string;
}

/** The look library, and the one photo of you it keeps for next time. */
export const LOOKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS looks (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS looks_created_ms_idx ON looks (created_ms DESC);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  payload TEXT NOT NULL
);
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Validates one stored photo.
 *
 * A photo without a URI is not a photo — it is a record of a file that is gone —
 * and returning null for it is what lets a look survive its photos being deleted.
 */
export function parseStoredImage(value: unknown): StoredImage | null {
  if (!isRecord(value)) return null;

  const uri = asString(value.uri);
  if (uri === '') return null;

  return {
    uri,
    fileName: asString(value.fileName),
    bytes: Math.max(0, Math.round(asNumber(value.bytes))),
    mimeType: asString(value.mimeType),
    width: Math.max(0, Math.round(asNumber(value.width))),
    height: Math.max(0, Math.round(asNumber(value.height))),
  };
}

export function toLookRow(look: Look): LookRow {
  const createdAt = asString(look.createdAt) || new Date(0).toISOString();
  const parsed = Date.parse(createdAt);

  return {
    id: look.id,
    created_at: createdAt,
    created_ms: Number.isFinite(parsed) ? parsed : 0,
    payload: JSON.stringify(look),
  };
}

/** Rebuilds a look from its stored row, or null when the row is unusable. */
export function fromLookRow(row: LookRow | null | undefined): Look | null {
  if (!row || typeof row.payload !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const id = asString(parsed.id);
  if (id === '') return null;

  const result = parseStoredImage(parsed.result);
  // The generated image is the look. Without it there is nothing to show, and a
  // row that survived its own result being deleted would be a dead screen.
  if (!result) return null;

  return {
    id,
    // The indexed column wins: it is what the list was sorted by.
    createdAt: row.created_at || asString(parsed.createdAt),
    person: parseStoredImage(parsed.person),
    outfit: parseStoredImage(parsed.outfit),
    result,
    model: asString(parsed.model),
    preservePose: parsed.preservePose === true,
  };
}

/** The photo of you, for the next try-on. */
export function parseProfile(value: unknown): StoredImage | null {
  return parseStoredImage(value);
}

export function toProfilePayload(person: StoredImage): string {
  return JSON.stringify(person);
}

/** Newest first — the order the user expects. */
export function sortByCreatedAt(looks: Look[]): Look[] {
  return [...looks].sort((a, b) => {
    const left = Date.parse(b.createdAt);
    const right = Date.parse(a.createdAt);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
    return left - right;
  });
}
