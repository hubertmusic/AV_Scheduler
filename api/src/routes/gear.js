// Gear check-out: who has the camera bag, which wireless mic went with which speaker, when the
// batteries were last swapped, and what needs fixing. Anyone signed in can take, return and log;
// leaders with plan access add and remove items.
import { Router } from 'express';
import { Gear, GearLog, User } from '../models.js';
import { requirePerm } from '../auth.js';
import { bad, isId, notFound, str, wrap } from '../lib/util.js';

export const gearRouter = Router();

async function names(ids) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }, { name: 1 }).lean();
  return Object.fromEntries(users.map((u) => [String(u._id), u.name]));
}

const view = (g, who) => ({
  id: String(g._id),
  name: g.name,
  category: g.category,
  notes: g.notes,
  holderId: g.holder ? String(g.holder) : null,
  holder: g.holder ? who[String(g.holder)] || 'Former member' : g.holderName || null,
  outAt: g.outAt,
  attention: g.attention,
  batteryAt: g.batteryAt,
});

async function load(id) {
  if (!isId(id)) throw notFound();
  const g = await Gear.findById(id);
  if (!g) throw notFound('That item was removed.');
  return g;
}
const log = (g, action, by, text = '') => GearLog.create({ gear: g._id, action, by, text: str(text, 300) });
const reply = async (res, g) => res.json(view(g, await names([g.holder])));

gearRouter.get('/', wrap(async (req, res) => {
  const list = await Gear.find({}).sort({ category: 1, name: 1 }).lean();
  const who = await names(list.map((g) => g.holder));
  res.json(list.map((g) => view(g, who)));
}));

gearRouter.post('/', requirePerm('plans'), wrap(async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) throw bad('Name the item, e.g. “Wireless mic 3”.');
  const g = await Gear.create({ name, category: str(req.body.category, 40), notes: str(req.body.notes, 300) });
  res.locals.activity = `Added ${name} to the gear list`;
  res.status(201).json(view(g, {}));
}));

gearRouter.patch('/:id', requirePerm('plans'), wrap(async (req, res) => {
  const g = await load(req.params.id);
  if (req.body.name !== undefined) g.name = str(req.body.name, 80) || g.name;
  if (req.body.category !== undefined) g.category = str(req.body.category, 40);
  if (req.body.notes !== undefined) g.notes = str(req.body.notes, 300);
  await g.save();
  await reply(res, g);
}));

gearRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  const g = await load(req.params.id);
  await GearLog.deleteMany({ gear: g._id });
  await g.deleteOne();
  res.locals.activity = `Removed ${g.name} from the gear list`;
  res.status(204).end();
}));

// POST /:id/out { userId? , name? , note? } — take it (yourself by default) or hand it to someone
gearRouter.post('/:id/out', wrap(async (req, res) => {
  const g = await load(req.params.id);
  const b = req.body || {};
  let holder = req.user._id;
  let holderName = '';
  if (b.userId) {
    if (!isId(b.userId) || !(await User.exists({ _id: b.userId, active: true }))) throw bad('Pick someone on the team.');
    holder = b.userId;
  } else if (str(b.name, 80)) {
    holder = null;
    holderName = str(b.name, 80);
  }
  g.holder = holder;
  g.holderName = holderName;
  g.outAt = new Date();
  await g.save();
  const who = holder ? (await names([holder]))[String(holder)] : holderName;
  await log(g, 'out', req.user._id, [who && `To ${who}`, b.note].filter(Boolean).join(' · '));
  res.locals.activity = `Checked out ${g.name}${who && String(holder) !== String(req.user._id) ? ` to ${who}` : ''}`;
  await reply(res, g);
}));

gearRouter.post('/:id/in', wrap(async (req, res) => {
  const g = await load(req.params.id);
  g.holder = null;
  g.holderName = '';
  g.outAt = null;
  await g.save();
  await log(g, 'in', req.user._id, req.body?.note);
  res.locals.activity = `Returned ${g.name}`;
  await reply(res, g);
}));

// POST /:id/log { action: battery | note | attention | fixed, text }
gearRouter.post('/:id/log', wrap(async (req, res) => {
  const g = await load(req.params.id);
  const action = req.body?.action;
  const text = str(req.body?.text, 300);
  if (!['battery', 'note', 'attention', 'fixed'].includes(action)) throw bad('Unknown action.');
  if ((action === 'note' || action === 'attention') && !text) throw bad(action === 'note' ? 'Write the note.' : 'Say what’s wrong with it.');
  if (action === 'battery') g.batteryAt = new Date();
  if (action === 'attention') g.attention = text;
  if (action === 'fixed') g.attention = '';
  await g.save();
  await log(g, action, req.user._id, text);
  if (action === 'attention') res.locals.activity = `Reported a problem with ${g.name}: ${text}`;
  if (action === 'fixed') res.locals.activity = `Marked ${g.name} as fixed`;
  await reply(res, g);
}));

gearRouter.get('/:id/log', wrap(async (req, res) => {
  const g = await load(req.params.id);
  const rows = await GearLog.find({ gear: g._id }).sort({ createdAt: -1 }).limit(50).lean();
  const who = await names(rows.map((r) => r.by));
  res.json(rows.map((r) => ({ action: r.action, text: r.text, by: who[String(r.by)] || '', at: r.createdAt })));
}));
