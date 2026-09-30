/**
 * Local id generation.
 *
 * Ids only need to be unique inside one device's history, so a timestamp plus a
 * random suffix is enough — and it keeps the app working offline, which is the
 * state it is in the moment the photos are picked.
 */

let counter = 0;

export function createId(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000;
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${counter.toString(36)}${random}`;
}
