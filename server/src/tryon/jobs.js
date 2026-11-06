/**
 * Try-ons that outlive the request that started them.
 *
 * A cold start or a wait for a GPU can take minutes, and the proxy in front of
 * this server ends any request after about a hundred seconds. So the app can ask
 * for a job instead: the photos go up in one request that is answered at once,
 * and the app asks again under an unguessable id until the job has an answer.
 *
 * Memory only, like the looks. A job holds its outcome (a look summary or a
 * message for the user), never a photo: the photos live in the closure of the
 * running provider call and are dropped when it ends. A restart forgets every
 * job, and the app treats an unknown id as "try again".
 */

import { randomBytes } from 'node:crypto';

/** How long a finished job's answer waits to be collected. */
const DONE_TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 64;

const jobs = new Map();

function forgetExpired(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.expiresAt !== null && job.expiresAt <= now) jobs.delete(id);
  }
}

/** Removes the oldest finished jobs until there is room. A running job is never dropped. */
function makeRoom() {
  for (const [id, job] of jobs) {
    if (jobs.size < MAX_JOBS) return;
    if (job.status !== 'pending') jobs.delete(id);
  }
}

/** Starts tracking a job and returns its id. */
export function createJob() {
  forgetExpired();
  makeRoom();
  const id = randomBytes(24).toString('hex');
  jobs.set(id, { status: 'pending', expiresAt: null });
  return id;
}

/** Records the look the job made. */
export function finishJob(id, look) {
  if (!jobs.has(id)) return;
  jobs.set(id, { status: 'done', look, expiresAt: Date.now() + DONE_TTL_MS });
}

/** Records the message the user sees for a job that made nothing. */
export function failJob(id, error) {
  if (!jobs.has(id)) return;
  jobs.set(id, { status: 'failed', error, expiresAt: Date.now() + DONE_TTL_MS });
}

/** What the app is told about a job, or null when there is no such job. */
export function describeJob(id) {
  forgetExpired();
  const job = typeof id === 'string' ? jobs.get(id) : undefined;
  if (!job) return null;
  if (job.status === 'done') return { status: 'done', look: job.look };
  if (job.status === 'failed') return { status: 'failed', error: job.error };
  return { status: 'pending' };
}
