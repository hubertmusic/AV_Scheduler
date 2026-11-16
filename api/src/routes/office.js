// Church Admin (office teams): their calendar (board meetings, business meetings, deadlines,
// church events), committees, meetings with agendas and minutes, goals, action items, documents,
// event requests, and the agenda overview. Most routes need the Church Admin side picked at the
// top; a few (shared church events, asking for an event) are for everyone signed in.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { ActionItem, Assignment, Committee, DOC_CATEGORIES, Event, Goal, OFFICE_TYPES, OfficeDoc, OfficeEvent, OfficeRequest, OfficeSeries, Plan, Team, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { planFor } from './plans.js';
import { addDays, bad, DATE_RE, forbidden, getSettings, isHttpUrl, isId, membershipOf, normalizeUrl, notFound, str, TIME_RE, todayIn, wrap } from '../lib/util.js';
import { deleteStored, filesOf, originalName, removeUploads, uploader } from '../lib/media.js';
import { mailerReady, sendMail } from '../lib/mailer.js';
import { forgetTeams, isTeamHead, requireTeamHead, teamsList } from '../lib/teams.js';
import { officePerms, seesRoster } from '../lib/office.js';
import { attachRequest, attachWaiting, clashesFor, markOnAgenda, mailDecision } from '../lib/roomRequests.js';
import crypto from 'node:crypto';
import { assertSees, audienceOf, describeSeries, edits, fillSeries, isOfficeTeam, isSecretary, officeTeamKeys, requireOfficeTeam, sees, visibleFilter, yearPlanDate } from '../lib/office.js';

export const officeRouter = Router();

const COLORS = ['blue', 'green', 'purple', 'orange', 'red', 'yellow', 'teal', 'gray'];
const nameOf = async (ids) => Object.fromEntries((await User.find({ _id: { $in: ids.filter(Boolean) } }, { name: 1 }).lean()).map((u) => [String(u._id), u.name]));
const idList = (list) => (Array.isArray(list) ? [...new Set(list.filter(isId).map(String))] : []);
const head = (req) => !!membershipOf(req.user, req.team.key)?.head; // the team's own head leader (not the admin)
const today = async () => todayIn((await getSettings()).timezone);
// The Activity log is read by the admin, so it never names a confidential item: only items shared
// with every team are named; everything else is described in general terms.
const named = (item, fallback) => (item?.visibility === 'everyone' ? `“${item.title}”` : fallback);
const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : 0);
const fromMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function teamCommittees(team) {
  return Committee.find({ team }).sort({ order: 1, name: 1 }).lean();
}
// Committees someone may put an item in: any of the team's for the head and admin, otherwise their own
async function cleanCommittees(req, list, { own = true } = {}) {
  const keys = new Set((await teamCommittees(req.team.key)).map((c) => c.key));
  const picked = (Array.isArray(list) ? list : []).filter((k) => keys.has(k));
  if (own && !head(req)) {
    const mine = membershipOf(req.user, req.team.key)?.committees || [];
    const outside = picked.filter((k) => !mine.includes(k));
    if (outside.length) throw forbidden('You can only put things in committees you sit on. Use “Share with” to let another committee see it.');
  }
  return [...new Set(picked)];
}

// ======================= for everyone signed in =======================

// GET /api/office/shared?from&to — church events the office shared with every team
officeRouter.get('/shared', wrap(async (req, res) => {
  const from = DATE_RE.test(req.query.from) ? req.query.from : await today();
  const to = DATE_RE.test(req.query.to) ? req.query.to : addDays(from, 60);
  const teams = await officeTeamKeys();
  const list = await OfficeEvent.find({ team: { $in: teams }, visibility: 'everyone', date: { $gte: from, $lte: to } }).sort({ date: 1, start: 1 }).lean();
  res.json(list.map(sharedView));
}));
const sharedView = (e) => ({ id: String(e._id), type: e.type, title: e.title, date: e.date, start: e.start, end: e.end, allDay: e.allDay, room: e.room, notes: e.notes });

// Asking the office for a church event or a room (anyone signed in)
officeRouter.get('/requests/mine', wrap(async (req, res) => {
  const list = await OfficeRequest.find({ requestedBy: req.user._id }).sort({ createdAt: -1 }).limit(30).lean();
  res.json(list.map(requestView));
}));
officeRouter.post('/requests', wrap(async (req, res) => {
  const teams = await officeTeamKeys();
  if (!teams.length) throw bad('There’s no Church Admin team yet.');
  const b = req.body || {};
  const title = str(b.title, 120);
  if (!title) throw bad('What’s the event?');
  if (!DATE_RE.test(b.date || '')) throw bad('Pick a date.');
  if (b.date < (await today())) throw bad('That date has passed.');
  for (const k of ['start', 'end']) if (b[k] && !TIME_RE.test(b[k])) throw bad('Times look like 18:30.');
  if (b.start && b.end && b.end <= b.start) throw bad('The end time has to be after the start time.');
  const r = await OfficeRequest.create({ team: teams.includes(b.team) ? b.team : teams[0], title, date: b.date, start: b.start || '', end: b.start ? b.end || '' : '', room: str(b.room, 80), people: Math.max(0, Math.min(5000, Math.round(Number(b.people) || 0))), notes: str(b.notes, 1000), needsAv: !!b.needsAv, requestedBy: req.user._id });
  // Straight onto the next board meeting's agenda (or waiting for one)
  const meeting = await attachRequest(r);
  res.locals.activity = `Asked Church Admin for “${title}” on ${b.date}`;
  res.status(201).json({ ...requestView(r), meetingDate: meeting?.date || null });
}));
const requestView = (r, names = {}) => ({
  id: String(r._id),
  title: r.title,
  date: r.date,
  start: r.start,
  end: r.end,
  room: r.room,
  notes: r.notes,
  needsAv: r.needsAv,
  status: r.status,
  reply: r.reply,
  people: r.people || 0,
  source: r.source || 'member',
  requestedBy: (r.source === 'link' ? r.from?.name : names[String(r.requestedBy)]) || null,
  decidedBy: names[String(r.decidedBy)] || null,
  event: r.event ? String(r.event) : null,
  waiting: r.status === 'pending' && !r.meeting, // no board meeting on the calendar yet
  createdAt: r.createdAt,
});

// Plan leaders on a service team: announcements the office asked to put in a service's bulletin
officeRouter.post('/bulletin/:id/:action(add|decline)', wrap(async (req, res) => {
  if (!req.can.plans || isOfficeTeam(req.team)) throw forbidden('Only a service plan leader can do that.');
  if (!isId(req.params.id)) throw notFound();
  const ev = await OfficeEvent.findById(req.params.id);
  if (!ev || ev.bulletin?.status !== 'pending') throw notFound('That request was already handled.');
  if (req.params.action === 'add') {
    const plan = await planFor(ev.bulletin.service);
    if (plan.archived) throw bad('That service is archived.');
    const text = ev.bulletin.text || `${ev.title} — ${DateTime.fromISO(ev.date).toFormat('cccc, LLL d')}${ev.start ? `, ${DateTime.fromFormat(ev.start, 'HH:mm').toFormat('h:mm a')}` : ''}${ev.room ? `, ${ev.room}` : ''}`;
    plan.announcements = [plan.announcements, text].filter(Boolean).join('\n\n').slice(0, 5000);
    await plan.save();
  }
  ev.bulletin.status = req.params.action === 'add' ? 'added' : 'declined';
  ev.bulletin.decidedBy = req.user._id;
  ev.bulletin.decidedAt = new Date();
  await ev.save();
  res.locals.activity = `${req.params.action === 'add' ? 'Added' : 'Declined'} Church Admin’s announcement “${ev.title}”`;
  res.json({ ok: true });
}));

