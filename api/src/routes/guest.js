import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { Activity, GuestLink, Media, Submission } from '../models.js';
import { bad, getSettings, HttpError, isId, notFound, str, wrap } from '../lib/util.js';
import { deleteStored, filesOf, originalName, removeUploads, uploader } from '../lib/media.js';
import { applyItem, removeItem, updateItem, windowState } from '../lib/guestItems.js';
import { planFor } from './plans.js';
import { evName, logActivity } from '../lib/activity.js';

// Public routes for outside guests. A guest opens their link and enters the 6-digit code that
// came with it. They see only the service it was made for and only what they've sent.
// While their window is open, what they submit goes straight into the plan and they can change
// or take it back. After it closes it's locked: anything new or changed waits for a leader.
export const guestRouter = Router();

const MAX_FILES = 40;
const MAX_ITEMS = 60;
const MAX_TRIES = 8;
const COOKIE = 'cc_guest';

guestRouter.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => String(req.headers['cf-connecting-ip'] || req.ip),
    validate: { xForwardedForHeader: false },
    message: { error: 'Too many requests. Wait a few minutes and try again.' },
  })
);

const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.headers['cf-connecting-ip'] || req.ip),
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many tries. Wait a few minutes and try again.' },
});

async function findLink(req) {
  const t = req.params.token;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(t || '')) throw notFound('This link isn’t valid.');
  const g = await GuestLink.findOne({ token: t }).populate('event');
  if (!g || !g.event) throw notFound('This link isn’t valid.');
  if (g.revoked || g.expiresAt < new Date()) throw new HttpError(410, 'This link has expired. Ask the team for a new one.');
  return g;
}

function unlocked(req, g) {
  if (!g.code) return true; // links made before codes existed
  try {
    const p = jwt.verify(req.cookies?.[COOKIE] || '', config.jwtSecret);
    return p.gid === String(g._id) && p.cv === (g.codeVersion || 0);
  } catch {
    return false;
  }
}

async function loadLink(req) {
  const g = await findLink(req);
  if (!unlocked(req, g)) throw new HttpError(401, 'Enter the 6-digit code that came with your link.');
  return g;
}

const who = (g) => `${g.name} (guest)`;
const log = (g, action, req) => logActivity({ kind: 'guest', who: who(g), action: `${action} for ${evName(g.event)}`, req });

function subView(s, change) {
  return {
    id: String(s._id),
    kind: s.kind,
    status: s.status,
    data: s.data,
    media: s.media?._id ? { name: s.media.originalName, size: s.media.size } : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    // a late change to this item, waiting for the team
    change: change ? { id: String(change._id), data: change.data, createdAt: change.createdAt } : null,
  };
}

function readItem(kind, b) {
  if (kind === 'note') {
    const data = { text: str(b.text, 20000) };
    if (!data.text) throw bad('Write a note first.');
    return data;
  }
  if (kind === 'scripture') {
    const data = { reference: str(b.reference, 120), version: str(b.version, 30), text: str(b.text, 20000) };
    if (!data.reference) throw bad('Add the reference, e.g. John 3:16.');
    return data;
  }
  if (kind === 'song') {
    const data = { title: str(b.title, 120), artist: str(b.artist, 120), key: str(b.key, 12), lyrics: str(b.lyrics, 30000) };
    if (!data.title) throw bad('Give the song a title.');
    return data;
  }
  throw bad('Unknown item.');
}

const fmt = (d) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function assertNotWaiting(g) {
  if (windowState(g) === 'waiting') throw bad(`You can start adding things ${fmt(g.opensAt)}.`);
}

const label = (s) => ({ note: 'a note', scripture: `a Bible text (${s.data?.reference || ''})`, song: `a song (${s.data?.title || ''})`, media: `a file (${s.data?.name || ''})` })[s.kind];

