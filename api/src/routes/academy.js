import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models.js';
import { token, wrap } from '../lib/util.js';
import { logActivity } from '../lib/activity.js';

// Signs crew into Booth Crew Academy with their Crew Call account.
// Crew Call hands the Academy a short-lived, single-use signed pass; the Academy
// checks it with the shared secret, links or creates the person's account, and
// starts their session. No password is shared between the apps.

export const academyRouter = Router();
const COOKIE = 'cc_session';

// Only paths on the Academy itself, never another site.
export function safeAcademyPath(to) {
  const s = String(to || '/').slice(0, 300);
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\s]/.test(s)) return '/';
  return s;
}

export function academyPass(user, to) {
  return jwt.sign(
    {
      email: user.email,
      name: user.name,
      to: safeAcademyPath(to),
    },
    config.academySecret,
    { algorithm: 'HS256', expiresIn: 60, issuer: 'crew-call', audience: 'booth-crew-academy', subject: String(user._id), jwtid: token(18) }
  );
}

async function signedInUser(req) {
  const t = req.cookies?.[COOKIE];
  if (!t) return null;
  try {
    const { uid } = jwt.verify(t, config.jwtSecret);
    const user = await User.findById(uid);
    return user && user.active && user.passwordHash ? user : null;
  } catch {
    return null;
  }
}

// GET /api/academy/go?to=/lesson/foh-1 — a normal link (opened in a tab), not a fetch.
academyRouter.get('/go', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const to = safeAcademyPath(req.query.to);
  if (!config.academyOn) return res.redirect(302, '/#resources');
  const user = await signedInUser(req);
  if (!user) return res.redirect(302, `/?academy=${encodeURIComponent(to)}`);
  if (user.role !== 'admin') logActivity({ user, kind: 'view', page: 'academy', action: 'Opened Booth Crew Academy', req });
  const pass = academyPass(user, to);
  res.redirect(302, `${config.academyUrl}/sso/crew-call?pass=${encodeURIComponent(pass)}`);
}));
