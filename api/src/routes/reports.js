// Gear → Reports: problems and missing gear (anyone on AV can report; crew see what they reported),
// and for team leaders and the admin: the inventory's totals, audits, equipment requests with
// price checks, store links, and a full report to print.
import { Router } from 'express';
import { Gear, GearAudit, GearLink, GearRequest, Issue, User } from '../models.js';
import { bad, forbidden, getSettings, isId, notFound, str, wrap } from '../lib/util.js';
import { isTeamLeader } from '../lib/teams.js';
import { gearLead } from './gear.js';
import { issueViews, loadIssue, reportIssue, resolveIssue } from './extras.js';

export const reportsRouter = Router();
const lead = (req) => req.can?.plans || isTeamLeader(req);
const money = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v) * 100) / 100));

async function names(ids) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }, { name: 1 }).lean();
  return Object.fromEntries(users.map((u) => [String(u._id), u.name]));
}

// ---------- problems and missing gear ----------
reportsRouter.get('/problems', wrap(async (req, res) => {
  const q = {};
  if (['open', 'fixed'].includes(req.query.status)) q.status = req.query.status;
  if (!lead(req)) q.reportedBy = req.user._id;
  const list = await Issue.find(q).sort({ status: -1, createdAt: -1 }).limit(300).lean();
  res.json({ lead: !!lead(req), list: await issueViews(list) });
}));

reportsRouter.post('/problems', wrap(async (req, res) => {
  const b = req.body || {};
  const i = await reportIssue({ title: b.title, details: b.details, gearId: b.gearId, eventId: b.eventId, kind: b.kind, by: req.user._id });
  res.locals.activity = i.kind === 'missing' ? `Reported missing: ${i.title}` : `Reported a problem: ${i.title}`;
  res.status(201).json((await issueViews([i.toObject()]))[0]);
}));

reportsRouter.post('/problems/:id/resolve', gearLead, wrap(async (req, res) => {
  const i = await loadIssue(req.params.id);
  await resolveIssue(i, req.user._id, req.body?.note);
  res.locals.activity = `${i.kind === 'missing' ? 'Marked found' : 'Marked fixed'}: ${i.title}`;
  res.json((await issueViews([i.toObject()]))[0]);
}));

reportsRouter.post('/problems/:id/reopen', gearLead, wrap(async (req, res) => {
  const i = await loadIssue(req.params.id);
  i.status = 'open';
  i.fixedBy = undefined;
  i.fixedAt = undefined;
  await i.save();
  if (i.kind === 'missing' && i.gear) await Gear.updateOne({ _id: i.gear }, { missing: true });
  res.json((await issueViews([i.toObject()]))[0]);
}));

reportsRouter.delete('/problems/:id', wrap(async (req, res) => {
  const i = await loadIssue(req.params.id);
  if (!lead(req) && String(i.reportedBy) !== String(req.user._id)) throw forbidden('Only a team leader or whoever reported it can delete it.');
  await i.deleteOne();
  res.status(204).end();
}));

// Everything below is for team leaders and the admin
reportsRouter.use(gearLead);

// ---------- totals ----------
async function summary() {
  const gear = await Gear.find({}, { quantity: 1, cost: 1, missing: 1, attention: 1, condition: 1 }).lean();
  const reqs = await GearRequest.find({ status: { $in: ['requested', 'approved', 'ordered'] } }, { status: 1, quantity: 1, unitCost: 1 }).lean();
  const lastAudit = await GearAudit.findOne({ finishedAt: { $ne: null } }).sort({ finishedAt: -1 }).lean();
  const openAudit = await GearAudit.exists({ finishedAt: null });
  const cost = (r) => (r.unitCost || 0) * (r.quantity || 1);
  return {
    items: gear.length,
    units: gear.reduce((n, g) => n + (g.quantity ?? 1), 0),
    value: Math.round(gear.reduce((n, g) => n + (g.cost || 0) * (g.quantity ?? 1), 0) * 100) / 100,
    unpriced: gear.filter((g) => g.cost === null || g.cost === undefined).length,
    missing: gear.filter((g) => g.missing).length,
    needsFixing: gear.filter((g) => g.attention || g.condition === 'broken').length,
    openProblems: await Issue.countDocuments({ status: 'open' }),
    requests: {
      waiting: reqs.filter((r) => r.status === 'requested').length,
      waitingCost: reqs.filter((r) => r.status === 'requested').reduce((n, r) => n + cost(r), 0),
      approvedCost: reqs.filter((r) => r.status !== 'requested').reduce((n, r) => n + cost(r), 0),
    },
    lastAuditAt: lastAudit?.finishedAt || null,
    auditOpen: !!openAudit,
  };
}
reportsRouter.get('/summary', wrap(async (req, res) => res.json(await summary())));

