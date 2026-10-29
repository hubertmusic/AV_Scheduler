import { config } from '../config.js';
import { Router } from 'express';
import { IANAZone } from 'luxon';
import { Assignment, Blackout, Event, EVENT_KINDS, Group, Position, Request, Resource, Unavailable, User } from '../models.js';
import { requireAdmin, requirePerm } from '../auth.js';
import { addDays, bad, conflict, DATE_RE, getSettings, isHttpUrl, isId, normalizeUrl, notFound, str, TIME_RE, todayIn, wrap } from '../lib/util.js';
import { eventView, groupView, meView, personView, requestView } from '../lib/views.js';
import { cleanGroupIds } from './events.js';
import { announcementsFor, noticeLinesFor } from './announcements.js';
import { buildCalendar } from '../lib/ics.js';
import { awayByEvent, baseOf, isShadow, touchAvailability } from '../lib/availability.js';
import { mailerReady, sendMail } from '../lib/mailer.js';
import { calendarClient, dayName, evName, logActivity, posName } from '../lib/activity.js';

const settingsView = (s) => ({
  orgName: s.orgName,
  timezone: s.timezone,
  countryCode: s.countryCode,
  groupLink: s.groupLink,
  weekendTemplate: s.weekendTemplate,
  reminderEmails: s.reminderEmails,
  reminderDays: s.reminderDays,
  emailConfigured: mailerReady(),
});

// ---------- bootstrap: everything the app needs on load ----------
export const bootstrapRouter = Router();
bootstrapRouter.get('/', wrap(async (req, res) => {
  const [s, positions, people, groups] = await Promise.all([
    getSettings(),
    Position.find({}).sort({ order: 1, label: 1 }).lean(),
    User.find(req.can.people ? {} : { active: true }).sort({ name: 1 }),
    Group.find({}).sort({ name: 1 }),
  ]);
  res.json({
    me: req.previewing ? { ...meView(req.user), calUrl: `${config.publicUrl}/cal/(their-private-link).ics`, previewing: true } : meView(req.user),
    settings: settingsView(s),
    positions: positions.map((p) => ({ key: p.key, label: p.label, order: p.order })),
    people: people.map((p) => personView(p, req.user)),
    groups: groups.map((g) => groupView(g, req.user)),
    announcements: await announcementsFor(addDays(todayIn(s.timezone), -7), addDays(todayIn(s.timezone), 120)),
    academy: config.academyOn ? { url: config.academyUrl, host: new URL(config.academyUrl).host } : null,
  });
}));

// ---------- my shifts overview ----------
export const meRouter = Router();
meRouter.get('/overview', wrap(async (req, res) => {
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const horizon = addDays(today, 90);
  const me = req.user;
  const events = await Event.find({ date: { $gte: today, $lte: horizon } }).sort({ date: 1, start: 1 }).lean();
  const ids = events.map((e) => e._id);
  const [asg, myUnav, myReqs, away, blackouts] = await Promise.all([
    Assignment.find({ event: { $in: ids } }).lean(),
    Unavailable.find({ user: me._id }).lean(),
    Request.find({ from: me._id }).sort({ createdAt: -1 }).limit(30).populate(['from', 'event', 'targetUser', 'targetEvent', 'decidedBy']),
    awayByEvent(events, me._id),
    Blackout.find({ user: me._id, to: { $gte: today } }).sort({ from: 1 }).lean(),
  ]);
  const unav = new Set(myUnav.map((u) => String(u.event)));
  const isAway = (eid) => !!away[eid]?.size;
  const slotHolder = {};
  const onEvent = {};
  const mine = {};
  for (const a of asg) {
    slotHolder[`${a.event}|${a.position}`] = String(a.user);
    if (String(a.user) === String(me._id)) {
      onEvent[String(a.event)] = a.position;
      mine[`${a.event}|${a.position}`] = a;
    }
  }
  const pending = {};
  for (const r of myReqs) if (r.status === 'pending' && r.event) pending[`${r.event._id}|${r.position}`] = r.type;

  const shifts = [];
  const pickups = [];
  for (const e of events) {
    const eid = String(e._id);
    for (const pos of [...e.needs, ...e.needs.map((k) => `${k}+shadow`)]) {
      const key = `${eid}|${pos}`;
      const holder = slotHolder[key];
      if (holder === String(me._id)) {
        const a = mine[key];
        shifts.push({ ...eventView(e), position: baseOf(pos), slot: pos, shadow: isShadow(pos), confirmed: !!a.confirmedAt, away: isAway(eid) || unav.has(eid), pending: pending[key] || null });
      } else if (!isShadow(pos) && !holder && me.positions.includes(pos) && !unav.has(eid) && !isAway(eid) && !onEvent[eid]) {
        pickups.push({ ...eventView(e), position: pos, pending: pending[key] === 'pickup' });
      }
    }
  }
  const availability = events
    .filter((e) => e.date <= addDays(today, 56))
    .map((e) => ({ ...eventView(e), unavailable: unav.has(String(e._id)), away: isAway(String(e._id)), onPosition: onEvent[String(e._id)] ? baseOf(onEvent[String(e._id)]) : null }));

  res.json({
    shifts,
    pickups,
    availability,
    blackouts: blackouts.map((b) => ({ id: String(b._id), from: b.from, to: b.to, note: b.note })),
    maxPerMonth: me.maxPerMonth || 0,
    availabilityUpdatedAt: me.availabilityUpdatedAt || null,
    requests: myReqs.map(requestView),
  });
}));

