// Weekly media lifecycle.
//
//  - Active:   this weekend and anything coming up. Editable.
//  - Archived: automatically on the Monday after a service (in the org's time zone), or earlier
//              when a leader presses "Archive this weekend". Read-only and searchable; reuse
//              anything with "Copy to this week". Nothing moves. (An admin can instead delete a
//              weekend's plans and files; the schedule of who served stays.)
//  - Cold:     ARCHIVE_AFTER_DAYS after a service, its uploaded files move to ARCHIVE_DIR (a NAS
//              folder). The plan still lists them and they still open, a little slower.
//  - Removed:  optional. PURGE_VIDEO_AFTER_DAYS deletes old videos (the biggest files) but keeps
//              the record, so the plan still shows what was played.
//
// The plan record itself (who served, songs, Bible texts, sermon) is never deleted by this job.
// Library items and songs' .pro files are never moved: they're reused every week.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { Event, Media, Plan } from '../models.js';
import { addDays, getSettings, todayIn } from './util.js';
import { ARCHIVE_MARKER, archiveReady, storedPath } from './media.js';
import { logActivity } from './activity.js';

// Services archive on Monday morning: everything dated before the most recent Monday.
// Dates are YYYY-MM-DD, local to the org.
export function archiveCutoff(today) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -((dow + 6) % 7));
}
export const isArchivedDate = (date, today) => date < archiveCutoff(today);
// ev needs date and archivedAt
export const isArchived = (ev, today) => !!ev?.archivedAt || isArchivedDate(ev.date, today);
// Event query parts for archived / still-open services
export const archivedQuery = (today) => ({ $or: [{ date: { $lt: archiveCutoff(today) } }, { archivedAt: { $ne: null } }] });
export const openQuery = (today) => ({ date: { $gte: archiveCutoff(today) }, archivedAt: null });

export async function orgToday() {
  return todayIn((await getSettings()).timezone);
}

// Copy src to dir/name, checking the copy before it gets its real name. Works across disks and
// network mounts (rename can't), and never leaves a half-written file under the real name.
export async function copyVerified(src, dir, name) {
  const dest = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.part`);
  const { size } = await fs.promises.stat(src);
  try {
    await fs.promises.copyFile(src, tmp);
    const copied = await fs.promises.stat(tmp);
    if (copied.size !== size) throw new Error('the copy came out the wrong size');
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
  return dest;
}

// Uploaded files (not library items) of services dated before `cutoff`
async function serviceMediaBefore(cutoff, extra = {}) {
  const events = await Event.find({ date: { $lt: cutoff } }, { _id: 1 }).lean();
  if (!events.length) return [];
  const plans = await Plan.find({ event: { $in: events.map((e) => e._id) } }, { _id: 1 }).lean();
  if (!plans.length) return [];
  return Media.find({ plan: { $in: plans.map((p) => p._id) }, library: { $ne: true }, purgedAt: null, ...extra });
}

let lastRun = null;

export async function runColdStorage() {
  if (!config.archiveDir) return { moved: 0, skipped: 'Cold storage is off (ARCHIVE_DIR isn’t set).' };
  if (!archiveReady()) {
    return { moved: 0, skipped: `The archive folder isn’t ready: ${path.join(config.archiveDir, ARCHIVE_MARKER)} is missing. Is the NAS mounted?` };
  }
  const cutoff = addDays(await orgToday(), -config.archiveAfterDays);
  const list = await serviceMediaBefore(cutoff, { location: { $ne: 'cold' }, status: 'approved' });
  let moved = 0;
  let bytes = 0;
  const failed = [];
  for (const m of list) {
    const src = path.join(config.uploadDir, m.storedName);
    if (!storedPath(m) || !fs.existsSync(src)) continue;
    try {
      await copyVerified(src, config.archiveDir, m.storedName);
      m.location = 'cold';
      m.movedAt = new Date();
      await m.save(); // only now is the archive copy the one that gets served
      await fs.promises.unlink(src).catch(() => {});
      moved++;
      bytes += m.size || 0;
    } catch (e) {
      failed.push(`${m.originalName}: ${e.message}`);
    }
  }
  return { moved, bytes, failed };
}

export async function runPurge() {
  if (!config.purgeVideoAfterDays) return { purged: 0, skipped: 'Old videos are kept (PURGE_VIDEO_AFTER_DAYS is 0).' };
  const cutoff = addDays(await orgToday(), -config.purgeVideoAfterDays);
  const list = await serviceMediaBefore(cutoff, { mime: { $regex: '^video/' } });
  let purged = 0;
  let bytes = 0;
  for (const m of list) {
    if (m.location === 'cold' && !archiveReady()) continue; // try again when the NAS is back
    const file = storedPath(m);
    if (file) await fs.promises.unlink(file).catch(() => {});
    m.purgedAt = new Date();
    await m.save();
    purged++;
    bytes += m.size || 0;
  }
  return { purged, bytes };
}

const mb = (b) => `${Math.round((b || 0) / 1024 / 1024)} MB`;

export async function runArchiveJobs() {
  const cold = await runColdStorage();
  const purge = await runPurge();
  lastRun = { at: new Date(), cold, purge };
  if (cold.moved) await logActivity({ kind: 'system', action: `Moved ${cold.moved} file${cold.moved === 1 ? '' : 's'} (${mb(cold.bytes)}) from old services to the archive` });
  if (cold.failed?.length) await logActivity({ kind: 'system', action: `Couldn’t move ${cold.failed.length} file(s) to the archive: ${cold.failed.slice(0, 3).join('; ')}` });
  if (purge.purged) await logActivity({ kind: 'system', action: `Removed ${purge.purged} old video${purge.purged === 1 ? '' : 's'} (${mb(purge.bytes)}) to save space` });
  if (cold.skipped && config.archiveDir) console.warn('archive:', cold.skipped);
  return lastRun;
}

async function sumBy(filter) {
  const rows = await Media.find(filter, { size: 1 }).lean();
  return { count: rows.length, bytes: rows.reduce((t, r) => t + (r.size || 0), 0) };
}

export async function storageStatus() {
  const live = { purgedAt: null, status: 'approved' };
  const [library, hot, cold, removed] = await Promise.all([
    sumBy({ ...live, library: true }),
    sumBy({ ...live, library: { $ne: true }, location: { $ne: 'cold' } }),
    sumBy({ ...live, location: 'cold' }),
    sumBy({ purgedAt: { $ne: null } }),
  ]);
  return {
    enabled: !!config.archiveDir,
    ready: archiveReady(),
    archiveAfterDays: config.archiveAfterDays,
    purgeVideoAfterDays: config.purgeVideoAfterDays,
    library,
    hot,
    cold,
    removed,
    lastRun,
  };
}

export function startArchiveJob() {
  const tick = () => runArchiveJobs().catch((e) => console.error('archive job:', e.message));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 6 * 3600 * 1000);
}
