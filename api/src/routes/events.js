import { Router } from 'express';
import { DateTime } from 'luxon';
import { Assignment, Event, EVENT_KINDS, Group, Position, Request, Skip, Unavailable, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { addDays, bad, DATE_RE, forbidden, getSettings, isId, notFound, str, TIME_RE, wrap } from '../lib/util.js';
import { eventView } from '../lib/views.js';
import { deletePlanFor } from './plans.js';
import { awayByEvent, slotValid, touchAvailability } from '../lib/availability.js';
import { dayName, evName, posName } from '../lib/activity.js';

export const eventsRouter = Router();

async function readEventInput(body, partial = false) {
  const out = {};
  if (!partial || body.date !== undefined) {
    if (!DATE_RE.test(body.date || '')) throw bad('Pick a date.');
    out.date = body.date;
  }
  if (!partial || body.title !== undefined) {
    out.title = str(body.title, 80);
    if (!out.title) throw bad('Give the service a name.');
  }
  for (const f of ['start', 'call', 'end']) {
    if (!partial || body[f] !== undefined) {
      if (!TIME_RE.test(body[f] || '')) throw bad(`Enter a ${f === 'call' ? 'call' : f} time.`);
      out[f] = body[f];
    }
  }
  if (!partial || body.needs !== undefined) {
    const keys = new Set((await Position.find({}).lean()).map((p) => p.key));
    const needs = Array.isArray(body.needs) ? [...new Set(body.needs.filter((k) => keys.has(k)))] : [];
    out.needs = needs;
  }
  if (body.notes !== undefined) out.notes = str(body.notes, 500);
  if (body.kind !== undefined) out.kind = EVENT_KINDS.includes(body.kind) ? body.kind : 'service';
  if (body.groups !== undefined) out.groups = await cleanGroupIds(body.groups);
  if (body.forEvent !== undefined) {
    out.forEvent = isId(body.forEvent) && (await Event.exists({ _id: body.forEvent })) ? body.forEvent : null;
  }
  return out;
}

export async function cleanGroupIds(list) {
  const ids = Array.isArray(list) ? [...new Set(list.filter(isId))] : [];
  if (!ids.length) return [];
  const found = await Group.find({ _id: { $in: ids } }, { _id: 1 }).lean();
  return found.map((g) => g._id);
}

// GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD
eventsRouter.get('/', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || to < from) throw bad('Give a from and to date.');
  if (addDays(from, 120) < to) throw bad('Ask for 120 days or fewer at a time.');
  const events = await Event.find({ date: { $gte: from, $lte: to } }).sort({ date: 1, start: 1 }).lean();
  const ids = events.map((e) => e._id);
  // Crew only see their own availability; leaders who place people see everyone's.
  const seeAll = req.can.edit;
  const unavFilter = { event: { $in: ids } };
  if (!seeAll) unavFilter.user = req.user._id;
  const [asg, unav, away] = await Promise.all([
    Assignment.find({ event: { $in: ids } }).lean(),
    Unavailable.find(unavFilter).lean(),
    awayByEvent(events, seeAll ? null : req.user._id),
  ]);
  const out = events.map((e) => ({ ...eventView(e), assignments: {}, confirmed: {}, unavailable: [], away: [...(away[String(e._id)] || [])] }));
  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  for (const a of asg) {
    const e = byId[String(a.event)];
    if (!e) continue;
    e.assignments[a.position] = String(a.user);
    if (a.confirmedAt) e.confirmed[a.position] = true;
  }
  for (const u of unav) byId[String(u.event)] && byId[String(u.event)].unavailable.push(String(u.user));
  res.json(out);
}));

eventsRouter.post('/', requirePerm('edit'), wrap(async (req, res) => {
  const ev = await Event.create({ ...(await readEventInput(req.body)), manual: true });
  res.locals.activity = `Added ${evName(ev)}`;
  res.status(201).json(eventView(ev));
}));

