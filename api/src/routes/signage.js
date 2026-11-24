// Digital signage (the Signage tab): what the church's screens show. Works like Anthias's own screen:
// items with a name, start and end, duration and an on/off switch, in an order you drag. Each item
// can go on every screen or chosen ones. Pictures, videos and PDFs come from uploads, a service
// plan's media, or the upload links people are sent (those wait for approval).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import { config } from '../config.js';
import { Event, Media, Plan, Screen, SignageAsset, SignageLink } from '../models.js';
import { bad, forbidden, getSettings, HttpError, isId, notFound, str, todayIn, token, wrap, addDays } from '../lib/util.js';
import { filesOf, originalName, removeUploads, storedPath, unavailableReason, uploader } from '../lib/media.js';
import { assetFile, copyIntoSignage, deleteAssetFiles, isLive, kindOf, managesSignage, nextOrder, NOT_SUPPORTED, onScreen, playerItems, playlistFor, playlistVersion, prepare, screenLink, screensList, toolsReady } from '../lib/signage.js';
import { forgetInAnthias, syncScreen, syncSoon, testAnthias } from '../lib/anthias.js';
import { seal } from '../lib/secrets.js';
import { planFor, planRights } from './plans.js';
import { isArchived, orgToday } from '../lib/archive.js';
import { onServiceTeam } from '../lib/office.js';
import { logActivity } from '../lib/activity.js';

export const signageRouter = Router();
signageRouter.use((req, res, next) => (managesSignage(req.user) ? next() : next(forbidden('Signage is for people with the Signage privilege.'))));

// ---------- views ----------
const iso = (d) => (d ? new Date(d).toISOString() : null);
const fileUrl = (a, page = null) => `/api/signage/assets/${a._id}/file${page !== null ? `?page=${page}` : ''}`;
function assetView(a, now = new Date()) {
  return {
    id: String(a._id),
    name: a.name,
    kind: a.kind,
    mime: a.mime,
    size: a.size,
    pages: a.pages?.length || 0,
    uri: a.uri || '',
    seconds: a.seconds,
    videoSeconds: a.videoSeconds || 0,
    sound: !!a.sound,
    startAt: iso(a.startAt),
    endAt: iso(a.endAt),
    enabled: !!a.enabled,
    screens: (a.screens || []).map(String),
    order: a.order,
    status: a.status,
    processing: a.processing,
    processError: a.processError || '',
    from: a.from?.name ? a.from : null,
    fromPlan: !!a.plan,
    createdBy: a.createdBy?.name || null,
    createdAt: iso(a.createdAt),
    live: isLive(a, now),
    // A picture to show in the list: the picture itself, a PDF's first page
    thumb: a.processing !== 'ready' ? null : a.kind === 'image' ? fileUrl(a) : a.kind === 'pdf' && a.pages?.length ? fileUrl(a, 0) : null,
    file: a.kind === 'web' ? null : fileUrl(a),
    sentTo: (a.anthias || []).map((x) => String(x.screen)),
  };
}
function screenView(s) {
  return {
    id: String(s._id),
    name: s.name,
    link: screenLink(s),
    mode: s.mode,
    fit: s.fit,
    seconds: s.seconds,
    anthias: { url: s.anthias?.url || '', auth: s.anthias?.auth || 'none', user: s.anthias?.user || '', hasSecret: !!s.anthias?.secret, insecure: s.anthias?.insecure !== false, lastSyncAt: iso(s.anthias?.lastSyncAt), lastError: s.anthias?.lastError || '', sent: s.anthias?.sent || 0 },
  };
}
function linkView(l, now = new Date()) {
  return { id: String(l._id), label: l.label, url: `${config.publicUrl}/send/${l.token}`, on: l.on, expiresAt: iso(l.expiresAt), expired: !!l.expiresAt && l.expiresAt <= now, uses: l.uses, createdBy: l.createdBy?.name || null, createdAt: iso(l.createdAt) };
}
async function everything(req) {
  const [assets, screens, links] = await Promise.all([
    SignageAsset.find({ status: { $ne: 'declined' } }).sort({ order: 1, createdAt: 1 }).populate('createdBy', 'name'),
    screensList(),
    SignageLink.find().sort({ createdAt: -1 }).populate('createdBy', 'name'),
  ]);
  const now = new Date();
  return {
    assets: assets.map((a) => assetView(a, now)),
    screens: screens.map(screenView),
    links: links.map((l) => linkView(l, now)),
    tools: toolsReady(),
    maxMB: config.maxUploadMB,
    plans: await onServiceTeam(req.user),
  };
}