// ---------- audits ----------
async function auditView(a, withResults = true) {
  const who = await names([a.startedBy, a.finishedBy, ...a.results.map((r) => r.by)]);
  const count = (s) => a.results.filter((r) => r.status === s).length;
  return {
    id: String(a._id),
    startedAt: a.createdAt,
    startedBy: who[String(a.startedBy)] || '',
    finishedAt: a.finishedAt,
    finishedBy: who[String(a.finishedBy)] || '',
    counts: { found: count('found'), missing: count('missing'), damaged: count('damaged'), checked: a.results.length },
    results: withResults ? a.results.map((r) => ({ gearId: String(r.gear), name: r.name, status: r.status, note: r.note, by: who[String(r.by)] || '', at: r.at })) : undefined,
  };
}
async function loadAudit(id) {
  if (!isId(id)) throw notFound();
  const a = await GearAudit.findById(id);
  if (!a) throw notFound('That audit was removed.');
  return a;
}
reportsRouter.get('/audits', wrap(async (req, res) => {
  const list = await GearAudit.find({}).sort({ createdAt: -1 }).limit(30);
  res.json(await Promise.all(list.map((a) => auditView(a, !a.finishedAt))));
}));
reportsRouter.get('/audits/:id', wrap(async (req, res) => res.json(await auditView(await loadAudit(req.params.id)))));
// Start one (or carry on with the one already going)
reportsRouter.post('/audits', wrap(async (req, res) => {
  let a = await GearAudit.findOne({ finishedAt: null });
  if (!a) {
    a = await GearAudit.create({ startedBy: req.user._id, results: [] });
    res.locals.activity = 'Started a gear audit';
  }
  res.status(201).json(await auditView(a));
}));
// { gearId, status: found | missing | damaged | null (not checked yet), note }
reportsRouter.post('/audits/:id/mark', wrap(async (req, res) => {
  const a = await loadAudit(req.params.id);
  if (a.finishedAt) throw bad('That audit is finished. Start a new one.');
  const b = req.body || {};
  if (!isId(b.gearId)) throw bad('Pick an item.');
  const g = await Gear.findById(b.gearId, { name: 1 }).lean();
  if (!g) throw notFound('That item was removed.');
  a.results = a.results.filter((r) => String(r.gear) !== String(g._id));
  if (b.status) {
    if (!['found', 'missing', 'damaged'].includes(b.status)) throw bad('Found, missing or needs repair?');
    a.results.push({ gear: g._id, name: g.name, status: b.status, note: str(b.note, 300), by: req.user._id, at: new Date() });
  }
  await a.save();
  res.json(await auditView(a));
}));
// Finish: what was found is marked as there; missing and damaged items go on the problem list
reportsRouter.post('/audits/:id/finish', wrap(async (req, res) => {
  const a = await loadAudit(req.params.id);
  if (a.finishedAt) throw bad('That audit is already finished.');
  const now = new Date();
  for (const r of a.results) {
    const g = await Gear.findById(r.gear);
    if (!g) continue;
    if (r.status === 'found' || r.status === 'damaged') {
      g.auditedAt = now;
      if (g.missing) {
        // It turned up: close what said it was missing
        for (const i of await Issue.find({ gear: g._id, kind: 'missing', status: 'open' })) await resolveIssue(i, req.user._id, 'Found in the audit');
        g.missing = false;
      }
    }
    if (r.status === 'missing' && !(await Issue.exists({ gear: g._id, kind: 'missing', status: 'open' }))) await reportIssue({ kind: 'missing', gearId: String(g._id), details: r.note || 'Not found in the audit', by: req.user._id });
    if (r.status === 'damaged' && !(await Issue.exists({ gear: g._id, kind: 'problem', status: 'open' }))) await reportIssue({ kind: 'problem', gearId: String(g._id), title: `${g.name} needs repair`, details: r.note || 'Found damaged in the audit', by: req.user._id });
    await Gear.updateOne({ _id: g._id }, { auditedAt: g.auditedAt, missing: r.status === 'missing' ? true : g.missing });
  }
  a.finishedAt = now;
  a.finishedBy = req.user._id;
  await a.save();
  const v = await auditView(a);
  res.locals.activity = `Finished a gear audit: ${v.counts.found} found, ${v.counts.missing} missing, ${v.counts.damaged} need repair`;
  res.json(v);
}));
reportsRouter.delete('/audits/:id', wrap(async (req, res) => {
  const a = await loadAudit(req.params.id);
  if (a.finishedAt && req.user.role !== 'admin') throw forbidden('Only the admin can delete a finished audit.');
  await a.deleteOne();
  res.status(204).end();
}));

