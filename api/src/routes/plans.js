import crypto from 'node:crypto';
import { Router } from 'express';
import archiver from 'archiver';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { Assignment, Event, GuestLink, Media, OrderTemplate, Plan, Song, Submission, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { addDays, bad, DATE_RE, forbidden, getSettings, isId, notFound, roleIn, str, token, wrap } from '../lib/util.js';
import { isAvTeam, requireMember } from '../lib/teams.js';
import { copyStoredFile, deleteMediaFile, deleteStored, fileHash, filesOf, mediaView, originalName, removeUploads, sendStored, storedPath, uploader } from '../lib/media.js';
import { archivedQuery, isArchived, isArchivedDate, openQuery, orgToday } from '../lib/archive.js';
import { orderView, readOrder } from '../lib/serviceOrder.js';
import { applyItem, defaultSchedule, updateItem, windowState } from '../lib/guestItems.js';
import { safeFileName, toProPresenterText } from '../lib/propresenter.js';
import { buildAnnouncementsPptx, buildServicePptx } from '../lib/pptx.js';
import { eventView } from '../lib/views.js';
import { evName } from '../lib/activity.js';
import path from 'node:path';
import fs from 'node:fs';
import { requireFeature } from '../lib/features.js';

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

const ARCHIVED = 'This service is in the archive, so it can’t be changed. Use Copy to this week to reuse anything from it.';
export const escapeRx = (q) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function assertOpen(ev) {
  if (isArchived(ev, await orgToday())) throw bad(ARCHIVED);
}

// Who can change which part of a service plan:
//   lead     — team leaders (plans permission): sermon, speaker, pastor's notes, order of service,
//              guest links, archiving, everything below
//   details  — anyone on a team: Bible texts, songs (keys, chord notes), announcements, slides
//   av       — anyone on the AV team: media-library items, input list, ProPresenter files
export function planRights(req) {
  const lead = !!req.can?.plans;
  const member = lead || !!roleIn(req.user, req.team?.key);
  const av = req.user?.role === 'admin' || isAvTeam(req.team);
  return { lead, details: member, av: member && av };
}
const LEAD_ONLY = 'Only a team leader can change that part of the plan.';
const requireAvMember = (req, res, next) => (planRights(req).av ? next() : next(forbidden('That’s part of the AV team’s side.')));

// Library items for a plan, in the plan's order
async function planAssets(plan) {
  const ids = (plan.assets || []).map((a) => String(a?._id || a));
  if (!ids.length) return [];
  const found = await Media.find({ _id: { $in: ids }, library: true }).populate('uploadedBy', 'name');
  const by = Object.fromEntries(found.map((m) => [String(m._id), m]));
  return ids.map((id) => by[id]).filter(Boolean);
}

async function readAssets(list) {
  if (!Array.isArray(list)) return [];
  const ids = [...new Set(list.filter(isId))].slice(0, 60);
  const found = new Set((await Media.find({ _id: { $in: ids }, library: true, purgedAt: null }, { _id: 1 }).lean()).map((m) => String(m._id)));
  return ids.filter((id) => found.has(id));
}

export async function planFor(eventId) {
  let p = await Plan.findOne({ event: eventId });
  if (!p) {
    try {
      // A new plan starts from the order-of-service template for services of this name, if any
      const ev = await Event.findById(eventId, { title: 1, kind: 1 }).lean();
      const tpl = ev && ev.kind !== 'soundcheck' ? await OrderTemplate.findOne({ serviceTitle: ev.title }).lean() : null;
      p = await Plan.create({ event: eventId, order: tpl ? readOrder(tpl.order) : [] });
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
    retired: !!s.retired,
    pro: pro ? { id: String(pro._id), name: pro.originalName, size: pro.size, uploadedAt: pro.createdAt, url: `/api/media/${pro._id}/file` } : null,
    // the stored .pro predates the latest lyric edit, so it may not match
    proOutdated: !!(pro && s.lyricsUpdatedAt && pro.createdAt < s.lyricsUpdatedAt),
  };
}

const guestView = (g, counts = {}) => ({
  id: String(g._id),
  name: g.name,
  note: g.note,
  code: g.code || '',
  codeLocked: (g.codeTries || 0) >= 8,
  opensAt: g.opensAt || g.createdAt,
  closesAt: g.closesAt || null,
  expiresAt: g.expiresAt,
  state: windowState(g),
  active: !g.revoked && g.expiresAt > new Date(),
  url: `${config.publicUrl}/guest/${g.token}`,
  live: counts.live || 0, // items of theirs in the plan
  waiting: counts.pending || 0, // late items waiting for approval
});

function submissionView(s) {
  return {
    id: String(s._id),
    kind: s.kind,
    status: s.status,
    data: s.data,
    // a late change to something already in the plan: what it was before
    replaces: s.replaces?._id ? { data: s.replaces.data } : null,
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

async function fullPlan(ev, req) {
  const viewerCan = req.can || {};
  const rights = planRights(req);
  const plan = await planFor(ev._id);
  if (!plan.rundownToken || !plan.bulletinToken) {
    plan.rundownToken ||= token(18);
    plan.bulletinToken ||= token(18);
    await plan.save();
  }
  await plan.populate({ path: 'songs.song', populate: { path: 'proMedia' } });
  await plan.populate('updatedBy', 'name');
  const mediaFilter = { plan: plan._id, status: viewerCan.plans ? { $in: ['approved', 'pending'] } : 'approved' };
  const media = await Media.find(mediaFilter).sort({ createdAt: 1 }).populate('uploadedBy', 'name').populate('guest', 'name');
  const today = await orgToday();
  const out = {
    event: eventView(ev),
    archived: isArchived(ev, today),
    // archived by hand before its Monday: it can still be put back on the planning page
    archivedEarly: !!ev.archivedAt && !isArchivedDate(ev.date, today),
    archivedBy: ev.archivedBy ? (await User.findById(ev.archivedBy, { name: 1 }).lean())?.name || null : null,
    assets: (await planAssets(plan)).map(mediaView),
    speaker: plan.speaker,
    sermonTitle: plan.sermonTitle,
    notes: plan.notes,
    scriptures: plan.scriptures,
    songs: plan.songs.filter((x) => x.song).map((x) => ({ key: x.key, note: x.note, song: songView(x.song) })),
    media: media.map(mediaView),
    order: orderView(plan.order),
    announcements: plan.announcements,
    live: plan.live || null,
    inputs: plan.inputs || [],
    share: { rundown: plan.rundownToken, bulletin: plan.bulletinToken },
    updatedAt: plan.updatedAt,
    updatedBy: plan.updatedBy?.name || null,
    rights,
  };
  if (viewerCan.plans) {
    const [guests, subs] = await Promise.all([
      GuestLink.find({ event: ev._id }).sort({ createdAt: -1 }).limit(20),
      Submission.find({ event: ev._id, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(200).populate('guest', 'name').populate('replaces', 'data').populate({ path: 'media', populate: { path: 'guest', select: 'name' } }),
    ]);
    const counts = {};
    for (const x of subs) {
      const c = (counts[String(x.guest?._id || x.guest)] ||= {});
      c[x.status] = (c[x.status] || 0) + 1;
    }
    out.guests = guests.map((g) => guestView(g, counts[String(g._id)]));
    out.submissions = subs.map(submissionView);
  }
  return out;
}

// Remove a service's plan, its files, guest links and submissions (used when a service is deleted).
export async function deletePlanFor(eventId) {
  const plan = await Plan.findOne({ event: eventId });
  if (plan) {
    const media = await Media.find({ plan: plan._id });
    media.forEach((m) => deleteMediaFile(m));
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
  const today = await orgToday();
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
        media: p ? (mediaCounts[String(p._id)] || 0) + (p.assets?.length || 0) : 0,
        pending: pendingBy[String(e._id)] || 0,
        archived: isArchived(e, today),
        planDeleted: !!e.planDeletedAt,
      };
    })
  );
}));

// GET /api/plans/pending — count of guest submissions waiting, for the tab badge
plansRouter.get('/pending', requirePerm('plans'), wrap(async (req, res) => {
  const open = await Event.find(openQuery(await orgToday()), { _id: 1 }).lean();
  res.json({ count: await Submission.countDocuments({ status: 'pending', event: { $in: open.map((e) => e._id) } }) });
}));

// Turn down what guests sent late and close their links (a service going into the archive).
async function closeGuestsFor(eventId, by) {
  await GuestLink.updateMany({ event: eventId, revoked: { $ne: true } }, { revoked: true });
  const waiting = await Submission.find({ event: eventId, status: 'pending' }).populate('media');
  for (const s of waiting) {
    if (s.media) {
      deleteStored(s.media.storedName);
      s.media.status = 'rejected';
      await s.media.save();
    }
    s.status = 'rejected';
    s.decidedBy = by;
    s.decidedAt = new Date();
    await s.save();
  }
}

// POST /api/plans/archive-weekend { events: [eventId], delete: bool }
// Archive services now instead of waiting for Monday, so the planning page is a clean slate
// for next weekend. Saved services go to the Archive, read-only. With delete (admin only),
// their plans and files are deleted instead; the schedule of who served stays.
plansRouter.post('/archive-weekend', requirePerm('plans'), requireAvMember, wrap(async (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.events) ? [...new Set(b.events.filter(isId))].slice(0, 30) : [];
  if (!ids.length) throw bad('Pick the services to archive.');
  const del = b.delete === true;
  if (del && req.user.role !== 'admin') throw forbidden('Only the admin can delete service plans. Save them to the archive instead.');
  const events = await Event.find({ _id: { $in: ids }, ...openQuery(await orgToday()) }).sort({ date: 1, start: 1 });
  if (!events.length) throw bad('Those services are already in the archive.');
  for (const ev of events) {
    if (del) {
      await deletePlanFor(ev._id);
      ev.planDeletedAt = new Date();
    } else {
      await closeGuestsFor(ev._id, req.user._id);
    }
    ev.archivedAt = new Date();
    ev.archivedBy = req.user._id;
    await ev.save();
  }
  res.locals.activity = `${del ? 'Deleted the plans of' : 'Archived'} ${events.map(evName).join(', ')}`;
  res.json({ archived: events.length, deleted: del });
}));

