import { Router } from 'express';
import archiver from 'archiver';
import { config } from '../config.js';
import { Event, GuestLink, Media, Plan, Song, Submission } from '../models.js';
import { requirePerm } from '../auth.js';
import { addDays, bad, DATE_RE, getSettings, isId, notFound, str, token, wrap } from '../lib/util.js';
import { deleteStored, filesOf, mediaView, originalName, removeUploads, sendStored, uploader } from '../lib/media.js';
import { safeFileName, toProPresenterText } from '../lib/propresenter.js';
import { buildServicePptx } from '../lib/pptx.js';
import { eventView } from '../lib/views.js';
import { evName } from '../lib/activity.js';
import path from 'node:path';
import fs from 'node:fs';

export const plansRouter = Router();
export const songsRouter = Router();
export const mediaRouter = Router();
export const guestAdminRouter = Router();
export const submissionsRouter = Router();

// ---------- helpers ----------
async function loadEvent(id) {
  if (!isId(id)) throw notFound();
  const ev = await Event.findById(id);
  if (!ev) throw notFound('That service no longer exists.');
  return ev;
}

export async function planFor(eventId) {
  let p = await Plan.findOne({ event: eventId });
  if (!p) {
    try {
      p = await Plan.create({ event: eventId });
    } catch {
      p = await Plan.findOne({ event: eventId }); // created by a parallel request
    }
  }
  return p;
}

export function songView(s) {
  const pro = s.proMedia && typeof s.proMedia === 'object' && s.proMedia._id ? s.proMedia : null;
  return {
    id: String(s._id),
    title: s.title,
    artist: s.artist,
    ccli: s.ccli,
    lyrics: s.lyrics,
    notes: s.notes,
    updatedAt: s.updatedAt,
    pro: pro ? { id: String(pro._id), name: pro.originalName, size: pro.size, uploadedAt: pro.createdAt, url: `/api/media/${pro._id}/file` } : null,
    // the stored .pro predates the latest lyric edit, so it may not match
    proOutdated: !!(pro && s.lyricsUpdatedAt && pro.createdAt < s.lyricsUpdatedAt),
  };
}

const guestView = (g) => ({ id: String(g._id), name: g.name, note: g.note, expiresAt: g.expiresAt, active: !g.revoked && g.expiresAt > new Date(), url: `${config.publicUrl}/guest/${g.token}` });

function submissionView(s) {
  return {
    id: String(s._id),
    kind: s.kind,
    status: s.status,
    data: s.data,
    media: s.media && s.media._id ? mediaView(s.media) : null,
    guestName: s.guest?.name || '',
    createdAt: s.createdAt,
    decidedAt: s.decidedAt,
  };
}

function readScriptures(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 50)
    .map((x) => ({ reference: str(x?.reference, 120), version: str(x?.version, 30), text: str(x?.text, 20000) }))
    .filter((x) => x.reference);
}

