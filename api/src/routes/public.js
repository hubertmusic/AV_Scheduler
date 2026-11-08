// Public pages opened from a link or QR code, no sign-in: the service rundown (platform and crew)
// and the congregation's bulletin. Each has its own unguessable link; a leader can replace it.
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import rateLimit from 'express-rate-limit';
import { Event, Plan } from '../models.js';
import { getSettings, notFound, wrap } from '../lib/util.js';
import { bulletinData, rundownData } from '../lib/serviceOrder.js';

export const publicRouter = Router();

publicRouter.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => String(req.headers['cf-connecting-ip'] || req.ip),
    validate: { xForwardedForHeader: false },
    message: { error: 'Too many requests. Wait a few minutes and try again.' },
  })
);

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const GONE = 'This link doesn’t work any more. Ask the team for the new one.';

// The church logo shown on the bulletin
publicRouter.get('/logo', wrap(async (req, res) => {
  const s = await getSettings();
  if (!s.logo || !/^[\w.-]+$/.test(s.logo)) throw notFound();
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(path.join(config.uploadDir, s.logo), (err) => err && !res.headersSent && res.status(404).end());
}));

async function find(field, token) {
  if (!TOKEN_RE.test(token || '')) throw notFound(GONE);
  const plan = await Plan.findOne({ [field]: token });
  const ev = plan ? await Event.findById(plan.event).lean() : null;
  if (!ev) throw notFound(GONE);
  const s = await getSettings();
  return { plan, ev, orgName: s.orgName || '', logo: s.logo ? `/api/public/logo?v=${s.logoAt ? s.logoAt.getTime() : 0}` : '' };
}

publicRouter.get('/rundown/:token', wrap(async (req, res) => {
  const { plan, ev, orgName } = await find('rundownToken', req.params.token);
  res.set('Cache-Control', 'no-store');
  res.json(await rundownData(plan, ev, orgName));
}));

publicRouter.get('/bulletin/:token', wrap(async (req, res) => {
  const { plan, ev, orgName, logo } = await find('bulletinToken', req.params.token);
  res.set('Cache-Control', 'no-store');
  res.json({ ...(await bulletinData(plan, ev, orgName)), logo });
}));
