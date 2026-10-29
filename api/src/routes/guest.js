import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { GuestLink, Media, Submission } from '../models.js';
import { bad, getSettings, HttpError, notFound, str, wrap } from '../lib/util.js';
import { filesOf, originalName, removeUploads, uploader } from '../lib/media.js';
import { planFor } from './plans.js';
import { evName, logActivity } from '../lib/activity.js';
import { Activity } from '../models.js';

// Public routes for outside guests. A link works for a few hours, only shows the
// service it was made for, and everything sent waits for a leader's approval.
export const guestRouter = Router();

const MAX_FILES = 40;
const MAX_ITEMS = 60;

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

async function loadLink(req) {
  const t = req.params.token;
  if (!/^[A-Za-z0-9_-]{20,}$/.test(t || '')) throw notFound('This link isn’t valid.');
  const g = await GuestLink.findOne({ token: t }).populate('event');
  if (!g || !g.event) throw notFound('This link isn’t valid.');
  if (g.revoked || g.expiresAt < new Date()) throw new HttpError(410, 'This link has expired. Ask the team for a new one.');
  return g;
}

const subView = (s) => ({ id: String(s._id), kind: s.kind, status: s.status, data: s.data, media: s.media?._id ? { name: s.media.originalName, size: s.media.size } : null, createdAt: s.createdAt });

guestRouter.get('/:token', wrap(async (req, res) => {
  const g = await loadLink(req);
  const s = await getSettings();
  const who = `${g.name} (guest)`;
  if (!(await Activity.exists({ kind: 'guest', who, createdAt: { $gt: new Date(Date.now() - 30 * 60 * 1000) } }))) {
    await logActivity({ kind: 'guest', who, action: `Opened their upload link for ${evName(g.event)}`, req });
  }
  const subs = await Submission.find({ guest: g._id }).sort({ createdAt: -1 }).populate('media');
  res.json({
    orgName: s.orgName,
    name: g.name,
    note: g.note,
    expiresAt: g.expiresAt,
    maxUploadMB: config.maxUploadMB,
    event: { title: g.event.title, date: g.event.date, start: g.event.start },
    submissions: subs.map(subView),
  });
}));

guestRouter.post('/:token/files', uploader({ maxCount: 10 }), wrap(async (req, res) => {
  const files = filesOf(req);
  let g;
  try {
    g = await loadLink(req);
    if (!files.length) throw bad('Choose at least one file.');
    const sent = await Submission.countDocuments({ guest: g._id, kind: 'media' });
    if (sent + files.length > MAX_FILES) throw bad(`This link can take up to ${MAX_FILES} files. Ask the team for another link.`);
  } catch (e) {
    removeUploads(files);
    throw e;
  }
  const plan = await planFor(g.event._id);
  const out = [];
  for (const f of files) {
    const m = await Media.create({ plan: plan._id, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, guest: g._id, status: 'pending' });
    const s = await Submission.create({ event: g.event._id, guest: g._id, kind: 'media', media: m._id, data: { name: m.originalName } });
    s.media = m;
    out.push(subView(s));
  }
  await logActivity({ kind: 'guest', who: `${g.name} (guest)`, action: `Uploaded ${files.length} file${files.length === 1 ? '' : 's'} for ${evName(g.event)}`, req });
  res.status(201).json(out);
}));

guestRouter.post('/:token/items', wrap(async (req, res) => {
  const g = await loadLink(req);
  if ((await Submission.countDocuments({ guest: g._id, kind: { $ne: 'media' } })) >= MAX_ITEMS) throw bad('This link has reached its limit. Ask the team for another link.');
  const b = req.body || {};
  let data;
  if (b.kind === 'note') {
    data = { text: str(b.text, 20000) };
    if (!data.text) throw bad('Write a note first.');
  } else if (b.kind === 'scripture') {
    data = { reference: str(b.reference, 120), version: str(b.version, 30), text: str(b.text, 20000) };
    if (!data.reference) throw bad('Add the reference, e.g. John 3:16.');
  } else if (b.kind === 'song') {
    data = { title: str(b.title, 120), artist: str(b.artist, 120), key: str(b.key, 12), lyrics: str(b.lyrics, 30000) };
    if (!data.title) throw bad('Give the song a title.');
  } else {
    throw bad('Unknown item.');
  }
  const s = await Submission.create({ event: g.event._id, guest: g._id, kind: b.kind, data });
  const what = { note: 'a note', scripture: `a Bible text (${data.reference})`, song: `a song (${data.title})` }[b.kind];
  await logActivity({ kind: 'guest', who: `${g.name} (guest)`, action: `Sent ${what} for ${evName(g.event)}`, req });
  res.status(201).json(subView(s));
}));
