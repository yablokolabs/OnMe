/**
 * The look library, and the one photo of you.
 *
 * Both survive a restart, so both live in SQLite rather than in React state. The
 * images themselves are in the app's own document directory (see `photos.ts`),
 * and a row is only ever a description of files the app owns.
 *
 * The database file is `onme.db`. There is nothing here that talks to a server:
 * the library is entirely local, and deleting everything in Settings really does
 * remove it from the device.
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import {
  NO_ALLOWANCE,
  afterReward,
  afterTryOn,
  type Allowance,
} from '@/services/allowance';
import { deleteStoredImage, deleteAllStoredImages } from '@/services/photos';
import {
  LOOKS_SCHEMA,
  fromLookRow,
  parseAllowance,
  parseProfile,
  toLookRow,
  toProfilePayload,
  type CreditsRow,
  type LookRow,
} from '@/services/lookRows';
import type { Look, StoredImage } from '@/types/onme';

const DATABASE_NAME = 'onme.db';

let databasePromise: Promise<SQLiteDatabase> | null = null;

function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync('PRAGMA journal_mode = WAL;');
      await database.execAsync(LOOKS_SCHEMA);
      return database;
    });
  }
  return databasePromise;
}

/** Newest look first — the order the user expects. */
export async function listLooks(): Promise<Look[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<LookRow>(
    'SELECT * FROM looks ORDER BY created_ms DESC'
  );
  return rows.map(fromLookRow).filter((look): look is Look => look !== null);
}

export async function getLook(id: string): Promise<Look | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<LookRow>('SELECT * FROM looks WHERE id = ?', id);
  return fromLookRow(row);
}

export async function saveLook(look: Look): Promise<void> {
  const database = await getDatabase();
  const row = toLookRow(look);
  await database.runAsync(
    `INSERT INTO looks (id, created_at, created_ms, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       created_at = excluded.created_at,
       created_ms = excluded.created_ms,
       payload = excluded.payload`,
    row.id,
    row.created_at,
    row.created_ms,
    row.payload
  );
}

export async function deleteLookRow(id: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM looks WHERE id = ?', id);
}

export async function deleteAllLookRows(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM looks');
}

/* ── How many pictures are left for nothing ───────────────────────────────── */

/**
 * The allowance counters, read from the one row that holds them.
 *
 * Every read goes to the database rather than to React state, because the number
 * has to survive a force-quit: a free tier that could be refreshed by closing the
 * app is not a free tier.
 */
export async function readAllowance(): Promise<Allowance> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CreditsRow>('SELECT used, bonus FROM credits WHERE id = 1');
  return parseAllowance(row);
}

async function writeAllowance(next: Allowance): Promise<Allowance> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO credits (id, used, bonus) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET used = excluded.used, bonus = excluded.bonus`,
    next.used,
    next.bonus
  );
  return next;
}

/** One more picture made. Called after the picture exists, never before it. */
export async function recordTryOn(): Promise<Allowance> {
  return writeAllowance(afterTryOn(await readAllowance()));
}

/** One more picture bought by watching a rewarded ad to the end. */
export async function grantRewardedTryOn(): Promise<Allowance> {
  return writeAllowance(afterReward(await readAllowance()));
}

/** Back to a fresh install. Only "delete everything" does this — see below. */
export async function resetAllowance(): Promise<void> {
  await writeAllowance(NO_ALLOWANCE);
}

/* ── The photo of you ─────────────────────────────────────────────────────── */

export async function getSavedPerson(): Promise<StoredImage | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM profile WHERE id = 1'
  );
  if (!row || typeof row.payload !== 'string') return null;

  try {
    return parseProfile(JSON.parse(row.payload));
  } catch {
    return null;
  }
}

export async function savePerson(person: StoredImage): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO profile (id, payload) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
    toProfilePayload(person)
  );
}

/**
 * Forgets the photo of you, **without touching the file**.
 *
 * The file may still be the source of looks the user is keeping, so deciding
 * whether it can be deleted is the caller's job — see `forgetPerson` in
 * `use-looks`, which checks before removing it.
 */
export async function clearSavedPersonRow(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM profile WHERE id = 1');
}

/** Kept as the one-step version, for a caller that has already handled the file. */
export async function clearSavedPerson(): Promise<void> {
  const existing = await getSavedPerson();
  deleteStoredImage(existing);
  await clearSavedPersonRow();
}

/**
 * Deletes both tables and every photo the app holds.
 *
 * The rows go before the files, because a row that outlives its file is a dead
 * screen and a file that outlives its row is storage the user believes they
 * deleted.
 */
export async function deleteEverything(): Promise<void> {
  await deleteAllLookRows();
  await clearSavedPerson();
  await resetAllowance();
  deleteAllStoredImages();
}

/*
 * Resetting the allowance with everything else is a choice, and worth stating.
 *
 * It costs the user every picture they have made to win back ten free ones, so it
 * is not a way to live for free — and the alternative, keeping a counter behind
 * after the screen promised that everything OnMe holds is gone, is the kind of
 * small lie the rest of this app exists not to tell. Pro is different: it is not
 * in this database at all, so a subscriber who deletes everything still restores
 * their purchase from the store with one tap.
 */