// Build a weekend's services from the template in Settings.
// Missing services are created. Services already there that no longer match the template
// (times, positions, type, groups) are listed in `differs`. Services on the weekend that
// aren't in the template (removed or turned off there) are listed in `extra`.
// Send { sync: true, syncIds?, remove? } to update the chosen ones and remove the chosen extras.
eventsRouter.post('/weekend', requirePerm('edit'), wrap(async (req, res) => {
  const friday = req.body.friday;
  if (!DATE_RE.test(friday || '') || DateTime.fromISO(friday).weekday !== 5) throw bad('Pick the Friday of the weekend.');
  const s = await getSettings();
  if (!s.weekendTemplate.length) throw bad('Add services to the weekend template in Settings first.');
  const active = s.weekendTemplate.filter((t) => !t.off);
  const syncIds = Array.isArray(req.body.syncIds) ? new Set(req.body.syncIds.map(String)) : null;
  let created = 0;
  let updated = 0;
  let cleared = 0;
  let removed = 0;
  const differs = [];
  const same = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');
  const kept = new Set();
  const skips = await Skip.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).lean();
  const isSkipped = (date, title) => skips.some((k) => k.date === date && k.title === title);
  for (const t of active) {
    const date = addDays(friday, t.day);
    if (isSkipped(date, t.title)) continue;
    const want = { start: t.start, call: t.call, end: t.end, needs: [...t.needs], kind: t.kind || 'service', groups: (t.groups || []).map(String) };
    let ev = await Event.findOne({ date, title: t.title });
    if (!ev) {
      ev = await Event.create({ date, title: t.title, ...want });
      kept.add(String(ev._id));
      created++;
      continue;
    }
    kept.add(String(ev._id));
    const changed = [];
    if (ev.start !== want.start || ev.call !== want.call || ev.end !== want.end) changed.push('times');
    if (!same(ev.needs, want.needs)) changed.push('positions');
    if ((ev.kind || 'service') !== want.kind) changed.push('type');
    if (!same((ev.groups || []).map(String), want.groups)) changed.push('groups');
    if (!changed.length) continue;
    const dropped = ev.needs.filter((k) => !want.needs.includes(k));
    const placedOnDropped = dropped.length ? await Assignment.countDocuments({ event: ev._id, position: { $in: [...dropped, ...dropped.map((k) => `${k}+shadow`)] } }) : 0;
    if (!req.body.sync || (syncIds && !syncIds.has(String(ev._id)))) {
      differs.push({ id: String(ev._id), title: ev.title, date, changed, placedOnDropped });
      continue;
    }
    Object.assign(ev, want);
    await ev.save();
    if (dropped.length) {
      const keep = [...want.needs, ...want.needs.map((k) => `${k}+shadow`)];
      const r = await Assignment.deleteMany({ event: ev._id, position: { $nin: keep } });
      cleared += r.deletedCount || 0;
    }
    updated++;
  }

  // Services on this weekend that the template doesn't (or no longer) include.
  // A sound check made for a service that stays is left alone.
  const offTitles = new Set(s.weekendTemplate.filter((t) => t.off).map((t) => `${t.day}|${t.title}`));
  const onWeekend = await Event.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).sort({ date: 1, start: 1 });
  // Services added by hand (Add service) are left alone; remove those with their own Delete.
  const candidates = onWeekend.filter((e) => !e.manual && !kept.has(String(e._id)) && !(e.forEvent && (kept.has(String(e.forEvent)) || onWeekend.some((x) => x.manual && String(x._id) === String(e.forEvent)))));
  const extra = [];
  const removeIds = new Set(Array.isArray(req.body.remove) ? req.body.remove.map(String) : []);
  for (const e of candidates) {
    if (req.body.sync && removeIds.has(String(e._id))) {
      await removeEvent(e);
      removed++;
      continue;
    }
    const day = DateTime.fromISO(e.date).diff(DateTime.fromISO(friday), 'days').days;
    extra.push({
      id: String(e._id),
      title: e.title,
      date: e.date,
      kind: e.kind || 'service',
      turnedOff: offTitles.has(`${day}|${e.title}`),
      placed: await Assignment.countDocuments({ event: e._id }),
    });
  }
  if (created || updated || removed) {
    res.locals.activity = `Synced the weekend of ${dayName(friday)} with the template (${[created && `${created} added`, updated && `${updated} updated`, removed && `${removed} removed`].filter(Boolean).join(', ')})`;
  }
  res.json({ created, updated, cleared, removed, differs, extra, skipped: skips.map(skipView) });
}));

// POST /api/events/:id/soundcheck { call, start, end, needs, groups, copyCrew, notes }
// Creates a sound check tied to a service, optionally placing the service's crew on it.
eventsRouter.post('/:id/soundcheck', requirePerm('edit'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const svc = await Event.findById(req.params.id);
  if (!svc) throw notFound('That service no longer exists.');
  const input = await readEventInput({
    date: req.body.date || svc.date,
    title: str(req.body.title, 80) || `Sound check · ${svc.title}`,
    call: req.body.call,
    start: req.body.start,
    end: req.body.end,
    needs: req.body.needs ?? svc.needs.filter((k) => ['foh', 'stream'].includes(k)),
    groups: req.body.groups ?? svc.groups.map(String),
    notes: req.body.notes ?? '',
  });
  const sc = await Event.create({ ...input, kind: 'soundcheck', forEvent: svc._id });
  let copied = 0;
  if (req.body.copyCrew) {
    const asg = await Assignment.find({ event: svc._id, position: { $in: sc.needs } }).lean();
    for (const a of asg) {
      await Assignment.create({ event: sc._id, position: a.position, user: a.user });
      copied++;
    }
  }
  res.status(201).json({ ...eventView(sc), copied });
}));

eventsRouter.patch('/:id', requirePerm('edit'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const ev = await Event.findById(req.params.id);
  if (!ev) throw notFound('That service no longer exists.');
  const input = await readEventInput(req.body, true);
  Object.assign(ev, input);
  await ev.save();
  res.locals.activity = `Edited ${evName(ev)}`;
  if (input.needs) {
    // Clear assignments for positions this service no longer needs.
    const keep = [...ev.needs, ...ev.needs.map((k) => `${k}+shadow`)];
    await Assignment.deleteMany({ event: ev._id, position: { $nin: keep } });
  }
  res.json(eventView(ev));
}));

