import { config } from '../config.js';
import { Router } from 'express';
import { IANAZone } from 'luxon';
import { Assignment, Blackout, Committee, Event, EVENT_KINDS, Group, Issue, OfficeEvent, Position, Request, Resource, Team, Unavailable, User, SignageAsset } from '../models.js';
import { managesSignage } from '../lib/signage.js';
import { forgetSessionRules, requireAdmin, requirePerm, signOutUsers } from '../auth.js';
import { addDays, bad, can, conflict, DATE_RE, forbidden, getSettings, isHttpUrl, isId, membershipOf, normalizeUrl, notFound, str, TIME_RE, todayIn, wrap } from '../lib/util.js';
import { eventView, groupView, meView, personView, requestView } from '../lib/views.js';
import { cleanGroupIds } from './events.js';
import { announcementsFor, noticeLinesFor } from './announcements.js';
import { buildCalendar } from '../lib/ics.js';
import { awayByEvent, baseOf, isShadow, touchAvailability } from '../lib/availability.js';
import { mailerReady, sendMail } from '../lib/mailer.js';
import { FEATURES } from '../lib/features.js';
import { deleteStored, filesOf, originalName, removeUploads, sendStored, uploader } from '../lib/media.js';
import { calendarClient, dayName, evName, logActivity, posName } from '../lib/activity.js';
import { isOfficeTeam, officePerms, onServiceTeam, rosterFor, sees as seesOffice, seesRoster } from '../lib/office.js';
import { teamsShownTo } from '../lib/teams.js';
import { vaultFor } from './vault.js';
import { forgetPositions, isAvTeam, isTeamLeader, positionsList, positionTeams, requireTeamHead, teamsList, teamsOf, teamView } from '../lib/teams.js';

const settingsView = (s) => ({
  orgName: s.orgName,
  timezone: s.timezone,
  countryCode: s.countryCode,
  groupLink: s.groupLink,
  streamFooter: s.streamFooter,
  bulletinColor: s.bulletinColor || '',
  bulletinFont: s.bulletinFont === 'sans' ? 'sans' : 'serif',
  features: Object.fromEntries(FEATURES.map((k) => [k, !!s.features?.[k]])),
  checklists: s.checklists || {},
  burnoutWeeks: s.burnoutWeeks ?? 4,
  logo: s.logo ? `/api/public/logo?v=${s.logoAt ? s.logoAt.getTime() : 0}` : '',
  weekendTemplate: s.weekendTemplate,
  reminderEmails: s.reminderEmails,
  reminderDays: s.reminderDays,
  calendarAlertDays: s.calendarAlertDays ?? 5,
  autoBuildWeeks: s.autoBuildWeeks ?? 4,
  idleMinutes: s.idleMinutes ?? 90,
  endOnBrowserClose: s.endOnBrowserClose ?? true,
  emailConfigured: mailerReady(),
});