// GET /api/plans/archive?q=&page= — past services, newest first. q searches service and
// sermon titles, speakers, notes, Bible references and song titles.
plansRouter.get('/archive', wrap(async (req, res) => {
  const LIMIT = 25;
  const page = Math.min(400, Math.max(0, Math.floor(Number(req.query.page) || 0)));
  const q = str(req.query.q, 80);
  const filter = { kind: 'service', planDeletedAt: null, $and: [archivedQuery(await orgToday())] };
  if (q) {
    const rx = { $regex: escapeRx(q), $options: 'i' };
    const songIds = (await Song.find({ title: rx }, { _id: 1 }).lean()).map((x) => x._id);
    const hits = await Plan.find(
      { $or: [{ sermonTitle: rx }, { speaker: rx }, { notes: rx }, { 'scriptures.reference': rx }, ...(songIds.length ? [{ 'songs.song': { $in: songIds } }] : [])] },
      { event: 1 }
    ).lean();
    filter.$and.push({ $or: [{ _id: { $in: hits.map((h) => h.event) } }, { title: rx }] });
  }
  const events = await Event.find(filter).sort({ date: -1, start: -1 }).skip(page * LIMIT).limit(LIMIT + 1).lean();
  const more = events.length > LIMIT;
  const shown = events.slice(0, LIMIT);
  const plans = await Plan.find({ event: { $in: shown.map((e) => e._id) } }).populate('songs.song', 'title').lean();
  const planBy = Object.fromEntries(plans.map((p) => [String(p.event), p]));
  const counts = {};
  for (const m of await Media.find({ plan: { $in: plans.map((p) => p._id) }, status: 'approved' }, { plan: 1 }).lean()) counts[String(m.plan)] = (counts[String(m.plan)] || 0) + 1;
  res.json({
    more,
    items: shown.map((e) => {
      const p = planBy[String(e._id)];
      return {
        ...eventView(e),
        sermonTitle: p?.sermonTitle || '',
        speaker: p?.speaker || '',
        songs: (p?.songs || []).filter((x) => x.song).map((x) => x.song.title),
        scriptures: (p?.scriptures || []).map((x) => x.reference),
        media: p ? (counts[String(p._id)] || 0) + (p.assets?.length || 0) : 0,
      };
    }),
  });
}));

