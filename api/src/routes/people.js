import { Router } from 'express';
import { config } from '../config.js';
import { Assignment, Event, PERMS, Position, Request, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { addDays, bad, conflict, forbidden, getSettings, isId, normalizePhone, notFound, str, todayIn, token, wrap } from '../lib/util.js';
import { personView } from '../lib/views.js';
import { cleanRegulars } from '../lib/regulars.js';

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
  const filter = req.can.people ? {} : { active: true };
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
  if (await User.findOne({ email })) throw conflict('Someone with that email is already on the team.');
  const user = new User({
    name,
    email,
    phone: normalizePhone(req.body.phone, s.countryCode),
    positions: await cleanPositions(req.body.positions),
    calToken: token(),
  });
  freshInvite(user);
  await user.save();
  res.locals.activity = `Added ${user.name} to the team`;
  res.status(201).json({ person: personView(user, req.user), inviteUrl: inviteUrl(user.inviteToken) });
}));

async function loadEditable(req) {
  if (!isId(req.params.id)) throw notFound();
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('That person no longer exists.');
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && user.role !== 'crew' && String(user._id) !== String(req.user._id)) {
    throw forbidden('Only the admin can change team leaders.');
  }
  return user;
}

peopleRouter.patch('/:id', requirePerm('people'), wrap(async (req, res) => {
  const user = await loadEditable(req);
  const isAdmin = req.user.role === 'admin';
  const s = await getSettings();
  const b = req.body;

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
  if (b.positions !== undefined) user.positions = await cleanPositions(b.positions);
  if (b.trainee !== undefined) user.trainee = await cleanPositions(b.trainee);
  if (b.regulars !== undefined) {
    const keys = new Set((await Position.find({}).lean()).map((p) => p.key));
    user.regulars = cleanRegulars(b.regulars, keys);
  }
  if (b.maxPerMonth !== undefined) user.maxPerMonth = Math.max(0, Math.min(31, Math.round(Number(b.maxPerMonth) || 0)));

  // Admin-only: roles, leader titles, leader privileges.
  if (b.role !== undefined || b.leaderTitle !== undefined || b.perms !== undefined) {
    if (!isAdmin) throw forbidden('Only the admin can change roles and privileges.');
    if (user.role === 'admin') throw bad('The admin’s role can’t be changed here.');
    if (b.role !== undefined) {
      if (!['leader', 'crew'].includes(b.role)) throw bad('Pick crew member or team leader.');
      if (b.role === 'leader' && user.role !== 'leader') {
        user.perms = { edit: true, approve: true, message: true, resources: false, people: false, groups: false, plans: true };
        if (!user.leaderTitle) user.leaderTitle = 'Team leader';
      }
      user.role = b.role;
    }
    if (b.leaderTitle !== undefined) user.leaderTitle = str(b.leaderTitle, 60);
    if (b.perms && typeof b.perms === 'object') {
      for (const p of PERMS) if (b.perms[p] !== undefined) user.perms[p] = !!b.perms[p];
    }
  }

  if (b.active !== undefined && !!b.active !== user.active) {
    if (user.role === 'admin') throw bad('The admin can’t be deactivated.');
    if (String(user._id) === String(req.user._id)) throw bad('You can’t deactivate yourself.');
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
  res.locals.activity = `Edited ${user.name}`;
  res.json(personView(user, req.user));
}));

// GET /api/people/load — shifts per person: last 90 days, next 60 days
peopleRouter.get('/load', wrap(async (req, res) => {
  if (!req.can.people && !req.can.edit) throw forbidden();
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const events = await Event.find({ date: { $gte: addDays(today, -90), $lte: addDays(today, 60) } }, { _id: 1, date: 1 }).lean();
  const dateOf = Object.fromEntries(events.map((e) => [String(e._id), e.date]));
  const asg = await Assignment.find({ event: { $in: events.map((e) => e._id) } }, { user: 1, event: 1, position: 1 }).lean();
  const out = {};
  for (const a of asg) {
    if (a.position.endsWith('+shadow')) continue;
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