// ---------- bootstrap: everything the app needs on load ----------
export const bootstrapRouter = Router();
bootstrapRouter.get('/', wrap(async (req, res) => {
  const team = req.team.key;
  const av = isAvTeam(req.team);
  const [s, positions, people, everyone, groups, myTeams, allTeams] = await Promise.all([
    getSettings(),
    positionsList(),
    // Team screens list the people on the team you're working in
    User.find({ 'teams.team': team, ...(req.can.people ? {} : { active: true }) }).sort({ name: 1 }),
    // Names of everyone, for line-ups that cross teams
    User.find({ active: true }, { name: 1, teams: 1, role: 1 }).sort({ name: 1 }).lean(),
    av ? Group.find({}).sort({ name: 1 }) : [],
    teamsOf(req.user),
    teamsList(),
  ]);
  const pos = (p) => ({ key: p.key, label: p.label, order: p.order, team: p.team || 'av' });
  const office = isOfficeTeam(req.team);
  const serviceSide = await onServiceTeam(req.user);
  const officeSetup = office ? await Team.findOne({ key: team }, { rooms: 1, remindMinutes: 1, remindDays: 1 }).lean() : null;
  res.json({
    me: req.previewing ? { ...meView(req.user), calUrl: `${config.publicUrl}/cal/(their-private-link).ics`, previewing: true } : meView(req.user),
    settings: { ...settingsView(s), groupLink: req.team.groupLink || '' },
    team: teamView(req.team),
    teams: myTeams, // the teams this person can switch between
    allTeams: allTeams.map(teamView),
    // Teams this person can bring someone onto from Team & roles (Church Admin sends a request to join)
    addTo: req.previewing ? [] : await addableTeams(req.user, allTeams),
    positions: positions.filter((p) => (p.team || 'av') === team).map(pos), // this team's positions
    allPositions: positions.map(pos),
    people: rosterFor(req, people).map((p) => personView(p, req.user)),
    everyone: everyone.map((u) => ({ id: String(u._id), name: u.name, teams: u.role === 'admin' && !(u.teams || []).length ? ['av'] : teamsShownTo(req.user, u) })),
    groups: groups.map((g) => groupView(g, req.user)),
    announcements: await announcementsFor(addDays(todayIn(s.timezone), -7), addDays(todayIn(s.timezone), 120)),
    // Booth Crew Academy is AV training: it shows on the AV team's side only
    academy: config.academyOn && serviceSide && av ? { url: config.academyUrl, host: new URL(config.academyUrl).host } : null,
    serviceSide, // on a team that serves on services (sees services, plans and line-ups)
    // Teams whose leaders asked this person to join (Church Admin); accepted from a banner
    invites: await invitesFor(req.user),
    // Church Admin leaders (and the admin) see who's on the team and who's been asked
    seesRoster: office ? seesRoster(req.user, team) : true,
    // On Church Admin, what someone can do with its items comes from their own place on the team
    officeAccess: office ? { member: !!(req.user.teams || []).find((m) => m.team === team), can: officePerms(req.user, team) } : null,
    committees: office ? (await Committee.find({ team }).sort({ order: 1, name: 1 }).lean()).map((c) => ({ key: c.key, name: c.name, color: c.color, quorum: c.quorum })) : [],
    // Whether they see this team's vault: they keep it ({ keeper }), or a keeper gave them time ({ until })
    vault: req.previewing ? null : await vaultFor(req.user, team),
    // The church's screens: whether they manage them, and how many uploads wait for a look
    signage: managesSignage(req.user) ? { waiting: await SignageAsset.countDocuments({ status: 'pending' }) } : null,
    // Gear → Reports: how many problems and missing items are open, for AV's team leaders
    gearReports: isAvTeam(req.team) && (req.can.plans || isTeamLeader(req)) ? { open: await Issue.countDocuments({ status: 'open' }) } : null,
    office: officeSetup ? { rooms: officeSetup.rooms || [], remindMinutes: officeSetup.remindMinutes ?? 60, remindDays: officeSetup.remindDays ?? 1 } : null,
  });
}));

async function addableTeams(user, allTeams) {
  const out = [];
  for (const t of allTeams) {
    if (t.kind === 'office') {
      let ok = officePerms(user, t.key).people;
      // The admin can bring in the first person (to make them head leader) while there's no head yet
      if (!ok && user.role === 'admin') ok = !(await User.find({ 'teams.team': t.key }, { teams: 1 }).lean()).some((u) => membershipOf(u, t.key)?.head);
      if (ok) out.push({ key: t.key, name: t.name, ask: true });
    } else if (can(user, t.key).people) out.push({ key: t.key, name: t.name, ask: false });
  }
  return out;
}