// ---------- reading what people send ----------
function readDate(v, label) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw bad(`${label} isn’t a date.`);
  return d;
}
async function readScreens(v) {
  if (v === undefined) return undefined;
  let list = v;
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v || '[]');
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const ids = list.filter(isId).slice(0, 50);
  const found = await Screen.find({ _id: { $in: ids } }, { _id: 1 }).lean();
  return found.map((s) => s._id);
}
function readSeconds(v) {
  if (v === undefined || v === '') return undefined;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 86400) throw bad('Duration is in seconds, up to a day.');
  return n;
}
async function applyFields(a, b) {
  if (b.name !== undefined) {
    const n = str(b.name, 120);
    if (!n) throw bad('Give it a name.');
    a.name = n;
  }
  const start = readDate(b.startAt, 'Start');
  const end = readDate(b.endAt, 'End');
  if (start !== undefined) a.startAt = start;
  if (end !== undefined) a.endAt = end;
  if (a.startAt && a.endAt && a.endAt <= a.startAt) throw bad('The end has to be after the start.');
  const sec = readSeconds(b.seconds);
  if (sec !== undefined) a.seconds = sec;
  if (b.enabled !== undefined) a.enabled = b.enabled === true || b.enabled === 'true';
  if (b.sound !== undefined) a.sound = b.sound === true || b.sound === 'true';
  const screens = await readScreens(b.screens);
  if (screens !== undefined) a.screens = screens;
}
// The Anthias screens a change could reach
const reach = (a, before = null) => (!a.screens?.length || (before && !before.length) ? null : [...new Set([...a.screens, ...(before || [])].map(String))]);
async function findAsset(req) {
  if (!isId(req.params.id)) throw notFound();
  const a = await SignageAsset.findById(req.params.id);
  if (!a) throw notFound('That item is gone.');
  return a;
}

// ---------- the list ----------
signageRouter.get('/', wrap(async (req, res) => res.json(await everything(req))));

// POST /api/signage/assets (files[], name?, screens, startAt, endAt, seconds, enabled)
signageRouter.post('/assets', uploader({ maxCount: 20 }), wrap(async (req, res) => {
  const files = filesOf(req);
  if (!files.length) throw bad('Choose at least one file.');
  const bad1 = files.filter((f) => !kindOf(f.mimetype, f.originalname));
  if (bad1.length) {
    removeUploads(files);
    throw bad(NOT_SUPPORTED);
  }
  const made = [];
  let order = await nextOrder();
  for (const f of files) {
    const kind = kindOf(f.mimetype, f.originalname);
    const name = files.length === 1 && str(req.body.name, 120) ? str(req.body.name, 120) : originalName(f).replace(/\.[^.]+$/, '');
    const a = new SignageAsset({ name, kind, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, order: order++, createdBy: req.user._id, startAt: new Date(), processing: kind === 'image' && !/heic|heif/i.test(f.mimetype) ? 'ready' : 'working', seconds: kind === 'video' ? 0 : 10 });
    try {
      await applyFields(a, { ...req.body, name: undefined });
    } catch (e) {
      removeUploads(files);
      throw e;
    }
    await a.save();
    if (a.processing === 'working') prepare(a);
    made.push(a);
  }
  res.locals.activity = `Added ${made.length === 1 ? `“${made[0].name}”` : `${made.length} items`} to the screens`;
  syncSoon(reach(made[0]));
  res.status(201).json(await everything(req));
}));

// POST /api/signage/assets/web { name, uri, seconds, screens, startAt, endAt }
signageRouter.post('/assets/web', wrap(async (req, res) => {
  const uri = str(req.body?.uri, 1000);
  try {
    const u = new URL(uri);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw bad('Paste the whole web address, starting with https://');
  }
  const a = new SignageAsset({ name: str(req.body?.name, 120) || new URL(uri).hostname, kind: 'web', uri, order: await nextOrder(), createdBy: req.user._id, startAt: new Date(), seconds: 30 });
  await applyFields(a, { ...req.body, name: undefined, uri: undefined });
  await a.save();
  res.locals.activity = `Added the web page “${a.name}” to the screens`;
  syncSoon(reach(a));
  res.status(201).json(await everything(req));
}));

