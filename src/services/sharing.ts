/**
 * Sharing a look.
 *
 * Deliberately the only way a picture leaves the device by the user's own hand:
 * OnMe does not post anywhere, and does not need an account to show you the
 * result. If the platform has no share sheet, this reports that instead of
 * failing silently.
 */

import * as Sharing from 'expo-sharing';

/** `true` when the sheet opened and the share completed or was dismissed. */
export async function shareImage(uri: string, mimeType: string): Promise<boolean> {
  if (!uri) return false;

  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, {
      mimeType: mimeType || 'image/jpeg',
      dialogTitle: 'Share your look',
    });
    return true;
  } catch {
    // The user dismissing the sheet and the sheet failing look the same from
    // here, and neither is worth an error on screen.
    return false;
  }
}
