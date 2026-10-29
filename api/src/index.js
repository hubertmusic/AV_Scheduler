import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Settings, User } from './models.js';
import { accountRouter, authRouter, requireAuth } from './auth.js';
import { eventsRouter } from './routes/events.js';
import { requestsRouter } from './routes/requests.js';
import { peopleRouter } from './routes/people.js';
import { groupsRouter } from './routes/groups.js';
import { guestAdminRouter, mediaRouter, plansRouter, songsRouter, submissionsRouter } from './routes/plans.js';
import { guestRouter } from './routes/guest.js';
import { academyRouter } from './routes/academy.js';
import { weekendRouter } from './routes/weekend.js';
import { announcementsRouter } from './routes/announcements.js';
import { activityRouter } from './routes/activity.js';
import { changeLogger } from './lib/activity.js';
import { startReminderJob } from './lib/reminders.js';
import { bootstrapRouter, calRouter, meRouter, positionsRouter, resourcesRouter, settingsRouter } from './routes/misc.js';

const app = express();
app.set('trust proxy', 1); // behind nginx (and Cloudflare Tunnel)
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: mongoose.connection.readyState === 1 }));

app.use('/api/auth', authRouter);
app.use('/api/guest', guestRouter); // public, token-limited
app.use('/cal', calRouter);
app.use('/api/academy', academyRouter); // checks the session itself and redirects

app.use('/api', requireAuth);
app.use('/api', changeLogger);
app.use('/api/bootstrap', bootstrapRouter);
app.use('/api/account', accountRouter);
app.use('/api/me', meRouter);
app.use('/api/events', eventsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/people', peopleRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/plans', plansRouter);
app.use('/api/songs', songsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/guest-links', guestAdminRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/weekend', weekendRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/positions', positionsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err.code === 11000) return res.status(409).json({ error: 'That conflicts with something that already exists.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server.' : err.message });
});

// One-time data updates, each applied once and remembered in Settings.
async function runMigrations() {
  const s = await Settings.findOne({ key: 'main' });
  if (!s) return; // first run: setup creates settings with today's defaults
  if (!s.migrations.includes('leaders-edit-plans')) {
    // Team leaders can edit service plans unless the admin turns it off for someone.
    const r = await User.updateMany({ role: 'leader' }, { $set: { 'perms.plans': true } });
    s.migrations.push('leaders-edit-plans');
    await s.save();
    if (r.modifiedCount) console.log(`Gave ${r.modifiedCount} team leader(s) the "Edit service plans" permission.`);
  }
}

async function start() {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
      break;
    } catch (e) {
      if (attempt >= 20) throw e;
      console.log(`Waiting for MongoDB (${attempt})…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await runMigrations();
  app.listen(config.port, () => console.log(`Crew Call API listening on :${config.port}`));
  startReminderJob();
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
