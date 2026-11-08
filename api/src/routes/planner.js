// The admin's month planner (Planning tab): who's available across a month, where spare people
// can go, a Lead on every service, and a draft of placements that only reaches the schedule when
// the admin presses Apply.
import { Router } from 'express';
import { DateTime } from 'luxon';
import { Assignment, Event, Position, User } from '../models.js';
import { requireAdmin } from '../auth.js';
import { bad, fridayOf, isId, wrap } from '../lib/util.js';
import { awayByEvent, baseOf, isShadow, monthCounts, recentLoad, slotValid, unavailableByEvent } from '../lib/availability.js';
import { planAutofill } from '../lib/autofill.js';
import { evName } from '../lib/activity.js';

export const plannerRouter = Router();
plannerRouter.use(requireAdmin);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthRange(m) {
  if (!MONTH_RE.test(m || '')) throw bad('Pick a month (YYYY-MM).');
  const first = `${m}-01`;
  return { first, last: DateTime.fromISO(first).endOf('month').toISODate() };
}
const monthEvents = ({ first, last }) => Event.find({ date: { $gte: first, $lte: last } }).sort({ date: 1, start: 1 }).lean();

// GET /api/planner/month?month=YYYY-MM
plannerRouter.get('/month', wrap(async (req, res) => {
  const range = monthRange(req.query.month);
  const events = await monthEvents(range);
  const [positions, people, asg, unav, away, recent] = await Promise.all([
    Position.find({}).sort({ order: 1 }).lean(),
    User.find({ active: true }).sort({ name: 1 }).lean(),
    Assignment.find({ event: { $in: events.map((e) => e._id) } }).lean(),
    unavailableByEvent(events),
    awayByEvent(events),
    recentLoad(range.first, 56),
  ]);
  const off = {};
  for (const e of events) {
    const eid = String(e._id);
    off[eid] = [...new Set([...(unav[eid] || []), ...(away[eid] || [])])];
  }
  res.json({
    month: req.query.month,
    positions: positions.map((p) => ({ key: p.key, label: p.label })),
    events: events.map((e) => ({ id: String(e._id), date: e.date, title: e.title, kind: e.kind || 'service', start: e.start, needs: e.needs || [], forEvent: e.forEvent ? String(e.forEvent) : null })),
    people: people.map((p) => ({ id: String(p._id), name: p.name, positions: p.positions || [], trainee: p.trainee || [], leads: (p.leads || []).filter((k) => (p.positions || []).includes(k)), maxPerMonth: p.maxPerMonth || 0, recent: recent.count[String(p._id)] || 0 })),
    unavailable: off,
    assignments: asg.map((a) => ({ eventId: String(a.event), position: a.position, userId: String(a.user), confirmed: !!a.confirmedAt })),
  });
}));

const readDraft = (list, evIds) =>
  (Array.isArray(list) ? list.slice(0, 2000) : [])
    .filter((a) => a && evIds.has(a.eventId) && typeof a.position === 'string' && isId(a.userId))
    .map((a) => ({ eventId: a.eventId, position: a.position, userId: a.userId }));