// ---------- equipment requests ----------
const STATUSES = ['requested', 'approved', 'ordered', 'received', 'declined'];
async function requestViews(list) {
  const who = await names(list.flatMap((r) => [r.requestedBy, r.decidedBy]));
  return list.map((r) => ({
    id: String(r._id),
    title: r.title,
    details: r.details,
    category: r.category,
    quantity: r.quantity,
    unitCost: r.unitCost ?? null,
    total: r.unitCost ? Math.round(r.unitCost * r.quantity * 100) / 100 : null,
    links: r.links || [],
    neededBy: r.neededBy,
    status: r.status,
    note: r.note,
    requestedBy: who[String(r.requestedBy)] || '',
    decidedBy: who[String(r.decidedBy)] || '',
    decidedAt: r.decidedAt || null,
    createdAt: r.createdAt,
  }));
}
function cleanLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map((l) => ({ label: str(l?.label, 60), url: str(l?.url, 500) }))
    .filter((l) => /^https?:\/\/\S+$/i.test(l.url))
    .slice(0, 6);
}
function requestFields(r, b) {
  if (b.title !== undefined) r.title = str(b.title, 120) || r.title;
  if (b.details !== undefined) r.details = str(b.details, 1000);
  if (b.category !== undefined) r.category = str(b.category, 40);
  if (b.quantity !== undefined) r.quantity = Math.max(1, Math.min(999, Math.round(Number(b.quantity)) || 1));
  if (b.unitCost !== undefined) r.unitCost = money(b.unitCost);
  if (b.links !== undefined) r.links = cleanLinks(b.links);
  if (b.neededBy !== undefined) r.neededBy = /^\d{4}-\d{2}-\d{2}$/.test(b.neededBy) ? b.neededBy : '';
  if (b.note !== undefined) r.note = str(b.note, 300);
}
reportsRouter.get('/requests', wrap(async (req, res) => {
  const list = await GearRequest.find({}).sort({ createdAt: -1 }).limit(300).lean();
  res.json(await requestViews(list));
}));
reportsRouter.post('/requests', wrap(async (req, res) => {
  const b = req.body || {};
  if (!str(b.title, 120)) throw bad('Say what you’d like to get, e.g. “Shure SM58”.');
  const r = new GearRequest({ title: str(b.title, 120), requestedBy: req.user._id });
  requestFields(r, b);
  await r.save();
  res.locals.activity = `Requested equipment: ${r.title}`;
  res.status(201).json((await requestViews([r.toObject()]))[0]);
}));
reportsRouter.patch('/requests/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const r = await GearRequest.findById(req.params.id);
  if (!r) throw notFound('That request was removed.');
  const b = req.body || {};
  requestFields(r, b);
  if (b.status !== undefined && b.status !== r.status) {
    if (!STATUSES.includes(b.status)) throw bad('Unknown status.');
    r.status = b.status;
    r.decidedBy = req.user._id;
    r.decidedAt = new Date();
    res.locals.activity = `${{ requested: 'Reopened', approved: 'Approved', ordered: 'Ordered', received: 'Received', declined: 'Declined' }[b.status]} the request for ${r.title}`;
  }
  await r.save();
  res.json((await requestViews([r.toObject()]))[0]);
}));
reportsRouter.delete('/requests/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  await GearRequest.deleteOne({ _id: req.params.id });
  res.status(204).end();
}));