// ======================= the Church Admin side =======================
const office = Router();
// Church Admin details are confidential: never shown in the admin's "View as" preview, and every
// change is logged without naming what changed (unless a route names an item shared with everyone).
office.use((req, res, next) => {
  if (req.previewing) return next(forbidden('Church Admin details aren’t shown in a preview, to keep them confidential.'));
  // Privileges here come from the person's own place on the team, not from being the admin
  req.ocan = officePerms(req.user, req.team.key);
  const member = !!membershipOf(req.user, req.team.key);
  // The admin (or anyone not on the team) can manage committees, rooms and event requests, but
  // can't add or change the team's confidential items
  const managing = /^\/(committees|setup|requests|request-link)(\/|$)/.test(req.path);
  if (req.method !== 'GET' && !member && !managing) return next(forbidden('Only people on Church Admin can do that. Its head leader can add you.'));
  if (req.method !== 'GET') res.locals.activity = 'Worked on the Church Admin side';
  next();
});
const need = (perm) => (req, res, next) => (req.ocan?.[perm] ? next() : next(forbidden()));
const needOrAdmin = (perm) => (req, res, next) => (req.ocan?.[perm] || req.user.role === 'admin' ? next() : next(forbidden()));
officeRouter.use(requireOfficeTeam, office);

// ---------- committees ----------
office.get('/committees', wrap(async (req, res) => {
  const [list, people] = await Promise.all([teamCommittees(req.team.key), User.find({ active: true, 'teams.team': req.team.key }, { name: 1, teams: 1 }).lean()]);
  res.json(
    list.map((c) => {
      const members = people.filter((u) => membershipOf(u, req.team.key)?.committees?.includes(c.key));
      // Who sits on which committee: the admin and the team's leaders only
      return { key: c.key, name: c.name, color: c.color, quorum: c.quorum, members: seesRoster(req.user, req.team.key) ? members.map((u) => ({ id: String(u._id), name: u.name })) : [] };
    })
  );
}));
office.post('/committees', requireTeamHead, wrap(async (req, res) => {
  const name = str(req.body.name, 60);
  if (!name) throw bad('Name the committee.');
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'committee';
  let key = base;
  for (let i = 2; await Committee.exists({ team: req.team.key, key }); i++) key = `${base}-${i}`;
  const c = await Committee.create({ team: req.team.key, key, name, color: COLORS.includes(req.body.color) ? req.body.color : 'blue', quorum: Math.max(0, Math.min(200, Number(req.body.quorum) || 0)), order: await Committee.countDocuments({ team: req.team.key }) });
  res.locals.activity = `Added the ${name}`;
  res.status(201).json({ key: c.key, name: c.name, color: c.color, quorum: c.quorum, members: [] });
}));
office.patch('/committees/:key', requireTeamHead, wrap(async (req, res) => {
  const c = await Committee.findOne({ team: req.team.key, key: req.params.key });
  if (!c) throw notFound();
  if (req.body.name !== undefined) {
    const name = str(req.body.name, 60);
    if (!name) throw bad('Name the committee.');
    c.name = name;
  }
  if (req.body.color !== undefined && COLORS.includes(req.body.color)) c.color = req.body.color;
  if (req.body.quorum !== undefined) c.quorum = Math.max(0, Math.min(200, Number(req.body.quorum) || 0));
  await c.save();
  if (Array.isArray(req.body.members)) await setMembers(req.team.key, c.key, idList(req.body.members), head(req) ? null : req.user._id);
  res.json({ ok: true });
}));
// keep: someone whose own membership isn't changed (the admin can't add or remove themselves)
async function setMembers(team, key, wanted, keep = null) {
  const people = await User.find({ 'teams.team': team });
  for (const u of people) {
    if (keep && String(u._id) === String(keep)) continue;
    const m = membershipOf(u, team);
    const has = (m.committees || []).includes(key);
    const want = wanted.includes(String(u._id));
    if (has === want) continue;
    m.committees = want ? [...(m.committees || []), key] : m.committees.filter((k) => k !== key);
    u.markModified('teams');
    await u.save();
  }
}
office.delete('/committees/:key', requireTeamHead, wrap(async (req, res) => {
  const c = await Committee.findOne({ team: req.team.key, key: req.params.key });
  if (!c) throw notFound();
  await setMembers(req.team.key, c.key, []);
  for (const M of [OfficeEvent, Goal, ActionItem, OfficeDoc]) await M.updateMany({ team: req.team.key }, { $pull: { committees: c.key, sharedWith: c.key } });
  await c.deleteOne();
  res.locals.activity = `Removed the ${c.name} (its items now belong to the whole team)`;
  res.status(204).end();
}));

// ---------- team setup: rooms, reminders ----------
office.get('/setup', wrap(async (req, res) => {
  const t = await Team.findOne({ key: req.team.key }).lean();
  res.json({ rooms: t.rooms || [], remindMinutes: t.remindMinutes ?? 60, remindDays: t.remindDays ?? 1, yearPlan: (t.yearPlan || []).filter((y) => sees(req.user, { ...y, team: t.key })).map(yearItemView) });
}));
office.patch('/setup', requireTeamHead, wrap(async (req, res) => {
  const t = await Team.findOne({ key: req.team.key });
  if (Array.isArray(req.body.rooms)) {
    const seen = new Set();
    t.rooms = req.body.rooms
      .map((r) => ({ name: str(r?.name, 60), services: !!r?.services }))
      .filter((r) => r.name && !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase()))
      .slice(0, 40);
  }
  if (req.body.remindMinutes !== undefined) t.remindMinutes = Math.max(0, Math.min(24 * 60, Number(req.body.remindMinutes) || 0));
  if (req.body.remindDays !== undefined) t.remindDays = Math.max(0, Math.min(14, Number(req.body.remindDays) || 0));
  await t.save();
  forgetTeams();
  res.locals.activity = 'Updated Church Admin rooms and reminders';
  res.json({ ok: true });
}));

// ---------- the calendar ----------
async function readEvent(req, b, prev = null) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!prev || has('title')) {
    out.title = str(b.title, 120);
    if (!out.title) throw bad('Give it a name.');
  }
  if (!prev || has('type')) out.type = OFFICE_TYPES.includes(b.type) ? b.type : 'event';
  if (!prev || has('date')) {
    if (!DATE_RE.test(b.date || '')) throw bad('Pick a date.');
    out.date = b.date;
  }
  if (!prev || has('allDay') || has('start') || has('end')) {
    const allDay = has('allDay') ? !!b.allDay : prev?.allDay || false;
    out.allDay = allDay;
    if (allDay) {
      out.start = '';
      out.end = '';
    } else {
      const start = has('start') ? b.start : prev?.start;
      let end = has('end') ? b.end : prev?.end;
      if (!TIME_RE.test(start || '')) throw bad('Pick a start time, or make it all day.');
      if (end && !TIME_RE.test(end)) throw bad('Times look like 18:30.');
      if (!end || toMin(end) <= toMin(start)) end = fromMin(Math.min(toMin(start) + 60, 23 * 60 + 59));
      out.start = start;
      out.end = end;
    }
  }
  if (has('room')) out.room = str(b.room, 80);
  if (has('notes')) out.notes = str(b.notes, 2000);
  if (!prev || has('visibility')) out.visibility = b.visibility === 'everyone' ? 'everyone' : 'office';
  if (!prev || has('committees')) out.committees = await cleanCommittees(req, b.committees);
  if (has('sharedWith')) out.sharedWith = await cleanCommittees(req, b.sharedWith, { own: false });
  if (has('attendees')) {
    const members = new Set((await User.find({ 'teams.team': req.team.key, active: true }, { _id: 1 }).lean()).map((u) => String(u._id)));
    const seen = new Set();
    out.attendees = (Array.isArray(b.attendees) ? b.attendees : [])
      .filter((a) => isId(a?.user) && members.has(String(a.user)) && !seen.has(String(a.user)) && seen.add(String(a.user)))
      .map((a) => ({ user: a.user, role: str(a.role, 40) }))
      .slice(0, 100);
  }
  if (has('needsAv')) out.needsAv = !!b.needsAv;
  if (has('avNote')) out.avNote = str(b.avNote, 300);
  const allDay = out.allDay ?? prev?.allDay;
  if ((out.needsAv ?? prev?.needsAv) && allDay) throw bad('Give it a start and end time so AV knows when to come.');
  return out;
}

