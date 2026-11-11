import { Router } from 'express';
import { config } from '../config.js';
import { Assignment, Event, PERMS, Position, Request, User } from '../models.js';
import { requireAdmin, requirePerm, signOutUsers } from '../auth.js';
import { logActivity } from '../lib/activity.js';
import { addDays, bad, conflict, forbidden, getSettings, isId, normalizePhone, notFound, str, todayIn, token, wrap } from '../lib/util.js';
import { personView } from '../lib/views.js';
import { cleanRegulars } from '../lib/regulars.js';
import { applyRegularsFor } from '../lib/regularsAuto.js';
import { currentStreaks } from '../lib/streaks.js';
import { baseKey, isAvTeam, isTeamHead, mergeTeam, teamKeys } from '../lib/teams.js';
import { membershipOf } from '../lib/util.js';

const LEADER_PERMS = { edit: true, approve: true, message: true, resources: false, people: false, groups: false, plans: true };

export const peopleRouter = Router();

const INVITE_DAYS = 14;
const inviteUrl = (t) => `${config.publicUrl}/invite/${t}`;

function freshInvite(user) {
  user.inviteToken = token();
  user.inviteExpires = new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000);
}

async function cleanPositions(list) {
  const keys = new Set((await Position.find({}).lean()).map((p) => p.key));
  return Array.isArray(list) ? [...new Set(list.filter((k) => keys.has(k)))] : [];
}

peopleRouter.get('/', wrap(async (req, res) => {
  const filter = { 'teams.team': req.team.key, ...(req.can.people ? {} : { active: true }) };
  const people = await User.find(filter).sort({ active: -1, name: 1 });
  res.json(people.map((p) => personView(p, req.user)));
}));

// Add someone and get an invite link to send them.
peopleRouter.post('/', requirePerm('people'), wrap(async (req, res) => {
  const s = await getSettings();
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 200).toLowerCase();
  if (!name) throw bad('Enter a name.');
  if (!email.includes('@')) throw bad('Enter an email address; it’s what they sign in with.');
  const keys = await teamKeys(req);
  const positions = (await cleanPositions(req.body.positions)).filter((k) => keys.has(k));
  const existing = await User.findOne({ email });
  if (existing) {
    // Already on another team: add them to this one too (same login, one calendar)
    if (membershipOf(existing, req.team.key) || existing.role === 'admin') throw conflict(`${existing.name} is already on the ${req.team.name}.`);
    if (!existing.active) throw conflict(`${existing.name} has been deactivated. Ask the admin to reactivate them first.`);
    existing.teams.push({ team: req.team.key, role: 'crew' });
    existing.positions = mergeTeam(existing.positions, positions, keys);
    await existing.save();
    res.locals.activity = `Added ${existing.name} to the ${req.team.name}`;
    return res.status(201).json({ person: personView(existing, req.user), joined: true, inviteUrl: existing.passwordHash ? null : inviteUrl(existing.inviteToken) });
  }
  const user = new User({
    name,
    email,
    phone: normalizePhone(req.body.phone, s.countryCode),
    positions,
    teams: [{ team: req.team.key, role: 'crew' }],
    calToken: token(),
  });
  freshInvite(user);
  await user.save();
  res.locals.activity = `Added ${user.name} to the ${req.team.name}`;
  res.status(201).json({ person: personView(user, req.user), inviteUrl: inviteUrl(user.inviteToken) });
}));

async function loadEditable(req) {
  if (!isId(req.params.id)) throw notFound();
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('That person no longer exists.');
  const isSelf = String(user._id) === String(req.user._id);
  if (user.role === 'admin' && !isSelf && req.user.role !== 'admin') throw forbidden();
  if (user.role !== 'admin' && !membershipOf(user, req.team.key)) throw notFound(`${user.name} isn’t on the ${req.team.name}.`);
  // Leaders are changed by the admin or the team's head leader
  const m = membershipOf(user, req.team.key);
  if (!isSelf && !isTeamHead(req) && (m?.role === 'leader' || m?.head)) throw forbidden('Only the admin or this team’s head leader can change team leaders.');
  return user;
}

