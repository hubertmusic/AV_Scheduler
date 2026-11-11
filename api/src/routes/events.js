import { Router } from 'express';
import { DateTime } from 'luxon';
import { Assignment, Event, EVENT_KINDS, Group, Position, Request, Skip, Unavailable, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { addDays, bad, DATE_RE, forbidden, fridayOf, getSettings, isId, notFound, str, TIME_RE, wrap } from '../lib/util.js';
import { eventView } from '../lib/views.js';
import { deletePlanFor } from './plans.js';
import { awayByEvent, slotValid, touchAvailability } from '../lib/availability.js';
import { dayName, evName, posName } from '../lib/activity.js';
import { placeRegulars } from '../lib/regularsAuto.js';
import { baseKey, isAvTeam, mergeTeam, onlyTeam, positionsList, requireAvTeam, teamKeys, teamsList } from '../lib/teams.js';

// Work another team has on a service (assignments on positions that aren't this team's)
async function otherTeamsWork(ev, keys) {
  const asg = await Assignment.find({ event: ev._id }, { position: 1 }).lean();
  return asg.filter((a) => !keys.has(baseKey(a.position))).length;
}
// A rehearsal belongs to its team; only that team (or the admin) changes it
function assertOwnEvent(req, ev) {
  if (ev.team && ev.team !== req.team.key && req.user.role !== 'admin') throw forbidden('That belongs to another team.');
}

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
  // Through this team's eyes: its positions and people; other teams as a filled/needed count
  const keys = await teamKeys(req);
  const out = events.map((e) => ({ ...eventView(e), needs: onlyTeam(e.needs, keys), otherNeeds: e.needs.filter((k) => !keys.has(k)).length, otherFilled: 0, assignments: {}, confirmed: {}, unavailable: [], away: [...(away[String(e._id)] || [])] }));
  const byId = Object.fromEntries(out.map((e) => [e.id, e]));
  for (const a of asg) {
    const e = byId[String(a.event)];
    if (!e) continue;
    if (!keys.has(baseKey(a.position))) {
      if (!a.position.endsWith('+shadow')) e.otherFilled++;
      continue;
    }
    e.assignments[a.position] = String(a.user);
    if (a.confirmedAt) e.confirmed[a.position] = true;
  }
  for (const u of unav) byId[String(u.event)] && byId[String(u.event)].unavailable.push(String(u.user));
  res.json(out);
}));