// Confirm (or un-confirm) one of my shifts
meRouter.post('/confirm', wrap(async (req, res) => {
  const { eventId, slot } = req.body;
  if (!isId(eventId) || typeof slot !== 'string') throw bad('Pick a shift.');
  const a = await Assignment.findOne({ event: eventId, position: slot, user: req.user._id }).populate('event', 'title date');
  if (!a) throw notFound('You aren\u2019t on that shift any more.');
  a.confirmedAt = req.body.confirmed === false ? null : new Date();
  await a.save();
  res.locals.activity = `${a.confirmedAt ? 'Confirmed' : 'Un-confirmed'} ${await posName(slot)} · ${evName(a.event)}`;
  res.json({ ok: true, confirmed: !!a.confirmedAt });
}));

// Blackout dates (away from–to)
meRouter.post('/blackouts', wrap(async (req, res) => {
  const from = req.body.from;
  const to = req.body.to || from;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || to < from) throw bad('Pick the first and last day you\u2019re away.');
  if (addDays(from, 366) < to) throw bad('Keep it to a year or less.');
  if ((await Blackout.countDocuments({ user: req.user._id })) >= 50) throw bad('That\u2019s a lot of dates. Remove some old ones first.');
  const b = await Blackout.create({ user: req.user._id, from, to, note: str(req.body.note, 120) });
  await touchAvailability(req.user._id);
  res.locals.activity = `Added away dates ${dayName(from)}${to !== from ? ` – ${dayName(to)}` : ''}${b.note ? ` (${b.note})` : ''}`;
  res.status(201).json({ id: String(b._id), from: b.from, to: b.to, note: b.note });
}));

meRouter.delete('/blackouts/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const b = await Blackout.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!b) throw notFound();
  await touchAvailability(req.user._id);
  res.locals.activity = `Removed away dates ${dayName(b.from)}${b.to !== b.from ? ` – ${dayName(b.to)}` : ''}`;
  res.status(204).end();
}));

// "Nothing's changed" — lets leaders see availability is current
meRouter.post('/availability/ok', wrap(async (req, res) => {
  await touchAvailability(req.user._id);
  res.locals.activity = 'Confirmed their availability is up to date';
  res.json({ ok: true });
}));

meRouter.put('/limit', wrap(async (req, res) => {
  const n = Math.max(0, Math.min(31, Math.round(Number(req.body.maxPerMonth) || 0)));
  req.user.maxPerMonth = n;
  req.user.availabilityUpdatedAt = new Date();
  await req.user.save();
  res.locals.activity = n ? `Set a limit of ${n} shifts a month` : 'Removed their monthly limit';
  res.json({ maxPerMonth: n });
}));