// Admin: sign one person out on every device
peopleRouter.post('/:id/sign-out', requireAdmin, wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const user = await User.findById(req.params.id);
  if (!user) throw notFound();
  await signOutUsers({ _id: user._id });
  await logActivity({ user: req.user, kind: 'system', action: `Signed ${user.name} out on all devices`, req });
  res.status(204).end();
}));

peopleRouter.patch('/:id', requirePerm('people'), wrap(async (req, res) => {
  const user = await loadEditable(req);
  const isAdmin = req.user.role === 'admin';
  const head = isTeamHead(req);
  const s = await getSettings();
  const b = req.body;
  const keys = await teamKeys(req);
  const m = membershipOf(user, req.team.key); // null for the admin's own record on another team

  if (b.name !== undefined) {
    const name = str(b.name, 80);
    if (!name) throw bad('Name can’t be empty.');
    user.name = name;
  }
  if (b.email !== undefined) {
    const email = str(b.email, 200).toLowerCase();
    if (!email.includes('@')) throw bad('Enter a valid email.');
    const other = await User.findOne({ email, _id: { $ne: user._id } });
    if (other) throw conflict('Someone else already uses that email.');
    user.email = email;
  }
  if (b.phone !== undefined) user.phone = normalizePhone(b.phone, s.countryCode);
  // Positions on this team only; their positions on other teams stay as they are
  if (b.positions !== undefined) user.positions = mergeTeam(user.positions, await cleanPositions(b.positions), keys);
  if (b.trainee !== undefined) user.trainee = mergeTeam(user.trainee, await cleanPositions(b.trainee), keys);
  if (b.leads !== undefined) user.leads = mergeTeam(user.leads, await cleanPositions(b.leads), keys);
  user.leads = (user.leads || []).filter((k) => user.positions.includes(k)); // Lead only where trained
  let regularsChanged = false;
  if (b.regulars !== undefined) {
    const keys = new Set((await Position.find({}).lean()).map((p) => p.key));
    const before = JSON.stringify(user.regulars || []);
    user.regulars = cleanRegulars(b.regulars, keys);
    regularsChanged = JSON.stringify(user.regulars) !== before;
  }
  if (b.maxPerMonth !== undefined) {
    const n = Math.max(0, Math.min(31, Math.round(Number(b.maxPerMonth) || 0)));
    if (m) m.maxPerMonth = n; // per team
    else user.maxPerMonth = n;
  }

  // Roles on this team: the admin or the team's head leader (who change as leaders are elected)
  if (b.role !== undefined || b.leaderTitle !== undefined || b.perms !== undefined) {
    if (!head) throw forbidden('Only the admin or this team’s head leader can change roles and privileges.');
    if (user.role === 'admin') throw bad('The admin’s role can’t be changed here.');
    if (!m) throw bad(`${user.name} isn’t on the ${req.team.name}.`);
    if (m.head && !isAdmin) throw forbidden('Only the admin can change the head leader.');
    if (b.role !== undefined) {
      if (!['leader', 'crew'].includes(b.role)) throw bad('Pick crew member or team leader.');
      if (b.role === 'leader' && m.role !== 'leader') {
        m.perms = { ...LEADER_PERMS };
        if (!m.title) m.title = 'Team leader';
      }
      if (b.role === 'crew') m.head = false;
      m.role = b.role;
    }
    if (b.leaderTitle !== undefined) m.title = str(b.leaderTitle, 60);
    if (b.perms && typeof b.perms === 'object') {
      for (const p of PERMS) if (b.perms[p] !== undefined) m.perms[p] = !!b.perms[p];
    }
    user.markModified('teams');
  }

  // Take someone off this team (they keep their login and any other teams)
  if (b.onTeam === false && m) {
    if (!head) throw forbidden('Only the admin or this team’s head leader can take someone off the team.');
    if (m.head && !isAdmin) throw forbidden('Only the admin can change the head leader.');
    const today = todayIn(s.timezone);
    const upcoming = await Event.find({ date: { $gte: today } }, { _id: 1 }).lean();
    const slots = [...keys, ...[...keys].map((k) => `${k}+shadow`)];
    await Assignment.deleteMany({ user: user._id, event: { $in: upcoming.map((e) => e._id) }, position: { $in: slots } });
    user.teams = user.teams.filter((t) => t.team !== req.team.key);
    user.positions = mergeTeam(user.positions, [], keys);
    user.trainee = mergeTeam(user.trainee, [], keys);
    user.leads = mergeTeam(user.leads, [], keys);
  }

  if (b.active !== undefined && !!b.active !== user.active) {
    if (user.role === 'admin') throw bad('The admin can’t be deactivated.');
    if (String(user._id) === String(req.user._id)) throw bad('You can’t deactivate yourself.');
    if (!isAdmin && (user.teams || []).length > 1) throw forbidden(`${user.name} is on more than one team, so only the admin can deactivate them. You can take them off the ${req.team.name} instead.`);
    user.active = !!b.active;
    if (!user.active) {
      // Free up their upcoming shifts and close their open requests.
      const today = todayIn(s.timezone);
      const upcoming = await Event.find({ date: { $gte: today } }, { _id: 1 }).lean();
      await Assignment.deleteMany({ user: user._id, event: { $in: upcoming.map((e) => e._id) } });
      await Request.updateMany(
        { status: 'pending', $or: [{ from: user._id }, { targetUser: user._id }] },
        { status: 'cancelled', reason: 'Person was deactivated.', decidedAt: new Date() }
      );
    }
  }
  await user.save();
  res.locals.activity = b.onTeam === false ? `Took ${user.name} off the ${req.team.name}` : `Edited ${user.name}`;
  // A new or changed regular schedule puts them on the weekends already built.
  const regularsPlaced = regularsChanged && user.active ? await applyRegularsFor(user._id) : 0;
  res.json({ ...personView(user, req.user), regularsPlaced });
}));

