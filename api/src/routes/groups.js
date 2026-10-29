import { Router } from 'express';
import { Event, Group } from '../models.js';
import { requirePerm } from '../auth.js';
import { bad, getSettings, isHttpUrl, isId, normalizePhone, normalizeUrl, notFound, str, wrap } from '../lib/util.js';
import { groupView } from '../lib/views.js';

export const groupsRouter = Router();

async function readGroup(b) {
  const s = await getSettings();
  const name = str(b.name, 80);
  if (!name) throw bad('Give the group a name.');
  const groupLink = normalizeUrl(str(b.groupLink, 300));
  if (groupLink && !isHttpUrl(groupLink)) throw bad('The WhatsApp group link should start with https://');
  const members = Array.isArray(b.members)
    ? b.members
        .slice(0, 100)
        .map((m) => ({ name: str(m?.name, 80), phone: normalizePhone(m?.phone, s.countryCode), role: str(m?.role, 40) }))
        .filter((m) => m.name)
    : [];
  return {
    name,
    contactName: str(b.contactName, 80),
    phone: normalizePhone(b.phone, s.countryCode),
    groupLink,
    notes: str(b.notes, 1000),
    members,
  };
}

groupsRouter.get('/', wrap(async (req, res) => {
  const list = await Group.find({}).sort({ name: 1 });
  res.json(list.map((g) => groupView(g, req.user)));
}));

groupsRouter.post('/', requirePerm('groups'), wrap(async (req, res) => {
  const g = await Group.create(await readGroup(req.body));
  res.status(201).json(groupView(g, req.user));
}));

groupsRouter.patch('/:id', requirePerm('groups'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const g = await Group.findById(req.params.id);
  if (!g) throw notFound('That group no longer exists.');
  Object.assign(g, await readGroup({ ...g.toObject(), ...req.body }));
  await g.save();
  res.json(groupView(g, req.user));
}));

groupsRouter.delete('/:id', requirePerm('groups'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const g = await Group.findById(req.params.id);
  if (!g) throw notFound();
  await Event.updateMany({ groups: g._id }, { $pull: { groups: g._id } });
  const s = await getSettings();
  s.weekendTemplate = s.weekendTemplate.map((t) => ({ ...t.toObject(), groups: (t.groups || []).filter((id) => String(id) !== String(g._id)) }));
  await s.save();
  await g.deleteOne();
  res.status(204).end();
}));
