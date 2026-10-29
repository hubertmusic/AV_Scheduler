import { Router } from 'express';
import { Activity, Assignment, Event, User } from '../models.js';
import { requireAdmin } from '../auth.js';
import { addDays, getSettings, isId, str, todayIn, wrap } from '../lib/util.js';
import { logActivity } from '../lib/activity.js';

export const activityRouter = Router();

const PAGES = {
  open: 'Opened the app',
  schedule: 'Viewed the schedule',
  mine: 'Viewed My shifts',
  plans: 'Viewed service plans',
  requests: 'Viewed requests',
  groups: 'Viewed groups',
  team: 'Viewed Team & roles',
  resources: 'Viewed resources',
  settings: 'Viewed settings',
  check: 'Viewed the weekend check',
  runsheet: 'Opened a run sheet',
};

// Any signed-in person: note a page view (at most once per page every 30 minutes).
activityRouter.post('/view', wrap(async (req, res) => {
  const page = str(req.body.page, 20);
  if (!PAGES[page] || req.user.role === 'admin') return res.status(204).end();
  const recent = await Activity.findOne({ user: req.user._id, kind: 'view', page, createdAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) } }).lean();
  if (!recent) {
    const detail = str(req.body.detail, 120);
    await logActivity({ user: req.user, kind: 'view', page, action: detail ? `${PAGES[page]}: ${detail}` : PAGES[page], req });
  }
  res.status(204).end();
}));

const feedView = (a) => ({
  id: String(a._id),
  at: a.createdAt,
  kind: a.kind,
  userId: a.user ? String(a.user) : null,
  who: a.who,
  action: a.action,
  page: a.page,
  device: a.device,
  ip: a.ip,
});

// Admin only: the activity feed. ?kind=login|view|calendar|change|guest|system &user=&before=ISO
activityRouter.get('/feed', requireAdmin, wrap(async (req, res) => {
  const filter = {};
  const kinds = { login: ['login', 'login-failed'], view: ['view'], calendar: ['calendar'], change: ['change'], guest: ['guest'], system: ['system'] };
  if (kinds[req.query.kind]) filter.kind = { $in: kinds[req.query.kind] };
  if (isId(req.query.user)) filter.user = req.query.user;
  if (req.query.before && !Number.isNaN(Date.parse(req.query.before))) filter.createdAt = { $lt: new Date(req.query.before) };
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const list = await Activity.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(list.map(feedView));
}));

// Admin only: one row per person — who's signing in, looking, syncing and keeping up.
activityRouter.get('/people', requireAdmin, wrap(async (req, res) => {
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const d7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [people, counts, upcoming] = await Promise.all([
    User.find({}).sort({ active: -1, name: 1 }).lean(),
    Activity.find({ createdAt: { $gte: d30 }, user: { $ne: null } }, { user: 1, kind: 1, createdAt: 1 }).lean(),
    Event.find({ date: { $gte: today, $lte: addDays(today, 30) } }, { _id: 1 }).lean(),
  ]);
  const asg = await Assignment.find({ event: { $in: upcoming.map((e) => e._id) } }, { user: 1, confirmedAt: 1 }).lean();
  const stat = {};
  for (const a of counts) {
    const u = String(a.user);
    const k = ((stat[u] ||= {})[a.kind] ||= { n: 0, last: null, recent7: 0 });
    k.n++;
    if (!k.last || a.createdAt > k.last) k.last = a.createdAt;
    if (a.createdAt >= d7) k.recent7++;
  }
  const shifts = {};
  for (const a of asg) {
    const u = String(a.user);
    shifts[u] ||= { upcoming: 0, unconfirmed: 0 };
    shifts[u].upcoming++;
    if (!a.confirmedAt) shifts[u].unconfirmed++;
  }
  res.json(
    people.map((p) => {
      const u = String(p._id);
      const st = stat[u] || {};
      return {
        id: u,
        name: p.name,
        role: p.role,
        active: p.active,
        signedUp: !!p.passwordHash,
        lastLoginAt: p.lastLoginAt || null,
        lastSeenAt: p.lastSeenAt || null,
        lastDevice: p.lastDevice || '',
        calLastFetchedAt: p.calLastFetchedAt || null,
        calClient: p.calClient || '',
        availabilityUpdatedAt: p.availabilityUpdatedAt || null,
        logins30: st.login?.n || 0,
        failedLogins30: st['login-failed']?.n || 0,
        views7: st.view?.recent7 || 0,
        views30: st.view?.n || 0,
        changes30: st.change?.n || 0,
        lastChangeAt: st.change?.last || null,
        upcoming: shifts[u]?.upcoming || 0,
        unconfirmed: shifts[u]?.unconfirmed || 0,
      };
    })
  );
}));