function myRsvp(ev, user) {
  return (ev.rsvps || []).find((r) => String(r.user) === String(user._id))?.status || '';
}
function eventView(ev, req, ctx = {}) {
  const c = req.ocan || {};
  const counts = { yes: 0, no: 0, maybe: 0 };
  for (const r of ev.rsvps || []) counts[r.status]++;
  return {
    id: String(ev._id),
    type: ev.type,
    title: ev.title,
    date: ev.date,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    room: ev.room,
    notes: ev.notes,
    visibility: ev.visibility,
    committees: ev.committees || [],
    sharedWith: ev.sharedWith || [],
    attendees: (ev.attendees || []).map((a) => ({ id: String(a.user), name: ctx.names?.[String(a.user)] || '', role: a.role })),
    series: ev.series ? String(ev.series) : null,
    repeat: ev.series ? ctx.series?.[String(ev.series)] || '' : '',
    myRsvp: myRsvp(ev, req.user),
    rsvps: counts,
    needsAv: ev.needsAv,
    avNote: ev.avNote,
    agendaItems: (ev.agenda || []).filter((x) => x.kind !== 'heading').length,
    minutesStatus: ev.minutesApprovedAt ? 'approved' : ev.minutes || ev.motions?.length ? 'draft' : 'none',
    bulletin: ev.bulletin?.status ? { status: ev.bulletin.status, service: ev.bulletin.service ? String(ev.bulletin.service) : null, text: ev.bulletin.text } : null,
    canEdit: edits(req.user, ev, c.edit),
  };
}
async function viewContext(list) {
  const userIds = list.flatMap((e) => (e.attendees || []).map((a) => a.user));
  const seriesIds = [...new Set(list.map((e) => e.series).filter(Boolean).map(String))];
  const [names, series] = await Promise.all([nameOf(userIds), OfficeSeries.find({ _id: { $in: seriesIds } }).lean()]);
  return { names, series: Object.fromEntries(series.map((s) => [String(s._id), describeSeries(s)])) };
}

// GET /api/office/events?from&to
office.get('/events', wrap(async (req, res) => {
  const from = DATE_RE.test(req.query.from) ? req.query.from : addDays(await today(), -7);
  const to = DATE_RE.test(req.query.to) ? req.query.to : addDays(from, 62);
  const list = await OfficeEvent.find({ ...visibleFilter(req.user, req.team.key), date: { $gte: from, $lte: addDays(to, 0) } }).sort({ date: 1, start: 1 }).lean();
  const ctx = await viewContext(list);
  res.json(list.map((e) => eventView(e, req, ctx)));
}));

async function loadEvent(req, id = req.params.id) {
  if (!isId(id)) throw notFound();
  const ev = await OfficeEvent.findOne({ _id: id, team: req.team.key });
  if (!ev) throw notFound('That was removed.');
  assertSees(req.user, ev, 'that');
  return ev;
}
const assertEdits = (req, ev) => {
  if (!edits(req.user, ev, req.ocan.edit)) throw forbidden('You can’t change this one.');
};

// GET /api/office/events/:id — everything about one item, meetings included
office.get('/events/:id', wrap(async (req, res) => {
  const ev = await loadEvent(req);
  res.json(await fullEvent(ev, req));
}));
async function fullEvent(ev, req) {
  const e = ev.toObject ? ev.toObject() : ev;
  const [ctx, people, committees, actions, series] = await Promise.all([
    viewContext([e]),
    audienceOf(e),
    teamCommittees(e.team),
    ActionItem.find({ meeting: e._id }).sort({ createdAt: 1 }).lean(),
    e.series ? OfficeSeries.findById(e.series).lean() : null,
  ]);
  const names = { ...ctx.names, ...Object.fromEntries(people.map((u) => [String(u._id), u.name])) };
  const extra = await nameOf([e.minutesBy, e.minutesApprovedBy, ...actions.map((a) => a.owner), ...(e.present || [])]);
  Object.assign(names, extra);
  const owners = e.committees || [];
  const quorum = owners.length === 1 ? committees.find((c) => c.key === owners[0])?.quorum || 0 : 0;
  const rights = minutesRights(req, e);
  return {
    ...eventView(e, req, ctx),
    repeatRule: series ? { freq: series.freq, interval: series.interval, nth: series.nth, weekday: series.weekday, monthDay: series.monthDay, until: series.until } : null,
    audience: people.map((u) => ({ id: String(u._id), name: u.name, rsvp: myRsvp(e, u), invited: !(e.attendees || []).length || (e.attendees || []).some((a) => String(a.user) === String(u._id)) })),
    quorum,
    agenda: (e.agenda || []).map((x) => ({ id: String(x._id), kind: x.kind, title: x.title, presenter: x.presenter, minutes: x.minutes, notes: x.notes })),
    agendaSentAt: e.agendaSentAt || null,
    minutes: e.minutes,
    present: (e.present || []).map(String),
    guests: e.guests,
    minutesOpen: e.minutesOpen,
    minutesBy: names[String(e.minutesBy)] || null,
    minutesApprovedAt: e.minutesApprovedAt || null,
    minutesApprovedBy: names[String(e.minutesApprovedBy)] || null,
    motions: (e.motions || []).map(motionView),
    actions: actions.map((a) => actionView(a, req, names)),
    canAgenda: !!req.ocan.plans && edits(req.user, e, true),
    canMinutes: rights,
    canApprove: !!req.ocan.plans && edits(req.user, e, true),
  };
}

// Minutes: the secretary by default; anyone in the meeting once a leader opens it up; the head and admin always
function minutesRights(req, ev) {
  if (ev.minutesApprovedAt) return false; // approved minutes are locked; a leader can reopen them
  if (membershipOf(req.user, ev.team)?.head) return true;
  if (isSecretary(req.user, ev)) return true;
  return !!ev.minutesOpen && sees(req.user, { ...ev, visibility: 'office', sharedWith: [] });
}

// POST /api/office/events { …fields, repeat?: { freq, interval, nth, weekday, monthDay, until } }
office.post('/events', need('edit'), wrap(async (req, res) => {
  const fields = await readEvent(req, req.body || {});
  const base = { ...fields, team: req.team.key, createdBy: req.user._id, updatedBy: req.user._id };
  const rep = req.body.repeat;
  if (rep && rep.freq) {
    const series = await makeSeries(req, base, rep);
    const first = await OfficeEvent.findOne({ series: series._id }).sort({ date: 1 });
    if (!first) throw bad('That repeat has no dates. Check when it ends.');
    for (const ev of await OfficeEvent.find({ series: series._id })) await syncAv(ev, req);
    await attachWaiting(req.team.key);
    res.locals.activity = `Added ${named(fields, 'a Church Admin calendar item')} (${describeSeries(series)})`;
    return res.status(201).json(await fullEvent(first, req));
  }
  const ev = await OfficeEvent.create(base);
  await syncAv(ev, req);
  await attachWaiting(req.team.key); // a new board meeting picks up requests waiting for one
  res.locals.activity = `Added ${named(ev, 'a Church Admin calendar item')}`;
  res.status(201).json(await fullEvent(ev, req));
}));

async function makeSeries(req, base, rep) {
  const freq = ['weekly', 'monthly-nth', 'monthly-day', 'yearly'].includes(rep.freq) ? rep.freq : null;
  if (!freq) throw bad('Pick how it repeats.');
  const d = DateTime.fromISO(base.date, { zone: 'utc' });
  const until = rep.until && DATE_RE.test(rep.until) ? rep.until : '';
  if (until && until < base.date) throw bad('The repeat has to end after it starts.');
  const nth = freq === 'monthly-nth' ? (Number(rep.nth) === -1 ? -1 : Math.max(1, Math.min(4, Number(rep.nth) || Math.ceil(d.day / 7)))) : undefined;
  const { date, ...template } = base;
  const series = await OfficeSeries.create({
    team: req.team.key,
    freq,
    interval: Math.max(1, Math.min(12, Number(rep.interval) || 1)),
    weekday: freq === 'monthly-nth' ? (rep.weekday !== undefined ? Math.max(0, Math.min(6, Number(rep.weekday))) : d.weekday % 7) : undefined,
    nth,
    monthDay: freq === 'monthly-day' ? Math.max(1, Math.min(31, Number(rep.monthDay) || d.day)) : undefined,
    first: date,
    until,
    template,
    createdBy: req.user._id,
  });
  await fillSeries(series, await today());
  return series;
}

