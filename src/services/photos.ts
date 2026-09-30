/**
 * Picking a photo, and owning a copy of it.
 *
 * Two rules shape this module:
 *
 *   1. **A picked file is copied into the app's own storage immediately.** A
 *      picker's URI points into a cache another process can clear, and OnMe
 *      promises the photos are yours and deletable — so the app has to hold the
 *      file, not a reference to one somebody else owns.
 *   2. **Nothing here talks to the network.** Picking a photo and sending it are
 *      separate steps, so the screen can show what was chosen before anything
 *      leaves the device.
 *
 * On the encoding: `expo-image-picker` with `base64: true` re-encodes through
 * `UIImage.jpegData` on iOS and `Bitmap.CompressFormat.JPEG` on Android, so the
 * base64 is **always JPEG** whatever the original was — including HEIC, which is
 * what an iPhone produces by default. That is why the declared type below is a
 * constant rather than a copy of the asset's own `mimeType`, which still names
 * the original format and would mislabel the bytes.
 */

import { Directory, File, Paths } from 'expo-file-system';
// The read-as-string call lives in the legacy entry point on purpose; see
// `readPhotoBase64` below.
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { estimatePhotoBytes, type PhotoInput } from '@/services/tryOnPayload';
import type { StoredImage } from '@/types/onme';

const PHOTOS_FOLDER = 'photos';

/** A photo the user chose, before anything has been sent anywhere. */
export interface PickedPhoto {
  /** What will be uploaded. */
  input: PhotoInput;
  /** The chosen file, for showing the choice on screen. */
  uri: string;
  width: number;
  height: number;
}

function photosDirectory(): Directory {
  return new Directory(Paths.document, PHOTOS_FOLDER);
}

function ensurePhotosDirectory(): Directory {
  const directory = photosDirectory();
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * Opens the photo library and returns the chosen photo, or null if the user
 * backed out. Throws only for the one thing the user has to act on: no access.
 */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'OnMe needs access to your photos to pick one. You can turn it on in your phone settings.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // No crop step: the question is "how does this look on me", and a crop
    // screen is one more thing to get through before you find out.
    allowsEditing: false,
    quality: 0.9,
    base64: true,
    // Location and camera metadata is not OnMe's business.
    exif: false,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  const base64 = typeof asset.base64 === 'string' ? asset.base64 : '';

  return {
    input: {
      base64,
      // Always JPEG: see the note at the top of this file.
      mimeType: 'image/jpeg',
      bytes: estimatePhotoBytes(base64),
    },
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
  };
}

function imageFromFile(file: File, picked: PickedPhoto, mimeType: string): StoredImage {
  return {
    uri: file.uri,
    fileName: file.name,
    bytes: file.size ?? picked.input.bytes ?? 0,
    mimeType,
    width: picked.width,
    height: picked.height,
  };
}

/**
 * Copies the photo of you into app storage under its own name.
 *
 * Named per pick rather than one fixed file, so the looks already made from an
 * earlier photo keep pointing at the photo they were actually made from. A single
 * `you.jpg` overwritten on the next pick would silently rewrite history: an
 * older look would show a source pair containing somebody the result was not
 * generated from.
 */
export function storePersonPhoto(picked: PickedPhoto, photoId: string): StoredImage {
  const directory = ensurePhotosDirectory();
  const destination = new File(directory, `you-${photoId}.jpg`);

  const source = new File(picked.uri);
  source.copySync(destination);

  return imageFromFile(destination, picked, 'image/jpeg');
}

/** Copies an outfit photo into app storage under the look it belongs to. */
export function storeOutfitPhoto(lookId: string, picked: PickedPhoto): StoredImage {
  const directory = ensurePhotosDirectory();
  const destination = new File(directory, `${lookId}-outfit.jpg`);

  const source = new File(picked.uri);
  source.copySync(destination);

  return imageFromFile(destination, picked, 'image/jpeg');
}

function extensionFor(contentType: string, url: string): string {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';

  const match = /\.(png|jpe?g|webp)(?:\?|$)/i.exec(url);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.png';
}

/**
 * Downloads the generated image and keeps it on the device.
 *
 * The model hands back a URL on its own storage. OnMe does not leave the user's
 * history pointing at somebody else's CDN: the picture is fetched once and saved
 * here, so the look opens offline and cannot expire underneath them.
 */
export async function storeGeneratedImage(
  lookId: string,
  url: string,
  contentType: string,
  width: number,
  height: number
): Promise<StoredImage> {
  const directory = ensurePhotosDirectory();
  const extension = extensionFor(contentType, url);
  const destination = new File(directory, `${lookId}-look${extension}`);

  const downloaded = await File.downloadFileAsync(url, destination);

  return {
    uri: downloaded.uri,
    fileName: downloaded.name || `${lookId}${extension}`,
    bytes: downloaded.size ?? 0,
    mimeType: contentType || (extension === '.png' ? 'image/png' : 'image/jpeg'),
    width,
    height,
  };
}

/**
 * Reads a stored photo back as base64, for the next try-on.
 *
 * This is why the photo of you can be picked once and reused: the file stays on
 * the device, and only the bytes that are about to be sent are ever in memory.
 *
 * The current `File` API exposes `arrayBuffer()` and no base64 read, so this uses
 * the legacy read-as-string with an explicit encoding rather than carrying a
 * base64 encoder in JavaScript for no reason.
 */
export async function readPhotoBase64(image: StoredImage): Promise<string> {
  return readAsStringAsync(image.uri, { encoding: 'base64' });
}

/** Deletes one stored photo. A missing file is not an error. */
export function deleteStoredImage(image: StoredImage | null | undefined): void {
  if (!image?.uri) return;
  try {
    const file = new File(image.uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or the URI was never ours. Either way nothing claims it now.
  }
}

/** Deletes every photo OnMe holds: both of you, and every generated look. */
export function deleteAllStoredImages(): void {
  try {
    const directory = photosDirectory();
    if (directory.exists) directory.delete();
  } catch {
    // A folder that cannot be removed is reported by whatever fails next.
  }
}
