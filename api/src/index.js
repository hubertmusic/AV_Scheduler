import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { config } from './config.js';
import { HttpError } from './lib/util.js';
import { Settings, User } from './models.js';
import { accountRouter, authRouter, requireAuth } from './auth.js';
import { eventsRouter } from './routes/events.js';
import { requestsRouter } from './routes/requests.js';
import { peopleRouter } from './routes/people.js';
import { groupsRouter } from './routes/groups.js';
import { guestAdminRouter, mediaRouter, plansRouter, songsRouter, submissionsRouter } from './routes/plans.js';
import { guestRouter } from './routes/guest.js';
import { reserveRouter } from './routes/reserve.js';
import { publicRouter } from './routes/public.js';
import { ensureTeams, requireAvTeam } from './lib/teams.js';
import { teamsRouter } from './routes/teams.js';
import { boardsRouter } from './routes/boards.js';
import { standingRouter } from './routes/standing.js';
import { templatesRouter } from './routes/templates.js';
import { gearRouter } from './routes/gear.js';
import { reportsRouter } from './routes/reports.js';
import { checklistsRouter, debriefRouter, issuesRouter, signoffsRouter } from './routes/extras.js';
import { plannerRouter } from './routes/planner.js';
import { officeRouter } from './routes/office.js';
import { chatRouter } from './routes/chat.js';
import { screenRouter, sendRouter, signageRouter } from './routes/signage.js';
import { checkTools, resumePreparing, whenPrepared } from './lib/signage.js';
import { startAnthiasJob, syncSoon } from './lib/anthias.js';
import { notesRouter, vaultRouter } from './routes/vault.js';
import { ensureVaultKey } from './lib/secrets.js';
import { ensureOffice, onServiceTeam, startOfficeJob } from './lib/office.js';
import { wrap } from './lib/util.js';
import { libraryRouter } from './routes/library.js';
import { academyRouter } from './routes/academy.js';
import { weekendRouter } from './routes/weekend.js';
import { announcementsRouter } from './routes/announcements.js';
import { activityRouter } from './routes/activity.js';
import { changeLogger } from './lib/activity.js';
import { startReminderJob } from './lib/reminders.js';
import { startArchiveJob } from './lib/archive.js';
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
app.use('/api/reserve', reserveRouter); // public: the room request link
app.use('/api/public', publicRouter); // rundown and bulletin links
app.use('/api/screen', screenRouter); // public: a church screen's live player
app.use('/api/send', sendRouter); // public: upload links for the screens
app.use('/cal', calRouter);
app.use('/api/academy', academyRouter); // checks the session itself and redirects

app.use('/api', requireAuth);
app.use('/api', changeLogger);
// Services, plans, songs and line-ups are for people on a team that serves on them (AV, Praise…).
// People only on Church Admin don't see them.
const serviceSide = wrap(async (req, res, next) => {
  if (await onServiceTeam(req.user)) return next();
  res.status(403).json({ error: 'That’s part of the AV and Praise side.' });
});
for (const p of ['/api/events', '/api/requests', '/api/plans', '/api/songs', '/api/media', '/api/guest-links', '/api/submissions', '/api/weekend', '/api/standing-links', '/api/order-templates', '/api/checklists', '/api/issues', '/api/debrief', '/api/signoffs', '/api/planner']) app.use(p, serviceSide);
app.use('/api/bootstrap', bootstrapRouter);
app.use('/api/account', accountRouter);
app.use('/api/me', meRouter);
app.use('/api/events', eventsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/people', peopleRouter);
app.use('/api/groups', requireAvTeam, groupsRouter); // AV's side
app.use('/api/plans', plansRouter);
app.use('/api/songs', songsRouter);
app.use('/api/media', mediaRouter);
app.use('/api/library', requireAvTeam, libraryRouter); // AV's side
app.use('/api/guest-links', guestAdminRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/weekend', weekendRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/activity', activityRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/positions', positionsRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/standing-links', standingRouter);
app.use('/api/order-templates', templatesRouter);
app.use('/api/gear', requireAvTeam, gearRouter); // AV's side
app.use('/api/reports', requireAvTeam, reportsRouter); // Gear → Reports
app.use('/api/checklists', checklistsRouter);
app.use('/api/issues', issuesRouter);
app.use('/api/debrief', debriefRouter);
app.use('/api/signoffs', signoffsRouter);
app.use('/api/planner', plannerRouter);
app.use('/api/office', officeRouter);
app.use('/api/vault', vaultRouter);
app.use('/api/chat', chatRouter);
app.use('/api/notes', notesRouter);
app.use('/api/signage', signageRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err.code === 11000) return res.status(409).json({ error: 'That conflicts with something that already exists.' });
  const status = err.status || 500;
  if (status >= 500 && !(err instanceof HttpError)) console.error(err);
  // Our own 5xx errors (e.g. "the NAS isn't reachable") carry a message meant for people.
  res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong on the server.' : err.message, ...(err.extra || {}) });
});

// One-time data updates, each applied once and remembered in Settings.
async function runMigrations() {
  const s = await Settings.findOne({ key: 'main' });
  if (!s) return; // first run: setup creates settings with today's defaults
  await ensureTeams(); // AV and Praise teams; everyone so far joins AV
  await ensureOffice(); // the Church Admin team and its first committees
  await ensureVaultKey(); // notices a changed vault key (or moves to a new VAULT_KEY)
  if (!s.migrations.includes('leaders-edit-plans')) {
    // Team leaders can edit service plans unless the admin turns it off for someone.
    const r = await User.updateMany({ role: 'leader' }, { $set: { 'perms.plans': true } });
    s.migrations.push('leaders-edit-plans');
    await s.save();
    if (r.modifiedCount) console.log(`Gave ${r.modifiedCount} team leader(s) the "Edit service plans" permission.`);
  }
  if (!s.migrations.includes('leaders-manage-signage')) {
    // Every team leader manages the church screens unless the admin or their head leader turns it
    // off; crew members only when they're given it, so nobody keeps it from before a change of role.
    for (const u of await User.find({ 'teams.0': { $exists: true } })) {
      for (const m of u.teams) m.perms.signage = m.role === 'leader';
      u.markModified('teams');
      await u.save();
    }
    s.migrations.push('leaders-manage-signage');
    await s.save();
    console.log('Team leaders can now manage signage.');
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
  startArchiveJob();
  startOfficeJob();
  // Signage: what the server can convert, finish anything half-prepared, keep Anthias screens current
  checkTools().then((t) => console.log(`[signage] video ${t.ffmpeg && t.ffprobe ? 'on' : 'off (no ffmpeg)'}, PDFs ${t.pdftoppm ? 'on' : 'off (no pdftoppm)'}`));
  whenPrepared(() => syncSoon());
  resumePreparing();
  startAnthiasJob();
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