plansRouter.get('/:eventId', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  res.json(await fullPlan(ev, req));
}));

// POST /api/plans/:eventId/share/rundown|bulletin — replace a share link (the old link and QR stop working)
plansRouter.post('/:eventId/share/:which', requirePerm('plans'), wrap(async (req, res) => {
  const field = { rundown: 'rundownToken', bulletin: 'bulletinToken' }[req.params.which];
  if (!field) throw notFound();
  const ev = await loadEvent(req.params.eventId);
  const plan = await planFor(ev._id);
  plan[field] = token(18);
  await plan.save();
  res.locals.activity = `Made a new ${req.params.which} link · ${evName(ev)}`;
  res.json(await fullPlan(ev, req));
}));

// POST /api/plans/:eventId/order/copy-last — start from the latest earlier service's order of
// service, preferring one with the same name. Replaces an empty order; otherwise adds to it.
plansRouter.post('/:eventId/order/copy-last', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  await assertOpen(ev);
  const withOrder = await Plan.find({ event: { $ne: ev._id }, 'order.0': { $exists: true } }, { event: 1 }).lean();
  const earlier = await Event.find({ _id: { $in: withOrder.map((p) => p.event) }, date: { $lte: ev.date } }).sort({ date: -1, start: -1 }).limit(50).lean();
  const src = earlier.find((e) => e.title === ev.title && e.kind === ev.kind) || earlier.find((e) => e.kind === ev.kind) || earlier[0];
  if (!src) throw bad('No earlier service has an order of service yet.');
  const [from, plan] = [await planFor(src._id), await planFor(ev._id)];
  plan.order.push(...readOrder(from.order.map((x) => x.toObject())));
  plan.updatedBy = req.user._id;
  await plan.save();
  res.locals.activity = `Copied the order of service from ${evName(src)} · ${evName(ev)}`;
  res.json({ ...(await fullPlan(ev, req)), copiedFrom: { title: src.title, date: src.date } });
}));

// ---------- input list (extra feature) ----------
export function readInputs(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 96)
    .map((r) => ({ ch: str(r?.ch, 8), source: str(r?.source, 80), mic: str(r?.mic, 60), stand: str(r?.stand, 40), notes: str(r?.notes, 120) }))
    .filter((r) => r.ch || r.source || r.mic);
}

