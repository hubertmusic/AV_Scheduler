import { Router } from 'express';
import { DateTime } from 'luxon';
import { Assignment, Event, Group, Media, Plan, Position, Request, Submission, User, Skip } from '../models.js';
import { requireAdmin, requirePerm } from '../auth.js';
import { addDays, bad, DATE_RE, forbidden, fridayOf, getSettings, isId, notFound, todayIn, wrap } from '../lib/util.js';
import { announcementsFor } from './announcements.js';
import { eventView, groupView, personView } from '../lib/views.js';
import { awayByEvent, baseOf, isShadow, unavailableByEvent } from '../lib/availability.js';
import { planAutofill } from '../lib/autofill.js';
import { runReminders } from '../lib/reminders.js';
import { mailerReady } from '../lib/mailer.js';
import { dayName } from '../lib/activity.js';

export const weekendRouter = Router();

function fridayParam(v) {
  if (!DATE_RE.test(v || '') || DateTime.fromISO(v).weekday !== 5) throw bad('Pick the Friday of the weekend.');
  return v;
}
const anyLeader = (req, res, next) => (req.can.edit || req.can.approve || req.can.plans || req.can.message ? next() : next(forbidden()));

// ---------- auto-fill ----------
weekendRouter.get('/autofill', requirePerm('edit'), wrap(async (req, res) => {
  res.json(await planAutofill(fridayParam(req.query.friday)));
}));

// POST { friday, picks: [{ eventId, position, userId }] } — applies the picks that still fit.
weekendRouter.post('/autofill', requirePerm('edit'), wrap(async (req, res) => {
  const friday = fridayParam(req.body.friday);
  const picks = Array.isArray(req.body.picks) ? req.body.picks.slice(0, 300) : [];
  const events = await Event.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).lean();
  const evById = Object.fromEntries(events.map((e) => [String(e._id), e]));
  const users = Object.fromEntries((await User.find({ active: true }).lean()).map((u) => [String(u._id), u]));
  let applied = 0;
  const skipped = [];
  for (const p of picks) {
    const e = evById[p?.eventId];
    const u = users[p?.userId];
    if (!e || !u || !e.needs.includes(p.position) || !u.positions.includes(p.position)) {
      skipped.push(p);
      continue;
    }
    const taken = await Assignment.exists({ event: e._id, position: p.position });
    const already = await Assignment.exists({ event: e._id, user: u._id });
    if (taken || already) {
      skipped.push(p);
      continue;
    }
    await Assignment.create({ event: e._id, position: p.position, user: u._id });
    applied++;
  }
  res.locals.activity = `Auto-filled ${applied} spot${applied === 1 ? '' : 's'} for the weekend of ${dayName(friday)}`;
  res.json({ applied, skipped: skipped.length });
}));

// ---------- copy last weekend ----------
weekendRouter.post('/copy', requirePerm('edit'), wrap(async (req, res) => {
  const friday = fridayParam(req.body.friday);
  const prevFri = addDays(friday, -7);
  const prev = await Event.find({ date: { $gte: prevFri, $lte: addDays(prevFri, 2) } }).sort({ date: 1, start: 1 }).lean();
  if (!prev.length) throw bad('Nothing was scheduled the weekend before.');
  let created = 0;
  let copied = 0;
  const skipped = [];
  const map = {}; // prev event id -> new event
  // Services first so sound checks can point at the new service.
  for (const e of [...prev].sort((a, b) => (a.kind === 'soundcheck') - (b.kind === 'soundcheck'))) {
    const date = addDays(e.date, 7);
    if (await Skip.exists({ date, title: e.title })) continue; // left out of this weekend on purpose
    let t = await Event.findOne({ date, title: e.title, kind: e.kind || 'service' });
    if (!t) {
      t = await Event.create({
        date,
        title: e.title,
        start: e.start,
        call: e.call,
        end: e.end,
        needs: e.needs,
        notes: e.notes,
        kind: e.kind || 'service',
        groups: e.groups || [],
        forEvent: e.forEvent && map[String(e.forEvent)] ? map[String(e.forEvent)]._id : undefined,
        manual: Boolean(e.manual),
      });
      created++;
    }
    map[String(e._id)] = t;
  }
  const targets = Object.values(map);
  const [prevAsg, unav, away] = await Promise.all([
    Assignment.find({ event: { $in: prev.map((e) => e._id) } }).populate('user').lean(),
    unavailableByEvent(targets),
    awayByEvent(targets),
  ]);
  for (const a of prevAsg) {
    const t = map[String(a.event)];
    const u = a.user;
    if (!t || !u) continue;
    const tid = String(t._id);
    const uid = String(u._id);
    if (!t.needs.includes(baseOf(a.position))) continue;
    if (await Assignment.exists({ event: t._id, position: a.position })) continue;
    let reason = '';
    if (!u.active) reason = 'no longer active';
    else if (!isShadow(a.position) && !u.positions.includes(a.position)) reason = 'not trained for it any more';
    else if (away[tid]?.has(uid)) reason = 'away that day';
    else if (unav[tid]?.has(uid)) reason = 'marked unavailable';
    else if (await Assignment.exists({ event: t._id, user: u._id })) reason = 'already on that service';
    if (reason) {
      skipped.push({ name: u.name, title: t.title, position: a.position, reason });
      continue;
    }
    await Assignment.create({ event: t._id, position: a.position, user: u._id });
    copied++;
  }
  res.locals.activity = `Copied the weekend of ${dayName(prevFri)} to ${dayName(friday)} (${copied} placements)`;
  res.json({ created, copied, skipped });
}));