// PATCH /api/office/events/:id?scope=one|future
const SERIES_FIELDS = ['title', 'type', 'start', 'end', 'allDay', 'room', 'notes', 'visibility', 'committees', 'sharedWith', 'attendees', 'needsAv', 'avNote'];
office.patch('/events/:id', need('edit'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  assertEdits(req, ev);
  const fields = await readEvent(req, req.body || {}, ev);
  const future = req.query.scope === 'future' && ev.series;
  if (future && fields.date && fields.date !== ev.date) throw bad('To move every date, remove the repeat from here on and add it again. You can move just this date.');
  Object.assign(ev, fields, { updatedBy: req.user._id });
  await ev.save();
  await syncAv(ev, req);
  if (future) {
    const set = Object.fromEntries(SERIES_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]]));
    const later = await OfficeEvent.find({ series: ev.series, date: { $gt: ev.date } });
    for (const x of later) {
      Object.assign(x, set, { updatedBy: req.user._id });
      await x.save();
      await syncAv(x, req);
    }
    const s = await OfficeSeries.findById(ev.series);
    if (s) {
      s.template = { ...s.template, ...set };
      s.markModified('template');
      await s.save();
    }
    res.locals.activity = `Changed ${named(ev, 'a repeating Church Admin item')} from one date on`;
  } else res.locals.activity = `Changed ${named(ev, 'a Church Admin calendar item')}`;
  res.json(await fullEvent(ev, req));
}));

// DELETE /api/office/events/:id?scope=one|future
office.delete('/events/:id', need('edit'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  assertEdits(req, ev);
  const doomed = req.query.scope === 'future' && ev.series ? await OfficeEvent.find({ series: ev.series, date: { $gte: ev.date } }) : [ev];
  if (req.query.scope === 'future' && ev.series) await OfficeSeries.updateOne({ _id: ev.series }, { $set: { until: addDays(ev.date, -1), filledTo: addDays(ev.date, -1) } });
  for (const x of doomed) {
    await unlinkAv(x);
    await ActionItem.updateMany({ meeting: x._id }, { $unset: { meeting: 1 } });
    await x.deleteOne();
  }
  res.locals.activity = doomed.length > 1 ? `Removed ${named(ev, 'a repeating Church Admin item')} (${doomed.length} dates)` : `Removed ${named(ev, 'a Church Admin calendar item')}`;
  res.status(204).end();
}));

// PUT /api/office/events/:id/rsvp { status: yes|no|maybe|'' }
office.put('/events/:id/rsvp', wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!membershipOf(req.user, ev.team) && req.user.role !== 'admin') throw forbidden();
  ev.rsvps = (ev.rsvps || []).filter((r) => String(r.user) !== String(req.user._id));
  if (['yes', 'no', 'maybe'].includes(req.body.status)) ev.rsvps.push({ user: req.user._id, status: req.body.status, at: new Date() });
  await ev.save();
  res.json({ myRsvp: myRsvp(ev, req.user) });
}));

// GET /api/office/rooms/check?date&start&end&room&except — what else uses the room then
office.get('/rooms/check', wrap(async (req, res) => {
  const { date, start, end, room, except } = req.query;
  if (!DATE_RE.test(date || '') || !room) return res.json({ conflicts: [] });
  const t = await Team.findOne({ key: req.team.key }).lean();
  const r = (t.rooms || []).find((x) => x.name.toLowerCase() === String(room).toLowerCase());
  const s0 = TIME_RE.test(start || '') ? toMin(start) : 0;
  const e0 = TIME_RE.test(end || '') ? toMin(end) : 24 * 60;
  const hits = (s, e) => (s ? toMin(s) : 0) < e0 && (e ? toMin(e) : 24 * 60) > s0;
  const conflicts = [];
  const teams = await officeTeamKeys();
  const others = await OfficeEvent.find({ team: { $in: teams }, date, room: new RegExp(`^${String(room).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), ...(isId(except) ? { _id: { $ne: except } } : {}) }).lean();
  for (const o of others) if (hits(o.start, o.end)) conflicts.push({ what: sees(req.user, o) ? o.title : 'Booked', start: o.start, end: o.end, allDay: o.allDay });
  if (r?.services) {
    const evs = await Event.find({ date, office: null }).lean();
    for (const e of evs) if (hits(e.call || e.start, e.end)) conflicts.push({ what: e.kind === 'rehearsal' ? 'Rehearsal' : e.kind === 'soundcheck' ? 'Sound check' : 'Service', start: e.call || e.start, end: e.end });
  }
  res.json({ conflicts });
}));

// ---------- "Needs AV": a matching spot on the AV schedule ----------
async function syncAv(ev, req) {
  const linked = await Event.findOne({ office: ev._id });
  if (!ev.needsAv || ev.allDay) return unlinkAv(ev, linked);
  const call = fromMin(Math.max(0, toMin(ev.start) - 30));
  const fields = { date: ev.date, title: ev.title, start: ev.start, call, end: ev.end, notes: [`Asked for by Church Admin${ev.room ? ` · ${ev.room}` : ''}`, ev.avNote].filter(Boolean).join(' — ') };
  if (linked) {
    Object.assign(linked, fields);
    await linked.save();
  } else await Event.create({ ...fields, kind: 'service', team: null, needs: [], manual: true, office: ev._id });
}
async function unlinkAv(ev, linked) {
  linked = linked === undefined ? await Event.findOne({ office: ev._id }) : linked;
  if (!linked) return;
  if (await Assignment.exists({ event: linked._id })) {
    linked.office = null;
    linked.notes = `${linked.notes ? `${linked.notes} — ` : ''}Church Admin no longer needs AV for this.`;
    await linked.save();
  } else await linked.deleteOne();
}

// ---------- meetings: agenda, minutes, motions ----------
office.put('/events/:id/agenda', need('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!edits(req.user, ev, true)) throw forbidden('You can’t change this meeting.');
  const list = Array.isArray(req.body.agenda) ? req.body.agenda.slice(0, 80) : [];
  ev.agenda = list.map((x) => ({ kind: x?.kind === 'heading' ? 'heading' : 'item', title: str(x?.title, 200), presenter: str(x?.presenter, 80), minutes: Math.max(0, Math.min(600, Number(x?.minutes) || 0)), notes: str(x?.notes, 1000) })).filter((x) => x.title);
  await ev.save();
  res.locals.activity = `Updated the agenda for ${named(ev, 'a Church Admin meeting')}`;
  res.json(await fullEvent(ev, req));
}));

// POST /api/office/events/:id/send-agenda — email it to everyone in the meeting
office.post('/events/:id/send-agenda', need('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!mailerReady()) throw bad('Email isn’t set up yet. Send it on WhatsApp instead.');
  if (!ev.agenda.length) throw bad('Add agenda items first.');
  const s = await getSettings();
  const people = (await audienceOf(ev)).filter((u) => u.email && (!(ev.attendees || []).length || ev.attendees.some((a) => String(a.user) === String(u._id))));
  const text = agendaText(ev, s.orgName);
  let sent = 0;
  for (const u of people) {
    try {
      await sendMail({ to: u.email, subject: `Agenda: ${ev.title}, ${DateTime.fromISO(ev.date).toFormat('cccc, LLL d')}`, text: `Hi ${u.name.split(' ')[0]},\n\n${text}` });
      sent++;
    } catch {
      /* counted below */
    }
  }
  ev.agendaSentAt = new Date();
  await ev.save();
  res.locals.activity = `Emailed the agenda for ${named(ev, 'a Church Admin meeting')} to ${sent} people`;
  res.json({ sent, of: people.length });
}));
export function agendaText(ev, orgName) {
  const when = `${DateTime.fromISO(ev.date).toFormat('cccc, LLLL d')}${ev.start ? ` at ${DateTime.fromFormat(ev.start, 'HH:mm').toFormat('h:mm a')}` : ''}${ev.room ? ` · ${ev.room}` : ''}`;
  let n = 0;
  const lines = ev.agenda.map((x) => (x.kind === 'heading' ? `\n${x.title.toUpperCase()}` : `${++n}. ${x.title}${x.presenter ? ` — ${x.presenter}` : ''}${x.minutes ? ` (${x.minutes} min)` : ''}${x.notes ? `\n   ${x.notes}` : ''}`));
  return [`${ev.title}`, when, '', 'Agenda', ...lines, '', `Details in Crew Call: ${config.publicUrl}/#office-plan`, '', `— ${orgName}`].join('\n');
}

// PUT /api/office/events/:id/minutes { minutes, present, guests }
office.put('/events/:id/minutes', wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!minutesRights(req, ev.toObject())) throw forbidden(ev.minutesApprovedAt ? 'These minutes are approved, so they can’t change.' : 'The secretary takes the minutes. A leader can open them up to anyone in the meeting.');
  if (req.body.minutes !== undefined) ev.minutes = str(req.body.minutes, 30000);
  if (req.body.present !== undefined) ev.present = idList(req.body.present);
  if (req.body.guests !== undefined) ev.guests = str(req.body.guests, 500);
  ev.minutesBy = req.user._id;
  await ev.save();
  res.json(await fullEvent(ev, req));
}));
// POST /api/office/events/:id/minutes-open { open } — a leader lets anyone in the meeting take minutes
office.post('/events/:id/minutes-open', need('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  ev.minutesOpen = !!req.body.open;
  await ev.save();
  res.locals.activity = `${ev.minutesOpen ? 'Opened' : 'Closed'} the minutes of ${named(ev, 'a Church Admin meeting')} ${ev.minutesOpen ? 'to anyone in the meeting' : 'back to the secretary'}`;
  res.json(await fullEvent(ev, req));
}));
// POST /api/office/events/:id/minutes-approve { approved }
office.post('/events/:id/minutes-approve', need('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (req.body.approved === false) {
    ev.minutesApprovedAt = null;
    ev.minutesApprovedBy = null;
  } else {
    if (!ev.minutes && !ev.motions.length) throw bad('There are no minutes to approve yet.');
    ev.minutesApprovedAt = new Date();
    ev.minutesApprovedBy = req.user._id;
  }
  await ev.save();
  res.locals.activity = `${ev.minutesApprovedAt ? 'Approved' : 'Reopened'} the minutes of ${named(ev, 'a Church Admin meeting')}`;
  res.json(await fullEvent(ev, req));
}));