// ---------- stores and links ----------
// A starting list of stores; team leaders can fix, remove or add to it
const STORES = [
  ['Google Shopping', 'https://www.google.com/search?tbm=shop&q={q}', 'Compares prices across many stores'],
  ['Sweetwater', 'https://www.sweetwater.com/store/search.php?s={q}', 'Pro audio; free tech support'],
  ['B&H Photo', 'https://www.bhphotovideo.com/c/search?q={q}', 'Cameras, video and audio'],
  ['Guitar Center', 'https://www.guitarcenter.com/search?Ntt={q}', 'Local stores; used gear too'],
  ['Amazon', 'https://www.amazon.com/s?k={q}', 'Cables, batteries and small parts'],
  ['Reverb (used)', 'https://reverb.com/marketplace?query={q}', 'Used and vintage'],
  ['eBay (used)', 'https://www.ebay.com/sch/i.html?_nkw={q}', 'Used gear and spare parts'],
];
async function links() {
  const s = await getSettings();
  if (!s.migrations.includes('gear-stores')) {
    if (!(await GearLink.exists({}))) await GearLink.insertMany(STORES.map(([label, url, note], i) => ({ label, url, note, store: true, order: i })));
    s.migrations.push('gear-stores');
    await s.save();
  }
  const list = await GearLink.find({}).sort({ store: -1, order: 1, createdAt: 1 }).lean();
  return list.map((l) => ({ id: String(l._id), label: l.label, url: l.url, note: l.note, store: l.store }));
}
function linkFields(l, b) {
  if (b.label !== undefined) l.label = str(b.label, 60) || l.label;
  if (b.note !== undefined) l.note = str(b.note, 200);
  if (b.url !== undefined) {
    const url = str(b.url, 500);
    if (!/^https?:\/\/\S+$/i.test(url)) throw bad('Paste the whole web address, starting with https://');
    l.url = url;
    l.store = url.includes('{q}');
  }
}
reportsRouter.get('/links', wrap(async (req, res) => res.json(await links())));
reportsRouter.post('/links', wrap(async (req, res) => {
  const b = req.body || {};
  if (!str(b.label, 60)) throw bad('Give the link a name.');
  const l = new GearLink({ label: str(b.label, 60), url: 'https://x', order: (await GearLink.countDocuments({})) + 1 });
  linkFields(l, { url: b.url, note: b.note });
  await l.save();
  res.status(201).json(await links());
}));
reportsRouter.patch('/links/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const l = await GearLink.findById(req.params.id);
  if (!l) throw notFound();
  linkFields(l, req.body || {});
  await l.save();
  res.json(await links());
}));
reportsRouter.delete('/links/:id', wrap(async (req, res) => {
  if (isId(req.params.id)) await GearLink.deleteOne({ _id: req.params.id });
  res.json(await links());
}));

// ---------- the full report, to print ----------
reportsRouter.get('/full', wrap(async (req, res) => {
  const gear = await Gear.find({}).sort({ category: 1, name: 1 }).lean();
  const open = await Issue.find({ status: 'open' }).sort({ createdAt: -1 }).lean();
  const since = new Date(Date.now() - 90 * 86400e3);
  const fixed = await Issue.find({ status: 'fixed', fixedAt: { $gte: since } }).sort({ fixedAt: -1 }).limit(100).lean();
  const reqs = await GearRequest.find({ status: { $ne: 'declined' } }).sort({ status: 1, createdAt: -1 }).lean();
  const audit = await GearAudit.findOne({ finishedAt: { $ne: null } }).sort({ finishedAt: -1 });
  const st = await getSettings();
  res.json({
    church: st.orgName || '',
    at: new Date(),
    summary: await summary(),
    gear: gear.map((g) => ({
      id: String(g._id),
      name: g.name,
      category: g.category || 'Other',
      brand: g.brand || '',
      model: g.model || '',
      serial: g.serial || '',
      assetTag: g.assetTag || '',
      quantity: g.quantity ?? 1,
      location: g.location || '',
      condition: g.condition || '',
      cost: g.cost ?? null,
      purchasedOn: g.purchasedOn || '',
      missing: !!g.missing,
      attention: g.attention || '',
      auditedAt: g.auditedAt || null,
    })),
    open: await issueViews(open),
    fixed: await issueViews(fixed),
    requests: await requestViews(reqs),
    audit: audit ? await auditView(audit) : null,
  });
}));