async function invitesFor(user) {
  const list = user.teamInvites || [];
  if (!list.length) return [];
  const [teams, from] = await Promise.all([teamsList(), User.find({ _id: { $in: list.map((i) => i.from) } }, { name: 1 }).lean()]);
  return list
    .map((i) => ({ team: i.team, teamName: teams.find((t) => t.key === i.team)?.name || i.team, from: from.find((u) => String(u._id) === String(i.from))?.name || 'A leader', at: i.at }))
    .filter((i) => teams.some((t) => t.key === i.team));
}

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
  // My shifts cover every team I'm on; each shift says which team it's for
  const posTeam = await positionTeams();
  const teamOf = (pos) => posTeam[baseOf(pos)] || 'av';
  // Double bookings: every spot I hold at each service, named with its team
  const [plist, tlist] = await Promise.all([positionsList(), teamsList()]);
  const spot = (pos) => {
    const p = plist.find((x) => x.key === baseOf(pos));
    const t = tlist.find((x) => x.key === teamOf(pos));
    return `${p?.label || baseOf(pos)}${isShadow(pos) ? ' (shadowing)' : ''}${t ? ` (${t.name})` : ''}`;
  };
  const mySlots = {};
  for (const k of Object.keys(mine)) {
    const [eid, pos] = k.split('|');
    (mySlots[eid] ||= []).push(pos);
  }
  for (const e of events) {
    const eid = String(e._id);
    for (const pos of [...e.needs, ...e.needs.map((k) => `${k}+shadow`)]) {
      const key = `${eid}|${pos}`;
      const holder = slotHolder[key];
      if (holder === String(me._id)) {
        const a = mine[key];
        // A learner shadowing this spot, for a Lead (or the admin) to sign off
        const learner = !isShadow(pos) && (me.role === 'admin' || me.leads?.includes(pos)) ? slotHolder[`${eid}|${pos}+shadow`] || null : null;
        shifts.push({ ...eventView(e), position: baseOf(pos), slot: pos, shadow: isShadow(pos), team: teamOf(pos), alsoOn: (mySlots[eid] || []).filter((p) => p !== pos).map(spot), regular: a.viaRegular || '', confirmed: !!a.confirmedAt, away: isAway(eid) || unav.has(eid), pending: pending[key] || null, learner });
      } else if (!isShadow(pos) && !holder && me.positions.includes(pos) && !unav.has(eid) && !isAway(eid) && !onEvent[eid]) {
        pickups.push({ ...eventView(e), position: pos, team: teamOf(pos), pending: pending[key] === 'pickup' });
      }
    }
  }
  // Availability covers services one of my teams serves on (and my teams' rehearsals)
  const myTeams = new Set((me.teams || []).map((m) => m.team));
  const forMe = (e) => me.role === 'admin' || !myTeams.size || onEvent[String(e._id)] || (e.team ? myTeams.has(e.team) : (e.needs || []).some((k) => myTeams.has(teamOf(k))));
  const availability = events
    .filter((e) => e.date <= addDays(today, 56) && forMe(e))
    .map((e) => ({ ...eventView(e), unavailable: unav.has(String(e._id)), away: isAway(String(e._id)), onPosition: onEvent[String(e._id)] ? baseOf(onEvent[String(e._id)]) : null }));

  res.json({
    shifts,
    pickups,
    availability,
    blackouts: blackouts.map((b) => ({ id: String(b._id), from: b.from, to: b.to, note: b.note })),
    maxPerMonth: (me.teams || []).length ? Math.max(0, ...me.teams.map((t) => t.maxPerMonth || 0)) : me.maxPerMonth || 0,
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
  // Their own limit applies on each of their teams (a leader can set a team's limit separately)
  for (const t of req.user.teams || []) t.maxPerMonth = n;
  req.user.availabilityUpdatedAt = new Date();
  await req.user.save();
  res.locals.activity = n ? `Set a limit of ${n} shifts a month` : 'Removed their monthly limit';
  res.json({ maxPerMonth: n });
}));

// ---------- resources ----------
export const resourcesRouter = Router();
// Who sees a resource. Each level sees its own and everything below it.
const AUDIENCE = { all: 0, leaders: 1, heads: 2, admin: 3 };
const audienceOf = (r) => (r.audience in AUDIENCE ? r.audience : 'all');
// The viewer's level on the team they're working in (-1: not on it)
function resourceLevel(req) {
  if (req.user.role === 'admin') return AUDIENCE.admin;
  const m = membershipOf(req.user, req.team.key);
  if (!m) return -1;
  if (m.head) return AUDIENCE.heads;
  return m.role === 'leader' ? AUDIENCE.leaders : AUDIENCE.all;
}
const resourceTeamOf = (r) => r.team || 'av'; // older ones, from before teams, are AV's
const onThisTeam = (r, req) => r.everyTeam || resourceTeamOf(r) === req.team.key;
const seesResource = (r, req) => onThisTeam(r, req) && resourceLevel(req) >= AUDIENCE[audienceOf(r)];
// Changing one: the privilege, on its team (every-team ones are the admin's), and able to see it
const editsResource = (r, req) => can(req.user).resources && seesResource(r, req) && (r.everyTeam ? req.user.role === 'admin' : resourceTeamOf(r) === req.team.key);
const truthy = (v) => v === true || v === 'true' || v === '1' || v === 'on';