const motionView = (m) => ({ id: String(m._id), text: m.text, movedBy: m.movedBy, secondedBy: m.secondedBy, result: m.result, votesFor: m.votesFor, votesAgainst: m.votesAgainst, abstain: m.abstain });
const readMotion = (b) => {
  const text = str(b.text, 1000);
  if (!text) throw bad('What’s the motion?');
  const n = (v) => Math.max(0, Math.min(10000, Number(v) || 0));
  return { text, movedBy: str(b.movedBy, 80), secondedBy: str(b.secondedBy, 80), result: ['passed', 'failed', 'tabled', 'withdrawn'].includes(b.result) ? b.result : 'passed', votesFor: n(b.votesFor), votesAgainst: n(b.votesAgainst), abstain: n(b.abstain) };
};
office.post('/events/:id/motions', wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!minutesRights(req, ev.toObject())) throw forbidden('Only whoever takes the minutes can record motions.');
  ev.motions.push(readMotion(req.body || {}));
  await ev.save();
  res.locals.activity = `Recorded a motion in ${named(ev, 'a Church Admin meeting')}`;
  res.status(201).json(await fullEvent(ev, req));
}));
office.patch('/events/:id/motions/:mid', wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!minutesRights(req, ev.toObject())) throw forbidden('Only whoever takes the minutes can change motions.');
  const m = ev.motions.id(req.params.mid);
  if (!m) throw notFound();
  Object.assign(m, readMotion({ ...motionView(m), ...req.body }));
  await ev.save();
  res.json(await fullEvent(ev, req));
}));
office.delete('/events/:id/motions/:mid', wrap(async (req, res) => {
  const ev = await loadEvent(req);
  if (!minutesRights(req, ev.toObject())) throw forbidden('Only whoever takes the minutes can remove motions.');
  ev.motions.pull(req.params.mid);
  await ev.save();
  res.json(await fullEvent(ev, req));
}));

// Votes on record: every motion in meetings you can see, newest first, with search
office.get('/motions', wrap(async (req, res) => {
  const q = str(req.query.q, 100).toLowerCase();
  const list = await OfficeEvent.find({ ...visibleFilter(req.user, req.team.key), 'motions.0': { $exists: true } }, { title: 1, date: 1, motions: 1, committees: 1, minutesApprovedAt: 1 }).sort({ date: -1 }).limit(500).lean();
  const out = [];
  for (const e of list)
    for (const m of e.motions)
      if (!q || `${m.text} ${m.movedBy} ${m.secondedBy} ${e.title}`.toLowerCase().includes(q)) out.push({ ...motionView(m), meeting: { id: String(e._id), title: e.title, date: e.date, committees: e.committees, approved: !!e.minutesApprovedAt } });
  res.json(out.slice(0, 300));
}));

// Announcement for a service's bulletin: PUT /api/office/events/:id/bulletin { service, text }
office.put('/events/:id/bulletin', need('edit'), wrap(async (req, res) => {
  const ev = await loadEvent(req);
  assertEdits(req, ev);
  if (!req.body.service) {
    ev.bulletin = { status: '', text: '' };
  } else {
    if (ev.visibility !== 'everyone') throw bad('Share it with every team first; the bulletin is for the whole church.');
    if (!isId(req.body.service) || !(await Event.exists({ _id: req.body.service, kind: 'service' }))) throw bad('Pick a service.');
    ev.bulletin = { service: req.body.service, text: str(req.body.text, 1000), status: 'pending' };
  }
  await ev.save();
  res.locals.activity = ev.bulletin.status ? `Asked to put ${named(ev, 'a church event')} in a service’s announcements` : `Took back the announcement for ${named(ev, 'a church event')}`;
  res.json(await fullEvent(ev, req));
}));

