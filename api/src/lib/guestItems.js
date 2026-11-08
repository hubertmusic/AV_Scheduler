// Guest items in the service plan. While a guest's window is open, what they submit goes
// straight into the plan and their edits update it in place. After it closes, new items and
// changes wait for a leader (approve applies them the same way).
import { DateTime } from 'luxon';
import { Media, Plan, Song } from '../models.js';
import { deleteMediaFile } from './media.js';

// 'waiting' (not open yet) · 'open' · 'locked' (changes need approval)
export function windowState(g, at = new Date()) {
  if (!g.code) return 'locked'; // links from before schedules: the team approved everything
  if (g.opensAt && at < g.opensAt) return 'waiting';
  if (g.closesAt && at >= g.closesAt) return 'locked';
  return 'open';
}

// Default schedule for a new link: open now, lock the evening before the service (6 PM),
// or an hour before it if that's already past. The link stops working at the end of the day.
export function defaultSchedule(ev, tz, nowMs = Date.now()) {
  const start = DateTime.fromISO(`${ev.date}T${ev.start || '09:00'}`, { zone: tz });
  const now = DateTime.fromMillis(nowMs, { zone: tz });
  let closes = start.minus({ days: 1 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  if (closes <= now.plus({ hours: 1 })) closes = start.minus({ hours: 1 });
  if (closes <= now.plus({ minutes: 30 })) closes = now.plus({ hours: 2 });
  const endOfDay = DateTime.fromISO(ev.date, { zone: tz }).endOf('day');
  return { opensAt: now.toJSDate(), closesAt: closes.toJSDate(), expiresAt: (endOfDay > closes ? endOfDay : closes.plus({ hours: 1 })).toJSDate() };
}

const noteBlock = (who, text) => `— From ${who}:\n${text || ''}`;
const sameScripture = (a, b) => a.reference === b.reference && (a.version || '') === (b.version || '') && (a.text || '') === (b.text || '');

function dropBlock(notes, block) {
  if (!block || !notes.includes(block)) return notes;
  return notes.replace(block, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Put a submission's content into the plan. Returns what was added (saved on the submission).
export async function applyItem(plan, sub, who, data = sub.data || {}) {
  if (sub.kind === 'note') {
    const block = noteBlock(who, data.text);
    plan.notes = [plan.notes, block].filter(Boolean).join('\n\n');
    return { block };
  }
  if (sub.kind === 'scripture') {
    const row = { reference: data.reference, version: data.version || '', text: data.text || '' };
    plan.scriptures.push(row);
    return { scripture: row };
  }
  if (sub.kind === 'song') {
    const song = await Song.create({ title: data.title, artist: data.artist || '', lyrics: data.lyrics || '', notes: `Sent by ${who}`, lyricsUpdatedAt: new Date() });
    plan.songs.push({ song: song._id, key: data.key || '', note: '' });
    return { song: String(song._id) };
  }
  if (sub.kind === 'media') {
    const m = sub.media?._id ? sub.media : await Media.findById(sub.media);
    if (m) {
      m.status = 'approved';
      m.plan = plan._id;
      await m.save();
    }
    return { media: String(sub.media?._id || sub.media) };
  }
  return null;
}

// Update what an item put in the plan. If the team already removed it, it's added again.
export async function updateItem(plan, sub, who, data) {
  const a = sub.applied || {};
  if (sub.kind === 'note') {
    const block = noteBlock(who, data.text);
    plan.notes = a.block && plan.notes.includes(a.block) ? plan.notes.replace(a.block, block) : [plan.notes, block].filter(Boolean).join('\n\n');
    return { block };
  }
  if (sub.kind === 'scripture') {
    const row = { reference: data.reference, version: data.version || '', text: data.text || '' };
    const i = a.scripture ? plan.scriptures.findIndex((x) => sameScripture(x, a.scripture)) : -1;
    if (i >= 0) plan.scriptures.set(i, row);
    else plan.scriptures.push(row);
    return { scripture: row };
  }
  if (sub.kind === 'song') {
    const song = a.song ? await Song.findById(a.song) : null;
    if (!song) return applyItem(plan, sub, who, data);
    Object.assign(song, { title: data.title, artist: data.artist || '' });
    if ((data.lyrics || '') !== song.lyrics) {
      song.lyrics = data.lyrics || '';
      song.lyricsUpdatedAt = new Date();
    }
    await song.save();
    const row = plan.songs.find((x) => String(x.song) === String(song._id));
    if (row) row.key = data.key || '';
    else plan.songs.push({ song: song._id, key: data.key || '', note: '' });
    return a;
  }
  return a;
}

// Take an item back out of the plan (the guest withdrew it while their window was open).
export async function removeItem(plan, sub) {
  const a = sub.applied || {};
  if (sub.kind === 'note') plan.notes = dropBlock(plan.notes, a.block);
  if (sub.kind === 'scripture' && a.scripture) {
    const i = plan.scriptures.findIndex((x) => sameScripture(x, a.scripture));
    if (i >= 0) plan.scriptures.splice(i, 1);
  }
  if (sub.kind === 'song' && a.song) {
    plan.songs = plan.songs.filter((x) => String(x.song) !== a.song);
    const used = await Plan.exists({ _id: { $ne: plan._id }, 'songs.song': a.song });
    const song = await Song.findById(a.song);
    if (song && !used && !song.proMedia) await song.deleteOne(); // made for this item and nowhere else
  }
  if (sub.kind === 'media') {
    const m = sub.media?._id ? sub.media : await Media.findById(sub.media);
    if (m) {
      deleteMediaFile(m);
      await m.deleteOne();
    }
  }
}
