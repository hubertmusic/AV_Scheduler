import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { User, Position, Settings } from './models.js';
import { bad, can, isId, DEFAULT_POSITIONS, DEFAULT_TEMPLATE, forbidden, getSettings, HttpError, normalizePhone, str, token, wrap } from './lib/util.js';
import { meView } from './lib/views.js';
import { deviceFrom, logActivity, touchSeen } from './lib/activity.js';

const COOKIE = 'cc_session';
const MAX_AGE = 30 * 24 * 3600 * 1000;

function setSession(res, user) {
  const t = jwt.sign({ uid: String(user._id) }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: MAX_AGE, path: '/' });
}

// Loads the signed-in user into req.user, or answers 401.
export const requireAuth = wrap(async (req, res, next) => {
  const t = req.cookies?.[COOKIE];
  if (!t) throw new HttpError(401, 'Please sign in.');
  let payload;
  try {
    payload = jwt.verify(t, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Your session expired. Please sign in again.');
  }
  const user = await User.findById(payload.uid);
  if (!user || !user.active || !user.passwordHash) throw new HttpError(401, 'Please sign in.');
  req.user = user;
  req.can = can(user);
  await touchSeen(user);
  // "View as": the admin can look at the app exactly as one person sees it.
  // Read-only: any change is refused while previewing.
  const viewAs = req.get('x-view-as');
  if (viewAs && user.role === 'admin' && viewAs !== String(user._id)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(403, 'You’re previewing someone else’s view, so nothing can be changed. Exit the preview first.');
    }
    const target = isId(viewAs) ? await User.findById(viewAs) : null;
    if (!target) throw new HttpError(404, 'That person no longer exists. Exit the preview.');
    req.realUser = user;
    req.user = target;
    req.can = can(target);
    req.previewing = true;
  }
  next();
});

// Records a successful sign-in for the admin's activity view.
async function noteLogin(user, req, how) {
  user.lastLoginAt = new Date();
  user.lastSeenAt = user.lastLoginAt;
  user.lastDevice = deviceFrom(req.headers['user-agent']);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt, lastSeenAt: user.lastSeenAt, lastDevice: user.lastDevice } });
  await logActivity({ user, kind: 'login', action: how, req });
}

export const requirePerm = (perm) => (req, res, next) => (req.can?.[perm] ? next() : next(forbidden()));
export const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : next(forbidden('Only the admin can do that.')));

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Use a password of at least 8 characters.');
  if (pw.length > 200) throw bad('That password is too long.');
}

// Only failed attempts count. Behind a Cloudflare Tunnel every request reaches us
// from the tunnel's address, so key on the visitor's address Cloudflare passes along.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.headers['cf-connecting-ip'] || req.ip),
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

export const authRouter = Router();

authRouter.get('/status', wrap(async (req, res) => {
  const count = await User.countDocuments({});
  const s = count ? await getSettings() : null;
  res.json({ needsSetup: count === 0, orgName: s?.orgName || '' });
}));

// First run only: creates the admin account, default positions and weekend template.
authRouter.post('/setup', loginLimiter, wrap(async (req, res) => {
  if ((await User.countDocuments({})) > 0) throw forbidden('Setup has already been completed.');
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 200).toLowerCase();
  const orgName = str(req.body.orgName, 80) || 'AV Crew';
  if (!name || !email.includes('@')) throw bad('Enter your name and email.');
  checkPassword(req.body.password);
  if ((await Position.countDocuments({})) === 0) await Position.insertMany(DEFAULT_POSITIONS);
  const s = await getSettings();
  s.orgName = orgName;
  if (!s.weekendTemplate.length) s.weekendTemplate = DEFAULT_TEMPLATE;
  await s.save();
  const user = await User.create({
    name,
    email,
    phone: normalizePhone(req.body.phone, s.countryCode),
    passwordHash: await bcrypt.hash(req.body.password, 12),
    role: 'admin',
    leaderTitle: 'Admin',
    positions: DEFAULT_POSITIONS.map((p) => p.key),
    calToken: token(),
  });
  setSession(res, user);
  await noteLogin(user, req, 'Set up Crew Call');
  res.status(201).json({ me: meView(user) });
}));

authRouter.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const user = await User.findOne({ email });
  const ok = user && user.active && user.passwordHash && (await bcrypt.compare(String(req.body.password || ''), user.passwordHash));
  if (!ok) {
    if (user) await logActivity({ user, kind: 'login-failed', action: 'Wrong password at sign-in', req });
    throw new HttpError(401, 'That email and password don’t match.');
  }
  setSession(res, user);
  await noteLogin(user, req, 'Signed in');
  res.json({ me: meView(user) });
}));

authRouter.post('/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});

authRouter.get('/invite/:token', wrap(async (req, res) => {
  const user = await User.findOne({ inviteToken: req.params.token, active: true });
  if (!user || !user.inviteExpires || user.inviteExpires < new Date()) throw new HttpError(404, 'This invite link has expired. Ask your team leader for a new one.');
  const s = await getSettings();
  res.json({ name: user.name, email: user.email, orgName: s.orgName });
}));

authRouter.post('/invite/:token', loginLimiter, wrap(async (req, res) => {
  const user = await User.findOne({ inviteToken: req.params.token, active: true });
  if (!user || !user.inviteExpires || user.inviteExpires < new Date()) throw new HttpError(404, 'This invite link has expired. Ask your team leader for a new one.');
  checkPassword(req.body.password);
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.inviteToken = undefined;
  user.inviteExpires = undefined;
  if (!user.calToken) user.calToken = token();
  await user.save();
  setSession(res, user);
  await noteLogin(user, req, 'Accepted their invite and set a password');
  res.json({ me: meView(user) });
}));

export const accountRouter = Router();

accountRouter.post('/password', wrap(async (req, res) => {
  const ok = await bcrypt.compare(String(req.body.current || ''), req.user.passwordHash);
  if (!ok) throw bad('Your current password isn’t right.');
  checkPassword(req.body.password);
  req.user.passwordHash = await bcrypt.hash(req.body.password, 12);
  await req.user.save();
  res.status(204).end();
}));

accountRouter.patch('/', wrap(async (req, res) => {
  const s = await getSettings();
  if (req.body.name !== undefined) {
    const name = str(req.body.name, 80);
    if (!name) throw bad('Name can’t be empty.');
    req.user.name = name;
  }
  if (req.body.phone !== undefined) req.user.phone = normalizePhone(req.body.phone, s.countryCode);
  await req.user.save();
  res.json({ me: meView(req.user) });
}));

accountRouter.post('/calendar/reset', wrap(async (req, res) => {
  req.user.calToken = token();
  await req.user.save();
  res.json({ me: meView(req.user) });
}));