// ---------- goals ----------
function goalView(g, req, names = {}) {
  const ms = g.milestones || [];
  const done = ms.filter((m) => m.done).length;
  return {
    id: String(g._id),
    title: g.title,
    description: g.description,
    owner: g.owner ? { id: String(g.owner), name: names[String(g.owner)] || '' } : null,
    start: g.start,
    due: g.due,
    status: g.status,
    progress: g.status === 'done' ? 100 : ms.length ? Math.round((done / ms.length) * 100) : 0,
    milestones: ms.map((m) => ({ id: String(m._id), title: m.title, due: m.due, owner: m.owner ? { id: String(m.owner), name: names[String(m.owner)] || '' } : null, done: m.done })),
    committees: g.committees || [],
    sharedWith: g.sharedWith || [],
    canEdit: edits(req.user, g, req.ocan.plans),
  };
}
async function goalsOut(list, req) {
  const names = await nameOf(list.flatMap((g) => [g.owner, ...(g.milestones || []).map((m) => m.owner)]));
  return list.map((g) => goalView(g, req, names));
}
async function readGoal(req, b, prev) {
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!prev || has('title')) {
    out.title = str(b.title, 160);
    if (!out.title) throw bad('Name the goal.');
  }
  if (has('description')) out.description = str(b.description, 3000);
  if (has('owner')) out.owner = isId(b.owner) ? b.owner : null;
  for (const k of ['start', 'due']) if (has(k)) out[k] = DATE_RE.test(b[k] || '') ? b[k] : '';
  if (has('status')) out.status = ['not-started', 'on-track', 'behind', 'done'].includes(b.status) ? b.status : 'not-started';
  if (!prev || has('committees')) out.committees = await cleanCommittees(req, b.committees);
  if (has('sharedWith')) out.sharedWith = await cleanCommittees(req, b.sharedWith, { own: false });
  if (has('milestones')) {
    const old = new Map((prev?.milestones || []).map((m) => [String(m._id), m]));
    out.milestones = (Array.isArray(b.milestones) ? b.milestones : [])
      .slice(0, 60)
      .map((m) => {
        const before = isId(m?.id) ? old.get(String(m.id)) : null;
        const done = !!m?.done;
        return { ...(before ? { _id: before._id } : {}), title: str(m?.title, 200), due: DATE_RE.test(m?.due || '') ? m.due : '', owner: isId(m?.owner) ? m.owner : null, done, doneAt: done ? before?.doneAt || new Date() : null };
      })
      .filter((m) => m.title);
  }
  return out;
}
office.get('/goals', wrap(async (req, res) => {
  const list = await Goal.find(visibleFilter(req.user, req.team.key)).sort({ due: 1, createdAt: 1 }).lean();
  res.json(await goalsOut(list.filter((g) => sees(req.user, { ...g, visibility: 'office' })), req));
}));
office.post('/goals', need('plans'), wrap(async (req, res) => {
  const g = await Goal.create({ ...(await readGoal(req, req.body || {})), team: req.team.key, createdBy: req.user._id });
  res.locals.activity = 'Added a Church Admin goal';
  res.status(201).json((await goalsOut([g.toObject()], req))[0]);
}));
async function loadGoal(req) {
  if (!isId(req.params.id)) throw notFound();
  const g = await Goal.findOne({ _id: req.params.id, team: req.team.key });
  if (!g || !sees(req.user, { ...g.toObject(), visibility: 'office' })) throw notFound();
  return g;
}
office.patch('/goals/:id', wrap(async (req, res) => {
  const g = await loadGoal(req);
  const b = req.body || {};
  const onlyTicks = Object.keys(b).length === 1 && Array.isArray(b.milestones) && !edits(req.user, g, req.ocan.plans);
  if (onlyTicks) {
    // A milestone's owner can tick it off without the planning privilege
    for (const m of b.milestones) {
      const x = g.milestones.id(m?.id);
      if (x && String(x.owner) === String(req.user._id) && !!m.done !== x.done) {
        x.done = !!m.done;
        x.doneAt = x.done ? new Date() : null;
      }
    }
  } else {
    if (!edits(req.user, g, req.ocan.plans)) throw forbidden('You can’t change this goal.');
    Object.assign(g, await readGoal(req, b, g));
  }
  if (g.milestones.length && g.milestones.every((m) => m.done) && g.status !== 'done' && b.status === undefined) g.status = 'done';
  await g.save();
  res.json((await goalsOut([g.toObject()], req))[0]);
}));
office.delete('/goals/:id', need('plans'), wrap(async (req, res) => {
  const g = await loadGoal(req);
  if (!edits(req.user, g, true)) throw forbidden();
  await ActionItem.updateMany({ goal: g._id }, { $unset: { goal: 1 } });
  await g.deleteOne();
  res.locals.activity = 'Removed a Church Admin goal';
  res.status(204).end();
}));

// ---------- action items ----------
function actionView(a, req, names = {}) {
  return {
    id: String(a._id),
    title: a.title,
    notes: a.notes,
    owner: a.owner ? { id: String(a.owner), name: names[String(a.owner)] || '' } : null,
    due: a.due,
    done: a.done,
    meeting: a.meeting ? String(a.meeting) : null,
    goal: a.goal ? String(a.goal) : null,
    committees: a.committees || [],
    canEdit: edits(req.user, a, req.ocan.edit || req.ocan.plans) || String(a.createdBy) === String(req.user._id),
    canTick: String(a.owner) === String(req.user._id) || edits(req.user, a, req.ocan.edit || req.ocan.plans),
  };
}
office.get('/actions', wrap(async (req, res) => {
  const filter = { ...visibleFilter(req.user, req.team.key), ...(req.query.mine ? { owner: req.user._id } : {}), ...(req.query.open ? { done: false } : {}) };
  const list = (await ActionItem.find(filter).sort({ done: 1, due: 1, createdAt: 1 }).limit(500).lean()).filter((a) => String(a.owner) === String(req.user._id) || sees(req.user, { ...a, visibility: 'office' }));
  const names = await nameOf(list.map((a) => a.owner));
  const meetings = Object.fromEntries((await OfficeEvent.find({ _id: { $in: list.map((a) => a.meeting).filter(Boolean) } }, { title: 1, date: 1 }).lean()).map((e) => [String(e._id), { title: e.title, date: e.date }]));
  res.json(list.map((a) => ({ ...actionView(a, req, names), meetingInfo: a.meeting ? meetings[String(a.meeting)] || null : null })));
}));
office.post('/actions', wrap(async (req, res) => {
  const b = req.body || {};
  let committees;
  let meeting = null;
  if (isId(b.meeting)) {
    // From a meeting's minutes: whoever takes the minutes can add them; they belong with the meeting
    const ev = await loadEvent(req, b.meeting);
    if (!minutesRights(req, ev.toObject()) && !(req.ocan.plans && edits(req.user, ev, true))) throw forbidden('Only whoever takes the minutes, or a leader, can add action items here.');
    committees = ev.committees;
    meeting = ev._id;
  } else {
    if (!req.ocan.edit && !req.ocan.plans) throw forbidden('Only a leader can add action items.');
    committees = await cleanCommittees(req, b.committees);
  }
  const title = str(b.title, 200);
  if (!title) throw bad('What needs doing?');
  const a = await ActionItem.create({ team: req.team.key, committees, title, notes: str(b.notes, 1000), owner: isId(b.owner) ? b.owner : null, due: DATE_RE.test(b.due || '') ? b.due : '', meeting, goal: isId(b.goal) ? b.goal : null, createdBy: req.user._id });
  res.locals.activity = 'Added a Church Admin action item';
  res.status(201).json(actionView(a, req, await nameOf([a.owner])));
}));
office.patch('/actions/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const a = await ActionItem.findOne({ _id: req.params.id, team: req.team.key });
  if (!a) throw notFound();
  const v = actionView(a, req);
  const b = req.body || {};
  const onlyDone = Object.keys(b).every((k) => k === 'done');
  if (!(onlyDone ? v.canTick : v.canEdit)) throw forbidden('You can’t change this action item.');
  if (b.done !== undefined && !!b.done !== a.done) {
    a.done = !!b.done;
    a.doneAt = a.done ? new Date() : null;
  }
  if (!onlyDone) {
    if (b.title !== undefined) a.title = str(b.title, 200) || a.title;
    if (b.notes !== undefined) a.notes = str(b.notes, 1000);
    if (b.owner !== undefined) a.owner = isId(b.owner) ? b.owner : null;
    if (b.due !== undefined) a.due = DATE_RE.test(b.due || '') ? b.due : '';
    if (b.goal !== undefined) a.goal = isId(b.goal) ? b.goal : null;
  }
  await a.save();
  res.json(actionView(a, req, await nameOf([a.owner])));
}));
office.delete('/actions/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const a = await ActionItem.findOne({ _id: req.params.id, team: req.team.key });
  if (!a) throw notFound();
  if (!actionView(a, req).canEdit) throw forbidden();
  await a.deleteOne();
  res.status(204).end();
}));