function resourceView(r, req) {
  return {
    id: String(r._id),
    title: r.title,
    url: r.url,
    position: r.position,
    kind: r.kind,
    minutes: r.minutes,
    audience: audienceOf(r),
    everyTeam: !!r.everyTeam,
    guide: !!r.guide,
    file: r.file?.stored ? { name: r.file.originalName, size: r.file.size, mime: r.file.mime } : null,
    updatedAt: r.updatedAt,
    canEdit: editsResource(r, req),
  };
}
function readResource(b, req, current = {}) {
  const title = str(b.title, 120);
  if (!title) throw bad('Give the resource a title.');
  const url = normalizeUrl(str(b.url, 1000));
  if (url && !isHttpUrl(url)) throw bad('That doesn’t look like a web address. Try something like academy.example.org or https://example.com/page');
  const audience = b.audience === undefined ? audienceOf(current) : String(b.audience);
  if (!(audience in AUDIENCE)) throw bad('Choose who can see it.');
  if (AUDIENCE[audience] > resourceLevel(req)) throw forbidden('You can only share a resource with people at your level or below.');
  const out = { title, url, position: str(b.position, 40), kind: str(b.kind, 30) || 'Link', minutes: Math.max(0, Math.min(600, Number(b.minutes) || 0)), audience };
  out.guide = b.guide === undefined ? !!current.guide : truthy(b.guide);
  // Only the admin puts something on every team
  out.everyTeam = req.user.role === 'admin' ? (b.everyTeam === undefined ? !!current.everyTeam : truthy(b.everyTeam)) : !!current.everyTeam;
  return out;
}
const fileOf = (f) => ({ stored: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size });
const AUDIENCE_WORDS = { all: '', leaders: ' for team leaders', heads: ' for head leaders', admin: ' for the admin' };