// ---------- resources ----------
export const resourcesRouter = Router();
function readResource(b) {
  const title = str(b.title, 120);
  if (!title) throw bad('Give the resource a title.');
  const url = normalizeUrl(str(b.url, 1000));
  if (url && !isHttpUrl(url)) throw bad('That doesn’t look like a web address. Try something like practiceav.fyi or https://example.com/page');
  return { title, url, position: str(b.position, 40), kind: str(b.kind, 30) || 'Link', minutes: Math.max(0, Math.min(600, Number(b.minutes) || 0)) };
}
resourcesRouter.get('/', wrap(async (req, res) => {
  const list = await Resource.find({}).sort({ position: 1, title: 1 }).lean();
  res.json(list.map((r) => ({ id: String(r._id), title: r.title, url: r.url, position: r.position, kind: r.kind, minutes: r.minutes })));
}));
resourcesRouter.post('/', requirePerm('resources'), wrap(async (req, res) => {
  const r = await Resource.create(readResource(req.body));
  res.status(201).json({ id: String(r._id), ...readResource(r) });
}));
resourcesRouter.patch('/:id', requirePerm('resources'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const r = await Resource.findById(req.params.id);
  if (!r) throw notFound();
  Object.assign(r, readResource({ ...r.toObject(), ...req.body }));
  await r.save();
  res.json({ id: String(r._id), ...readResource(r) });
}));
resourcesRouter.delete('/:id', requirePerm('resources'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  await Resource.deleteOne({ _id: req.params.id });
  res.status(204).end();
}));

// ---------- settings + positions (admin) ----------
export const settingsRouter = Router();
settingsRouter.patch('/', requireAdmin, wrap(async (req, res) => {
  const s = await getSettings();
  const b = req.body;
  if (b.orgName !== undefined) s.orgName = str(b.orgName, 80) || 'AV Crew';
  if (b.timezone !== undefined) {
    if (!IANAZone.isValidZone(b.timezone)) throw bad('That time zone isn’t recognized (e.g. America/New_York).');
    s.timezone = b.timezone;
  }
  if (b.reminderEmails !== undefined) s.reminderEmails = !!b.reminderEmails;
  if (b.reminderDays !== undefined) s.reminderDays = Math.max(1, Math.min(7, Math.round(Number(b.reminderDays) || 2)));
  if (b.countryCode !== undefined) s.countryCode = String(b.countryCode).replace(/\D/g, '').slice(0, 4);
  if (b.groupLink !== undefined) {
    const link = normalizeUrl(str(b.groupLink, 300));
    if (link && !isHttpUrl(link)) throw bad('The group link should start with https://');
    s.groupLink = link;
  }
  if (b.weekendTemplate !== undefined) {
    if (!Array.isArray(b.weekendTemplate) || b.weekendTemplate.length > 20) throw bad('The weekend template is invalid.');
    const keys = new Set((await Position.find({}).lean()).map((p) => p.key));
    const rows = [];
    for (const t of b.weekendTemplate) {
      const title = str(t.title, 80);
      if (!title) throw bad('Every service in the template needs a name.');
      if (![0, 1, 2].includes(Number(t.day))) throw bad('Pick Friday, Sabbath or Sunday for each service.');
      for (const f of ['start', 'call', 'end']) if (!TIME_RE.test(t[f] || '')) throw bad(`Check the times for ${title}.`);
      rows.push({
        day: Number(t.day),
        title,
        start: t.start,
        call: t.call,
        end: t.end,
        needs: (t.needs || []).filter((k) => keys.has(k)),
        kind: EVENT_KINDS.includes(t.kind) ? t.kind : 'service',
        groups: await cleanGroupIds(t.groups),
        off: Boolean(t.off),
      });
    }
    s.weekendTemplate = rows;
  }
  await s.save();
  res.json(settingsView(s));
}));

settingsRouter.post('/test-email', requireAdmin, wrap(async (req, res) => {
  if (!mailerReady()) throw bad('Email isn\u2019t set up. Add SMTP_URL and MAIL_FROM to your .env file, then restart.');
  try {
    await sendMail({ to: req.user.email, subject: 'Crew Call test email', text: 'Email from Crew Call is working. Shift reminders will be sent from this address.' });
  } catch (e) {
    throw bad(`The mail server refused it: ${e.message}`);
  }
  res.json({ sentTo: req.user.email });
}));