eventsRouter.post('/', requirePerm('edit'), wrap(async (req, res) => {
  const input = await readEventInput(req.body);
  input.needs = onlyTeam(input.needs, await teamKeys(req));
  if (input.kind === 'soundcheck' && !isAvTeam(req.team)) input.kind = 'service';
  // A rehearsal is the team's own (everyone still sees it on the calendar)
  const ev = await Event.create({ ...input, team: input.kind === 'rehearsal' ? req.team.key : null, manual: true });
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
  const createdIds = new Set();
  const skips = await Skip.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).lean();
  // Each team syncs its own positions; other teams' positions on a service stay as they are
  const keys = await teamKeys(req);
  const av = isAvTeam(req.team) || req.user.role === 'admin';
  const isSkipped = (date, title) => skips.some((k) => k.date === date && k.title === title);
  for (const t of active) {
    const date = addDays(friday, t.day);
    if (isSkipped(date, t.title)) continue;
    const want = { start: t.start, call: t.call, end: t.end, needs: [...t.needs], kind: t.kind || 'service', groups: (t.groups || []).map(String) };
    let ev = await Event.findOne({ date, title: t.title });
    if (!ev) {
      ev = await Event.create({ date, title: t.title, ...want });
      kept.add(String(ev._id));
      createdIds.add(String(ev._id));
      created++;
      continue;
    }
    kept.add(String(ev._id));
    const changed = [];
    if (ev.start !== want.start || ev.call !== want.call || ev.end !== want.end) changed.push('times');
    if (!same(onlyTeam(ev.needs, keys), onlyTeam(want.needs, keys))) changed.push('positions');
    if ((ev.kind || 'service') !== want.kind) changed.push('type');
    if (av && !same((ev.groups || []).map(String), want.groups)) changed.push('groups');
    if (!changed.length) continue;
    const dropped = onlyTeam(ev.needs, keys).filter((k) => !want.needs.includes(k));
    const placedOnDropped = dropped.length ? await Assignment.countDocuments({ event: ev._id, position: { $in: [...dropped, ...dropped.map((k) => `${k}+shadow`)] } }) : 0;
    if (!req.body.sync || (syncIds && !syncIds.has(String(ev._id)))) {
      differs.push({ id: String(ev._id), title: ev.title, date, changed, placedOnDropped });
      continue;
    }
    Object.assign(ev, { ...want, needs: mergeTeam(ev.needs, want.needs, keys), ...(av ? {} : { groups: ev.groups }) });
    await ev.save();
    if (dropped.length) {
      const r = await Assignment.deleteMany({ event: ev._id, position: { $in: [...dropped, ...dropped.map((k) => `${k}+shadow`)] } });
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
      // Not a service another team is scheduled on (unless you're the admin)
      if (req.user.role === 'admin' || (isAvTeam(req.team) && !(await otherTeamsWork(e, keys)))) {
        await removeEvent(e);
        removed++;
        continue;
      }
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
  // People with a regular schedule go straight onto the services just created.
  const regularsPlaced = createdIds.size ? (await placeRegulars(friday, { onlyEvents: createdIds })).length : 0;
  if (created || updated || removed) {
    res.locals.activity = `Synced the weekend of ${dayName(friday)} with the template (${[created && `${created} added`, updated && `${updated} updated`, removed && `${removed} removed`].filter(Boolean).join(', ')})`;
  }
  res.json({ created, updated, cleared, removed, regularsPlaced, differs, extra, skipped: skips.map(skipView) });
}));

// POST /api/events/:id/soundcheck { call, start, end, needs, groups, copyCrew, notes }
// Creates a sound check tied to a service, optionally placing the service's crew on it.
eventsRouter.post('/:id/soundcheck', requireAvTeam, requirePerm('edit'), wrap(async (req, res) => {
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
  assertOwnEvent(req, ev);
  const input = await readEventInput(req.body, true);
  // A shared service's name, day and times are set by the AV side (or the admin); other teams
  // choose which of their positions it needs and can add a note
  if (!ev.team && req.user.role !== 'admin' && !isAvTeam(req.team)) {
    const changed = ['date', 'title', 'start', 'call', 'end', 'kind'].filter((k) => input[k] !== undefined && input[k] !== (ev[k] ?? (k === 'kind' ? 'service' : '')));
    if (changed.length) throw forbidden('The service’s name, day and times are set by the AV team. You can change which of your positions it needs, or add a note.');
  }
  if (input.needs) input.needs = mergeTeam(ev.needs, input.needs, await teamKeys(req));
  if (input.kind === 'rehearsal' && !ev.team) input.team = req.team.key;
  if (input.kind && input.kind !== 'rehearsal') input.team = null;
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
  assertOwnEvent(req, ev);
  if (!ev.team && req.user.role !== 'admin' && !isAvTeam(req.team)) throw forbidden('Services are added and removed by the AV team. You can take your team’s positions off it instead.');
  if (req.user.role !== 'admin' && (await otherTeamsWork(ev, await teamKeys(req)))) {
    throw forbidden('Another team has people on this service, so only the admin can remove it. You can take your team’s positions off it instead.');
  }
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
    await placeRegulars(fridayOf(k.date), { onlyEvents: new Set([String(ev._id)]) });
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
  const keys = await teamKeys(req);
  if (!keys.has(baseKey(position))) throw forbidden('That position belongs to another team.');
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
  if (user.role !== 'admin' && !(user.teams || []).some((m) => m.team === req.team.key)) throw bad(`${user.name} isn’t on the ${req.team.name}.`);
  if (existing && String(existing.user?._id) === String(user._id)) return res.json({ ok: true });
  if (existing) {
    // A new person has to confirm and be reminded again.
    Object.assign(existing, { user: user._id, confirmedAt: null, reminderEmailAt: null, waRemindedAt: null, viaRegular: '' });
    await existing.save();
  } else {
    await Assignment.create({ event: ev._id, position, user: user._id });
  }
  res.locals.activity = `Placed ${user.name} on ${label} · ${evName(ev)}`;
  res.json({ ok: true });
}));

// GET /api/events/:id/lineup — who's serving on every team, with a way to reach each person.
// Anyone signed in can see it: it's how a singer finds who's running slides, and the reverse.
eventsRouter.get('/:id/lineup', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const ev = await Event.findById(req.params.id).lean();
  if (!ev) throw notFound('That service no longer exists.');
  const [teams, positions, asg] = await Promise.all([teamsList(), positionsList(), Assignment.find({ event: ev._id }).populate('user', 'name phone teams role').lean()]);
  const byPos = {};
  for (const a of asg) byPos[a.position] = a;
  const out = teams
    .map((t) => {
      const mine = positions.filter((p) => (p.team || 'av') === t.key && ev.needs.includes(p.key));
      const slots = mine.flatMap((p) => {
        const row = (slot) => {
          const a = byPos[slot];
          return { position: p.key, label: p.label, shadow: slot !== p.key, confirmed: !!a?.confirmedAt, person: a?.user ? { id: String(a.user._id), name: a.user.name, phone: a.user.phone || '' } : null };
        };
        return [row(p.key), ...(byPos[`${p.key}+shadow`] ? [row(`${p.key}+shadow`)] : [])];
      });
      const leaders = []; // filled below
      return { key: t.key, name: t.name, groupLink: t.groupLink || '', slots, leaders };
    })
    .filter((t) => t.slots.length || (ev.team && ev.team === t.key));
  // Each team's head leader, for questions that aren't about one position
  const heads = (await User.find({ active: true, 'teams.head': true }, { name: 1, phone: 1, teams: 1 }).lean()).filter((u) => (u.teams || []).some((m) => m.head));
  for (const t of out) t.leaders = heads.filter((u) => u.teams.some((m) => m.team === t.key && m.head)).map((u) => ({ id: String(u._id), name: u.name, phone: u.phone || '' }));
  res.json({ event: eventView(ev), teams: out });
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
