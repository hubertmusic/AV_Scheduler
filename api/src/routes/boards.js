// Flow-chart boards on the Planning tab: boxes, sticky notes, decisions and team members joined
// by lines, for sketching the week. Shared by the admin and all team leaders.
import { Router } from 'express';
import { Board, User } from '../models.js';
import { bad, conflict, forbidden, isId, notFound, str, wrap } from '../lib/util.js';

export const boardsRouter = Router();
boardsRouter.use((req, res, next) => (['admin', 'leader'].includes(req.user?.role) ? next() : next(forbidden('Boards are for the admin and team leaders.'))));

export const NODE_TYPES = ['box', 'note', 'decision', 'person', 'text'];
export const COLORS = ['plain', 'yellow', 'blue', 'green', 'orange', 'red', 'purple'];
const MAX_NODES = 300;
const MAX_EDGES = 600;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);

function readNodes(list) {
  if (!Array.isArray(list)) throw bad('Board nodes are missing.');
  if (list.length > MAX_NODES) throw bad(`A board can hold up to ${MAX_NODES} boxes.`);
  const seen = new Set();
  return list
    .filter((n) => n && ID_RE.test(n.id) && !seen.has(n.id) && seen.add(n.id))
    .map((n) => ({
      id: n.id,
      type: NODE_TYPES.includes(n.type) ? n.type : 'box',
      x: num(n.x, -50000, 50000, 0),
      y: num(n.y, -50000, 50000, 0),
      w: n.w == null ? null : num(n.w, 60, 1200, null),
      h: n.h == null ? null : num(n.h, 30, 1200, null),
      label: str(n.label, 500),
      color: COLORS.includes(n.color) ? n.color : 'plain',
      personId: n.type === 'person' && isId(n.personId) ? n.personId : null,
    }));
}

function readEdges(list, nodeIds) {
  if (!Array.isArray(list)) throw bad('Board lines are missing.');
  if (list.length > MAX_EDGES) throw bad(`A board can hold up to ${MAX_EDGES} lines.`);
  const seen = new Set();
  const handle = (h) => (typeof h === 'string' && ID_RE.test(h) ? h : null);
  return list
    .filter((e) => e && ID_RE.test(e.id) && !seen.has(e.id) && nodeIds.has(e.source) && nodeIds.has(e.target) && seen.add(e.id))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: handle(e.sourceHandle), targetHandle: handle(e.targetHandle), label: str(e.label, 120), arrow: e.arrow !== false }));
}

async function names(ids) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }, { name: 1 }).lean();
  return Object.fromEntries(users.map((u) => [String(u._id), u.name]));
}

const view = (b, who = {}) => ({
  id: String(b._id),
  title: b.title,
  nodes: b.nodes,
  edges: b.edges,
  rev: b.rev,
  updatedAt: b.updatedAt,
  updatedBy: who[String(b.updatedBy)] || null,
  createdBy: who[String(b.createdBy)] || null,
  createdById: b.createdBy ? String(b.createdBy) : null,
});

async function load(id) {
  if (!isId(id)) throw notFound();
  const b = await Board.findById(id);
  if (!b) throw notFound('That board was deleted.');
  return b;
}

// A starting point for the week: what's coming up, what's needed, who covers it
function weekTemplate() {
  const n = (id, type, x, y, label, color = 'plain') => ({ id, type, x, y, w: null, h: null, label, color, personId: null });
  const nodes = [
    n('svc', 'box', 0, 0, 'This weekend’s services', 'blue'),
    n('need', 'box', 0, 140, 'What each service needs (positions, songs, media)'),
    n('enough', 'decision', 30, 290, 'Enough people?'),
    n('confirm', 'box', -230, 470, 'Confirm the crew', 'green'),
    n('fill', 'box', 230, 470, 'Move people / ask on WhatsApp', 'orange'),
    n('ideas', 'note', 380, 0, 'Ideas for this week…', 'yellow'),
  ];
  const e = (id, source, target, label = '', sourceHandle = 'b', targetHandle = 't') => ({ id, source, target, sourceHandle, targetHandle, label, arrow: true });
  return { nodes, edges: [e('e1', 'svc', 'need'), e('e2', 'need', 'enough'), e('e3', 'enough', 'confirm', 'Yes', 'l'), e('e4', 'enough', 'fill', 'No', 'r')] };
}

boardsRouter.get('/', wrap(async (req, res) => {
  const list = await Board.find({}, { title: 1, updatedAt: 1, updatedBy: 1, createdBy: 1, rev: 1, nodes: 1 }).sort({ updatedAt: -1 }).limit(200).lean();
  const who = await names(list.flatMap((b) => [b.updatedBy, b.createdBy]));
  res.json(list.map((b) => ({ ...view(b, who), nodes: undefined, edges: undefined, size: (b.nodes || []).length })));
}));

boardsRouter.post('/', wrap(async (req, res) => {
  const title = str(req.body?.title, 120) || 'Untitled board';
  const start = req.body?.template === 'week' ? weekTemplate() : { nodes: [], edges: [] };
  const b = await Board.create({ title, ...start, createdBy: req.user._id, updatedBy: req.user._id });
  res.locals.activity = `Made the board “${title}”`;
  res.status(201).json(view(b, await names([b.createdBy])));
}));

boardsRouter.get('/:id', wrap(async (req, res) => {
  const b = await load(req.params.id);
  res.json(view(b, await names([b.updatedBy, b.createdBy])));
}));

// PUT /api/boards/:id { title?, nodes, edges, rev } — rev must match, or someone else saved first
boardsRouter.put('/:id', wrap(async (req, res) => {
  const b = await load(req.params.id);
  const body = req.body || {};
  if (Number(body.rev) !== b.rev) {
    const who = await names([b.updatedBy]);
    throw conflict(`${who[String(b.updatedBy)] || 'Someone'} changed this board while you were working. Showing their latest version.`);
  }
  if (body.title !== undefined) {
    const title = str(body.title, 120);
    if (!title) throw bad('Give the board a name.');
    if (title !== b.title) res.locals.activity = `Renamed a board to “${title}”`;
    b.title = title;
  }
  if (body.nodes !== undefined) {
    b.nodes = readNodes(body.nodes);
    b.edges = readEdges(body.edges ?? b.edges, new Set(b.nodes.map((n) => n.id)));
  }
  b.rev += 1;
  b.updatedBy = req.user._id;
  b.markModified('nodes');
  b.markModified('edges');
  await b.save();
  res.json(view(b, await names([b.updatedBy, b.createdBy])));
}));

boardsRouter.delete('/:id', wrap(async (req, res) => {
  const b = await load(req.params.id);
  if (req.user.role !== 'admin' && String(b.createdBy) !== String(req.user._id)) throw forbidden('Only the person who made this board, or the admin, can delete it.');
  await b.deleteOne();
  res.locals.activity = `Deleted the board “${b.title}”`;
  res.status(204).end();
}));
