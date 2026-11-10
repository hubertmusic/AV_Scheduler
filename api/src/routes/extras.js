// Extra features the admin turns on in Settings → Extra features: pre-service checklists, problem
// reports (the fix list), after-service debriefs and training sign-offs.
import { Router } from 'express';
import { Assignment, ChecklistTick, Debrief, Event, Gear, GearLog, Issue, Position, SignOff, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { addDays, bad, forbidden, getSettings, isId, notFound, str, todayIn, wrap } from '../lib/util.js';
import { featureOn, requireFeature } from '../lib/features.js';
import { evName } from '../lib/activity.js';

async function names(ids) {
  const users = await User.find({ _id: { $in: [...new Set(ids.filter(Boolean).map(String))] } }, { name: 1 }).lean();
  return Object.fromEntries(users.map((u) => [String(u._id), u.name]));
}
async function loadEvent(id) {
  if (!isId(id)) throw notFound();
  const ev = await Event.findById(id).lean();
  if (!ev) throw notFound('That service no longer exists.');
  return ev;
}
const onEvent = (eventId, userId) => Assignment.find({ event: eventId, user: userId }, { position: 1 }).lean();

// ---------- pre-service checklists ----------
export const checklistsRouter = Router();
checklistsRouter.use(requireFeature('checklists'));

async function checklistView(ev, me, can) {
  const s = await getSettings();
  const lists = s.checklists || {};
  const [positions, ticks, asg] = await Promise.all([Position.find({}).lean(), ChecklistTick.find({ event: ev._id }).lean(), Assignment.find({ event: ev._id }).lean()]);
  const label = Object.fromEntries(positions.map((p) => [p.key, p.label]));
  const who = await names([...ticks.map((t) => t.user), ...asg.map((a) => a.user)]);
  const mine = new Set(asg.filter((a) => String(a.user) === String(me._id)).map((a) => a.position.replace('+shadow', '')));
  return {
    event: { id: String(ev._id), title: ev.title, date: ev.date, call: ev.call, start: ev.start },
    positions: (ev.needs || [])
      .filter((k) => lists[k]?.length)
      .map((k) => {
        const holder = asg.find((a) => a.position === k);
        const items = lists[k].map((text) => {
          const t = ticks.find((x) => x.position === k && x.item === text);
          return { text, done: !!t, by: t ? who[String(t.user)] || '' : '', at: t?.createdAt || null };
        });
        return { key: k, label: label[k] || k, person: holder ? who[String(holder.user)] || '' : '', items, done: items.filter((i) => i.done).length, mine: mine.has(k), canTick: mine.has(k) || !!can.plans };
      }),
  };
}

checklistsRouter.get('/:eventId', wrap(async (req, res) => {
  res.json(await checklistView(await loadEvent(req.params.eventId), req.user, req.can));
}));

// POST /api/checklists/:eventId { position, item, done }
checklistsRouter.post('/:eventId', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const { position, item, done } = req.body || {};
  const s = await getSettings();
  if (!(ev.needs || []).includes(position) || !s.checklists?.[position]?.includes(item)) throw bad('That checklist item doesn’t exist.');
  const mine = (await onEvent(ev._id, req.user._id)).some((a) => a.position.replace('+shadow', '') === position);
  if (!mine && !req.can.plans) throw forbidden('Only the person on that position, or a leader, can tick its checklist.');
  if (done) await ChecklistTick.updateOne({ event: ev._id, position, item }, { $setOnInsert: { user: req.user._id } }, { upsert: true });
  else await ChecklistTick.deleteOne({ event: ev._id, position, item });
  res.json(await checklistView(ev, req.user, req.can));
}));

// ---------- problem reports (the fix list) ----------
export const issuesRouter = Router();
issuesRouter.use(requireFeature('problems'));

