// Weekly links (Service plans → Weekly links): one permanent link and code per person who sends
// things every week, like the pastor or worship leader. Each time they open it, it goes to the
// next matching service's guest page, with its deadline a set time before that service.
import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { Router } from 'express';
import { Event, GuestLink, StandingLink } from '../models.js';
import { requirePerm } from '../auth.js';
import { bad, getSettings, isId, notFound, str, token, wrap } from '../lib/util.js';
import { archiveCutoff, orgToday } from '../lib/archive.js';

export const standingRouter = Router();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// The next service this link is for (today's counts until the end of the day)
export async function nextServiceFor(sl, today) {
  const filter = { date: { $gte: today }, kind: { $ne: 'soundcheck' }, archivedAt: null };
  if (sl.serviceTitle) filter.title = sl.serviceTitle;
  return Event.findOne(filter).sort({ date: 1, start: 1 }).lean();
}

export function weeklySchedule(sl, ev, tz, nowMs = Date.now()) {
  const day = DateTime.fromISO(ev.date, { zone: tz });
  const [h, m] = (TIME_RE.test(sl.deadlineTime) ? sl.deadlineTime : '18:00').split(':').map(Number);
  const closes = day.minus({ days: sl.deadlineDays }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  const endOfDay = day.endOf('day');
  return { opensAt: new Date(nowMs), closesAt: closes.toJSDate(), expiresAt: (endOfDay > closes ? endOfDay : closes.plus({ hours: 1 })).toJSDate() };
}

// Find or make this week's guest link for a weekly link. Returns { guest, ev } or null.
export async function weeklyGuestLink(sl) {
  const s = await getSettings();
  const today = await orgToday();
  const ev = await nextServiceFor(sl, today);
  if (!ev || ev.date < archiveCutoff(today)) return null;
  let g = await GuestLink.findOne({ standing: sl._id, event: ev._id, revoked: false });
  if (!g) {
    g = await GuestLink.create({ token: token(24), event: ev._id, name: sl.name, note: sl.note, createdBy: sl.createdBy, code: sl.code, standing: sl._id, ...weeklySchedule(sl, ev, s.timezone) });
  } else if (g.code !== sl.code) {
    g.code = sl.code; // the weekly code changed: this week's link follows it
    g.codeVersion += 1;
    g.codeTries = 0;
    await g.save();
  }
  return { guest: g, ev };
}

function readFields(b, sl) {
  if (b.name !== undefined) {
    sl.name = str(b.name, 80);
    if (!sl.name) throw bad('Enter who this link is for.');
  }
  if (b.note !== undefined) sl.note = str(b.note, 300);
  if (b.serviceTitle !== undefined) sl.serviceTitle = str(b.serviceTitle, 120);
  if (b.deadlineDays !== undefined) {
    const n = Number(b.deadlineDays);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw bad('The deadline can be 0 to 6 days before the service.');
    sl.deadlineDays = n;
  }
  if (b.deadlineTime !== undefined) {
    if (!TIME_RE.test(b.deadlineTime)) throw bad('Pick a deadline time.');
    sl.deadlineTime = b.deadlineTime;
  }
}

async function view(sl, today) {
  const ev = await nextServiceFor(sl, today);
  const s = await getSettings();
  return {
    id: String(sl._id),
    token: sl.token,
    name: sl.name,
    note: sl.note,
    serviceTitle: sl.serviceTitle,
    deadlineDays: sl.deadlineDays,
    deadlineTime: sl.deadlineTime,
    code: sl.code,
    next: ev ? { title: ev.title, date: ev.date, start: ev.start, closesAt: weeklySchedule(sl, ev, s.timezone).closesAt } : null,
  };
}

standingRouter.get('/', requirePerm('plans'), wrap(async (req, res) => {
  const today = await orgToday();
  const list = await StandingLink.find({ revoked: false }).sort({ name: 1 });
  const titles = await Event.distinct('title', { kind: { $ne: 'soundcheck' } });
  res.json({ links: await Promise.all(list.map((sl) => view(sl, today))), titles: titles.sort() });
}));

standingRouter.post('/', requirePerm('plans'), wrap(async (req, res) => {
  const sl = new StandingLink({ token: token(24), code: newCode(), createdBy: req.user._id, name: '' });
  readFields({ deadlineDays: 2, deadlineTime: '18:00', ...req.body }, sl);
  if (!sl.name) throw bad('Enter who this link is for.');
  await sl.save();
  res.locals.activity = `Made a weekly link for ${sl.name}`;
  res.status(201).json(await view(sl, await orgToday()));
}));

async function load(id) {
  if (!isId(id)) throw notFound();
  const sl = await StandingLink.findOne({ _id: id, revoked: false });
  if (!sl) throw notFound('That weekly link was turned off.');
  return sl;
}

standingRouter.patch('/:id', requirePerm('plans'), wrap(async (req, res) => {
  const sl = await load(req.params.id);
  readFields(req.body || {}, sl);
  await sl.save();
  // This week's link takes the new deadline too
  const s = await getSettings();
  for (const g of await GuestLink.find({ standing: sl._id, revoked: false }).populate('event')) {
    if (!g.event) continue;
    const sch = weeklySchedule(sl, g.event, s.timezone);
    g.closesAt = sch.closesAt;
    g.expiresAt = sch.expiresAt;
    await g.save();
  }
  res.json(await view(sl, await orgToday()));
}));

standingRouter.post('/:id/new-code', requirePerm('plans'), wrap(async (req, res) => {
  const sl = await load(req.params.id);
  sl.code = newCode();
  await sl.save();
  for (const g of await GuestLink.find({ standing: sl._id, revoked: false })) {
    g.code = sl.code; // sign-ins with the old code stop working
    g.codeVersion = (g.codeVersion || 0) + 1;
    g.codeTries = 0;
    await g.save();
  }
  res.locals.activity = `Gave ${sl.name}’s weekly link a new code`;
  res.json(await view(sl, await orgToday()));
}));

standingRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  const sl = await load(req.params.id);
  sl.revoked = true;
  await sl.save();
  await GuestLink.updateMany({ standing: sl._id, revoked: false }, { revoked: true });
  res.locals.activity = `Turned off ${sl.name}’s weekly link`;
  res.status(204).end();
}));