resourcesRouter.get('/', wrap(async (req, res) => {
  const filter = req.team.key === 'av' ? { $or: [{ team: 'av' }, { team: { $exists: false } }, { everyTeam: true }] } : { $or: [{ team: req.team.key }, { everyTeam: true }] };
  const list = (await Resource.find(filter).sort({ position: 1, title: 1 }).lean()).filter((r) => seesResource(r, req));
  res.json(list.map((r) => resourceView(r, req)));
}));
// A new resource: a link, or a file sent as form data (field "file")
resourcesRouter.post('/', requirePerm('resources'), uploader({ field: 'file', maxCount: 1 }), wrap(async (req, res) => {
  const files = filesOf(req);
  try {
    const b = { ...(req.body || {}) };
    if (!str(b.title, 120) && files[0]) b.title = originalName(files[0]).replace(/\.[a-z0-9]+$/i, '');
    const data = readResource(b, req);
    const r = await Resource.create({ ...data, url: files[0] ? '' : data.url, team: req.team.key, file: files[0] ? fileOf(files[0]) : undefined });
    res.locals.activity = `Added a resource${AUDIENCE_WORDS[r.audience]}`;
    res.status(201).json(resourceView(r, req));
  } catch (e) {
    removeUploads(files);
    throw e;
  }
}));
async function editableResource(req) {
  if (!isId(req.params.id)) throw notFound();
  const r = await Resource.findById(req.params.id);
  if (!r || !seesResource(r, req)) throw notFound();
  if (!editsResource(r, req)) throw forbidden(r.everyTeam ? 'Only the admin can change a resource shown on every team.' : 'You can’t change that resource.');
  return r;
}
resourcesRouter.patch('/:id', requirePerm('resources'), wrap(async (req, res) => {
  const r = await editableResource(req);
  const b = req.body || {};
  Object.assign(r, readResource({ ...r.toObject(), ...b }, req, r));
  if (truthy(b.removeFile) && r.file?.stored) {
    deleteStored(r.file.stored);
    r.file = undefined;
  }
  if (r.file?.stored) r.url = '';
  await r.save();
  res.locals.activity = 'Changed a resource';
  res.json(resourceView(r, req));
}));
// Put a file on a resource (replaces the one it had)
resourcesRouter.post('/:id/file', requirePerm('resources'), uploader({ field: 'file', maxCount: 1 }), wrap(async (req, res) => {
  const files = filesOf(req);
  try {
    if (!files[0]) throw bad('Choose a file.');
    const r = await editableResource(req);
    const old = r.file?.stored;
    r.file = fileOf(files[0]);
    r.url = '';
    await r.save();
    if (old) deleteStored(old);
    res.locals.activity = 'Uploaded a new file for a resource';
    res.json(resourceView(r, req));
  } catch (e) {
    removeUploads(files);
    throw e;
  }
}));
resourcesRouter.delete('/:id', requirePerm('resources'), wrap(async (req, res) => {
  const r = await editableResource(req);
  if (r.file?.stored) deleteStored(r.file.stored);
  await r.deleteOne();
  res.locals.activity = 'Removed a resource';
  res.status(204).end();
}));
// The file itself, only for people the resource is for. ?download=1 saves it instead of opening it.
resourcesRouter.get('/:id/file', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const r = await Resource.findById(req.params.id).lean();
  if (!r || !r.file?.stored || !seesResource(r, req)) throw notFound();
  sendStored(res, { storedName: r.file.stored, originalName: r.file.originalName || 'file', mime: r.file.mime || 'application/octet-stream' }, { download: req.query.download === '1' });
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
  if (b.calendarAlertDays !== undefined) s.calendarAlertDays = Math.max(0, Math.min(14, Math.round(Number(b.calendarAlertDays) || 0)));
  if (b.autoBuildWeeks !== undefined) s.autoBuildWeeks = Math.max(0, Math.min(12, Math.round(Number(b.autoBuildWeeks) || 0)));
  if (b.countryCode !== undefined) s.countryCode = String(b.countryCode).replace(/\D/g, '').slice(0, 4);
  if (b.idleMinutes !== undefined) {
    const n = Math.round(Number(b.idleMinutes) || 0);
    s.idleMinutes = n <= 0 ? 0 : Math.max(15, Math.min(720, n));
  }
  if (b.endOnBrowserClose !== undefined) s.endOnBrowserClose = !!b.endOnBrowserClose;
  if (b.streamFooter !== undefined) s.streamFooter = str(b.streamFooter, 2000);
  if (b.bulletinColor !== undefined) {
    const c = String(b.bulletinColor || '').trim().toLowerCase();
    if (c && !/^#[0-9a-f]{6}$/.test(c)) throw bad('Colours look like #1f3a5f.');
    s.bulletinColor = c;
  }
  if (b.bulletinFont !== undefined) {
    if (!['serif', 'sans'].includes(b.bulletinFont)) throw bad('Pick serif or sans for the bulletin.');
    s.bulletinFont = b.bulletinFont;
  }
  if (b.features !== undefined) {
    if (typeof b.features !== 'object' || !b.features) throw bad('Features must be on or off.');
    s.features = { ...(s.features || {}), ...Object.fromEntries(FEATURES.filter((k) => k in b.features).map((k) => [k, !!b.features[k]])) };
    s.markModified('features');
  }
  if (b.checklists !== undefined) {
    if (typeof b.checklists !== 'object' || !b.checklists) throw bad('Checklists are invalid.');
    const keys = new Set((await Position.find({}).lean()).map((p) => p.key));
    s.checklists = Object.fromEntries(
      Object.entries(b.checklists)
        .filter(([k, v]) => keys.has(k) && Array.isArray(v))
        .map(([k, v]) => [k, [...new Set(v.map((x) => str(x, 120)).filter(Boolean))].slice(0, 30)])
        .filter(([, v]) => v.length)
    );
    s.markModified('checklists');
  }
  if (b.burnoutWeeks !== undefined) {
    const n = Number(b.burnoutWeeks);
    if (!Number.isInteger(n) || n < 0 || n > 12) throw bad('Weekends in a row must be 0 (off) to 12.');
    s.burnoutWeeks = n;
  }
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
  forgetSessionRules();
  res.json(settingsView(s));
}));