async function issueViews(list) {
  const who = await names(list.flatMap((i) => [i.reportedBy, i.fixedBy]));
  const evs = Object.fromEntries((await Event.find({ _id: { $in: list.map((i) => i.event).filter(Boolean) } }, { title: 1, date: 1 }).lean()).map((e) => [String(e._id), e]));
  const gear = Object.fromEntries((await Gear.find({ _id: { $in: list.map((i) => i.gear).filter(Boolean) } }, { name: 1 }).lean()).map((g) => [String(g._id), g.name]));
  return list.map((i) => ({
    id: String(i._id),
    title: i.title,
    details: i.details,
    status: i.status,
    event: i.event && evs[String(i.event)] ? { id: String(i.event), title: evs[String(i.event)].title, date: evs[String(i.event)].date } : null,
    gear: i.gear ? { id: String(i.gear), name: gear[String(i.gear)] || 'Removed item' } : null,
    reportedBy: who[String(i.reportedBy)] || '',
    createdAt: i.createdAt,
    fixedBy: who[String(i.fixedBy)] || '',
    fixedAt: i.fixedAt || null,
    fixNote: i.fixNote,
  }));
}

issuesRouter.get('/', wrap(async (req, res) => {
  const status = ['open', 'fixed'].includes(req.query.status) ? req.query.status : null;
  const list = await Issue.find(status ? { status } : {}).sort({ status: -1, createdAt: -1 }).limit(200).lean();
  res.json(await issueViews(list));
}));

export async function reportIssue({ title, details, eventId, gearId, by }) {
  const t = str(title, 120);
  if (!t) throw bad('Say what the problem is.');
  const gear = isId(gearId) ? await Gear.findById(gearId) : null;
  const ev = isId(eventId) ? await Event.exists({ _id: eventId }) : null;
  const i = await Issue.create({ title: t, details: str(details, 1000), event: ev ? eventId : undefined, gear: gear?._id, reportedBy: by });
  if (gear) {
    gear.attention ||= t;
    await gear.save();
    await GearLog.create({ gear: gear._id, action: 'attention', text: t, by });
  }
  return i;
}

issuesRouter.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const i = await reportIssue({ title: b.title, details: b.details, eventId: b.eventId, gearId: b.gearId, by: req.user._id });
  res.locals.activity = `Reported a problem: ${i.title}`;
  res.status(201).json((await issueViews([i.toObject()]))[0]);
}));

async function loadIssue(id) {
  if (!isId(id)) throw notFound();
  const i = await Issue.findById(id);
  if (!i) throw notFound('That report was deleted.');
  return i;
}

issuesRouter.post('/:id/fix', requirePerm('plans'), wrap(async (req, res) => {
  const i = await loadIssue(req.params.id);
  i.status = 'fixed';
  i.fixedBy = req.user._id;
  i.fixedAt = new Date();
  i.fixNote = str(req.body?.note, 300);
  await i.save();
  if (i.gear) {
    const g = await Gear.findById(i.gear);
    if (g && g.attention && g.attention === i.title) {
      g.attention = '';
      await g.save();
      await GearLog.create({ gear: g._id, action: 'fixed', text: i.fixNote, by: req.user._id });
    }
  }
  res.locals.activity = `Marked fixed: ${i.title}`;
  res.json((await issueViews([i.toObject()]))[0]);
}));

issuesRouter.post('/:id/reopen', requirePerm('plans'), wrap(async (req, res) => {
  const i = await loadIssue(req.params.id);
  i.status = 'open';
  i.fixedBy = undefined;
  i.fixedAt = undefined;
  await i.save();
  res.json((await issueViews([i.toObject()]))[0]);
}));

issuesRouter.delete('/:id', wrap(async (req, res) => {
  const i = await loadIssue(req.params.id);
  if (req.user.role !== 'admin' && String(i.reportedBy) !== String(req.user._id)) throw forbidden('Only the admin or whoever reported it can delete it.');
  await i.deleteOne();
  res.status(204).end();
}));

// ---------- after-service debrief ----------
export const debriefRouter = Router();
debriefRouter.use(requireFeature('debrief'));

