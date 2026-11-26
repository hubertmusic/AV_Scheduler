// The room request link: anyone with it can ask Church Admin for a room or a church event without
// an account. It shows only the church's name and its room names; what they send goes on the next
// board meeting's agenda (lib/roomRequests.js). Church Admin can turn the link off or make a new one.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { OfficeRequest, Team } from '../models.js';
import { bad, getSettings, HttpError, notFound, str, todayIn, wrap, addDays } from '../lib/util.js';
import { attachRequest, clashesFor, mailReceived, nextBoardMeeting } from '../lib/roomRequests.js';
import { logActivity } from '../lib/activity.js';

export const reserveRouter = Router();
const ip = (req) => String(req.headers['cf-connecting-ip'] || req.ip);
const limit = (windowMin, max, message, extra = {}) =>
  rateLimit({ windowMs: windowMin * 60 * 1000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: ip, validate: { xForwardedForHeader: false }, message: { error: message }, ...extra });
reserveRouter.use(limit(10, 120, 'Too many requests. Wait a few minutes and try again.'));
// 8 sent requests an hour from one place; a form sent back to fix a mistake doesn't count
const sendLimit = limit(60, 8, 'That’s a lot of requests from here. Wait an hour, or call the church office.', { skipFailedRequests: true });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_WAITING = 300; // link requests waiting at once, so a flood can't bury the board

async function findTeam(req) {
  const t = req.params.token;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(t || '')) throw notFound('This link isn’t valid.');
  const team = await Team.findOne({ kind: 'office', 'requestLink.token': t });
  if (!team) throw notFound('This link isn’t valid. Ask the church office for the current one.');
  if (!team.requestLink.on) throw new HttpError(410, 'Room requests are closed right now. Please call the church office.');
  return team;
}

// GET /api/reserve/:token — what the form needs
reserveRouter.get('/:token', wrap(async (req, res) => {
  const team = await findTeam(req);
  const s = await getSettings();
  res.json({ church: s.orgName, rooms: (team.rooms || []).map((r) => r.name).filter(Boolean), today: todayIn(s.timezone) });
}));

// GET /api/reserve/:token/check?date&start&end&room — is that room already taken then? (yes or no only)
reserveRouter.get('/:token/check', wrap(async (req, res) => {
  const team = await findTeam(req);
  const q = req.query;
  if (!DATE_RE.test(q.date || '') || !q.room) return res.json({ taken: false });
  const r = { team: team.key, date: q.date, start: TIME_RE.test(q.start || '') ? q.start : '', end: TIME_RE.test(q.end || '') ? q.end : '', room: str(q.room, 80) };
  res.json({ taken: (await clashesFor(r, { titles: false })).length > 0 });
}));

// POST /api/reserve/:token
reserveRouter.post('/:token', sendLimit, wrap(async (req, res) => {
  const team = await findTeam(req);
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const b = req.body || {};
  // A hidden box people never see; bots fill it in. Pretend it worked.
  if (b.website) return res.status(201).json({ ok: true, meetingDate: null });
  const name = str(b.name, 80);
  const email = str(b.email, 120).toLowerCase();
  const phone = str(b.phone, 40);
  const title = str(b.title, 120);
  if (!name) throw bad('Please give your name.');
  if (!EMAIL_RE.test(email)) throw bad('Please give an email address, so we can tell you what the board decides.');
  if (!title) throw bad('What’s it for?');
  if (!DATE_RE.test(b.date || '')) throw bad('Pick a date.');
  if (b.date < today) throw bad('That date has passed.');
  if (b.date > addDays(today, 730)) throw bad('Pick a date within the next two years.');
  for (const k of ['start', 'end']) if (b[k] && !TIME_RE.test(b[k])) throw bad('Times look like 6:30 PM.');
  if (b.start && b.end && b.end <= b.start) throw bad('The end time has to be after the start time.');
  if ((await OfficeRequest.countDocuments({ team: team.key, source: 'link', status: 'pending' })) >= MAX_WAITING) throw new HttpError(503, 'The church has a lot of requests waiting. Please call the church office.');
  const rooms = (team.rooms || []).map((r) => r.name);
  const room = str(b.room, 80);
  const r = await OfficeRequest.create({
    team: team.key,
    source: 'link',
    from: { name, email, phone },
    title,
    date: b.date,
    start: b.start || '',
    end: b.start ? b.end || '' : '',
    room: rooms.find((x) => x.toLowerCase() === room.toLowerCase()) || room,
    people: Math.max(0, Math.min(5000, Math.round(Number(b.people) || 0))),
    notes: str(b.notes, 1500),
    needsAv: !!b.needsAv,
  });
  const meeting = await attachRequest(r);
  await logActivity({ kind: 'system', who: name, action: `Asked Church Admin for “${title}” on ${b.date} with the room request link` });
  await mailReceived(r, meeting);
  res.status(201).json({ ok: true, meetingDate: meeting?.date || (await nextBoardMeeting(team.key))?.date || null });
}));
