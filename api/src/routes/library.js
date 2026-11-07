// Media library: backgrounds, countdowns, logo loops and other files reused week after week.
// Services link to library items instead of holding their own copy, so nothing here is
// archived or moved to cold storage.
import { Router } from 'express';
import { Event, LIBRARY_CATEGORIES, Media, Plan } from '../models.js';
import { requireAdmin, requirePerm } from '../auth.js';
import { bad, isId, notFound, str, wrap } from '../lib/util.js';
import { copyStoredFile, deleteMediaFile, fileHash, filesOf, mediaView, originalName, removeUploads, storedPath, unavailableReason, uploader } from '../lib/media.js';
import { isArchivedDate, orgToday, runArchiveJobs, storageStatus } from '../lib/archive.js';
import { escapeRx } from './plans.js';

export const libraryRouter = Router();

const category = (v) => (LIBRARY_CATEGORIES.includes(v) ? v : 'Other');

// How often each library item is used: { id: { past, upcoming, lastUsed, nextUse } }
async function usage(ids) {
  const plans = await Plan.find({ assets: { $in: ids } }, { event: 1, assets: 1 }).lean();
  const events = await Event.find({ _id: { $in: plans.map((p) => p.event) } }, { date: 1 }).lean();
  const dateOf = Object.fromEntries(events.map((e) => [String(e._id), e.date]));
  const today = await orgToday();
  const out = {};
  for (const p of plans) {
    const date = dateOf[String(p.event)];
    if (!date) continue;
    for (const a of p.assets) {
      const u = (out[String(a)] ||= { past: 0, upcoming: 0, lastUsed: null, nextUse: null });
      if (isArchivedDate(date, today)) {
        u.past++;
        if (!u.lastUsed || date > u.lastUsed) u.lastUsed = date;
      } else {
        u.upcoming++;
        if (!u.nextUse || date < u.nextUse) u.nextUse = date;
      }
    }
  }
  return out;
}

async function unlinkAsset(id, filter = {}) {
  for (const p of await Plan.find({ ...filter, assets: id })) {
    p.assets = p.assets.filter((a) => String(a) !== String(id));
    await p.save();
  }
}

async function listView(items) {
  const u = await usage(items.map((m) => m._id));
  return items.map((m) => ({ ...mediaView(m), usage: u[String(m._id)] || { past: 0, upcoming: 0, lastUsed: null, nextUse: null } }));
}

// GET /api/library?q=&category=
libraryRouter.get('/', wrap(async (req, res) => {
  const filter = { library: true, purgedAt: null };
  const q = str(req.query.q, 60);
  if (q) filter.$or = [{ title: { $regex: escapeRx(q), $options: 'i' } }, { originalName: { $regex: escapeRx(q), $options: 'i' } }];
  if (LIBRARY_CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
  const items = await Media.find(filter).sort({ category: 1, title: 1, originalName: 1 }).limit(500).populate('uploadedBy', 'name');
  res.json({ categories: LIBRARY_CATEGORIES, items: await listView(items) });
}));

// Upload straight into the library. Files that are already there are skipped.
libraryRouter.post('/', requirePerm('plans'), uploader({ maxCount: 20 }), wrap(async (req, res) => {
  const files = filesOf(req);
  if (!files.length) throw bad('Choose at least one file.');
  const cat = category(req.body?.category);
  const added = [];
  const skipped = [];
  for (const f of files) {
    const sha256 = await fileHash(f.path).catch(() => '');
    const dup = sha256 ? await Media.findOne({ library: true, sha256, purgedAt: null }) : null;
    if (dup) {
      removeUploads([f]);
      skipped.push(`${originalName(f)} is already in the library as “${dup.title || dup.originalName}”`);
      continue;
    }
    added.push(await Media.create({ library: true, category: cat, sha256, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, uploadedBy: req.user._id, status: 'approved' }));
  }
  res.locals.activity = `Added ${added.length} file${added.length === 1 ? '' : 's'} to the media library`;
  res.status(201).json({ added: added.length, skipped });
}));

libraryRouter.patch('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findOne({ _id: req.params.id, library: true, purgedAt: null });
  if (!m) throw notFound('That library item no longer exists.');
  if (req.body.title !== undefined) m.title = str(req.body.title, 160);
  if (req.body.category !== undefined) m.category = category(req.body.category);
  await m.save();
  await m.populate('uploadedBy', 'name');
  res.json((await listView([m]))[0]);
}));

// Take it out of the library. Upcoming services lose it. If past services used it, the file is
// deleted but the record stays, so their plans still show it was used.
libraryRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findOne({ _id: req.params.id, library: true, purgedAt: null });
  if (!m) throw notFound();
  const u = (await usage([m._id]))[String(m._id)];
  deleteMediaFile(m);
  if (u?.past) {
    const today = await orgToday();
    const upcoming = await Event.find({ date: { $gte: today } }, { _id: 1 }).lean();
    await unlinkAsset(m._id, { event: { $in: upcoming.map((e) => e._id) } });
    m.purgedAt = new Date();
    await m.save();
  } else {
    await unlinkAsset(m._id);
    await m.deleteOne();
  }
  res.locals.activity = `Deleted “${m.title || m.originalName}” from the media library`;
  res.status(204).end();
}));

// POST /api/library/from-media/:mediaId — save a file from a service plan to the library.
// On a current service the file itself moves to the library and the service links to it.
// From an archived service it's copied, so the archived plan stays as it was.
libraryRouter.post('/from-media/:mediaId', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.mediaId)) throw notFound();
  const m = await Media.findOne({ _id: req.params.mediaId, library: { $ne: true }, plan: { $ne: null }, status: 'approved' });
  if (!m) throw notFound('That file no longer exists.');
  const why = unavailableReason(m);
  if (why) throw bad(`Can’t add it to the library: ${why}.`);
  const plan = await Plan.findById(m.plan);
  const ev = plan ? await Event.findById(plan.event, { date: 1 }).lean() : null;
  const open = ev && !isArchivedDate(ev.date, await orgToday());
  if (!m.sha256) {
    m.sha256 = await fileHash(storedPath(m));
    await m.save();
  }
  const cat = category(req.body?.category);
  const link = async (id) => {
    if (open && !plan.assets.some((a) => String(a) === String(id))) {
      plan.assets.push(id);
      await plan.save();
    }
  };

  const existing = await Media.findOne({ library: true, sha256: m.sha256, purgedAt: null });
  if (existing) {
    if (open) {
      await link(existing._id);
      deleteMediaFile(m);
      await m.deleteOne();
    }
    return res.json({ item: mediaView(existing), already: true });
  }
  if (open && m.location !== 'cold') {
    m.library = true;
    m.category = cat;
    m.plan = undefined;
    await m.save();
    await link(m._id);
    res.locals.activity = `Saved “${m.title || m.originalName}” to the media library`;
    return res.json({ item: mediaView(m), already: false });
  }
  const storedName = await copyStoredFile(m);
  const item = await Media.create({ library: true, category: cat, sha256: m.sha256, storedName, originalName: m.originalName, title: m.title, mime: m.mime, size: m.size, uploadedBy: req.user._id, status: 'approved' });
  res.locals.activity = `Saved “${item.title || item.originalName}” to the media library`;
  res.json({ item: mediaView(item), already: false });
}));

// ---------- storage (admin) ----------
libraryRouter.get('/storage', requireAdmin, wrap(async (req, res) => {
  res.json(await storageStatus());
}));

libraryRouter.post('/storage/run', requireAdmin, wrap(async (req, res) => {
  await runArchiveJobs();
  res.json(await storageStatus());
}));