eventsRouter.delete('/:id', requirePerm('edit'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const ev = await Event.findById(req.params.id);
  if (!ev) throw notFound('That service no longer exists.');
  // A template service taken off one weekend stays off when the weekend is synced.
  if (!ev.manual && (await templateEntryFor(ev))) {
    await Skip.updateOne({ date: ev.date, title: ev.title }, { $setOnInsert: { date: ev.date, title: ev.title, by: req.user._id } }, { upsert: true });
  }
  await removeEvent(ev);
  res.locals.activity = `Removed ${evName(ev)}`;
  res.status(204).end();
}));

const skipView = (k) => ({ id: String(k._id), date: k.date, title: k.title });

// The active template service this event was built from, if any.
async function templateEntryFor(ev) {
  const s = await getSettings();
  const wd = DateTime.fromISO(ev.date).weekday; // Fri 5, Sat 6, Sun 7
  const day = { 5: 0, 6: 1, 7: 2 }[wd];
  if (day === undefined) return null;
  return s.weekendTemplate.find((t) => !t.off && t.day === day && t.title === ev.title) || null;
}

// GET /api/events/skips?from=&to=  template services left out of those weekends
eventsRouter.get('/skips', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || to < from) throw bad('Give a from and to date.');
  res.json((await Skip.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean()).map(skipView));
}));

// POST /api/events/skips/:id/restore  bring a skipped template service back for that weekend
eventsRouter.post('/skips/:id/restore', requirePerm('edit'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const k = await Skip.findById(req.params.id);
  if (!k) throw notFound('That service is already back.');
  await k.deleteOne();
  const probe = { date: k.date, title: k.title };
  const t = await templateEntryFor(probe);
  let ev = await Event.findOne(probe);
  if (!ev && t) {
    ev = await Event.create({ date: k.date, title: k.title, start: t.start, call: t.call, end: t.end, needs: [...t.needs], kind: t.kind || 'service', groups: t.groups || [] });
  }
  res.locals.activity = `Brought back ${k.title} (${dayName(k.date)})`;
  res.json(ev ? eventView(ev) : null);
}));

// Removes a service with its crew, availability notes, pending requests and plan.
async function removeEvent(ev) {
  await Assignment.deleteMany({ event: ev._id });
  await Unavailable.deleteMany({ event: ev._id });
  await Request.updateMany(
    { status: 'pending', $or: [{ event: ev._id }, { targetEvent: ev._id }] },
    { status: 'cancelled', reason: 'The service was removed.', decidedAt: new Date() }
  );
  await Event.updateMany({ forEvent: ev._id }, { $unset: { forEvent: 1 } });
  await deletePlanFor(ev._id);
  await ev.deleteOne();
}

// PUT /api/events/:id/assign/:position { userId | null }
eventsRouter.put('/:id/assign/:position', requirePerm('edit'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const ev = await Event.findById(req.params.id);
  if (!ev) throw notFound('That service no longer exists.');
  const position = req.params.position;
  if (!slotValid(ev, position)) throw bad('This service doesn’t need that position.');
  const label = await posName(position);
  const userId = req.body.userId;
  const existing = await Assignment.findOne({ event: ev._id, position }).populate('user', 'name');
  if (!userId) {
    if (existing) {
      await existing.deleteOne();
      res.locals.activity = `Removed ${existing.user?.name || 'someone'} from ${label} · ${evName(ev)}`;
    }
    return res.json({ ok: true });
  }
  if (!isId(userId)) throw bad('Pick a person.');
  const user = await User.findById(userId);
  if (!user || !user.active) throw bad('That person isn’t active.');
  if (existing && String(existing.user?._id) === String(user._id)) return res.json({ ok: true });
  if (existing) {
    // A new person has to confirm and be reminded again.
    Object.assign(existing, { user: user._id, confirmedAt: null, reminderEmailAt: null, waRemindedAt: null });
    await existing.save();
  } else {
    await Assignment.create({ event: ev._id, position, user: user._id });
  }
  res.locals.activity = `Placed ${user.name} on ${label} · ${evName(ev)}`;
  res.json({ ok: true });
}));

// PUT /api/events/:id/unavailable { unavailable: bool, userId? }
eventsRouter.put('/:id/unavailable', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const ev = await Event.findById(req.params.id);
  if (!ev) throw notFound('That service no longer exists.');
  let userId = req.user._id;
  if (req.body.userId && String(req.body.userId) !== String(req.user._id)) {
    if (!req.can.edit || !isId(req.body.userId)) throw forbidden();
    userId = req.body.userId;
  }
  if (req.body.unavailable) {
    await Unavailable.updateOne({ user: userId, event: ev._id }, { $set: { user: userId, event: ev._id } }, { upsert: true });
  } else {
    await Unavailable.deleteOne({ user: userId, event: ev._id });
  }
  await touchAvailability(userId);
  res.locals.activity = `Marked ${req.body.unavailable ? 'unavailable' : 'available'} for ${evName(ev)}`;
  res.json({ ok: true });
}));