// POST /api/plans/:eventId/inputs/copy-last — the latest earlier service's input list (same name first)
plansRouter.post('/:eventId/inputs/copy-last', requireFeature('inputList'), requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  await assertOpen(ev);
  const withInputs = await Plan.find({ event: { $ne: ev._id }, 'inputs.0': { $exists: true } }, { event: 1 }).lean();
  const earlier = await Event.find({ _id: { $in: withInputs.map((p) => p.event) }, date: { $lte: ev.date } }).sort({ date: -1, start: -1 }).limit(50).lean();
  const src = earlier.find((e) => e.title === ev.title) || earlier[0];
  if (!src) throw bad('No earlier service has an input list yet.');
  const [from, plan] = [await planFor(src._id), await planFor(ev._id)];
  plan.inputs = readInputs(from.inputs);
  plan.markModified('inputs');
  plan.updatedBy = req.user._id;
  await plan.save();
  res.locals.activity = `Copied the input list from ${evName(src)} · ${evName(ev)}`;
  res.json({ ...(await fullPlan(ev, req)), copiedFrom: { title: src.title, date: src.date } });
}));

// ---------- live run-of-show (extra feature) ----------
// GET: the order and live state, polled by the booth view every couple of seconds
plansRouter.get('/:eventId/live', requireFeature('liveShow'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const plan = await planFor(ev._id);
  res.set('Cache-Control', 'no-store');
  res.json({ event: eventView(ev), order: orderView(plan.order), live: plan.live || null, now: new Date(), stageToken: plan.rundownToken });
}));

// POST { action: start | next | prev | goto | end | reset, index } — leaders, or anyone on this service
plansRouter.post('/:eventId/live', requireFeature('liveShow'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  if (!req.can.plans && !(await Assignment.exists({ event: ev._id, user: req.user._id }))) throw forbidden('Only the crew on this service, or a leader, can run the live rundown.');
  const plan = await planFor(ev._id);
  const lines = plan.order;
  const playable = lines.map((x, i) => (x.kind === 'heading' ? -1 : i)).filter((i) => i >= 0);
  if (!playable.length) throw bad('Add items to the order of service first.');
  const now = new Date();
  const live = plan.live ? { ...plan.live, log: [...(plan.live.log || [])] } : null;
  const goTo = (i) => {
    live.index = i;
    live.itemAt = now;
    live.endedAt = null;
    live.log.push({ index: i, title: lines[i].title, at: now });
  };
  const { action } = req.body || {};
  if (action === 'start') {
    Object.assign(plan, { live: { startedAt: now, index: playable[0], itemAt: now, endedAt: null, log: [{ index: playable[0], title: lines[playable[0]].title, at: now }] } });
  } else if (action === 'reset') {
    plan.live = null;
  } else {
    if (!live) throw bad('Press Start first.');
    const pos = playable.indexOf(live.index);
    if (action === 'next') {
      if (pos < playable.length - 1) goTo(playable[pos + 1]);
      else live.endedAt = now;
    } else if (action === 'prev') {
      if (pos > 0) goTo(playable[pos - 1]);
    } else if (action === 'goto') {
      const i = Number(req.body.index);
      if (!playable.includes(i)) throw bad('Pick an item in the order.');
      goTo(i);
    } else if (action === 'end') {
      live.endedAt = now;
    } else throw bad('Unknown action.');
    plan.live = live;
  }
  plan.markModified('live');
  await plan.save();
  res.json({ event: eventView(ev), order: orderView(plan.order), live: plan.live || null, now, stageToken: plan.rundownToken });
}));

// POST /api/plans/:eventId/order/template/:id — add a saved template's lines to the order
plansRouter.post('/:eventId/order/template/:id', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  await assertOpen(ev);
  if (!isId(req.params.id)) throw notFound();
  const tpl = await OrderTemplate.findById(req.params.id).lean();
  if (!tpl) throw notFound('That template was deleted.');
  const plan = await planFor(ev._id);
  plan.order.push(...readOrder(tpl.order));
  plan.updatedBy = req.user._id;
  await plan.save();
  res.locals.activity = `Added the “${tpl.name}” template to the order of service · ${evName(ev)}`;
  res.json(await fullPlan(ev, req));
}));

// GET /api/plans/:eventId/announcements.pptx — the bulletin's announcements as slides
plansRouter.get('/:eventId/announcements.pptx', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const plan = await planFor(ev._id);
  if (!plan.announcements.trim()) throw bad('Add announcements to the plan first.');
  const buffer = await buildAnnouncementsPptx(ev, plan.announcements, (await getSettings()).orgName);
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.set('Content-Disposition', `attachment; filename="announcements-${ev.date}.pptx"`);
  res.send(buffer);
}));

// Put a service archived by hand back on the planning page (only until its Monday).
plansRouter.post('/:eventId/unarchive', requirePerm('plans'), requireAvMember, wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  if (!ev.archivedAt) throw bad('That service isn’t archived.');
  if (ev.planDeletedAt) throw bad('That service’s plan was deleted, so there’s nothing to put back.');
  if (isArchivedDate(ev.date, await orgToday())) throw bad('That service has passed, so it stays in the archive. Use Copy to this week to reuse anything from it.');
  ev.archivedAt = null;
  ev.archivedBy = undefined;
  await ev.save();
  res.locals.activity = `Put ${evName(ev)} back on the planning page`;
  res.json(await fullPlan(ev, req));
}));