// Services I served in the last 3 days that I haven't checked in on
debriefRouter.get('/pending', wrap(async (req, res) => {
  const today = todayIn((await getSettings()).timezone);
  const events = await Event.find({ date: { $gte: addDays(today, -3), $lte: today } }, { title: 1, date: 1, end: 1 }).lean();
  const asg = await Assignment.find({ event: { $in: events.map((e) => e._id) }, user: req.user._id }, { event: 1 }).lean();
  const done = new Set((await Debrief.find({ user: req.user._id, event: { $in: asg.map((a) => a.event) } }, { event: 1 }).lean()).map((d) => String(d.event)));
  const served = new Set(asg.map((a) => String(a.event)));
  res.json(events.filter((e) => served.has(String(e._id)) && !done.has(String(e._id))).map((e) => ({ id: String(e._id), title: e.title, date: e.date })));
}));

debriefRouter.post('/:eventId', wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  if (!(await onEvent(ev._id, req.user._id)).length && !req.can.plans) throw forbidden('Only people who served can check in on this service.');
  const b = req.body || {};
  const fields = { wentWell: str(b.wentWell, 1000), problems: str(b.problems, 1000), ideas: str(b.ideas, 1000) };
  if (!fields.wentWell && !fields.problems && !fields.ideas) throw bad('Write at least one answer.');
  await Debrief.updateOne({ event: ev._id, user: req.user._id }, { $set: fields }, { upsert: true });
  let issue = null;
  if (b.toFixList && fields.problems && (await featureOn('problems'))) {
    issue = await reportIssue({ title: fields.problems.split('\n')[0].slice(0, 120), details: fields.problems, eventId: String(ev._id), by: req.user._id });
  }
  res.locals.activity = `Checked in after ${evName(ev)}`;
  res.status(201).json({ ok: true, issue: issue ? String(issue._id) : null });
}));

debriefRouter.get('/:eventId', requirePerm('plans'), wrap(async (req, res) => {
  const ev = await loadEvent(req.params.eventId);
  const list = await Debrief.find({ event: ev._id }).sort({ createdAt: 1 }).lean();
  const who = await names(list.map((d) => d.user));
  res.json(list.map((d) => ({ name: who[String(d.user)] || 'Former member', wentWell: d.wentWell, problems: d.problems, ideas: d.ideas, at: d.updatedAt })));
}));

// ---------- training sign-offs ----------
export const signoffsRouter = Router();
signoffsRouter.use(requireFeature('signoffs'));

// POST /api/signoffs { userId, position, eventId?, note } — a Lead on that position, or the admin
signoffsRouter.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  if (!isId(b.userId) || typeof b.position !== 'string') throw bad('Pick the person and position.');
  const isLead = req.user.positions?.includes(b.position) && req.user.leads?.includes(b.position);
  if (req.user.role !== 'admin' && !isLead) throw forbidden('Only a Lead on that position, or the admin, can sign someone off.');
  const u = await User.findOne({ _id: b.userId, active: true });
  if (!u) throw notFound('That person isn’t on the team.');
  if (!u.trainee?.includes(b.position)) throw bad(`${u.name} isn’t learning that position.`);
  u.trainee = u.trainee.filter((k) => k !== b.position);
  if (!u.positions.includes(b.position)) u.positions.push(b.position);
  await u.save();
  const so = await SignOff.create({ user: u._id, position: b.position, by: req.user._id, event: isId(b.eventId) ? b.eventId : undefined, note: str(b.note, 300) });
  const pos = await Position.findOne({ key: b.position }).lean();
  res.locals.activity = `Signed off ${u.name} on ${pos?.label || b.position}`;
  res.status(201).json({ id: String(so._id), positions: u.positions, trainee: u.trainee });
}));

signoffsRouter.get('/', wrap(async (req, res) => {
  const uid = isId(req.query.userId) ? req.query.userId : String(req.user._id);
  if (uid !== String(req.user._id) && !req.can.people && req.user.role !== 'leader') throw forbidden();
  const list = await SignOff.find({ user: uid }).sort({ createdAt: -1 }).lean();
  const who = await names(list.map((s) => s.by));
  res.json(list.map((s) => ({ position: s.position, by: who[String(s.by)] || '', note: s.note, at: s.createdAt })));
}));
