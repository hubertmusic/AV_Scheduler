import { Router } from 'express';
import { Assignment, Event, Request, REQUEST_TYPES, Unavailable, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { bad, conflict, forbidden, getSettings, isId, notFound, str, todayIn, wrap } from '../lib/util.js';
import { requestView } from '../lib/views.js';
import { awayByEvent } from '../lib/availability.js';
import { evName, posName } from '../lib/activity.js';

export const requestsRouter = Router();

const POP = ['from', 'event', 'targetUser', 'targetEvent', 'decidedBy'];
const populate = (q) => POP.reduce((acc, p) => acc.populate(p), q);

async function loadSlot(eventId, position) {
  if (!isId(eventId)) throw bad('Pick a shift.');
  const ev = await Event.findById(eventId);
  if (!ev || !ev.needs.includes(position)) throw bad('That shift no longer exists.');
  return ev;
}

async function upcomingCheck(ev) {
  const s = await getSettings();
  if (ev.date < todayIn(s.timezone)) throw bad('That shift has already happened.');
}

// GET /api/requests/options?type=transfer|swap&eventId=&position=
// Who you could transfer to, or which shifts you could swap with.
requestsRouter.get('/options', wrap(async (req, res) => {
  const { type, eventId, position } = req.query;
  const ev = await loadSlot(eventId, position);
  const mine = await Assignment.findOne({ event: ev._id, position, user: req.user._id });
  if (!mine) throw bad('You aren’t on that shift.');

  if (type === 'transfer') {
    const [onEvent, unav, away] = await Promise.all([
      Assignment.find({ event: ev._id }).lean(),
      Unavailable.find({ event: ev._id }).lean(),
      awayByEvent([ev]),
    ]);
    const exclude = new Set([...onEvent.map((a) => String(a.user)), ...unav.map((u) => String(u.user)), ...(away[String(ev._id)] || []), String(req.user._id)]);
    const people = await User.find({ active: true, positions: position }).sort({ name: 1 }).lean();
    return res.json(people.filter((p) => !exclude.has(String(p._id))).map((p) => ({ id: String(p._id), name: p.name })));
  }

  if (type === 'swap') {
    const s = await getSettings();
    const today = todayIn(s.timezone);
    const events = await Event.find({ date: { $gte: today }, needs: position }).sort({ date: 1, start: 1 }).lean();
    const ids = events.map((e) => e._id);
    const [asg, myUnav, myAll, onMine] = await Promise.all([
      Assignment.find({ event: { $in: ids }, position }).populate('user').lean(),
      Unavailable.find({ user: req.user._id }).lean(),
      Assignment.find({ user: req.user._id }).lean(),
      Assignment.find({ event: ev._id }).lean(),
    ]);
    // Skip services you're already on, or where the other person is already on yours.
    const blocked = new Set([...myUnav.map((u) => String(u.event)), ...myAll.map((a) => String(a.event))]);
    const busyOnMine = new Set(onMine.map((a) => String(a.user)));
    const evById = Object.fromEntries(events.map((e) => [String(e._id), e]));
    const out = asg
      .filter((a) => a.user && a.user.active && String(a.user._id) !== String(req.user._id) && String(a.event) !== String(ev._id) && !blocked.has(String(a.event)) && !busyOnMine.has(String(a.user._id)))
      .map((a) => {
        const e = evById[String(a.event)];
        return { eventId: String(e._id), position, date: e.date, title: e.title, start: e.start, userId: String(a.user._id), userName: a.user.name };
      })
      .sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
    return res.json(out);
  }
  throw bad('Unknown request type.');
}));

// POST /api/requests { type, eventId, position, targetUserId?, targetEventId?, note? }
requestsRouter.post('/', wrap(async (req, res) => {
  const { type, eventId, position } = req.body;
  if (!REQUEST_TYPES.includes(type)) throw bad('Unknown request type.');
  const ev = await loadSlot(eventId, position);
  await upcomingCheck(ev);
  const doc = { type, from: req.user._id, event: ev._id, position, note: str(req.body.note, 300) };

  const dupe = await Request.findOne({ from: req.user._id, event: ev._id, position, status: 'pending' });
  if (dupe) throw conflict('You already have a pending request for that shift.');

  const holder = await Assignment.findOne({ event: ev._id, position });
  if (type === 'pickup') {
    if (holder) throw conflict('Someone already has that spot.');
    if (!req.user.positions.includes(position)) throw bad('You aren’t trained for that position yet.');
    if (await Assignment.findOne({ event: ev._id, user: req.user._id })) throw bad('You’re already on that service.');
  } else {
    if (!holder || String(holder.user) !== String(req.user._id)) throw bad('You aren’t on that shift.');
  }

  if (type === 'transfer') {
    if (!isId(req.body.targetUserId)) throw bad('Choose who should take the shift.');
    const target = await User.findById(req.body.targetUserId);
    if (!target || !target.active) throw bad('That person isn’t active.');
    if (!target.positions.includes(position)) throw bad(`${target.name} isn’t trained for that position.`);
    doc.targetUser = target._id;
  }
  if (type === 'swap') {
    if (!isId(req.body.targetEventId)) throw bad('Choose the shift you want to trade for.');
    const tev = await loadSlot(req.body.targetEventId, position);
    const other = await Assignment.findOne({ event: tev._id, position });
    if (!other || String(other.user) === String(req.user._id)) throw bad('That shift isn’t available to trade.');
    doc.targetEvent = tev._id;
    doc.targetPosition = position;
    doc.targetUser = other.user;
  }

  const r = await Request.create(doc);
  res.locals.activity = `Asked to ${{ swap: 'swap', transfer: 'transfer', pickup: 'pick up', drop: 'drop' }[type]} ${await posName(position)} · ${evName(ev)}`;
  res.status(201).json(requestView(await populate(Request.findById(r._id))));
}));

// GET /api/requests — for leaders who approve requests
requestsRouter.get('/', requirePerm('approve'), wrap(async (req, res) => {
  const [pending, recent] = await Promise.all([
    populate(Request.find({ status: 'pending' }).sort({ createdAt: 1 })),
    populate(Request.find({ status: { $ne: 'pending' } }).sort({ updatedAt: -1 }).limit(40)),
  ]);
  res.json([...pending, ...recent].map(requestView));
}));

async function apply(r) {
  const a = await Assignment.findOne({ event: r.event, position: r.position });
  const same = (x, y) => x && y && String(x) === String(y);
  switch (r.type) {
    case 'transfer': {
      if (!a || !same(a.user, r.from)) return 'The shift changed hands before this was approved.';
      const target = await User.findById(r.targetUser);
      if (!target || !target.active) return 'The person taking the shift is no longer active.';
      if (await Assignment.findOne({ event: r.event, user: r.targetUser })) return `${target.name} is already on that service.`;
      Object.assign(a, { user: r.targetUser, confirmedAt: null, reminderEmailAt: null, waRemindedAt: null });
      await a.save();
      return null;
    }
    case 'drop':
      if (a && same(a.user, r.from)) await a.deleteOne();
      return null;
    case 'pickup':
      if (a) return 'Someone already filled this spot.';
      if (await Assignment.findOne({ event: r.event, user: r.from })) return 'They’re already on that service.';
      await Assignment.create({ event: r.event, position: r.position, user: r.from });
      return null;
    case 'swap': {
      const b = await Assignment.findOne({ event: r.targetEvent, position: r.targetPosition });
      if (!a || !b || !same(a.user, r.from) || !same(b.user, r.targetUser)) return 'One of the shifts changed before this was approved.';
      if (await Assignment.findOne({ event: r.targetEvent, user: r.from, position: { $ne: r.targetPosition } })) return 'The requester is already on the other service.';
      if (await Assignment.findOne({ event: r.event, user: r.targetUser, position: { $ne: r.position } })) return 'The other person is already on this service.';
      // Avoid a temporary duplicate by writing both sides.
      const fresh = { confirmedAt: null, reminderEmailAt: null, waRemindedAt: null };
      Object.assign(a, { user: r.targetUser, ...fresh });
      Object.assign(b, { user: r.from, ...fresh });
      await a.save();
      await b.save();
      return null;
    }
    default:
      return 'Unknown request type.';
  }
}

async function loadPending(id) {
  if (!isId(id)) throw notFound();
  const r = await Request.findById(id);
  if (!r) throw notFound('That request no longer exists.');
  if (r.status !== 'pending') throw conflict('That request was already handled.');
  return r;
}

requestsRouter.post('/:id/approve', requirePerm('approve'), wrap(async (req, res) => {
  const r = await loadPending(req.params.id);
  const problem = await apply(r);
  await r.populate(['from', 'event']);
  res.locals.activity = `${problem ? 'Tried to approve' : 'Approved'} ${r.from?.name}\u2019s ${r.type} request · ${evName(r.event)}`;
  r.status = problem ? 'denied' : 'approved';
  r.reason = problem || '';
  r.decidedBy = req.user._id;
  r.decidedAt = new Date();
  await r.save();
  res.json(requestView(await populate(Request.findById(r._id))));
}));

requestsRouter.post('/:id/deny', requirePerm('approve'), wrap(async (req, res) => {
  const r = await loadPending(req.params.id);
  r.status = 'denied';
  r.reason = str(req.body.reason, 300);
  r.decidedBy = req.user._id;
  r.decidedAt = new Date();
  await r.save();
  res.json(requestView(await populate(Request.findById(r._id))));
}));

requestsRouter.post('/:id/cancel', wrap(async (req, res) => {
  const r = await loadPending(req.params.id);
  if (String(r.from) !== String(req.user._id)) throw forbidden();
  r.status = 'cancelled';
  r.decidedAt = new Date();
  await r.save();
  res.json(requestView(await populate(Request.findById(r._id))));
}));