// ---------- documents ----------
const docView = (d, req) => ({ id: String(d._id), title: d.title, category: d.category, url: d.url, file: d.file?.stored ? { name: d.file.originalName, size: d.file.size } : null, notes: d.notes, committees: d.committees || [], sharedWith: d.sharedWith || [], updatedAt: d.updatedAt, canEdit: edits(req.user, d, req.ocan.resources) });
office.get('/docs', wrap(async (req, res) => {
  const list = (await OfficeDoc.find(visibleFilter(req.user, req.team.key)).sort({ category: 1, title: 1 }).lean()).filter((d) => sees(req.user, { ...d, visibility: 'office' }));
  // Approved minutes are listed with the documents too
  const minutes = await OfficeEvent.find({ ...visibleFilter(req.user, req.team.key), minutesApprovedAt: { $ne: null } }, { title: 1, date: 1, committees: 1, minutesApprovedAt: 1 }).sort({ date: -1 }).limit(100).lean();
  res.json({ docs: list.map((d) => docView(d, req)), minutes: minutes.map((m) => ({ id: String(m._id), title: m.title, date: m.date, committees: m.committees })), categories: DOC_CATEGORIES });
}));
office.post('/docs', need('resources'), uploader({ field: 'file', maxCount: 1 }), wrap(async (req, res) => {
  const files = filesOf(req);
  try {
    const b = req.body || {};
    const title = str(b.title, 160) || (files[0] ? originalName(files[0]) : '');
    if (!title) throw bad('Name the document.');
    const parse = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []);
    const url = normalizeUrl(str(b.url, 500));
    if (!files[0] && !url) throw bad('Add a file or a link.');
    if (url && !isHttpUrl(url)) throw bad('That doesn’t look like a link.');
    const d = await OfficeDoc.create({
      team: req.team.key,
      title,
      category: DOC_CATEGORIES.includes(b.category) ? b.category : 'Other',
      url: files[0] ? '' : url,
      file: files[0] ? { stored: files[0].filename, originalName: originalName(files[0]), mime: files[0].mimetype, size: files[0].size } : undefined,
      notes: str(b.notes, 1000),
      committees: await cleanCommittees(req, parse(b.committees)),
      sharedWith: await cleanCommittees(req, parse(b.sharedWith), { own: false }),
      createdBy: req.user._id,
    });
    res.locals.activity = 'Added a Church Admin document';
    res.status(201).json(docView(d, req));
  } catch (e) {
    removeUploads(files);
    throw e;
  }
}));
office.patch('/docs/:id', need('resources'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const d = await OfficeDoc.findOne({ _id: req.params.id, team: req.team.key });
  if (!d || !edits(req.user, d, true)) throw notFound();
  const b = req.body || {};
  if (b.title !== undefined) d.title = str(b.title, 160) || d.title;
  if (b.category !== undefined && DOC_CATEGORIES.includes(b.category)) d.category = b.category;
  if (b.notes !== undefined) d.notes = str(b.notes, 1000);
  if (b.committees !== undefined) d.committees = await cleanCommittees(req, b.committees);
  if (b.sharedWith !== undefined) d.sharedWith = await cleanCommittees(req, b.sharedWith, { own: false });
  await d.save();
  res.json(docView(d, req));
}));
office.delete('/docs/:id', need('resources'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const d = await OfficeDoc.findOne({ _id: req.params.id, team: req.team.key });
  if (!d || !edits(req.user, d, true)) throw notFound();
  if (d.file?.stored) deleteStored(d.file.stored);
  await d.deleteOne();
  res.locals.activity = 'Removed a Church Admin document';
  res.status(204).end();
}));
office.get('/docs/:id/file', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const d = await OfficeDoc.findOne({ _id: req.params.id, team: req.team.key }).lean();
  if (!d || !d.file?.stored || !sees(req.user, { ...d, visibility: 'office' })) throw notFound();
  const p = path.join(config.uploadDir, d.file.stored);
  if (!fs.existsSync(p)) throw notFound('That file is missing.');
  res.set('X-Content-Type-Options', 'nosniff');
  res.download(p, d.file.originalName || 'document');
}));

// ---------- event requests (from anyone) ----------
office.get('/requests', needOrAdmin('approve'), wrap(async (req, res) => {
  await attachWaiting(req.team.key);
  const list = await OfficeRequest.find({ team: req.team.key }).sort({ status: -1, date: 1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: list.flatMap((r) => [r.requestedBy, r.decidedBy]).filter(Boolean) } }, { name: 1, email: 1, phone: 1 }).lean();
  const names = Object.fromEntries(users.map((u) => [String(u._id), u.name]));
  const meetings = Object.fromEntries((await OfficeEvent.find({ _id: { $in: list.map((r) => r.meeting).filter(Boolean) } }, { title: 1, date: 1, start: 1 }).lean()).map((m) => [String(m._id), m]));
  res.json(
    await Promise.all(
      list.map(async (r) => {
        const asker = users.find((u) => String(u._id) === String(r.requestedBy));
        const m = meetings[String(r.meeting)];
        return {
          ...requestView(r, names),
          // How to reach them: what they typed on the link, or their Crew Call profile
          contact: r.source === 'link' ? { email: r.from?.email || '', phone: r.from?.phone || '' } : { email: asker?.email || '', phone: asker?.phone || '' },
          meeting: m ? { id: String(m._id), title: m.title, date: m.date, start: m.start } : null,
          meetsAfter: !!m && m.date > r.date, // the board meets after the date they asked for
          clashes: r.status === 'pending' ? await clashesFor(r) : [],
        };
      }),
    ),
  );
}));

// The room request link (/reserve/<token>): anyone with it can ask without an account
const linkView = (t) => ({ on: !!t.requestLink?.on && !!t.requestLink?.token, token: t.requestLink?.token || '', url: t.requestLink?.token ? `${config.publicUrl}/reserve/${t.requestLink.token}` : '', madeAt: t.requestLink?.madeAt || null });
office.get('/request-link', needOrAdmin('approve'), wrap(async (req, res) => {
  res.json(linkView(await Team.findOne({ key: req.team.key }).lean()));
}));
// POST /api/office/request-link { on?, renew? } — renew makes a new link; the old one stops working
office.post('/request-link', needOrAdmin('approve'), wrap(async (req, res) => {
  const t = await Team.findOne({ key: req.team.key });
  const b = req.body || {};
  const link = t.requestLink || {};
  if (b.renew || !link.token) Object.assign(link, { token: crypto.randomBytes(18).toString('base64url'), madeAt: new Date() });
  if (b.on !== undefined) link.on = !!b.on;
  else if (b.renew) link.on = true;
  t.requestLink = link;
  t.markModified('requestLink');
  await t.save();
  res.locals.activity = b.renew ? 'Made a new room request link' : link.on ? 'Turned on the room request link' : 'Turned off the room request link';
  res.json(linkView(t));
}));
office.post('/requests/:id/:action(approve|decline)', needOrAdmin('approve'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const r = await OfficeRequest.findOne({ _id: req.params.id, team: req.team.key });
  if (!r) throw notFound();
  if (r.status !== 'pending') throw bad('That request was already answered.');
  r.reply = str(req.body.reply, 500);
  r.decidedBy = req.user._id;
  r.decidedAt = new Date();
  if (req.params.action === 'approve') {
    const b = req.body || {};
    const fields = await readEvent(req, {
      title: r.title,
      date: r.date,
      start: r.start,
      end: r.end,
      allDay: !r.start,
      room: r.room,
      notes: r.notes,
      type: b.type || 'event',
      visibility: b.visibility || 'everyone',
      committees: b.committees || [],
      needsAv: r.needsAv && !!r.start,
    });
    const ev = await OfficeEvent.create({ ...fields, team: req.team.key, fromRequest: r._id, createdBy: req.user._id, updatedBy: req.user._id });
    await syncAv(ev, req);
    r.event = ev._id;
    r.status = 'approved';
  } else r.status = 'declined';
  await r.save();
  await markOnAgenda(r, req.user.name);
  await mailDecision(r);
  res.locals.activity = `${r.status === 'approved' ? 'Approved' : 'Declined'} the request for “${r.title}”`;
  res.json(requestView(r, await nameOf([r.requestedBy, r.decidedBy])));
}));