// ---------- weekend check: everything that still needs doing ----------
weekendRouter.get('/check', anyLeader, wrap(async (req, res) => {
  const friday = fridayParam(req.query.friday);
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const events = await Event.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).sort({ date: 1, start: 1 }).lean();
  const ids = events.map((e) => e._id);
  const [asg, unav, away, plans, pendingReqs, pendingSubs, people] = await Promise.all([
    Assignment.find({ event: { $in: ids } }).populate('user').lean(),
    unavailableByEvent(events),
    awayByEvent(events),
    Plan.find({ event: { $in: ids } }).lean(),
    Request.find({ status: 'pending', $or: [{ event: { $in: ids } }, { targetEvent: { $in: ids } }] }).populate('from', 'name').lean(),
    Submission.find({ status: 'pending', event: { $in: ids } }, { event: 1 }).lean(),
    User.find({ active: true }).sort({ name: 1 }),
  ]);
  const showPhone = req.can.message || req.can.people;
  const who = (u) => (u ? { id: String(u._id), name: u.name, phone: showPhone ? u.phone : undefined } : null);
  const ev = (e) => ({ id: String(e._id), title: e.title, date: e.date, start: e.start, call: e.call, kind: e.kind || 'service' });
  const planBy = Object.fromEntries(plans.map((p) => [String(p.event), p]));

  const open = [];
  const unconfirmed = [];
  const reminders = [];
  const flags = [];
  for (const e of events) {
    const eid = String(e._id);
    const here = asg.filter((a) => String(a.event) === eid);
    const counts = {};
    for (const a of here) if (a.user) counts[String(a.user._id)] = (counts[String(a.user._id)] || 0) + 1;
    for (const pos of e.needs) if (!here.some((a) => a.position === pos)) open.push({ event: ev(e), position: pos });
    for (const a of here) {
      if (!a.user) continue;
      const uid = String(a.user._id);
      const item = { id: String(a._id), event: ev(e), position: baseOf(a.position), shadow: isShadow(a.position), person: who(a.user), confirmed: !!a.confirmedAt, emailed: !!a.reminderEmailAt, waReminded: !!a.waRemindedAt };
      reminders.push(item);
      if (!a.confirmedAt) unconfirmed.push(item);
      const flag = !a.user.active ? 'Deactivated' : counts[uid] > 1 ? 'Double-booked' : away[eid]?.has(uid) ? 'Away that day' : unav[eid]?.has(uid) ? 'Marked unavailable' : '';
      if (flag) flags.push({ ...item, flag });
    }
  }
  const plansMissing = events
    .filter((e) => (e.kind || 'service') === 'service')
    .map((e) => {
      const p = planBy[String(e._id)];
      const missing = [];
      if (!p?.songs?.length) missing.push('songs');
      if (!p?.notes) missing.push('pastor’s notes');
      if (!p?.scriptures?.length) missing.push('Bible texts');
      return { event: ev(e), missing };
    })
    .filter((x) => x.missing.length);
  const uploadsBy = {};
  for (const sub of pendingSubs) uploadsBy[String(sub.event)] = (uploadsBy[String(sub.event)] || 0) + 1;
  const staleCutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const stale = people.filter((p) => !p.availabilityUpdatedAt || p.availabilityUpdatedAt.getTime() < staleCutoff);

  res.json({
    friday,
    past: addDays(friday, 2) < today,
    events: events.map(ev),
    open,
    unconfirmed,
    reminders,
    flags,
    plansMissing,
    pendingRequests: pendingReqs.map((r) => ({ id: String(r._id), type: r.type, from: r.from?.name || '' })),
    pendingUploads: events.filter((e) => uploadsBy[String(e._id)]).map((e) => ({ event: ev(e), count: uploadsBy[String(e._id)] })),
    availability: { stale: stale.map((p) => ({ ...who(p), updatedAt: p.availabilityUpdatedAt || null })), total: people.length },
    email: { configured: mailerReady(), on: s.reminderEmails, days: s.reminderDays },
  });
}));