// POST /api/planner/autofill { month, draft: [{ eventId, position, userId }] }
// Proposes people for the draft's open spots, weekend by weekend, as if the draft were saved.
// Nothing is saved.
plannerRouter.post('/autofill', wrap(async (req, res) => {
  const range = monthRange(req.body?.month);
  const events = await monthEvents(range);
  const evIds = new Set(events.map((e) => String(e._id)));
  const dateOf = Object.fromEntries(events.map((e) => [String(e._id), e.date]));
  const draft = readDraft(req.body?.draft, evIds);

  // Monthly counts: the saved schedule outside this month's services, plus the draft
  const m = req.query.month || req.body.month;
  const saved = await monthCounts(range.first);
  const savedHere = await Assignment.find({ event: { $in: [...evIds] } }, { user: 1, position: 1 }).lean();
  const counts = { ...saved };
  for (const a of savedHere) if (!isShadow(a.position)) counts[String(a.user)] = (counts[String(a.user)] || 0) - 1;
  for (const a of draft) if (!isShadow(a.position)) counts[a.userId] = (counts[a.userId] || 0) + 1;

  const fridays = [...new Set(events.map((e) => fridayOf(e.date)))];
  const proposals = [];
  const unfilled = [];
  const regularNotes = [];
  for (const friday of fridays) {
    const r = await planAutofill(friday, { draft, monthly: { [m]: counts } });
    for (const p of r.proposals) {
      if (!evIds.has(p.eventId)) continue; // that weekend spills into the next month
      proposals.push(p);
      draft.push({ eventId: p.eventId, position: p.position, userId: p.userId });
      if (!isShadow(p.position)) counts[p.userId] = (counts[p.userId] || 0) + 1;
    }
    unfilled.push(...r.unfilled.filter((u) => evIds.has(u.eventId)));
    regularNotes.push(...r.regularNotes.map((n) => ({ ...n, friday })));
  }
  const weekday = events.filter((e) => !['5', '6', '7'].includes(String(DateTime.fromISO(e.date).weekday))).length;
  res.json({ proposals: proposals.sort((a, b) => dateOf[a.eventId].localeCompare(dateOf[b.eventId])), unfilled, regularNotes, weekdaySkipped: weekday });
}));

// POST /api/planner/apply { changes: [{ eventId, position, userId | null }] }
// Puts the draft on the schedule. Spots whose person changes need confirming again.
plannerRouter.post('/apply', wrap(async (req, res) => {
  const list = Array.isArray(req.body?.changes) ? req.body.changes.slice(0, 1000) : [];
  if (!list.length) throw bad('There’s nothing to apply.');
  const ids = [...new Set(list.map((c) => c?.eventId).filter(isId))];
  const events = Object.fromEntries((await Event.find({ _id: { $in: ids } }).lean()).map((e) => [String(e._id), e]));
  const users = Object.fromEntries((await User.find({ active: true }).lean()).map((u) => [String(u._id), u]));
  const skipped = [];
  const valid = [];
  for (const c of list) {
    const e = events[c?.eventId];
    if (!e) {
      skipped.push({ ...c, why: 'That service no longer exists.' });
      continue;
    }
    if (typeof c.position !== 'string' || !slotValid(e, c.position)) {
      skipped.push({ ...c, why: 'That service doesn’t need that position any more.' });
      continue;
    }
    if (c.userId) {
      const u = users[c.userId];
      const base = baseOf(c.position);
      const fits = u && (isShadow(c.position) ? u.trainee?.includes(base) || u.positions?.includes(base) : u.positions?.includes(base));
      if (!fits) {
        skipped.push({ ...c, why: u ? `${u.name} isn’t trained for that position.` : 'That person isn’t active.' });
        continue;
      }
    }
    valid.push(c);
  }

  // Clear the spots that change first, so swaps on the same service work
  let applied = 0;
  const toPlace = [];
  for (const c of valid) {
    const existing = await Assignment.findOne({ event: c.eventId, position: c.position });
    if (existing && String(existing.user) === c.userId) continue; // no change: keeps their confirmation
    if (existing) await existing.deleteOne();
    if (c.userId) toPlace.push(c);
    else if (existing) applied++;
  }
  for (const c of toPlace) {
    if (await Assignment.exists({ event: c.eventId, user: c.userId })) {
      skipped.push({ ...c, why: `${users[c.userId].name} is already on ${evName(events[c.eventId])}.` });
      continue;
    }
    await Assignment.create({ event: c.eventId, position: c.position, user: c.userId });
    applied++;
  }
  const first = Object.values(events).map((e) => e.date).sort()[0];
  res.locals.activity = `Applied the month plan${first ? ` for ${DateTime.fromISO(first).toFormat('LLLL yyyy')}` : ''}: ${applied} change${applied === 1 ? '' : 's'}`;
  res.json({ applied, skipped });
}));