plansRouter.patch('/:eventId', requireMember, wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  await assertOpen(ev);
  const plan = await planFor(ev._id);
  const b = req.body || {};
  const rights = planRights(req);
  const has = (k) => b[k] !== undefined;
  if (!rights.lead && ['speaker', 'sermonTitle', 'notes', 'order'].some(has)) throw forbidden(LEAD_ONLY);
  if (!rights.av && ['assets', 'inputs'].some(has)) throw forbidden('The media library and input list are part of the AV team’s side.');
  if (b.speaker !== undefined) plan.speaker = str(b.speaker, 80);
  if (b.sermonTitle !== undefined) plan.sermonTitle = str(b.sermonTitle, 160);
  if (b.notes !== undefined) plan.notes = str(b.notes, 50000);
  if (b.scriptures !== undefined) plan.scriptures = readScriptures(b.scriptures);
  if (b.songs !== undefined) plan.songs = await readPlanSongs(b.songs);
  if (b.assets !== undefined) plan.assets = await readAssets(b.assets);
  if (b.order !== undefined) plan.order = readOrder(b.order);
  if (b.announcements !== undefined) plan.announcements = str(b.announcements, 5000);
  if (b.inputs !== undefined) {
    plan.inputs = readInputs(b.inputs);
    plan.markModified('inputs');
  }
  plan.updatedBy = req.user._id;
  await plan.save();
  const names = { sermonTitle: 'sermon title', speaker: 'speaker', notes: 'notes', scriptures: 'Bible texts', songs: 'songs', assets: 'library items', order: 'order of service', announcements: 'announcements' };
  const what = Object.keys(names).filter((k) => b[k] !== undefined).map((k) => names[k]);
  res.locals.activity = `Edited ${what.join(', ') || 'the plan'} · ${evName(ev)}`;
  res.json(await fullPlan(ev, req));
}));

// POST /api/plans/:eventId/copy — reuse parts of another (usually archived) service in this one.
// Body: { from: eventId, order, sermon, notes, scriptures, songs, assets: booleans, media: [mediaId] }
plansRouter.post('/:eventId/copy', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  await assertOpen(ev);
  const b = req.body || {};
  const src = await loadEvent(typeof b.from === 'string' ? b.from : '');
  if (String(src._id) === String(ev._id)) throw bad('Pick a different service to copy from.');
  const [from, plan] = [await planFor(src._id), await planFor(ev._id)];
  const done = [];
  const failed = [];
  if (b.order && from.order.length) {
    plan.order.push(...readOrder(from.order.map((x) => x.toObject())));
    done.push('order of service');
  }
  if (b.sermon && (from.sermonTitle || from.speaker)) {
    plan.sermonTitle = from.sermonTitle;
    plan.speaker = from.speaker;
    done.push('sermon title');
  }
  if (b.notes && from.notes) {
    const when = DateTime.fromISO(src.date).toFormat('LLL d, yyyy');
    plan.notes = [plan.notes, `— From ${src.title}, ${when}:\n${from.notes}`].filter(Boolean).join('\n\n').slice(0, 50000);
    done.push('notes');
  }
  if (b.scriptures && from.scriptures.length) {
    const have = new Set(plan.scriptures.map((x) => `${x.reference}|${x.version}`.toLowerCase()));
    const add = from.scriptures.filter((x) => !have.has(`${x.reference}|${x.version}`.toLowerCase()));
    plan.scriptures.push(...add.map((x) => ({ reference: x.reference, version: x.version, text: x.text })));
    if (add.length) done.push(`${add.length} Bible text${add.length === 1 ? '' : 's'}`);
  }
  if (b.songs && from.songs.length) {
    const have = new Set(plan.songs.map((x) => String(x.song)));
    const add = from.songs.filter((x) => x.song && !have.has(String(x.song))).slice(0, Math.max(0, 40 - plan.songs.length));
    plan.songs.push(...add.map((x) => ({ song: x.song, key: x.key, note: x.note })));
    if (add.length) {
      await Song.updateMany({ _id: { $in: add.map((x) => x.song) } }, { $set: { retired: false } }); // back in use
      done.push(`${add.length} song${add.length === 1 ? '' : 's'}`);
    }
  }
  if (b.assets && from.assets?.length) {
    const have = new Set((plan.assets || []).map(String));
    const add = (await readAssets(from.assets.map(String))).filter((id) => !have.has(id));
    plan.assets = [...(plan.assets || []), ...add];
    if (add.length) done.push(`${add.length} library item${add.length === 1 ? '' : 's'}`);
  }
  const mediaIds = (Array.isArray(b.media) ? b.media : []).filter(isId).slice(0, 40);
  if (mediaIds.length) {
    let n = 0;
    for (const m of await Media.find({ _id: { $in: mediaIds }, plan: from._id, status: 'approved' }).sort({ createdAt: 1 })) {
      try {
        const storedName = await copyStoredFile(m);
        await Media.create({ plan: plan._id, storedName, originalName: m.originalName, title: m.title, mime: m.mime, size: m.size, sha256: m.sha256, uploadedBy: req.user._id, status: 'approved' });
        n++;
      } catch (e) {
        failed.push(`${m.title || m.originalName}: ${e.message}`);
      }
    }
    if (n) done.push(`${n} file${n === 1 ? '' : 's'}`);
  }
  plan.updatedBy = req.user._id;
  await plan.save();
  res.locals.activity = `Copied ${done.join(', ') || 'nothing'} from ${evName(src)} · ${evName(ev)}`;
  res.json({ ...(await fullPlan(ev, req)), copied: done, failed });
}));