async function readPlanSongs(list) {
  if (!Array.isArray(list)) return [];
  const ids = list.map((x) => x?.song).filter(isId);
  const found = new Set((await Song.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((s) => String(s._id)));
  return list
    .filter((x) => found.has(String(x?.song)))
    .slice(0, 40)
    .map((x) => ({ song: x.song, key: str(x.key, 12), note: str(x.note, 300) }));
}

async function fullPlan(ev, viewerCan) {
  const plan = await planFor(ev._id);
  await plan.populate({ path: 'songs.song', populate: { path: 'proMedia' } });
  await plan.populate('updatedBy', 'name');
  const mediaFilter = { plan: plan._id, status: viewerCan.plans ? { $in: ['approved', 'pending'] } : 'approved' };
  const media = await Media.find(mediaFilter).sort({ createdAt: 1 }).populate('uploadedBy', 'name').populate('guest', 'name');
  const out = {
    event: eventView(ev),
    speaker: plan.speaker,
    sermonTitle: plan.sermonTitle,
    notes: plan.notes,
    scriptures: plan.scriptures,
    songs: plan.songs.filter((x) => x.song).map((x) => ({ key: x.key, note: x.note, song: songView(x.song) })),
    media: media.map(mediaView),
    updatedAt: plan.updatedAt,
    updatedBy: plan.updatedBy?.name || null,
  };
  if (viewerCan.plans) {
    const [guests, subs] = await Promise.all([
      GuestLink.find({ event: ev._id }).sort({ createdAt: -1 }).limit(20),
      Submission.find({ event: ev._id }).sort({ createdAt: -1 }).limit(100).populate('guest', 'name').populate({ path: 'media', populate: { path: 'guest', select: 'name' } }),
    ]);
    out.guests = guests.map(guestView);
    out.submissions = subs.map(submissionView);
  }
  return out;
}

// Remove a service's plan, its files, guest links and submissions (used when a service is deleted).
export async function deletePlanFor(eventId) {
  const plan = await Plan.findOne({ event: eventId });
  if (plan) {
    const media = await Media.find({ plan: plan._id });
    media.forEach((m) => deleteStored(m.storedName));
    await Media.deleteMany({ plan: plan._id });
    await plan.deleteOne();
  }
  const pendingGuestMedia = await Submission.find({ event: eventId, media: { $ne: null } }).populate('media');
  pendingGuestMedia.forEach((s) => s.media && !s.media.plan && deleteStored(s.media.storedName));
  await Submission.deleteMany({ event: eventId });
  await GuestLink.deleteMany({ event: eventId });
}

// ---------- plans ----------
// GET /api/plans/summary?from=&to= — counts for the plan list
plansRouter.get('/summary', wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) throw bad('Give a from and to date.');
  const events = await Event.find({ date: { $gte: from, $lte: to } }).sort({ date: 1, start: 1 }).lean();
  const ids = events.map((e) => e._id);
  const [plans, pending] = await Promise.all([
    Plan.find({ event: { $in: ids } }).lean(),
    req.can.plans ? Submission.find({ event: { $in: ids }, status: 'pending' }, { event: 1 }).lean() : [],
  ]);
  const planBy = Object.fromEntries(plans.map((p) => [String(p.event), p]));
  const mediaCounts = {};
  if (plans.length) {
    const media = await Media.find({ plan: { $in: plans.map((p) => p._id) }, status: 'approved' }, { plan: 1 }).lean();
    for (const m of media) mediaCounts[String(m.plan)] = (mediaCounts[String(m.plan)] || 0) + 1;
  }
  const pendingBy = {};
  for (const s of pending) pendingBy[String(s.event)] = (pendingBy[String(s.event)] || 0) + 1;
  res.json(
    events.map((e) => {
      const p = planBy[String(e._id)];
      return {
        ...eventView(e),
        sermonTitle: p?.sermonTitle || '',
        speaker: p?.speaker || '',
        hasNotes: !!p?.notes,
        scriptures: p?.scriptures?.length || 0,
        songs: p?.songs?.length || 0,
        media: p ? mediaCounts[String(p._id)] || 0 : 0,
        pending: pendingBy[String(e._id)] || 0,
      };
    })
  );
}));

// GET /api/plans/pending — count of guest submissions waiting, for the tab badge
plansRouter.get('/pending', requirePerm('plans'), wrap(async (req, res) => {
  res.json({ count: await Submission.countDocuments({ status: 'pending' }) });
}));

plansRouter.get('/:eventId', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  res.json(await fullPlan(ev, req.can));
}));