// GET /api/signage/plan-media — pictures, videos and PDFs on service plans from two weeks ago to two
// months ahead (?all=1: every upcoming service, to add a screens item to one)
signageRouter.get('/plan-media', wrap(async (req, res) => {
  if (!(await onServiceTeam(req.user))) return res.json({ plans: [] });
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const events = await Event.find({ date: { $gte: addDays(today, -14), $lte: addDays(today, 60) }, kind: { $ne: 'soundcheck' } }, { title: 1, date: 1, start: 1 }).sort({ date: 1, start: 1 }).lean();
  const plans = await Plan.find({ event: { $in: events.map((e) => e._id) } }, { event: 1 }).lean();
  const media = await Media.find({ plan: { $in: plans.map((p) => p._id) }, status: 'approved', purgedAt: null, location: 'hot' }).sort({ createdAt: 1 }).lean();
  const byPlan = new Map(plans.map((p) => [String(p._id), String(p.event)]));
  const out = events
    .map((e) => ({
      eventId: String(e._id),
      title: e.title,
      date: e.date,
      start: e.start,
      media: media.filter((m) => byPlan.get(String(m.plan)) === String(e._id) && kindOf(m.mime, m.originalName)).map((m) => ({ id: String(m._id), title: m.title || m.originalName, mime: m.mime, kind: kindOf(m.mime, m.originalName), url: `/api/media/${m._id}/file` })),
    }))
    .filter((e) => req.query.all === '1' ? e.date >= today : e.media.length);
  res.json({ plans: out });
}));

// POST /api/signage/assets/from-media { mediaId, screens, startAt, endAt } — put a service plan's file on the screens
signageRouter.post('/assets/from-media', wrap(async (req, res) => {
  if (!(await onServiceTeam(req.user))) throw forbidden('Service plans are on the AV and Praise side.');
  if (!isId(req.body?.mediaId)) throw bad('Pick a file.');
  const m = await Media.findById(req.body.mediaId);
  if (!m || m.status !== 'approved') throw notFound('That file is gone.');
  const kind = kindOf(m.mime, m.originalName);
  if (!kind) throw bad(NOT_SUPPORTED);
  const why = unavailableReason(m);
  if (why) throw new HttpError(409, `That file can’t be used: ${why}.`);
  const storedName = await copyIntoSignage(storedPath(m), m.originalName);
  const a = new SignageAsset({ name: (m.title || m.originalName).replace(/\.[^.]+$/, ''), kind, storedName, originalName: m.originalName, mime: m.mime, size: m.size, plan: m.plan, order: await nextOrder(), createdBy: req.user._id, startAt: new Date(), processing: kind === 'image' && !/heic|heif/i.test(m.mime) ? 'ready' : 'working', seconds: kind === 'video' ? 0 : 10 });
  await applyFields(a, { ...req.body, name: req.body?.name || undefined });
  await a.save();
  if (a.processing === 'working') prepare(a);
  res.locals.activity = `Put “${a.name}” from a service plan on the screens`;
  syncSoon(reach(a));
  res.status(201).json(await everything(req));
}));

// PATCH /api/signage/assets/:id { name, startAt, endAt, seconds, enabled, sound, screens }
signageRouter.patch('/assets/:id', wrap(async (req, res) => {
  const a = await findAsset(req);
  const before = [...(a.screens || [])];
  await applyFields(a, req.body || {});
  await a.save();
  syncSoon(reach(a, before));
  res.json(await everything(req));
}));

// POST /api/signage/assets/order { ids } — the playlist order
signageRouter.post('/assets/order', wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isId).slice(0, 500) : [];
  await Promise.all(ids.map((id, i) => SignageAsset.updateOne({ _id: id }, { order: i + 1 })));
  syncSoon();
  res.json(await everything(req));
}));

signageRouter.delete('/assets/:id', wrap(async (req, res) => {
  const a = await findAsset(req);
  await forgetInAnthias(a);
  deleteAssetFiles(a);
  await a.deleteOne();
  res.locals.activity = `Took “${a.name}” off the screens`;
  res.json(await everything(req));
}));