export const positionsRouter = Router();
positionsRouter.post('/', requireAdmin, wrap(async (req, res) => {
  const label = str(req.body.label, 40);
  if (!label) throw bad('Name the position.');
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'pos';
  let key = base;
  for (let i = 2; await Position.findOne({ key }); i++) key = `${base}-${i}`;
  const count = await Position.countDocuments({});
  const p = await Position.create({ key, label, order: count });
  res.status(201).json({ key: p.key, label: p.label, order: p.order });
}));
positionsRouter.patch('/:key', requireAdmin, wrap(async (req, res) => {
  const p = await Position.findOne({ key: req.params.key });
  if (!p) throw notFound();
  if (req.body.label !== undefined) {
    const label = str(req.body.label, 40);
    if (!label) throw bad('Name the position.');
    p.label = label;
  }
  if (req.body.order !== undefined) p.order = Number(req.body.order) || 0;
  await p.save();
  res.json({ key: p.key, label: p.label, order: p.order });
}));
positionsRouter.delete('/:key', requireAdmin, wrap(async (req, res) => {
  const key = req.params.key;
  if (await Event.findOne({ needs: key })) throw conflict('Some services still use this position. Remove it from them first.');
  await Position.deleteOne({ key });
  await User.updateMany({}, { $pull: { positions: key } });
  const s = await getSettings();
  s.weekendTemplate = s.weekendTemplate.map((t) => ({ ...t.toObject(), needs: t.needs.filter((k) => k !== key) }));
  await s.save();
  res.status(204).end();
}));

// Record that someone's calendar app pulled their shifts (logged at most every 6 hours).
async function noteCalendarFetch(user, req) {
  const client = calendarClient(req.headers['user-agent']);
  const prev = user.calLastFetchedAt;
  await User.updateOne({ _id: user._id }, { $set: { calLastFetchedAt: new Date(), calClient: client } });
  if (!prev || Date.now() - prev.getTime() > 6 * 3600 * 1000 || user.calClient !== client) {
    await logActivity({ user, kind: 'calendar', action: `Calendar synced (${client})`, req });
  }
}

// ---------- personal calendar feed (no login; the token is the secret) ----------
export const calRouter = Router();
calRouter.get('/:file', wrap(async (req, res) => {
  const m = /^([A-Za-z0-9_-]{20,})\.ics$/.exec(req.params.file);
  if (!m) throw notFound();
  const user = await User.findOne({ calToken: m[1], active: true });
  const s = await getSettings();
  if (!user) {
    // An old link (after "make a new one") or a turned-off account: answer with an empty
    // calendar rather than an error, so calendar apps clear the shifts they already show.
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, max-age=0' });
    return res.send(buildCalendar({ name: `${s.orgName} — link no longer active`, tz: s.timezone, items: [] }));
  }
  await noteCalendarFetch(user, req);
  const since = addDays(todayIn(s.timezone), -30);
  const [positions, mine] = await Promise.all([Position.find({}).lean(), Assignment.find({ user: user._id }).populate({ path: 'event', populate: { path: 'groups', select: 'name' } }).lean()]);
  const base = Object.fromEntries(positions.map((p) => [p.key, p.label]));
  const label = new Proxy(base, { get: (t, k) => (isShadow(k) ? `${t[baseOf(k)] || baseOf(k)} (shadowing)` : t[k]) });
  const live = mine.filter((a) => a.event && a.event.date >= since);
  const evIds = live.map((a) => a.event._id);
  const crewAsg = await Assignment.find({ event: { $in: evIds } }).populate('user').lean();
  const crewBy = {};
  for (const a of crewAsg) {
    if (!a.user) continue;
    (crewBy[String(a.event)] ||= []).push(`${a.user.name.split(' ')[0]} (${label[a.position] || a.position})`);
  }
  const notices = {};
  for (const a of live) if (!notices[a.event.date]) notices[a.event.date] = await noticeLinesFor(a.event.date);
  const items = live.map((a) => ({
    notices: notices[a.event.date] || [],
    uid: `${a.event._id}-${a.position}-${user._id}@crew-call`,
    event: a.event,
    positionLabel: label[a.position] || a.position,
    crew: (crewBy[String(a.event._id)] || []).join(', '),
    groups: (a.event.groups || []).map((g) => g?.name).filter(Boolean).join(', '),
    updatedAt: a.updatedAt,
  }));
  const body = buildCalendar({ name: `${s.orgName} — ${user.name.split(' ')[0]}’s shifts`, tz: s.timezone, items, link: `${config.publicUrl}/#mine` });
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, max-age=0', 'Content-Disposition': 'inline; filename="shifts.ics"' });
  res.send(body);
}));