plansRouter.patch('/:eventId', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const plan = await planFor(ev._id);
  const b = req.body;
  if (b.speaker !== undefined) plan.speaker = str(b.speaker, 80);
  if (b.sermonTitle !== undefined) plan.sermonTitle = str(b.sermonTitle, 160);
  if (b.notes !== undefined) plan.notes = str(b.notes, 50000);
  if (b.scriptures !== undefined) plan.scriptures = readScriptures(b.scriptures);
  if (b.songs !== undefined) plan.songs = await readPlanSongs(b.songs);
  plan.updatedBy = req.user._id;
  await plan.save();
  const what = ['sermonTitle', 'speaker', 'notes', 'scriptures', 'songs'].filter((k) => b[k] !== undefined).map((k) => ({ sermonTitle: 'sermon title', speaker: 'speaker', notes: 'notes', scriptures: 'Bible texts', songs: 'songs' })[k]);
  res.locals.activity = `Edited ${what.join(', ') || 'the plan'} · ${evName(ev)}`;
  res.json(await fullPlan(ev, req.can));
}));

plansRouter.post('/:eventId/media', requirePerm('plans'), uploader({ maxCount: 20 }), wrap(async (req, res) => {
  const files = filesOf(req);
  let ev;
  try {
    ev = await loadEvent(req.params.eventId);
  } catch (e) {
    removeUploads(files);
    throw e;
  }
  if (!files.length) throw bad('Choose at least one file.');
  const plan = await planFor(ev._id);
  await Media.insertMany(
    files.map((f) => ({ plan: plan._id, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, uploadedBy: req.user._id, status: 'approved' }))
  );
  res.status(201).json(await fullPlan(ev, req.can));
}));

// Download everything for ProPresenter: each song as an importable .txt (and its .pro if
// one is stored), the Bible texts, the pastor's notes, every uploaded file, and a PowerPoint.
plansRouter.get('/:eventId/propresenter.zip', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const plan = await planFor(ev._id);
  await plan.populate({ path: 'songs.song', populate: { path: 'proMedia' } });
  const base = safeFileName(`${ev.date} ${ev.title}`);
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${base.replace(/[^\x20-\x7e]/g, '_')}.zip"` });
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', (e) => res.destroy(e));
  zip.pipe(res);
  plan.songs.forEach((x, i) => {
    if (!x.song) return;
    const n = String(i + 1).padStart(2, '0');
    const name = safeFileName(x.song.title, 'Song');
    zip.append(toProPresenterText(x.song.lyrics), { name: `Songs/${n} ${name}.txt` });
    if (x.song.proMedia?.storedName) zip.file(path.join(config.uploadDir, x.song.proMedia.storedName), { name: `Songs/${n} ${name}.pro` });
  });
  if (plan.scriptures.length) {
    const text = plan.scriptures.map((s) => `${s.reference}${s.version ? ` (${s.version})` : ''}\n${s.text}`.trim()).join('\n\n');
    zip.append(text + '\n', { name: 'Bible texts.txt' });
  }
  const header = [ev.title, ev.date, plan.sermonTitle && `Sermon: ${plan.sermonTitle}`, plan.speaker && `Speaker: ${plan.speaker}`].filter(Boolean).join('\n');
  zip.append(`${header}\n\n${plan.notes || ''}\n`, { name: 'Service notes.txt' });
  // Everything uploaded to the plan (pictures, videos, slides, documents), as uploaded.
  const used = new Set();
  for (const m of await approvedMedia(plan)) {
    const file = path.join(config.uploadDir, m.storedName);
    if (!fs.existsSync(file)) continue;
    zip.file(file, { name: `Media/${uniqueName(m.originalName, used)}` });
  }
  // The same service as a PowerPoint, for ProPresenter's PowerPoint import.
  try {
    const { buffer } = await buildServicePptx(ev, plan, await approvedMedia(plan), (await getSettings()).orgName);
    zip.append(buffer, { name: `${base}.pptx` });
  } catch (e) {
    console.error('pptx in zip failed:', e.message);
  }
  await zip.finalize();
}));

function approvedMedia(plan) {
  return Media.find({ plan: plan._id, status: 'approved' }).sort({ createdAt: 1 });
}