// POST /api/signage/assets/:id/approve { screens, startAt, endAt, seconds } — something sent with an upload link
signageRouter.post('/assets/:id/approve', wrap(async (req, res) => {
  const a = await findAsset(req);
  if (a.status !== 'pending') throw bad('That’s already been decided.');
  await applyFields(a, req.body || {});
  a.status = 'approved';
  a.order = await nextOrder();
  a.decidedBy = req.user._id;
  a.decidedAt = new Date();
  await a.save();
  res.locals.activity = `Approved “${a.name}” for the screens`;
  syncSoon(reach(a));
  res.json(await everything(req));
}));
signageRouter.post('/assets/:id/decline', wrap(async (req, res) => {
  const a = await findAsset(req);
  if (a.status !== 'pending') throw bad('That’s already been decided.');
  deleteAssetFiles(a);
  await a.deleteOne();
  res.locals.activity = `Turned down “${a.name}” for the screens`;
  res.json(await everything(req));
}));

// POST /api/signage/assets/:id/to-plan { eventId } — add an item to a service plan's media
signageRouter.post('/assets/:id/to-plan', wrap(async (req, res) => {
  const a = await findAsset(req);
  if (a.kind === 'web') throw bad('Web pages can’t go in a service plan’s media.');
  if (!(await onServiceTeam(req.user)) || !planRights(req).details) throw forbidden('Only people on the team can add to its service plans.');
  if (!isId(req.body?.eventId)) throw bad('Pick a service.');
  const ev = await Event.findById(req.body.eventId);
  if (!ev) throw notFound('That service is gone.');
  if (isArchived(ev, await orgToday())) throw bad('That service is in the archive, so it can’t be changed.');
  const src = assetFile(a);
  if (!src || !fs.existsSync(src)) throw notFound('The file is missing from the server.');
  const plan = await planFor(ev._id);
  const storedName = await copyIntoSignage(src, a.originalName || a.name);
  await Media.create({ plan: plan._id, storedName, originalName: a.originalName || a.name, title: a.name, mime: a.mime, size: a.size, uploadedBy: req.user._id, status: 'approved' });
  res.locals.activity = `Added “${a.name}” from the screens to ${ev.title} (${ev.date})`;
  res.json({ ok: true, title: ev.title, date: ev.date });
}));

// GET /api/signage/assets/:id/file?page=n
signageRouter.get('/assets/:id/file', wrap(async (req, res) => {
  const a = await findAsset(req);
  const page = req.query.page !== undefined ? Math.max(0, Math.min((a.pages?.length || 1) - 1, Number(req.query.page) || 0)) : null;
  sendAsset(res, a, page, { download: req.query.download === '1' });
}));

// GET /api/signage/preview?screen=<id> — what that screen would show now
signageRouter.get('/preview', wrap(async (req, res) => {
  const screen = isId(req.query.screen) ? await Screen.findById(req.query.screen).lean() : null;
  const s = screen || { _id: null, fit: 'contain', seconds: 10, name: 'All screens' };
  const now = new Date();
  const list = screen ? await playlistFor(screen, now) : (await SignageAsset.find({ status: 'approved', processing: 'ready', enabled: true }).sort({ order: 1 }).lean()).filter((a) => isLive(a, now));
  const items = playerItems(list, s, fileUrl);
  res.json({ name: s.name, fit: s.fit, items, v: playlistVersion(items, s) });
}));

// GET /api/signage/now — what each screen is showing right now (live-link screens report in)
signageRouter.get('/now', wrap(async (req, res) => {
  const screens = await screensList();
  const now = Date.now();
  res.set('Cache-Control', 'no-store');
  res.json({
    serverNow: now,
    screens: screens.map((s) => {
      const players = [...(nowPlaying.get(String(s._id))?.values() || [])].filter((p) => now - p.at < STALE_MS).sort((a, b) => b.at - a.at);
      const seen = Math.max(players[0]?.at || 0, s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : 0);
      return { id: String(s._id), mode: s.mode, online: players.some((p) => now - p.at < ONLINE_MS), lastSeenAt: seen ? new Date(seen).toISOString() : null, players: players.map(({ key, ...p }) => p) };
    }),
  });
}));

// ---------- screens ----------
signageRouter.post('/screens', wrap(async (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) throw bad('Name the screen (like Lobby).');
  if ((await Screen.countDocuments()) >= 30) throw bad('That’s a lot of screens. Remove one first.');
  const last = await Screen.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
  await Screen.create({ name, token: token(18), order: (last?.order || 0) + 1 });
  res.locals.activity = `Added the screen “${name}”`;
  res.status(201).json(await everything(req));
}));