// Sign everyone except the admin out on every device
// Church logo for the bulletin (PNG, JPEG or WebP, up to 3 MB)
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
settingsRouter.post('/logo', requireAdmin, uploader({ field: 'file', maxCount: 1 }), wrap(async (req, res) => {
  const [f] = filesOf(req);
  if (!f) throw bad('Choose an image.');
  if (!LOGO_TYPES.includes(f.mimetype) || f.size > 3 * 1024 * 1024) {
    removeUploads([f]);
    throw bad('Use a PNG, JPEG or WebP image up to 3 MB.');
  }
  const s = await getSettings();
  if (s.logo) deleteStored(s.logo);
  s.logo = f.filename;
  s.logoAt = new Date();
  await s.save();
  res.locals.activity = 'Changed the bulletin logo';
  res.json(settingsView(s));
}));
settingsRouter.delete('/logo', requireAdmin, wrap(async (req, res) => {
  const s = await getSettings();
  if (s.logo) deleteStored(s.logo);
  s.logo = '';
  s.logoAt = null;
  await s.save();
  res.locals.activity = 'Removed the bulletin logo';
  res.json(settingsView(s));
}));

settingsRouter.post('/sign-out-everyone', requireAdmin, wrap(async (req, res) => {
  const n = await signOutUsers({ _id: { $ne: req.user._id } });
  await logActivity({ user: req.user, kind: 'system', action: `Signed everyone else out on all devices (${n} account${n === 1 ? '' : 's'})`, req });
  res.json({ signedOut: n });
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

// Each team's head leader (and the admin) manages that team's positions
export const positionsRouter = Router();
const posOut = (p) => ({ key: p.key, label: p.label, order: p.order, team: p.team || 'av' });
async function loadTeamPosition(req) {
  const p = await Position.findOne({ key: req.params.key });
  if (!p) throw notFound();
  if ((p.team || 'av') !== req.team.key) throw forbidden('That position belongs to another team.');
  return p;
}
positionsRouter.post('/', requireTeamHead, wrap(async (req, res) => {
  const label = str(req.body.label, 40);
  if (!label) throw bad('Name the position.');
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'pos';
  let key = base;
  for (let i = 2; await Position.findOne({ key }); i++) key = `${base}-${i}`;
  const count = await Position.countDocuments({});
  const p = await Position.create({ key, label, order: count, team: req.team.key });
  forgetPositions();
  res.locals.activity = `Added the position ${label} (${req.team.name})`;
  res.status(201).json(posOut(p));
}));
positionsRouter.patch('/:key', requireTeamHead, wrap(async (req, res) => {
  const p = await loadTeamPosition(req);
  if (req.body.label !== undefined) {
    const label = str(req.body.label, 40);
    if (!label) throw bad('Name the position.');
    p.label = label;
  }
  if (req.body.order !== undefined) p.order = Number(req.body.order) || 0;
  await p.save();
  forgetPositions();
  res.json(posOut(p));
}));
positionsRouter.delete('/:key', requireTeamHead, wrap(async (req, res) => {
  const key = (await loadTeamPosition(req)).key;
  if (await Event.findOne({ needs: key })) throw conflict('Some services still use this position. Remove it from them first.');
  await Position.deleteOne({ key });
  await User.updateMany({}, { $pull: { positions: key, trainee: key, leads: key } });
  const s = await getSettings();
  s.weekendTemplate = s.weekendTemplate.map((t) => ({ ...t.toObject(), needs: t.needs.filter((k) => k !== key) }));
  await s.save();
  forgetPositions();
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
  // One feed: your shifts (with reminders), plus every other service and rehearsal from
  // 30 days ago to 4 months ahead, each with who's serving on every team.
  const today = todayIn(s.timezone);
  const since = addDays(today, -30);
  const [positions, teams, events] = await Promise.all([
    positionsList(),
    teamsList(),
    Event.find({ date: { $gte: since, $lte: addDays(today, 120) } }).populate('groups', 'name').sort({ date: 1, start: 1 }).lean(),
  ]);
  const base = Object.fromEntries(positions.map((p) => [p.key, p.label]));
  const label = new Proxy(base, { get: (t, k) => (isShadow(k) ? `${t[baseOf(k)] || baseOf(k)} (shadowing)` : t[k]) });
  const teamOfPos = Object.fromEntries(positions.map((p) => [p.key, p.team || 'av']));
  const teamName = Object.fromEntries(teams.map((t) => [t.key, t.name]));
  const order = Object.fromEntries(positions.map((p, i) => [p.key, i]));
  const allAsg = await Assignment.find({ event: { $in: events.map((e) => e._id) } }).populate('user', 'name').lean();
  const asgBy = {};
  for (const a of allAsg) if (a.user) (asgBy[String(a.event)] ||= []).push(a);
  // Who's serving, team by team: [{ team, rows: [{ label, name, you }] }]
  const lineupOf = (e) => {
    const rows = (asgBy[String(e._id)] || []).slice().sort((a, b) => (order[baseOf(a.position)] ?? 99) - (order[baseOf(b.position)] ?? 99) || isShadow(a.position) - isShadow(b.position));
    return teams
      .map((t) => ({
        team: t.name,
        rows: rows.filter((a) => (teamOfPos[baseOf(a.position)] || 'av') === t.key).map((a) => ({ label: label[a.position] || a.position, name: a.user.name, you: String(a.user._id) === String(user._id) })),
      }))
      .filter((t) => t.rows.length);
  };
  const spotName = (pos) => `${label[pos] || pos}${teams.length > 1 && teamName[teamOfPos[baseOf(pos)] || 'av'] ? ` (${teamName[teamOfPos[baseOf(pos)] || 'av']})` : ''}`;
  const notices = {};
  const items = [];
  // People only on Church Admin don't get services and rehearsals, just their own calendar
  const serviceSide = await onServiceTeam(user);
  for (const e of events) {
    if (!serviceSide && !(asgBy[String(e._id)] || []).some((a) => String(a.user._id) === String(user._id))) continue;
    const mine = (asgBy[String(e._id)] || []).filter((a) => String(a.user._id) === String(user._id));
    const lineup = lineupOf(e);
    for (const a of mine) {
      if (!notices[e.date]) notices[e.date] = await noticeLinesFor(e.date);
      items.push({
        notices: notices[e.date],
        uid: `${e._id}-${a.position}-${user._id}@crew-call`,
        event: e,
        positionLabel: label[a.position] || a.position,
        teamName: teams.length > 1 ? teamName[teamOfPos[baseOf(a.position)] || 'av'] || '' : '',
        confirmed: !!a.confirmedAt,
        // Double-booked: their other spots at this same service
        alsoOn: mine.filter((o) => o.position !== a.position).map((o) => spotName(o.position)),
        lineup,
        groups: (e.groups || []).map((g) => g?.name).filter(Boolean).join(', '),
        updatedAt: a.updatedAt,
        viaRegular: a.viaRegular || '',
      });
    }
    if (!mine.length) items.push({ uid: `${e._id}-info-${user._id}@crew-call`, event: e, lineup, teamName: teamName[e.team] || '', updatedAt: e.updatedAt });
  }
  // Church Admin items: everything the person can see on the teams they're on, plus church events
  // shared with every team. Meetings they're invited to get reminders.
  const officeTeams = teams.filter(isOfficeTeam);
  if (officeTeams.length) {
    const evs = await OfficeEvent.find({ team: { $in: officeTeams.map((t) => t.key) }, date: { $gte: since, $lte: addDays(today, 180) } }).sort({ date: 1, start: 1 }).lean();
    for (const ev of evs) {
      if (!seesOffice(user, ev)) continue;
      const t = officeTeams.find((x) => x.key === ev.team);
      const member = !!(user.teams || []).find((m) => m.team === ev.team);
      if (!member && ev.needsAv && serviceSide) continue; // already on the AV schedule as a service
      const m = (user.teams || []).find((x) => x.team === ev.team);
      const invited = member && (ev.attendees?.length ? ev.attendees.some((a) => String(a.user) === String(user._id)) : !(ev.committees || []).length || (m?.committees || []).some((k) => ev.committees.includes(k)));
      const rsvp = (ev.rsvps || []).find((r) => String(r.user) === String(user._id))?.status;
      items.push({ office: true, uid: `${ev._id}-office-${user._id}@crew-call`, event: ev, teamName: t?.name || 'Church Admin', invited: invited && rsvp !== 'no', remindMinutes: t?.remindMinutes ?? 60, remindDays: t?.remindDays ?? 1, updatedAt: ev.updatedAt });
    }
  }
  const body = buildCalendar({ name: `${s.orgName} — ${user.name.split(' ')[0]}’s calendar`, tz: s.timezone, items, link: `${config.publicUrl}/#mine`, alertDays: s.calendarAlertDays ?? 5 });
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache, max-age=0', 'Content-Disposition': 'inline; filename="shifts.ics"' });
  res.send(body);
}));