plansRouter.post('/:eventId/media', requireMember, uploader({ maxCount: 20 }), wrap(async (req, res) => {
  const files = filesOf(req);
  let ev;
  try {
    ev = await loadEvent(req.params.eventId);
    await assertOpen(ev);
  } catch (e) {
    removeUploads(files);
    throw e;
  }
  if (!files.length) throw bad('Choose at least one file.');
  const plan = await planFor(ev._id);
  // A file that's already in the media library gets linked instead of stored again.
  const linked = [];
  const rows = [];
  for (const f of files) {
    const sha256 = await fileHash(f.path).catch(() => '');
    const lib = sha256 ? await Media.findOne({ library: true, sha256, purgedAt: null }) : null;
    if (lib) {
      removeUploads([f]);
      if (!(plan.assets || []).some((a) => String(a) === String(lib._id))) plan.assets.push(lib._id);
      linked.push(lib.title || lib.originalName);
      continue;
    }
    rows.push({ plan: plan._id, storedName: f.filename, originalName: originalName(f), mime: f.mimetype, size: f.size, sha256, uploadedBy: req.user._id, status: 'approved' });
  }
  if (rows.length) await Media.insertMany(rows);
  if (linked.length) await plan.save();
  res.status(201).json({ ...(await fullPlan(ev, req)), linked });
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
    const pro = x.song.proMedia && storedPath(x.song.proMedia);
    if (pro && fs.existsSync(pro)) zip.file(pro, { name: `Songs/${n} ${name}.pro` });
  });
  if (plan.scriptures.length) {
    const text = plan.scriptures.map((s) => `${s.reference}${s.version ? ` (${s.version})` : ''}\n${s.text}`.trim()).join('\n\n');
    zip.append(text + '\n', { name: 'Bible texts.txt' });
  }
  const header = [ev.title, ev.date, plan.sermonTitle && `Sermon: ${plan.sermonTitle}`, plan.speaker && `Speaker: ${plan.speaker}`].filter(Boolean).join('\n');
  zip.append(`${header}\n\n${plan.notes || ''}\n`, { name: 'Service notes.txt' });
  // Everything uploaded to the plan (pictures, videos, slides, documents), as uploaded.
  const used = new Set();
  const files = await planFiles(plan);
  for (const m of files) {
    const file = !m.purgedAt && storedPath(m);
    if (!file || !fs.existsSync(file)) continue; // removed, or in the archive while the NAS is off
    zip.file(file, { name: `Media/${uniqueName(m.originalName, used)}` });
  }
  // The same service as a PowerPoint, for ProPresenter's PowerPoint import.
  try {
    const { buffer } = await buildServicePptx(ev, plan, files, (await getSettings()).orgName);
    zip.append(buffer, { name: `${base}.pptx` });
  } catch (e) {
    console.error('pptx in zip failed:', e.message);
  }
  await zip.finalize();
}));

// Everything a service uses: its own uploads, then the library items it links to
async function planFiles(plan) {
  const own = await Media.find({ plan: plan._id, status: 'approved' }).sort({ createdAt: 1 });
  return [...own, ...(await planAssets(plan))];
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
  const { buffer, skipped } = await buildServicePptx(ev, plan, await planFiles(plan), (await getSettings()).orgName);
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
  return { title, artist: str(b.artist, 120), ccli: str(b.ccli, 20), lyrics: str(b.lyrics, 30000), notes: str(b.notes, 5000) };
}

// When each song was sung: services up to today, newest first. { songId: ['2026-11-07', …] }
async function songDates({ from = '', to } = {}) {
  const plans = await Plan.find({ 'songs.0': { $exists: true } }, { event: 1, songs: 1 }).lean();
  const range = { $lte: to };
  if (from) range.$gte = from;
  const events = await Event.find({ _id: { $in: plans.map((p) => p.event) }, date: range, kind: 'service' }, { date: 1 }).lean();
  const dateOf = Object.fromEntries(events.map((e) => [String(e._id), e.date]));
  const out = {};
  for (const p of plans) {
    const date = dateOf[String(p.event)];
    if (!date) continue;
    for (const x of p.songs) if (x.song) (out[String(x.song)] ||= []).push(date);
  }
  for (const k of Object.keys(out)) out[k].sort().reverse();
  return out;
}