// PATCH /api/signage/screens/:id { name, mode, fit, seconds, anthias: { url, auth, user, secret, insecure } }
signageRouter.patch('/screens/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Screen.findById(req.params.id);
  if (!s) throw notFound('That screen is gone.');
  const b = req.body || {};
  if (b.name !== undefined) s.name = str(b.name, 60) || s.name;
  if (b.mode !== undefined) {
    if (!['link', 'anthias'].includes(b.mode)) throw bad('Pick how this screen gets its playlist.');
    s.mode = b.mode;
  }
  if (b.fit !== undefined) s.fit = b.fit === 'cover' ? 'cover' : 'contain';
  if (b.seconds !== undefined) s.seconds = Math.max(3, Math.min(600, Math.round(Number(b.seconds) || 10)));
  if (b.anthias && typeof b.anthias === 'object') {
    const x = b.anthias;
    if (x.url !== undefined) {
      const url = str(x.url, 200).replace(/\/+$/, '');
      if (url) {
        try {
          const u = new URL(url);
          if (!/^https?:$/.test(u.protocol)) throw new Error();
        } catch {
          throw bad('The Anthias address looks like https://192.168.1.50');
        }
      }
      s.anthias.url = url;
    }
    if (x.auth !== undefined) s.anthias.auth = ['none', 'token', 'basic'].includes(x.auth) ? x.auth : 'none';
    if (x.user !== undefined) s.anthias.user = str(x.user, 80);
    if (x.secret !== undefined && x.secret !== null) s.anthias.secret = x.secret ? seal(String(x.secret).slice(0, 500)) : '';
    if (x.insecure !== undefined) s.anthias.insecure = !!x.insecure;
  }
  await s.save();
  if (s.mode === 'anthias') syncSoon([s._id], 1000);
  res.json(await everything(req));
}));

signageRouter.delete('/screens/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Screen.findById(req.params.id);
  if (!s) throw notFound('That screen is gone.');
  // Items meant only for this screen would otherwise go on every screen: switch them off
  const only = await SignageAsset.find({ screens: s._id });
  for (const a of only) {
    a.screens = a.screens.filter((x) => String(x) !== String(s._id));
    if (!a.screens.length) a.enabled = false;
    a.anthias = a.anthias.filter((x) => String(x.screen) !== String(s._id));
    await a.save();
  }
  await s.deleteOne();
  res.locals.activity = `Removed the screen “${s.name}”`;
  res.json(await everything(req));
}));

// A new live link (the old one stops working)
signageRouter.post('/screens/:id/new-link', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Screen.findById(req.params.id);
  if (!s) throw notFound();
  s.token = token(18);
  await s.save();
  res.json(await everything(req));
}));

signageRouter.post('/screens/:id/test', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Screen.findById(req.params.id);
  if (!s) throw notFound();
  res.json(await testAnthias(s));
}));

signageRouter.post('/screens/:id/sync', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Screen.findById(req.params.id);
  if (!s) throw notFound();
  if (s.mode !== 'anthias') throw bad('This screen uses its live link; there’s nothing to send.');
  try {
    const r = await syncScreen(s._id);
    res.json({ ok: true, ...r, ...(await everything(req)) });
  } catch (e) {
    res.json({ ok: false, error: e.message, ...(await everything(req)) });
  }
}));

// ---------- upload links ----------
const LASTS = { off: null, '4h': 4 * 3600e3, '1d': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 };
signageRouter.post('/links', wrap(async (req, res) => {
  const lasts = req.body?.lasts || 'off';
  if (!(lasts in LASTS)) throw bad('Pick how long the link works.');
  if ((await SignageLink.countDocuments()) >= 50) throw bad('That’s a lot of links. Remove some old ones first.');
  await SignageLink.create({ token: token(18), label: str(req.body?.label, 80), expiresAt: LASTS[lasts] ? new Date(Date.now() + LASTS[lasts]) : null, createdBy: req.user._id });
  res.locals.activity = 'Made an upload link for the screens';
  res.status(201).json(await everything(req));
}));
signageRouter.patch('/links/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const l = await SignageLink.findById(req.params.id);
  if (!l) throw notFound();
  if (req.body?.on !== undefined) l.on = !!req.body.on;
  if (req.body?.label !== undefined) l.label = str(req.body.label, 80);
  await l.save();
  res.json(await everything(req));
}));
signageRouter.delete('/links/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  await SignageLink.deleteOne({ _id: req.params.id });
  res.json(await everything(req));
}));