// ---------- the yearly rhythm ----------
const yearItemView = (y) => ({ id: String(y._id), title: y.title, type: y.type, month: y.month, day: y.day, nth: y.nth, weekday: y.weekday, start: y.start, end: y.end, committees: y.committees, visibility: y.visibility });
office.put('/year-plan', need('plans'), wrap(async (req, res) => {
  const t = await Team.findOne({ key: req.team.key });
  const keys = new Set((await teamCommittees(req.team.key)).map((c) => c.key));
  t.yearPlan = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 120).map((y) => ({
    title: str(y?.title, 120),
    type: OFFICE_TYPES.includes(y?.type) ? y.type : 'event',
    month: Math.max(1, Math.min(12, Number(y?.month) || 1)),
    day: Math.max(0, Math.min(31, Number(y?.day) || 0)),
    nth: Number(y?.nth) === -1 ? -1 : Math.max(1, Math.min(4, Number(y?.nth) || 1)),
    weekday: Math.max(0, Math.min(6, Number(y?.weekday ?? 6))),
    start: TIME_RE.test(y?.start || '') ? y.start : '',
    end: TIME_RE.test(y?.end || '') ? y.end : '',
    committees: (Array.isArray(y?.committees) ? y.committees : []).filter((k) => keys.has(k)),
    visibility: y?.visibility === 'everyone' ? 'everyone' : 'office',
  })).filter((y) => y.title);
  await t.save();
  res.locals.activity = 'Updated the Church Admin yearly calendar';
  res.json({ items: t.yearPlan.map(yearItemView) });
}));
// POST /api/office/year-plan/fill { year } — add the yearly items to that year's calendar (once)
office.post('/year-plan/fill', need('plans'), wrap(async (req, res) => {
  const year = Number(req.body.year);
  if (!(year >= 2020 && year <= 2100)) throw bad('Pick a year.');
  const t = await Team.findOne({ key: req.team.key }).lean();
  let added = 0;
  let skipped = 0;
  for (const y of t.yearPlan || []) {
    const date = yearPlanDate(y, year);
    if (!date) continue;
    if (await OfficeEvent.exists({ team: t.key, title: y.title, date })) {
      skipped++;
      continue;
    }
    await OfficeEvent.create({ team: t.key, title: y.title, type: y.type, date, allDay: !y.start, start: y.start, end: y.start ? y.end || fromMin(toMin(y.start) + 60) : '', committees: y.committees, visibility: y.visibility, createdBy: req.user._id, updatedBy: req.user._id });
    added++;
  }
  res.locals.activity = `Filled in ${year} from the yearly calendar (${added} added)`;
  res.json({ added, skipped });
}));

// Upcoming services, to pick one for a bulletin announcement (names and times only)
office.get('/services', wrap(async (req, res) => {
  const t = await today();
  const list = await Event.find({ kind: 'service', office: null, date: { $gte: t, $lte: addDays(t, 60) } }, { title: 1, date: 1, start: 1 }).sort({ date: 1, start: 1 }).limit(60).lean();
  res.json(list.map((e) => ({ id: String(e._id), title: e.title, date: e.date, start: e.start })));
}));

// ---------- My calendar ----------
office.get('/mine', wrap(async (req, res) => {
  const t = await today();
  const evs = (await OfficeEvent.find({ ...visibleFilter(req.user, req.team.key), date: { $gte: t, $lte: addDays(t, 90) } }).sort({ date: 1, start: 1 }).lean()).filter((e) => {
    if ((e.attendees || []).length) return e.attendees.some((a) => String(a.user) === String(req.user._id));
    const m = membershipOf(req.user, e.team);
    return !!m && (!(e.committees || []).length || (m.committees || []).some((k) => e.committees.includes(k)));
  });
  const ctx = await viewContext(evs);
  const actions = await ActionItem.find({ team: req.team.key, owner: req.user._id, done: false }).sort({ due: 1 }).lean();
  const goals = await Goal.find({ team: req.team.key, 'milestones.owner': req.user._id }).lean();
  const milestones = goals.flatMap((g) => g.milestones.filter((m) => String(m.owner) === String(req.user._id) && !m.done).map((m) => ({ id: String(m._id), title: m.title, due: m.due, goal: { id: String(g._id), title: g.title } })));
  const m = membershipOf(req.user, req.team.key);
  res.json({
    events: evs.map((e) => eventView(e, req, ctx)),
    actions: actions.map((a) => actionView(a, req, { [String(req.user._id)]: req.user.name })),
    milestones,
    offices: m?.offices || [],
    committees: m?.committees || [],
  });
}));

// ---------- Agenda overview ----------
// GET /api/office/overview?zoom=week|month|quarter|year|3y&date=YYYY-MM-DD
office.get('/overview', wrap(async (req, res) => {
  const t = await today();
  const zoom = ['week', 'month', 'quarter', 'year', '3y'].includes(req.query.zoom) ? req.query.zoom : 'month';
  const at = DateTime.fromISO(DATE_RE.test(req.query.date || '') ? req.query.date : t, { zone: 'utc' });
  let from;
  let to;
  if (zoom === 'week') {
    from = at.minus({ days: at.weekday % 7 }); // weeks start on Sunday
    to = from.plus({ days: 6 });
  } else if (zoom === 'month') {
    from = at.startOf('month');
    to = at.endOf('month');
  } else if (zoom === 'quarter') {
    from = at.startOf('quarter');
    to = at.endOf('quarter');
  } else if (zoom === 'year') {
    from = at.startOf('year');
    to = at.endOf('year');
  } else {
    from = at.startOf('year');
    to = at.plus({ years: 2 }).endOf('year');
  }
  const f = from.toISODate();
  const e = to.toISODate();
  const vis = visibleFilter(req.user, req.team.key);
  const detailed = zoom === 'week' || zoom === 'month';
  const [events, goals, actions, committees, people] = await Promise.all([
    OfficeEvent.find({ ...vis, date: { $gte: f, $lte: e }, ...(detailed ? {} : { $or: [{ type: { $in: ['board', 'business', 'deadline', 'event'] } }, { 'agenda.0': { $exists: true } }] }) }).sort({ date: 1, start: 1 }).limit(1500).lean(),
    Goal.find(vis).lean(),
    ActionItem.find({ ...vis, done: false }).lean(),
    teamCommittees(req.team.key),
    User.find({ active: true, 'teams.team': req.team.key }, { name: 1, teams: 1 }).lean(),
  ]);
  const seeGoals = goals.filter((g) => sees(req.user, { ...g, visibility: 'office' }));
  const ctx = await viewContext(events);
  const names = Object.fromEntries(people.map((u) => [String(u._id), u.name]));
  // Goals and milestones due in the window (or running through it)
  const inRange = (d) => d && d >= f && d <= e;
  const goalRows = seeGoals
    .filter((g) => inRange(g.due) || (g.milestones || []).some((m) => inRange(m.due)) || (g.start && g.start <= e && (!g.due || g.due >= f)))
    .map((g) => ({ ...goalView(g, req, names), milestonesInRange: (g.milestones || []).filter((m) => inRange(m.due)).map((m) => ({ id: String(m._id), title: m.title, due: m.due, done: m.done })) }));
  // Needs attention, whatever the zoom
  const soon = addDays(t, 14);
  const overdue = actions.filter((a) => a.due && a.due < t && sees(req.user, { ...a, visibility: 'office' }));
  const noAgenda = await OfficeEvent.find({ ...vis, date: { $gte: t, $lte: soon }, type: { $in: ['board', 'business', 'committee'] }, 'agenda.0': { $exists: false } }, { title: 1, date: 1 }).sort({ date: 1 }).lean();
  const unapproved = await OfficeEvent.find({ ...vis, date: { $lt: t, $gte: addDays(t, -120) }, minutesApprovedAt: null, $or: [{ minutes: { $ne: '' } }, { 'motions.0': { $exists: true } }] }, { title: 1, date: 1 }).sort({ date: -1 }).limit(20).lean();
  const behind = seeGoals.filter((g) => g.status === 'behind' || (g.status !== 'done' && g.due && g.due < t) || (g.milestones || []).some((m) => !m.done && m.due && m.due < t));
  const terms = [];
  for (const u of people)
    for (const o of membershipOf(u, req.team.key)?.offices || [])
      if (o.termEnds && o.termEnds <= addDays(t, 60)) terms.push({ person: u.name, role: o.role, committee: committees.find((c) => c.key === o.committee)?.name || '', termEnds: o.termEnds, past: o.termEnds < t });
  res.json({
    zoom,
    from: f,
    to: e,
    today: t,
    events: events.map((x) => eventView(x, req, ctx)),
    goals: goalRows,
    counts: { meetings: events.filter((x) => ['board', 'business', 'committee'].includes(x.type)).length, deadlines: events.filter((x) => x.type === 'deadline').length, events: events.filter((x) => ['event', 'other'].includes(x.type)).length },
    attention: {
      overdue: overdue.map((a) => ({ id: String(a._id), title: a.title, due: a.due, owner: names[String(a.owner)] || '' })),
      noAgenda: noAgenda.map((x) => ({ id: String(x._id), title: x.title, date: x.date })),
      unapproved: unapproved.map((x) => ({ id: String(x._id), title: x.title, date: x.date })),
      behind: behind.map((g) => ({ id: String(g._id), title: g.title, due: g.due })),
      terms: terms.sort((a, b) => a.termEnds.localeCompare(b.termEnds)),
    },
  });
}));