songsRouter.get('/', wrap(async (req, res) => {
  const q = str(req.query.q, 60);
  const filter = q ? { title: { $regex: escapeRx(q), $options: 'i' } } : {};
  if (req.query.all !== '1') filter.retired = { $ne: true };
  const list = await Song.find(filter).sort({ title: 1 }).limit(200).populate('proMedia');
  const today = await orgToday();
  const yearAgo = addDays(today, -365);
  const dates = await songDates({ to: today });
  res.json(
    list.map((s) => {
      const d = dates[String(s._id)] || [];
      return { ...songView(s), lastUsed: d[0] || null, usedThisYear: d.filter((x) => x >= yearAgo).length, timesUsed: d.length };
    })
  );
}));

// GET /api/songs/usage.csv?from=&to= — songs sung in a date range, for a CCLI usage report
songsRouter.get('/usage.csv', requirePerm('plans'), wrap(async (req, res) => {
  const today = await orgToday();
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : addDays(today, -183);
  const to = DATE_RE.test(req.query.to || '') && req.query.to < today ? req.query.to : today;
  const dates = await songDates({ from, to });
  const songs = await Song.find({ _id: { $in: Object.keys(dates) } }).lean();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Title', 'Author', 'CCLI Song #', 'Times used', 'Dates'].map(cell).join(',')];
  songs
    .map((s) => ({ s, d: dates[String(s._id)] }))
    .sort((a, b) => b.d.length - a.d.length || a.s.title.localeCompare(b.s.title))
    .forEach(({ s, d }) => lines.push([s.title, s.artist, s.ccli, d.length, [...d].reverse().join(' ')].map(cell).join(',')));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="song-usage-${from}-to-${to}.csv"` });
  res.send('\ufeff' + lines.join('\r\n') + '\r\n');
}));

songsRouter.post('/', requireMember, wrap(async (req, res) => {
  const s = await Song.create({ ...readSong(req.body), lyricsUpdatedAt: new Date(), updatedBy: req.user._id });
  res.status(201).json(songView(s));
}));

songsRouter.patch('/:id', requireMember, wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  if (req.body.retired !== undefined && !req.can.plans) throw forbidden('Only a team leader can retire a song.');
  const s = await Song.findById(req.params.id).populate('proMedia');
  if (!s) throw notFound('That song no longer exists.');
  const input = readSong({ ...s.toObject(), ...req.body });
  if (input.lyrics !== s.lyrics) s.lyricsUpdatedAt = new Date();
  Object.assign(s, input, { updatedBy: req.user._id });
  if (req.body.retired !== undefined) s.retired = !!req.body.retired;
  await s.save();
  res.json(songView(s));
}));

// A song that past services used is retired (hidden but kept, so their plans still list it).
// Otherwise it's deleted.
songsRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const s = await Song.findById(req.params.id).populate('proMedia');
  if (!s) throw notFound();
  const today = await orgToday();
  const used = await Plan.find({ 'songs.song': s._id }, { event: 1 }).lean();
  const past = used.length ? await Event.countDocuments({ _id: { $in: used.map((p) => p.event) }, ...archivedQuery(today) }) : 0;
  if (past) {
    const upcoming = await Event.find({ _id: { $in: used.map((p) => p.event) }, ...openQuery(today) }, { _id: 1 }).lean();
    for (const p of await Plan.find({ event: { $in: upcoming.map((e) => e._id) }, 'songs.song': s._id })) {
      p.songs = p.songs.filter((x) => String(x.song) !== String(s._id));
      await p.save();
    }
    s.retired = true;
    await s.save();
    return res.json({ retired: true, song: songView(s) });
  }
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
songsRouter.post('/:id/pro', requireAvMember, uploader({ field: 'file', maxCount: 1 }), wrap(async (req, res) => {
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

songsRouter.delete('/:id/pro', requireAvMember, wrap(async (req, res) => {
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

// Leaders can rename or remove any service file; others only the files they uploaded
const ownsMedia = (req, m) => req.can.plans || (!m.library && !m.song && String(m.uploadedBy) === String(req.user._id));

mediaRouter.patch('/:id', requireMember, wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findById(req.params.id);
  if (!m) throw notFound();
  if (!ownsMedia(req, m)) throw forbidden('Only a team leader, or the person who added this file, can rename it.');
  if (req.body.title !== undefined) m.title = str(req.body.title, 160);
  await m.save();
  res.json(mediaView(m));
}));

mediaRouter.delete('/:id', requireMember, wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await Media.findById(req.params.id);
  if (!m) throw notFound();
  if (!ownsMedia(req, m)) throw forbidden('Only a team leader, or the person who added this file, can remove it.');
  if (m.song) throw bad('Remove .pro files from the song instead.');
  if (m.library) throw bad('That’s in the media library. Take it out of the service instead, or delete it from the library.');
  const plan = m.plan ? await Plan.findById(m.plan, { event: 1 }).lean() : null;
  const ev = plan ? await Event.findById(plan.event, { date: 1, archivedAt: 1 }).lean() : null;
  if (ev && isArchived(ev, await orgToday())) {
    // Archived service: free the space but keep the record, so the plan shows what was used.
    if (!m.purgedAt) {
      deleteMediaFile(m);
      m.purgedAt = new Date();
      await m.save();
    }
    return res.status(204).end();
  }
  deleteMediaFile(m);
  await Submission.updateMany({ media: m._id, status: 'pending' }, { status: 'rejected', decidedBy: req.user._id, decidedAt: new Date() });
  await m.deleteOne();
  res.status(204).end();
}));

// ---------- guest links (leader side) ----------
guestAdminRouter.post('/:eventId', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  await assertOpen(ev);
  const name = str(req.body.name, 80);
  if (!name) throw bad('Who is this link for?');
  const sched = defaultSchedule(ev, (await getSettings()).timezone);
  const g = new GuestLink({ token: token(24), event: ev._id, name, note: str(req.body.note, 500), createdBy: req.user._id, code: newCode(), ...sched });
  applySchedule(g, req.body);
  await g.save();
  res.locals.activity = `Made a guest link for ${name} · ${evName(ev)}`;
  res.status(201).json(guestView(g));
}));

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const dateIn = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);

// Set a link's window from { opensAt, closesAt } (ISO times). The link stays usable until at
// least an hour after it locks, so late changes can still be sent for approval.
function applySchedule(g, b = {}) {
  const opens = dateIn(b.opensAt);
  const closes = dateIn(b.closesAt);
  if (opens) g.opensAt = opens;
  if (closes) g.closesAt = closes;
  if (g.closesAt <= g.opensAt) throw bad('The deadline has to be after the time it opens.');
  const minEnd = new Date(g.closesAt.getTime() + 3600 * 1000);
  if (g.expiresAt < minEnd) g.expiresAt = minEnd;
}

async function loadLinkForLeader(id) {
  if (!isId(id)) throw notFound();
  const g = await GuestLink.findById(id).populate('event');
  if (!g || !g.event) throw notFound();
  return g;
}

// Change the schedule or note: { opensAt, closesAt, note }
guestAdminRouter.patch('/link/:id', requirePerm('plans'), wrap(async (req, res) => {
  const g = await loadLinkForLeader(req.params.id);
  if (!g.code) throw bad('This is an older link without a schedule. Make a new link instead.');
  if (req.body.note !== undefined) g.note = str(req.body.note, 500);
  applySchedule(g, req.body);
  await g.save();
  res.locals.activity = `Changed ${g.name}’s guest link schedule · ${evName(g.event)}`;
  res.json(guestView(g));
}));

// Open it again for a while after the deadline: { minutes }
guestAdminRouter.post('/link/:id/reopen', requirePerm('plans'), wrap(async (req, res) => {
  const g = await loadLinkForLeader(req.params.id);
  if (!g.code) throw bad('This is an older link without a schedule. Make a new link instead.');
  const minutes = Math.max(15, Math.min(24 * 60, Math.round(Number(req.body.minutes) || 60)));
  const now = new Date();
  if (!g.opensAt || g.opensAt > now) g.opensAt = now;
  g.closesAt = new Date(now.getTime() + minutes * 60 * 1000);
  g.revoked = false;
  applySchedule(g);
  await g.save();
  res.locals.activity = `Reopened ${g.name}’s guest link for ${minutes} minutes · ${evName(g.event)}`;
  res.json(guestView(g));
}));

guestAdminRouter.post('/link/:id/lock', requirePerm('plans'), wrap(async (req, res) => {
  const g = await loadLinkForLeader(req.params.id);
  const now = new Date();
  if (g.opensAt > now) g.opensAt = new Date(now.getTime() - 1000);
  g.closesAt = now;
  await g.save();
  res.locals.activity = `Locked ${g.name}’s guest link · ${evName(g.event)}`;
  res.json(guestView(g));
}));

// New code: the old one (and anyone signed in with it) stops working
guestAdminRouter.post('/link/:id/new-code', requirePerm('plans'), wrap(async (req, res) => {
  const g = await loadLinkForLeader(req.params.id);
  g.code = newCode();
  g.codeVersion = (g.codeVersion || 0) + 1;
  g.codeTries = 0;
  if (!g.opensAt) g.opensAt = g.createdAt;
  if (!g.closesAt) g.closesAt = g.expiresAt;
  await g.save();
  res.locals.activity = `Made a new code for ${g.name}’s guest link · ${evName(g.event)}`;
  res.json(guestView(g));
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

// Approving puts it in the plan (or applies the change to what's already there), the same
// way it would have gone in while the guest's window was open.
submissionsRouter.post('/:id/approve', requirePerm('plans'), wrap(async (req, res) => {
  const s = await loadPendingSubmission(req.params.id);
  const plan = await planFor(s.event);
  const who = s.guest?.name || 'a guest';
  if (s.replaces) {
    const original = await Submission.findById(s.replaces);
    if (original && original.status === 'live') {
      original.applied = await updateItem(plan, original, who, s.data || {});
      original.data = s.data;
      original.markModified('applied');
      await original.save();
    } else {
      await applyItem(plan, s, who);
    }
    s.status = 'approved';
  } else {
    s.applied = await applyItem(plan, s, who);
    s.markModified('applied');
    s.status = 'live'; // the guest can keep changing it if the window is reopened
  }
  plan.updatedBy = req.user._id;
  await plan.save();
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
