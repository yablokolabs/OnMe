/**
 * The two small calls the app makes besides a try-on.
 *
 *   - Before an ad is offered, the app asks whether the backend has pictures left
 *     this month. An ad that buys a picture the backend will refuse is an ad the
 *     user watched for nothing.
 *   - From the look screen, the user can report a picture. Google Play asks this
 *     of every app that generates images. The report is a reason, the model's name
 *     and an optional note: never the picture.
 */

import { resolveTryOnEndpoint } from '@/services/backend';

export interface MonthlyBudget {
  available: boolean;
  /** `YYYY-MM-DD`, the first day of next month. */
  resetsOn: string;
}

export type ReportReason = 'offensive' | 'sexual' | 'not-me' | 'other';

const TIMEOUT_MS = 10_000;

/** What the screen says when the month's pictures are spent. Same words as the backend. */
export function describeMonthSpent(resetsOn: string): string {
  const month = new Date(`${resetsOn}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `OnMe has made all its free pictures for this month. Try again on 1 ${month}.`;
}

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  const endpoint = resolveTryOnEndpoint(path);
  if ('error' in endpoint) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(endpoint.url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The month's budget, or null when the backend cannot be reached or read. */
export async function readMonthlyBudget(): Promise<MonthlyBudget | null> {
  const response = await call('/tryon/budget');
  if (!response?.ok) return null;
  try {
    const body = (await response.json()) as Partial<MonthlyBudget>;
    if (typeof body.available !== 'boolean' || typeof body.resetsOn !== 'string') return null;
    return { available: body.available, resetsOn: body.resetsOn };
  } catch {
    return null;
  }
}

export async function reportPicture(report: {
  reason: ReportReason;
  model: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await call('/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  });
  if (response?.status === 202) return { ok: true };
  return { ok: false, error: 'OnMe could not send that report. Check your connection and try again.' };
}