// Send an item to the plan: straight in while the window is open, for approval after.
async function submitItem(g, s) {
  const state = windowState(g);
  if (state === 'open') {
    const plan = await planFor(g.event._id);
    s.applied = await applyItem(plan, s, g.name);
    await plan.save();
    s.status = 'live';
  } else {
    s.status = 'pending';
  }
  s.markModified('applied');
  await s.save();
  return s.status;
}

guestRouter.get('/:token', wrap(async (req, res) => {
  const g = await findLink(req);
  const s = await getSettings();
  if (!unlocked(req, g)) return res.json({ needsCode: true, orgName: s.orgName, name: g.name });
  if (!(await Activity.exists({ kind: 'guest', who: who(g), createdAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) } }))) await log(g, 'Opened their link', req);
  const subs = await Submission.find({ guest: g._id, status: { $ne: 'rejected' }, replaces: null }).sort({ createdAt: -1 }).populate('media');
  const changes = await Submission.find({ guest: g._id, status: 'pending', replaces: { $ne: null } });
  const changeFor = Object.fromEntries(changes.map((c) => [String(c.replaces), c]));
  const ev = g.event;
  res.json({
    orgName: s.orgName,
    name: g.name,
    note: g.note,
    maxUploadMB: config.maxUploadMB,
    event: { title: ev.title, date: ev.date, start: ev.start, call: ev.call, end: ev.end },
    schedule: { state: windowState(g), opensAt: g.opensAt || g.createdAt, closesAt: g.closesAt || null, expiresAt: g.expiresAt, legacy: !g.code },
    submissions: subs.map((x) => subView(x, changeFor[String(x._id)])),
  });
}));

guestRouter.post('/:token/unlock', codeLimiter, wrap(async (req, res) => {
  const g = await findLink(req);
  if (!g.code) return res.status(204).end();
  if ((g.codeTries || 0) >= MAX_TRIES) throw new HttpError(423, 'Too many wrong codes. Ask the team to send you a new code.');
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (code !== g.code) {
    g.codeTries = (g.codeTries || 0) + 1;
    await g.save();
    const left = MAX_TRIES - g.codeTries;
    throw new HttpError(401, left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask the team to send you a new code.');
  }
  g.codeTries = 0;
  await g.save();
  const t = jwt.sign({ gid: String(g._id), cv: g.codeVersion || 0 }, config.jwtSecret, { expiresIn: Math.max(60, Math.floor((g.expiresAt - Date.now()) / 1000)) });
  res.cookie(COOKIE, t, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: `/api/guest/${g.token}`, expires: g.expiresAt });
  await log(g, 'Signed in with their code', req);
  res.status(204).end();
}));

guestRouter.post('/:token/files', uploader({ maxCount: 10 }), wrap(async (req, res) => {
  const files = filesOf(req);
  let g;
  try {
    g = await loadLink(req);
    assertNotWaiting(g);
    if (!files.length) throw bad('Choose at least one file.');
    const sent = await Submission.countDocuments({ guest: g._id, kind: 'media', status: { $ne: 'rejected' } });
    if (sent + files.length > MAX_FILES) throw bad(`This link can take up to ${MAX_FILES} files. Ask the team for another link.`);
  } catch (e) {
    removeUploads(files);
    throw e;
  }
  const plan = await planFor(g.event._id);
  let status = '';
  for (const f of files) {
    const m = await Media.create({ plan: plan._id, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, guest: g._id, status: 'pending' });
    const s = new Submission({ event: g.event._id, guest: g._id, kind: 'media', media: m._id, data: { name: m.originalName } });
    s.media = m;
    status = await submitItem(g, s);
  }
  await log(g, `${status === 'live' ? 'Added' : 'Sent for approval'} ${files.length} file${files.length === 1 ? '' : 's'}`, req);
  res.status(201).json({ status });
}));