weekendRouter.post('/reminded', requirePerm('message'), wrap(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(isId).slice(0, 300);
  const r = await Assignment.updateMany({ _id: { $in: ids } }, { $set: { waRemindedAt: req.body.undo ? null : new Date() } });
  res.locals.activity = `Marked ${ids.length} WhatsApp reminder${ids.length === 1 ? '' : 's'} as ${req.body.undo ? 'not sent' : 'sent'}`;
  res.json({ updated: r.modifiedCount ?? ids.length });
}));

// Admin: send any reminder emails that are due right now
weekendRouter.post('/reminders/run', requireAdmin, wrap(async (req, res) => {
  const out = await runReminders();
  res.locals.activity = `Ran email reminders (${out.sent} sent)`;
  res.json(out);
}));

// ---------- run sheet: one page for the booth ----------
weekendRouter.get('/runsheet/:eventId', wrap(async (req, res) => {
  if (!isId(req.params.eventId)) throw notFound();
  const e = await Event.findById(req.params.eventId).lean();
  if (!e) throw notFound('That service no longer exists.');
  const related = await Event.find({ $or: [{ forEvent: e._id }, ...(e.forEvent ? [{ _id: e.forEvent }] : [])] }).sort({ date: 1, start: 1 }).lean();
  const all = [e, ...related];
  const [positions, asg, groups, plan] = await Promise.all([
    Position.find({}).sort({ order: 1 }).lean(),
    Assignment.find({ event: { $in: all.map((x) => x._id) } }).populate('user'),
    Group.find({ _id: { $in: all.flatMap((x) => x.groups || []) } }),
    Plan.findOne({ event: e._id }).populate('songs.song').lean(),
  ]);
  const label = Object.fromEntries(positions.map((p) => [p.key, p.label]));
  const order = Object.fromEntries(positions.map((p, i) => [p.key, i]));
  const crewOf = (x) =>
    x.needs
      .flatMap((pos) => [pos, `${pos}+shadow`])
      .map((slot) => {
        const a = asg.find((y) => String(y.event) === String(x._id) && y.position === slot);
        if (isShadow(slot) && !a) return null;
        const p = a?.user ? personView(a.user, req.user) : null;
        return { position: label[baseOf(slot)] || baseOf(slot), shadow: isShadow(slot), name: p?.name || null, phone: p?.phone || '', confirmed: !!a?.confirmedAt };
      })
      .filter(Boolean)
      .sort((a, b) => (order[a.position] ?? 0) - (order[b.position] ?? 0));
  const groupBy = Object.fromEntries(groups.map((g) => [String(g._id), groupView(g, req.user)]));
  const pack = (x) => ({ ...eventView(x), crew: crewOf(x), groups: (x.groups || []).map((id) => groupBy[String(id)]).filter(Boolean) });
  const files = plan ? await Media.find({ plan: plan._id, status: 'approved' }, { originalName: 1, size: 1 }).lean() : [];
  res.json({
    notices: await announcementsFor(e.date, e.date).then((a) => ({ permanent: a.permanent?.text || '', weekly: a.weekly[fridayOf(e.date)]?.text || '' })),
    event: pack(e),
    related: related.map(pack),
    plan: plan
      ? {
          sermonTitle: plan.sermonTitle,
          speaker: plan.speaker,
          notes: plan.notes,
          scriptures: plan.scriptures,
          songs: plan.songs.filter((x) => x.song).map((x) => ({ title: x.song.title, artist: x.song.artist, key: x.key, lyrics: x.song.lyrics, note: x.note })),
          files: files.map((f) => ({ name: f.originalName, size: f.size })),
        }
      : null,
  });
}));