// GET /api/people/load — shifts per person: last 90 days, next 60 days
peopleRouter.get('/load', wrap(async (req, res) => {
  if (!req.can.people && !req.can.edit) throw forbidden();
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const events = await Event.find({ date: { $gte: addDays(today, -90), $lte: addDays(today, 60) } }, { _id: 1, date: 1 }).lean();
  const dateOf = Object.fromEntries(events.map((e) => [String(e._id), e.date]));
  const asg = await Assignment.find({ event: { $in: events.map((e) => e._id) } }, { user: 1, event: 1, position: 1 }).lean();
  const keys = await teamKeys(req);
  const out = {};
  for (const a of asg) {
    if (a.position.endsWith('+shadow') || !keys.has(baseKey(a.position))) continue;
    const d = dateOf[String(a.event)];
    const u = (out[String(a.user)] ||= { past90: 0, upcoming: 0, last: null, next: null });
    if (d < today) {
      u.past90++;
      if (!u.last || d > u.last) u.last = d;
    } else {
      u.upcoming++;
      if (!u.next || d < u.next) u.next = d;
    }
  }
  // Burnout watch: weekends in a row (AV only)
  if (isAvTeam(req.team)) for (const [uid, n] of Object.entries(await currentStreaks(today))) (out[uid] ||= { past90: 0, upcoming: 0, last: null, next: null }).streak = n;
  res.json(out);
}));

// New invite link — for someone who hasn't signed up yet, or (admin only) a password reset.
peopleRouter.post('/:id/invite', requirePerm('people'), wrap(async (req, res) => {
  const user = await loadEditable(req);
  if (!user.active) throw bad('Reactivate this person first.');
  if (user.passwordHash && req.user.role !== 'admin') throw forbidden('Only the admin can reset someone’s password.');
  if (user.role === 'admin' && String(user._id) !== String(req.user._id)) throw forbidden();
  freshInvite(user);
  await user.save();
  res.json({ inviteUrl: inviteUrl(user.inviteToken), reset: !!user.passwordHash });
}));