// New note, Bible text or song. { kind, …fields, draft }
guestRouter.post('/:token/items', wrap(async (req, res) => {
  const g = await loadLink(req);
  const b = req.body || {};
  if ((await Submission.countDocuments({ guest: g._id, kind: { $ne: 'media' }, replaces: null })) >= MAX_ITEMS) throw bad('This link has reached its limit. Ask the team for another link.');
  const data = readItem(b.kind, b);
  const s = new Submission({ event: g.event._id, guest: g._id, kind: b.kind, data, status: 'draft' });
  if (b.draft) {
    await s.save();
    return res.status(201).json({ status: 'draft' });
  }
  assertNotWaiting(g);
  const status = await submitItem(g, s);
  await log(g, `${status === 'live' ? 'Added' : 'Sent for approval'} ${label(s)}`, req);
  res.status(201).json({ status });
}));

async function ownItem(g, id) {
  if (!isId(id)) throw notFound();
  const s = await Submission.findOne({ _id: id, guest: g._id, replaces: null }).populate('media');
  if (!s) throw notFound('That item no longer exists.');
  return s;
}

// Edit an item. { …fields, submit }
//  draft: saves it (and sends it if submit) · live while open: updates the plan ·
//  live after the window: sends the change for approval · waiting for approval: updates the request
guestRouter.patch('/:token/items/:id', wrap(async (req, res) => {
  const g = await loadLink(req);
  const s = await ownItem(g, req.params.id);
  if (s.kind === 'media') throw bad('To change a file, remove it and upload the new one.');
  const data = readItem(s.kind, req.body || {});
  const state = windowState(g);

  if (s.status === 'draft') {
    s.data = data;
    if (!req.body.submit) {
      await s.save();
      return res.json({ status: 'draft' });
    }
    assertNotWaiting(g);
    const status = await submitItem(g, s);
    await log(g, `${status === 'live' ? 'Added' : 'Sent for approval'} ${label(s)}`, req);
    return res.json({ status });
  }
  if (s.status === 'pending') {
    s.data = data;
    await s.save();
    return res.json({ status: 'pending' });
  }
  if (s.status === 'live' && state === 'open') {
    const plan = await planFor(g.event._id);
    s.applied = await updateItem(plan, s, g.name, data);
    s.data = data;
    s.markModified('applied');
    await plan.save();
    await s.save();
    await log(g, `Changed ${label(s)}`, req);
    return res.json({ status: 'live' });
  }
  if (s.status === 'live') {
    // Locked: one change request per item, updated if they edit again
    const existing = await Submission.findOne({ replaces: s._id, status: 'pending' });
    if (existing) {
      existing.data = data;
      await existing.save();
    } else {
      await Submission.create({ event: g.event._id, guest: g._id, kind: s.kind, data, status: 'pending', replaces: s._id });
    }
    await log(g, `Sent a change for approval: ${label(s)}`, req);
    return res.json({ status: 'change-pending' });
  }
  throw bad('The team already added this one to the plan, so it can’t be changed here. Send them a note instead.');
}));

// Take an item back: drafts, anything waiting for approval, and live items while the window is open.
guestRouter.delete('/:token/items/:id', wrap(async (req, res) => {
  const g = await loadLink(req);
  const s = await ownItem(g, req.params.id);
  const state = windowState(g);
  if (s.status === 'live' && state !== 'open') throw bad('It’s locked now that the deadline has passed. Ask the team if it needs to come out.');
  if (s.status === 'approved' || s.status === 'rejected') throw bad('The team already handled this one.');
  if (s.status === 'live') {
    const plan = await planFor(g.event._id);
    await removeItem(plan, s);
    await plan.save();
    await log(g, `Took out ${label(s)}`, req);
  } else if (s.kind === 'media' && s.media) {
    deleteStored(s.media.storedName);
    await s.media.deleteOne();
  }
  await Submission.deleteMany({ replaces: s._id });
  await s.deleteOne();
  res.status(204).end();
}));

// Withdraw a late change that's still waiting
guestRouter.delete('/:token/changes/:id', wrap(async (req, res) => {
  const g = await loadLink(req);
  if (!isId(req.params.id)) throw notFound();
  await Submission.deleteOne({ _id: req.params.id, guest: g._id, status: 'pending', replaces: { $ne: null } });
  res.status(204).end();
}));
