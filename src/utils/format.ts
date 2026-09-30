/** Shared formatting helpers. */

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/**
 * Turns a timestamp into something that reads the way a person remembers it.
 *
 * The date is on the left and the time on the right, so a column of looks can be
 * scanned by day first and only then by time.
 */
export function formatMoment(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  if (dayDiff === 0) return `Today · ${time}`;
  if (dayDiff === 1) return `Yesterday · ${time}`;

  const day = date.getDate();
  const month = date.toLocaleString('en-GB', { month: 'short' });
  return `${day} ${month} · ${time}`;
}