// "photo.jpg", "photo (2).jpg"… so two uploads with the same name both make it into the zip.
function uniqueName(name, used) {
  const clean = safeFileName(name, 'file');
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length) || 'file';
  let out = clean;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${stem} (${n})${ext}`;
  used.add(out.toLowerCase());
  return out;
}

// The whole service as a PowerPoint: title, song lyrics, Bible texts and pictures.
plansRouter.get('/:eventId/service.pptx', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const plan = await planFor(ev._id);
  await plan.populate('songs.song');
  const { buffer, skipped } = await buildServicePptx(ev, plan, await approvedMedia(plan), (await getSettings()).orgName);
  const name = `${safeFileName(`${ev.date} ${ev.title}`)}.pptx`;
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Skipped-Media': String(skipped.length),
  });
  res.send(buffer);
}));

// ---------- songs ----------
function readSong(b) {
  const title = str(b.title, 120);
  if (!title) throw bad('Give the song a title.');
  return { title, artist: str(b.artist, 120), ccli: str(b.ccli, 20), lyrics: str(b.lyrics, 30000), notes: str(b.notes, 1000) };
}

songsRouter.get('/', wrap(async (req, res) => {
  const q = str(req.query.q, 60);
  const filter = q ? { title: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  const list = await Song.find(filter).sort({ title: 1 }).limit(200).populate('proMedia');
  res.json(list.map(songView));
}));

songsRouter.post('/', requirePerm('plans'), wrap(async (req, res) => {
  const s = await Song.create({ ...readSong(req.body), lyricsUpdatedAt: new Date(), updatedBy: req.user._id });
  res.status(201).json(songView(s));
}));

songsRouter.patch('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Song.findById(req.params.id).populate('proMedia');
  if (!s) throw notFound('That song no longer exists.');
  const input = readSong({ ...s.toObject(), ...req.body });
  if (input.lyrics !== s.lyrics) s.lyricsUpdatedAt = new Date();
  Object.assign(s, input, { updatedBy: req.user._id });
  await s.save();
  res.json(songView(s));
}));

songsRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Song.findById(req.params.id).populate('proMedia');
  if (!s) throw notFound();
  if (s.proMedia) {
    deleteStored(s.proMedia.storedName);
    await Media.deleteOne({ _id: s.proMedia._id });
  }
  await Plan.updateMany({}, { $pull: { songs: { song: s._id } } });
  await s.deleteOne();
  res.status(204).end();
}));

songsRouter.get('/:id/propresenter.txt', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Song.findById(req.params.id);
  if (!s) throw notFound();
  const name = safeFileName(s.title, 'Song');
  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}.txt"; filename*=UTF-8''${encodeURIComponent(name)}.txt`,
  });
  res.send(toProPresenterText(s.lyrics));
}));

// Attach (or replace) the ProPresenter .pro file for a song
songsRouter.post('/:id/pro', requirePerm('plans'), uploader({ field: 'file', maxCount: 1 }), wrap(async (req, res) => {
  const files = filesOf(req);
  const s = isId(req.params.id) ? await Song.findById(req.params.id).populate('proMedia') : null;
  if (!s) {
    removeUploads(files);
    throw notFound('That song no longer exists.');
  }
  const f = files[0];
  if (!f) throw bad('Choose the .pro file.');
  const name = originalName(f);
  if (!/\.pro$/i.test(name)) {
    removeUploads(files);
    throw bad('That isn’t a ProPresenter 7 .pro file.');
  }
  if (s.proMedia) {
    deleteStored(s.proMedia.storedName);
    await Media.deleteOne({ _id: s.proMedia._id });
  }
  const m = await Media.create({ song: s._id, storedName: f.filename, originalName: name, mime: 'application/octet-stream', size: f.size, uploadedBy: req.user._id });
  s.proMedia = m._id;
  await s.save();
  await s.populate('proMedia');
  res.json(songView(s));
}));