// ---------- sending files ----------
const MIME_OUT = { image: null, pdf: 'image/png' };
export function sendAsset(res, a, page = null, { download = false } = {}) {
  const file = assetFile(a, page);
  if (!file || !fs.existsSync(file)) throw notFound('That file is missing from the server.');
  const type = page !== null ? MIME_OUT.pdf : a.mime || 'application/octet-stream';
  const name = (a.originalName || a.name).replace(/[^\x20-\x7e]/g, '_');
  res.set({
    'Content-Type': /^(image|video)\//.test(type) || type === 'application/pdf' ? type : 'application/octet-stream',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${page !== null ? `${a.name.replace(/[^\x20-\x7e]/g, '_')}-${page + 1}.png` : name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, max-age=86400',
  });
  res.sendFile(file);
}

// =====================================================================================
// Public: a screen's live player (/screen/<token>), and the upload link (/send/<token>)
// =====================================================================================
export const screenRouter = Router();
screenRouter.use(rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => String(req.headers['cf-connecting-ip'] || req.ip), validate: { xForwardedForHeader: false } }));
async function screenByToken(t) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(t || '')) throw notFound('This screen link isn’t valid.');
  const s = await Screen.findOne({ token: t }).lean();
  if (!s) throw notFound('This screen link isn’t valid any more. Ask for the current one.');
  return s;
}
// GET /api/screen/:token — the playlist right now
screenRouter.get('/:token', wrap(async (req, res) => {
  const s = await screenByToken(req.params.token);
  const items = await screenItems(s);
  const st = await getSettings();
  res.set('Cache-Control', 'no-store');
  res.json({ name: s.name, church: st.orgName || '', fit: s.fit, items, v: playlistVersion(items, s), check: 60 });
}));
// What each live-link player last said it was showing: screen id → player id → state. In memory;
// it's only about the last few seconds. lastSeenAt goes to the database at most once a minute.
const nowPlaying = new Map();
const ONLINE_MS = 35 * 1000; // players check in every 10 seconds and on every new item
const STALE_MS = 6 * 3600 * 1000;
const clip = (v, n = 120) => String(v ?? '').slice(0, n);
// POST /api/screen/:token/now { player, item: { id, name, kind }, elapsed, length, next: { id, name }, v, w, h }
screenRouter.post('/:token/now', wrap(async (req, res) => {
  const s = await screenByToken(req.params.token);
  const b = req.body || {};
  const player = clip(b.player, 40);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(player)) throw bad('Bad player.');
  const now = Date.now();
  const room = nowPlaying.get(String(s._id)) || new Map();
  if (!room.has(player) && room.size >= 10) {
    // a screen link open in too many places: forget the oldest
    const oldest = [...room].sort((x, y) => x[1].at - y[1].at)[0];
    room.delete(oldest[0]);
  }
  const elapsed = Math.max(0, Math.min(86400, Number(b.elapsed) || 0));
  const latest = b.v === undefined ? null : playlistVersion(await screenItems(s), s);
  room.set(player, {
    player,
    at: now,
    item: b.item?.id ? { id: clip(b.item.id, 60), name: clip(b.item.name), kind: clip(b.item.kind, 10) } : null,
    startedAt: now - elapsed * 1000,
    length: Math.max(0, Math.min(86400, Number(b.length) || 0)),
    next: b.next?.id ? { id: clip(b.next.id, 60), name: clip(b.next.name) } : null,
    count: Math.max(0, Math.min(1000, Number(b.count) || 0)),
    current: latest === null ? null : String(b.v) === latest, // has the latest playlist
    size: Number(b.w) > 0 ? `${Math.round(b.w)}×${Math.round(b.h)}` : '',
  });
  nowPlaying.set(String(s._id), room);
  if (!s.lastSeenAt || now - new Date(s.lastSeenAt).getTime() > 60 * 1000) await Screen.updateOne({ _id: s._id }, { lastSeenAt: new Date(now) });
  res.status(204).end();
}));
const screenItems = async (s) => playerItems(await playlistFor(s), s, (a, page = null) => `/api/screen/${s.token}/file/${a._id}${page !== null ? `/${page}` : ''}`);

