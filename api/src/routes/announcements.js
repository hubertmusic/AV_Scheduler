import { Router } from 'express';
import { DateTime } from 'luxon';
import { Announcement } from '../models.js';
import { addDays, bad, DATE_RE, forbidden, fridayOf, getSettings, str, todayIn, wrap } from '../lib/util.js';
import { dayName } from '../lib/activity.js';

export const announcementsRouter = Router();

// Who can write announcements: the admin, and leaders who can edit the schedule.
const canWrite = (req, res, next) => (req.user.role === 'admin' || req.can.edit ? next() : next(forbidden('Only the admin and schedule editors can change announcements.')));

// Everything a page or message needs: the permanent note plus weekly notes keyed by Friday.
export async function announcementsFor(fromDate, toDate) {
  const s = await getSettings();
  const weekly = await Announcement.find({ friday: { $gte: fridayOf(fromDate), $lte: fridayOf(toDate) }, text: { $ne: '' } }).lean();
  return {
    permanent: s.permanentNote ? { text: s.permanentNote, at: s.permanentNoteAt, by: s.permanentNoteBy } : null,
    weekly: Object.fromEntries(weekly.map((a) => [a.friday, { text: a.text, at: a.updatedAt, by: a.updatedByName }])),
  };
}

// The notes that apply to one date, as plain lines (for emails and calendars).
export async function noticeLinesFor(date) {
  const a = await announcementsFor(date, date);
  const out = [];
  if (a.permanent) out.push(`IMPORTANT: ${a.permanent.text}`);
  const w = a.weekly[fridayOf(date)];
  if (w) out.push(`THIS WEEKEND: ${w.text}`);
  return out;
}

announcementsRouter.get('/', wrap(async (req, res) => {
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : addDays(today, -7);
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : addDays(today, 90);
  res.json(await announcementsFor(from, to));
}));

announcementsRouter.put('/permanent', canWrite, wrap(async (req, res) => {
  const s = await getSettings();
  const text = str(req.body.text, 2000);
  s.permanentNote = text;
  s.permanentNoteAt = new Date();
  s.permanentNoteBy = req.user.name;
  await s.save();
  res.locals.activity = text ? `Updated the permanent announcement: “${text.slice(0, 80)}${text.length > 80 ? '…' : ''}”` : 'Cleared the permanent announcement';
  res.json({ permanent: text ? { text, at: s.permanentNoteAt, by: s.permanentNoteBy } : null });
}));

announcementsRouter.put('/weekly/:friday', canWrite, wrap(async (req, res) => {
  const friday = req.params.friday;
  if (!DATE_RE.test(friday) || DateTime.fromISO(friday).weekday !== 5) throw bad('Pick the Friday of the weekend.');
  const text = str(req.body.text, 2000);
  if (!text) {
    await Announcement.deleteOne({ friday });
    res.locals.activity = `Cleared the announcement for the weekend of ${dayName(friday)}`;
    return res.json({ friday, weekly: null });
  }
  const a = await Announcement.findOneAndUpdate({ friday }, { $set: { text, updatedByName: req.user.name } }, { upsert: true, new: true });
  res.locals.activity = `Updated the announcement for the weekend of ${dayName(friday)}: “${text.slice(0, 80)}${text.length > 80 ? '…' : ''}”`;
  res.json({ friday, weekly: { text: a.text, at: a.updatedAt, by: a.updatedByName } });
}));
