/**
 * The look library, and the photo of you.
 *
 * One provider owns both, so Home, the try-on screen and Settings read the same
 * data and every change is written through to SQLite immediately. Nothing is held
 * only in React state: a library that forgets on restart is not a library, and a
 * photo of you that vanishes on restart means uploading yourself again.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  clearSavedPersonRow,
  deleteAllLookRows,
  deleteEverything,
  deleteLookRow,
  getLook,
  getSavedPerson,
  listLooks,
  saveLook,
  savePerson,
} from '@/services/looksDb';
import { deleteStoredImage } from '@/services/photos';
import type { Look, StoredImage } from '@/types/onme';

export interface LooksValue {
  /** Newest look first. */
  looks: Look[];
  /** The photo of you OnMe keeps so a try-on only needs the outfit. */
  person: StoredImage | null;
  loading: boolean;
  /** A storage problem, phrased for the user. */
  error: string | null;
  reload: () => Promise<void>;
  find: (id: string) => Look | undefined;
  add: (look: Look) => Promise<void>;
  /** Deletes the look and the pictures that belong to it. */
  remove: (id: string) => Promise<void>;
  /** Deletes every look, keeping the photo of you for the next one. */
  clearAll: () => Promise<void>;
  /** Remembers a photo of you for the next try-on. */
  remember: (person: StoredImage) => Promise<void>;
  /** Stops keeping the photo of you, unless a saved look still needs it. */
  forgetPerson: () => Promise<void>;
  /** Deletes everything OnMe holds on this device. */
  removeEverything: () => Promise<void>;
}

const LooksContext = createContext<LooksValue | null>(null);

function describe(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'OnMe could not open its library on this device.';
}

export function LooksProvider({ children }: { children: ReactNode }) {
  const [looks, setLooks] = useState<Look[]>([]);
  const [person, setPerson] = useState<StoredImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const [storedLooks, storedPerson] = await Promise.all([listLooks(), getSavedPerson()]);
      if (mounted.current) {
        setLooks(storedLooks);
        setPerson(storedPerson);
        setError(null);
      }
    } catch (loadError) {
      if (mounted.current) setError(describe(loadError));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;

    // Read through an async function rather than passing `reload` to the effect
    // directly: the load is asynchronous, and an effect body that set state on
    // its first synchronous pass would cascade a render before the library has
    // even been opened.
    void (async () => {
      await reload();
    })();

    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const add = useCallback(async (look: Look) => {
    await saveLook(look);
    setLooks((previous) => [look, ...previous.filter((other) => other.id !== look.id)]);
  }, []);

  const remove = useCallback(async (id: string) => {
    const existing = await getLook(id);
    if (existing) {
      // The photo of you is shared with the next try-on and with other looks made
      // from the same photo, so it is never deleted here. Only the two pictures
      // that belong to this look are.
      deleteStoredImage(existing.result);
      deleteStoredImage(existing.outfit);
    }
    await deleteLookRow(id);
    setLooks((previous) => previous.filter((look) => look.id !== id));
  }, []);

  const clearAll = useCallback(async () => {
    // Every look's own pictures go; the photo of you stays, because "delete my
    // looks" is not "make me upload myself again".
    for (const look of looks) {
      deleteStoredImage(look.result);
      deleteStoredImage(look.outfit);
    }
    await deleteAllLookRows();
    setLooks([]);
  }, [looks]);

  const remember = useCallback(async (next: StoredImage) => {
    await savePerson(next);
    setPerson(next);
  }, []);

  const forgetPerson = useCallback(async () => {
    const existing = await getSavedPerson();
    await clearSavedPersonRow();
    setPerson(null);
    if (!existing) return;

    // The file is only removed when nothing the user kept still points at it: a
    // saved look showing the photo it was made from is not a leak, it is the look.
    const stillUsed = looks.some((look) => look.person?.uri === existing.uri);
    if (!stillUsed) deleteStoredImage(existing);
  }, [looks]);

  const removeEverything = useCallback(async () => {
    await deleteEverything();
    setLooks([]);
    setPerson(null);
  }, []);

  const find = useCallback((id: string) => looks.find((look) => look.id === id), [looks]);

  const value = useMemo(
    () => ({
      looks,
      person,
      loading,
      error,
      reload,
      find,
      add,
      remove,
      clearAll,
      remember,
      forgetPerson,
      removeEverything,
    }),
    [
      looks,
      person,
      loading,
      error,
      reload,
      find,
      add,
      remove,
      clearAll,
      remember,
      forgetPerson,
      removeEverything,
    ]
  );

  return <LooksContext.Provider value={value}>{children}</LooksContext.Provider>;
}

export function useLooks(): LooksValue {
  const context = useContext(LooksContext);
  if (!context) {
    throw new Error('useLooks must be used inside a LooksProvider');
  }
  return context;
}