songsRouter.delete('/:id/pro', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Song.findById(req.params.id).populate('proMedia');
  if (!s) throw notFound();
  if (s.proMedia) {
    deleteStored(s.proMedia.storedName);
    await Media.deleteOne({ _id: s.proMedia._id });
    s.proMedia = undefined;
    await s.save();
  }
  res.json(songView(s));
}));

// ---------- media ----------
mediaRouter.get('/:id/file', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findById(req.params.id);
  if (!m || m.status === 'rejected') throw notFound();
  if (m.status === 'pending' && !req.can.plans) throw notFound();
  sendStored(res, m, { download: req.query.download === '1' });
}));

mediaRouter.patch('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findById(req.params.id);
  if (!m) throw notFound();
  if (req.body.title !== undefined) m.title = str(req.body.title, 160);
  await m.save();
  res.json(mediaView(m));
}));

mediaRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findById(req.params.id);
  if (!m) throw notFound();
  if (m.song) throw bad('Remove .pro files from the song instead.');
  deleteStored(m.storedName);
  await Submission.updateMany({ media: m._id, status: 'pending' }, { status: 'rejected', decidedBy: req.user._id, decidedAt: new Date() });
  await m.deleteOne();
  res.status(204).end();
}));

// ---------- guest links (leader side) ----------
guestAdminRouter.post('/:eventId', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const name = str(req.body.name, 80);
  if (!name) throw bad('Who is this link for?');
  const g = await GuestLink.create({
    token: token(24),
    event: ev._id,
    name,
    note: str(req.body.note, 500),
    createdBy: req.user._id,
    expiresAt: new Date(Date.now() + config.guestLinkHours * 3600 * 1000),
  });
  res.status(201).json(guestView(g));
}));

guestAdminRouter.post('/link/:id/revoke', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const g = await GuestLink.findById(req.params.id);
  if (!g) throw notFound();
  g.revoked = true;
  await g.save();
  res.json(guestView(g));
}));

// ---------- approving guest submissions ----------
async function loadPendingSubmission(id) {
  if (!isId(id)) throw notFound();
  const s = await Submission.findById(id).populate('guest').populate('media');
  if (!s) throw notFound('That item no longer exists.');
  if (s.status !== 'pending') throw bad('That was already handled.');
  return s;
}

submissionsRouter.post('/:id/approve', requirePerm('plans'), wrap(async (req, res) => {
  const s = await loadPendingSubmission(req.params.id);
  const plan = await planFor(s.event);
  const who = s.guest?.name || 'a guest';
  const d = s.data || {};
  if (s.kind === 'note') {
    plan.notes = [plan.notes, `— From ${who}:\n${d.text || ''}`].filter(Boolean).join('\n\n');
  } else if (s.kind === 'scripture') {
    plan.scriptures.push({ reference: d.reference, version: d.version || '', text: d.text || '' });
  } else if (s.kind === 'song') {
    const song = await Song.create({ title: d.title, artist: d.artist || '', lyrics: d.lyrics || '', notes: `Sent by ${who}`, lyricsUpdatedAt: new Date(), updatedBy: req.user._id });
    plan.songs.push({ song: song._id, key: d.key || '', note: '' });
  } else if (s.kind === 'media') {
    if (s.media) {
      s.media.status = 'approved';
      s.media.plan = plan._id;
      await s.media.save();
    }
  }
  plan.updatedBy = req.user._id;
  await plan.save();
  s.status = 'approved';
  s.decidedBy = req.user._id;
  s.decidedAt = new Date();
  await s.save();
  res.json({ ok: true });
}));

submissionsRouter.post('/:id/reject', requirePerm('plans'), wrap(async (req, res) => {
  const s = await loadPendingSubmission(req.params.id);
  if (s.media) {
    deleteStored(s.media.storedName);
    s.media.status = 'rejected';
    await s.media.save();
  }
  s.status = 'rejected';
  s.decidedBy = req.user._id;
  s.decidedAt = new Date();
  await s.save();
  res.json({ ok: true });
}));