// GET /api/screen/:token/file/:id[/:page]
screenRouter.get('/:token/file/:id/:page?', wrap(async (req, res) => {
  const s = await screenByToken(req.params.token);
  if (!isId(req.params.id)) throw notFound();
  const a = await SignageAsset.findById(req.params.id).lean();
  // Only what's on this screen's playlist now (a little grace, so an item ending mid-play still loads)
  if (!a || a.status !== 'approved' || !onScreen(a, s._id) || !(isLive(a) || isLive(a, new Date(Date.now() - 10 * 60e3)))) throw notFound();
  const page = req.params.page !== undefined ? Number(req.params.page) : null;
  if (page !== null && (!Number.isInteger(page) || page < 0 || page >= (a.pages?.length || 0))) throw notFound();
  sendAsset(res, a, page);
}));

export const sendRouter = Router();
const ip = (req) => String(req.headers['cf-connecting-ip'] || req.ip);
sendRouter.use(rateLimit({ windowMs: 10 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: ip, validate: { xForwardedForHeader: false }, message: { error: 'Too many requests. Wait a few minutes and try again.' } }));
const sendLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: ip, validate: { xForwardedForHeader: false }, skipFailedRequests: true, message: { error: 'That’s a lot of uploads from here. Wait an hour and try again.' } });
const MAX_WAITING = 200;
async function linkByToken(t) {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(t || '')) throw notFound('This link isn’t valid.');
  const l = await SignageLink.findOne({ token: t });
  if (!l) throw notFound('This link isn’t valid. Ask for a new one.');
  if (!l.on) throw new HttpError(410, 'This upload link has been turned off. Ask for a new one.');
  if (l.expiresAt && l.expiresAt <= new Date()) throw new HttpError(410, 'This upload link has expired. Ask for a new one.');
  return l;
}
// GET /api/send/:token — what the page needs
sendRouter.get('/:token', wrap(async (req, res) => {
  const l = await linkByToken(req.params.token);
  const s = await getSettings();
  res.json({ church: s.orgName || '', label: l.label, maxMB: config.maxUploadMB, expiresAt: iso(l.expiresAt), today: todayIn(s.timezone), pdf: toolsReady().pdf });
}));
// POST /api/send/:token (name, email, note, startDate, endDate, files[]) — waits for approval
sendRouter.post('/:token', sendLimit, uploader({ maxCount: 10 }), wrap(async (req, res) => {
  const files = filesOf(req);
  let l;
  try {
    l = await linkByToken(req.params.token);
    if (req.body?.website) {
      removeUploads(files);
      return res.status(201).json({ ok: true, count: files.length }); // a bot filled the hidden box
    }
    const name = str(req.body?.name, 80);
    if (!name) throw bad('Please give your name.');
    if (!files.length) throw bad('Choose at least one picture, video or PDF.');
    if (files.some((f) => !kindOf(f.mimetype, f.originalname))) throw bad(NOT_SUPPORTED);
    if ((await SignageAsset.countDocuments({ status: 'pending' })) >= MAX_WAITING) throw new HttpError(503, 'There’s a lot waiting to be looked at. Try again in a few days.');
  } catch (e) {
    removeUploads(files);
    throw e;
  }
  const from = { name: str(req.body.name, 80), email: str(req.body.email, 120).toLowerCase(), note: str(req.body.note, 800) };
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T00:00:00`) : null);
  const startAt = day(req.body.startDate) || new Date();
  let endAt = day(req.body.endDate);
  if (endAt) endAt = new Date(endAt.getTime() + 24 * 3600e3 - 1000); // through the end of that day
  for (const f of files) {
    const kind = kindOf(f.mimetype, f.originalname);
    const a = await SignageAsset.create({ name: originalName(f).replace(/\.[^.]+$/, ''), kind, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, status: 'pending', from, link: l._id, startAt, endAt: endAt && endAt > startAt ? endAt : null, seconds: kind === 'video' ? 0 : 10, processing: kind === 'image' && !/heic|heif/i.test(f.mimetype) ? 'ready' : 'working' });
    if (a.processing === 'working') prepare(a);
  }
  l.uses += 1;
  await l.save();
  await logActivity({ kind: 'system', who: from.name, action: `Sent ${files.length} file${files.length === 1 ? '' : 's'} for the screens with an upload link` });
  res.status(201).json({ ok: true, count: files.length });
}));
