// Public pages opened from a link or QR code, no sign-in: the service rundown (platform and crew)
// and the congregation's bulletin. Each has its own unguessable link; a leader can replace it.
import { Router } from 'express';
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

async function find(field, token) {
  if (!TOKEN_RE.test(token || '')) throw notFound(GONE);
  const plan = await Plan.findOne({ [field]: token });
  const ev = plan ? await Event.findById(plan.event).lean() : null;
  if (!ev) throw notFound(GONE);
  return { plan, ev, orgName: (await getSettings()).orgName || '' };
}

publicRouter.get('/rundown/:token', wrap(async (req, res) => {
  const { plan, ev, orgName } = await find('rundownToken', req.params.token);
  res.set('Cache-Control', 'no-store');
  res.json(await rundownData(plan, ev, orgName));
}));

publicRouter.get('/bulletin/:token', wrap(async (req, res) => {
  const { plan, ev, orgName } = await find('bulletinToken', req.params.token);
  res.set('Cache-Control', 'no-store');
  res.json(await bulletinData(plan, ev, orgName));
}));
