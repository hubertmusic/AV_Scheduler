// Chat: see who's online and message anyone on Crew Call, like Facebook chat used to be.
//  - a room for each team, for its members only (Church Admin's stays confidential)
//  - named groups anyone can start with people they pick (rename, emoji, colour, add people)
//  - one-on-one chats
// Open Crew Calls check in every few seconds (GET /sync), which is also how "online" works.
// Messages are stored encrypted, and nobody (not even the admin) reads chats they aren't in.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CHAT_COLORS, ChatMessage, ChatRoom, ChatSeen, Team, User } from '../models.js';
import { bad, forbidden, isId, membershipOf, notFound, str, wrap } from '../lib/util.js';
import { open, seal } from '../lib/secrets.js';
import { teamsShownTo } from '../lib/teams.js';
import { seesPhone } from '../lib/views.js';

export const chatRouter = Router();
const ONLINE_MS = 70 * 1000;
const MAX_TEXT = 2000;
const MAX_MEMBERS = 50;
const PAGE = 50;

// GET /api/chat/preview — "View as": the chat dock as that person sees it (who's online, their team
// rooms, how many unread), but none of what anyone wrote and not who they talk to privately.
// Read-only: it doesn't mark them online. Defined before the rule that keeps the rest of chat out.
chatRouter.get('/preview', wrap(async (req, res, next) => {
  if (!req.previewing) return next(forbidden('Only for “View as”.'));
  const now = new Date();
  const [people, rooms, teams] = await Promise.all([
    User.find({ active: true }, { name: 1, teams: 1, role: 1, chatPingAt: 1, chatAway: 1, lastSeenAt: 1 }).sort({ name: 1 }).lean(),
    ChatRoom.find(myRoomsQuery(req.user)).limit(200).lean(),
    Team.find({}, { key: 1, name: 1, kind: 1 }).sort({ order: 1, name: 1 }).lean(),
  ]);
  const names = Object.fromEntries(people.map((u) => [id(u), u.name]));
  const teamNames = Object.fromEntries(teams.map((t) => [t.key, t.name]));
  const status = (u) => (u.chatPingAt && now - u.chatPingAt < ONLINE_MS ? (u.chatAway ? 'away' : 'online') : 'offline');
  const views = await roomViews(req.user, rooms, teamNames, names);
  // Every team they're on has a room, even if nobody has opened chat there yet
  const teamRooms = myTeams(req.user)
    .filter((k) => teamNames[k])
    .map((k) => {
      const t = teams.find((x) => x.key === k);
      const v = views.find((r) => r.kind === 'team' && r.team === k);
      return { id: v?.id || `team:${k}`, kind: 'team', team: k, name: teamNames[k], emoji: v?.emoji || '', color: v?.color || (t.kind === 'office' ? 'purple' : t.kind === 'music' ? 'amber' : 'blue'), unread: v?.unread || 0 };
    });
  const privateRooms = views.filter((r) => r.kind !== 'team');
  res.json({
    me: id(req.user),
    people: people.map((u) => ({ id: id(u), name: u.name, status: status(u), lastSeen: u.chatPingAt || u.lastSeenAt || null, teams: teamsShownTo(req.user, u).map((k) => teamNames[k]).filter(Boolean) })),
    rooms: teamRooms,
    private: { chats: privateRooms.filter((r) => r.kind === 'direct').length, groups: privateRooms.filter((r) => r.kind === 'group').length, unread: privateRooms.reduce((n, r) => n + r.unread, 0) },
  });
}));
chatRouter.use((req, res, next) => (req.previewing ? next(forbidden('Chat isn’t shown in a preview.')) : next()));
const sendLimit = rateLimit({ windowMs: 60 * 1000, limit: 40, keyGenerator: (req) => String(req.user._id), standardHeaders: 'draft-7', legacyHeaders: false, validate: false, message: { error: 'That’s a lot of messages at once. Wait a moment.' } });

const id = (x) => String(x?._id || x);
const myTeams = (user) => (user.teams || []).map((m) => m.team);

// Who may read and write in a room
function inRoom(user, room) {
  if (room.kind === 'team') return !!membershipOf(user, room.team);
  return room.members.some((m) => id(m) === id(user));
}
async function loadRoom(req) {
  if (!isId(req.params.id)) throw notFound();
  const room = await ChatRoom.findById(req.params.id);
  if (!room || !inRoom(req.user, room)) throw notFound('That chat isn’t one of yours.');
  return room;
}

// Each team's room exists once someone on the team opens chat
async function ensureTeamRooms(user) {
  const keys = myTeams(user);
  if (!keys.length) return;
  const have = new Set((await ChatRoom.find({ kind: 'team', team: { $in: keys } }, { team: 1 }).lean()).map((r) => r.team));
  const teams = await Team.find({ key: { $in: keys.filter((k) => !have.has(k)) } }, { key: 1, kind: 1 }).lean();
  for (const t of teams) {
    try {
      await ChatRoom.create({ kind: 'team', team: t.key, key: `team:${t.key}`, color: t.kind === 'office' ? 'purple' : t.kind === 'music' ? 'amber' : 'blue' });
    } catch {
      /* made by a parallel request */
    }
  }
}
const myRoomsQuery = (user) => ({ $or: [{ kind: 'team', team: { $in: myTeams(user) } }, { members: user._id }] });

const messageView = (m, names) => ({
  id: id(m),
  room: id(m.room),
  user: m.user ? id(m.user) : null,
  name: m.user ? names[id(m.user)] || 'Someone' : '',
  text: m.deletedAt ? '' : (() => {
    try {
      return open(m.text);
    } catch {
      return '[can’t be read: the vault key changed]';
    }
  })(),
  system: !!m.system,
  deleted: !!m.deletedAt,
  at: m.createdAt,
});

async function roomViews(user, rooms, teamNames, names) {
  if (!rooms.length) return [];
  const ids = rooms.map((r) => r._id);
  const [seen, lasts] = await Promise.all([
    ChatSeen.find({ user: user._id, room: { $in: ids } }).lean(),
    Promise.all(rooms.map((r) => ChatMessage.findOne({ room: r._id }).sort({ createdAt: -1 }).lean())),
  ]);
  const seenAt = Object.fromEntries(seen.map((s) => [id(s.room), s.at]));
  return Promise.all(
    rooms.map(async (r, i) => {
      const last = lasts[i];
      const since = seenAt[id(r)];
      // Unread: others' messages since I last read it (capped; the badge shows 9+)
      const unread = last && (!since || last.createdAt > since) ? (await ChatMessage.find({ room: r._id, user: { $ne: user._id }, system: false, deletedAt: null, ...(since ? { createdAt: { $gt: since } } : {}) }, { _id: 1 }).limit(10).lean()).length : 0;
      const members = r.kind === 'team' ? [] : r.members.map((m) => ({ id: id(m), name: names[id(m)] || 'Someone' }));
      const other = r.kind === 'direct' ? members.find((m) => m.id !== id(user)) : null;
      const lastView = last ? messageView(last, names) : null;
      return {
        id: id(r),
        kind: r.kind,
        team: r.team || '',
        name: r.kind === 'team' ? teamNames[r.team] || 'Team' : r.kind === 'direct' ? other?.name || 'Chat' : r.name,
        emoji: r.emoji || '',
        color: r.color || 'blue',
        members,
        with: other?.id || null, // one-on-one: the other person
        owner: r.owner ? id(r.owner) : null,
        unread,
        last: lastView && { text: lastView.deleted ? 'Message removed' : lastView.text.slice(0, 80), name: lastView.name, mine: lastView.user === id(user), at: lastView.at, system: lastView.system },
        lastAt: r.lastMessageAt || r.createdAt,
      };
    })
  );
}

// GET /api/chat/sync?away=0|1&open=<roomId>,<roomId>&since=<iso>
// Checks in (online), and returns people with their status, my rooms with unread counts, and new
// messages in the rooms I have open.
chatRouter.get('/sync', wrap(async (req, res) => {
  const now = new Date();
  const away = req.query.away === '1';
  await User.updateOne({ _id: req.user._id }, { $set: { chatPingAt: now, chatAway: away } });
  await ensureTeamRooms(req.user);
  const [people, rooms, teams] = await Promise.all([
    User.find({ active: true }, { name: 1, teams: 1, role: 1, phone: 1, chatPingAt: 1, chatAway: 1, lastSeenAt: 1 }).sort({ name: 1 }).lean(),
    ChatRoom.find(myRoomsQuery(req.user)).sort({ lastMessageAt: -1 }).limit(200).lean(),
    Team.find({}, { key: 1, name: 1 }).lean(),
  ]);
  const names = Object.fromEntries(people.map((u) => [id(u), u.name]));
  const teamNames = Object.fromEntries(teams.map((t) => [t.key, t.name]));
  const status = (u) => (u.chatPingAt && now - u.chatPingAt < ONLINE_MS ? (u.chatAway ? 'away' : 'online') : 'offline');
  const out = {
    now,
    me: id(req.user),
    // phone: for the WhatsApp button, only where the viewer may see it (same rule as Team & roles)
    people: people.map((u) => ({ id: id(u), name: u.name, status: status(u), lastSeen: u.chatPingAt || u.lastSeenAt || null, teams: teamsShownTo(req.user, u).map((k) => teamNames[k]).filter(Boolean), ...(u.phone && seesPhone(u, req.user) ? { phone: u.phone } : {}) })),
    rooms: await roomViews(req.user, rooms, teamNames, names),
    messages: [],
  };
  // New messages in open rooms
  const openIds = String(req.query.open || '').split(',').filter(isId).slice(0, 6);
  const since = req.query.since ? new Date(req.query.since) : null;
  const mine = new Set(rooms.map((r) => id(r)));
  const want = openIds.filter((x) => mine.has(x));
  if (want.length && since && !Number.isNaN(since.getTime())) {
    // updatedAt catches removed messages too
    const msgs = await ChatMessage.find({ room: { $in: want }, updatedAt: { $gt: since } }).sort({ createdAt: 1 }).limit(300).lean();
    out.messages = msgs.map((m) => messageView(m, names));
  }
  res.json(out);
}));

// GET /api/chat/rooms/:id/messages?before=<messageId> — the latest 50, or 50 before one
chatRouter.get('/rooms/:id/messages', wrap(async (req, res) => {
  const room = await loadRoom(req);
  const q = { room: room._id };
  if (isId(req.query.before)) {
    const b = await ChatMessage.findById(req.query.before, { createdAt: 1 }).lean();
    if (b) q.createdAt = { $lt: b.createdAt };
  }
  const list = (await ChatMessage.find(q).sort({ createdAt: -1 }).limit(PAGE).lean()).reverse();
  const names = Object.fromEntries((await User.find({ _id: { $in: [...new Set(list.map((m) => id(m.user)).filter(isId))] } }, { name: 1 }).lean()).map((u) => [id(u), u.name]));
  res.json({ messages: list.map((m) => messageView(m, names)), more: list.length === PAGE });
}));

// POST /api/chat/rooms/:id/messages { text }
chatRouter.post('/rooms/:id/messages', sendLimit, wrap(async (req, res) => {
  const room = await loadRoom(req);
  const text = String(req.body?.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT);
  if (!text) throw bad('Type a message first.');
  const m = await ChatMessage.create({ room: room._id, user: req.user._id, text: seal(text) });
  await Promise.all([
    ChatRoom.updateOne({ _id: room._id }, { $set: { lastMessageAt: m.createdAt } }),
    ChatSeen.updateOne({ room: room._id, user: req.user._id }, { $set: { at: m.createdAt } }, { upsert: true }),
  ]);
  res.status(201).json(messageView(m, { [id(req.user)]: req.user.name }));
}));

// POST /api/chat/rooms/:id/seen — read up to now
chatRouter.post('/rooms/:id/seen', wrap(async (req, res) => {
  const room = await loadRoom(req);
  await ChatSeen.updateOne({ room: room._id, user: req.user._id }, { $set: { at: new Date() } }, { upsert: true });
  res.status(204).end();
}));

// DELETE /api/chat/messages/:id — take back your own message
chatRouter.delete('/messages/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const m = await ChatMessage.findById(req.params.id);
  if (!m || id(m.user) !== id(req.user)) throw notFound('Only the person who sent a message can remove it.');
  m.text = '';
  m.deletedAt = new Date();
  await m.save();
  res.status(204).end();
}));

async function activeIds(list, max) {
  const ids = [...new Set((Array.isArray(list) ? list : []).map(String))].filter(isId);
  if (ids.length > max) throw bad(`A group can have up to ${MAX_MEMBERS} people.`);
  return (await User.find({ _id: { $in: ids }, active: true }, { _id: 1 }).lean()).map((u) => u._id);
}
const readLook = (b, out = {}) => {
  if (b.name !== undefined) out.name = str(b.name, 60);
  if (b.emoji !== undefined) out.emoji = [...String(b.emoji || '').trim()].slice(0, 2).join('');
  if (b.color !== undefined) out.color = CHAT_COLORS.includes(b.color) ? b.color : 'blue';
  return out;
};
async function systemNote(room, user, text) {
  const m = await ChatMessage.create({ room: room._id, user: user._id, text: seal(text), system: true });
  await ChatRoom.updateOne({ _id: room._id }, { $set: { lastMessageAt: m.createdAt } });
}

// POST /api/chat/direct { userId } — the one-on-one chat with someone (made if new)
chatRouter.post('/direct', wrap(async (req, res) => {
  const other = isId(req.body?.userId) ? await User.findOne({ _id: req.body.userId, active: true }, { name: 1 }).lean() : null;
  if (!other) throw notFound('That person isn’t on Crew Call.');
  if (id(other) === id(req.user)) throw bad('That’s you.');
  const key = `direct:${[id(other), id(req.user)].sort().join(':')}`;
  let room = await ChatRoom.findOne({ key });
  if (!room) {
    try {
      room = await ChatRoom.create({ kind: 'direct', key, members: [req.user._id, other._id] });
    } catch {
      room = await ChatRoom.findOne({ key });
    }
  }
  res.json({ id: id(room) });
}));

// POST /api/chat/groups { name, emoji, color, members: [userId] }
chatRouter.post('/groups', wrap(async (req, res) => {
  const b = req.body || {};
  const look = readLook({ color: 'blue', ...b });
  if (!look.name) throw bad('Give the group a name.');
  const members = await activeIds([...(b.members || []), id(req.user)], MAX_MEMBERS);
  if (members.length < 2) throw bad('Pick at least one other person.');
  const room = await ChatRoom.create({ kind: 'group', ...look, members, owner: req.user._id, lastMessageAt: new Date() });
  await systemNote(room, req.user, `${req.user.name} started “${look.name}”`);
  res.status(201).json({ id: id(room) });
}));

// PATCH /api/chat/rooms/:id { name, emoji, color, add: [userId], remove: [userId] } — groups only.
// Anyone in the group can rename it or add people; the person who started it can remove people.
chatRouter.patch('/rooms/:id', wrap(async (req, res) => {
  const room = await loadRoom(req);
  if (room.kind !== 'group') throw bad('Only group chats can be changed.');
  const b = req.body || {};
  const look = readLook(b);
  if (look.name === '') throw bad('The group needs a name.');
  const notes = [];
  if (look.name && look.name !== room.name) notes.push(`renamed the group “${look.name}”`);
  if ((look.emoji !== undefined && look.emoji !== room.emoji) || (look.color && look.color !== room.color)) notes.push('changed the group’s look');
  Object.assign(room, look);
  const names = async (ids) => (await User.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((u) => u.name).join(', ');
  if (b.add?.length) {
    const add = (await activeIds(b.add, MAX_MEMBERS)).filter((u) => !room.members.some((m) => id(m) === id(u)));
    if (room.members.length + add.length > MAX_MEMBERS) throw bad(`A group can have up to ${MAX_MEMBERS} people.`);
    if (add.length) {
      room.members.push(...add);
      notes.push(`added ${await names(add)}`);
    }
  }
  if (b.remove?.length) {
    if (id(room.owner) !== id(req.user)) throw forbidden('Only the person who started the group can remove people. Anyone can leave.');
    const rm = (Array.isArray(b.remove) ? b.remove : []).map(String).filter((x) => x !== id(req.user));
    const gone = room.members.filter((m) => rm.includes(id(m)));
    if (gone.length) {
      room.members = room.members.filter((m) => !rm.includes(id(m)));
      notes.push(`removed ${await names(gone)}`);
    }
  }
  await room.save();
  for (const n of notes) await systemNote(room, req.user, `${req.user.name} ${n}`);
  res.json({ ok: true });
}));

// POST /api/chat/rooms/:id/leave — leave a group (the last one out removes it)
chatRouter.post('/rooms/:id/leave', wrap(async (req, res) => {
  const room = await loadRoom(req);
  if (room.kind !== 'group') throw bad('You can only leave group chats.');
  room.members = room.members.filter((m) => id(m) !== id(req.user));
  if (!room.members.length) {
    await Promise.all([ChatMessage.deleteMany({ room: room._id }), ChatSeen.deleteMany({ room: room._id }), room.deleteOne()]);
    return res.status(204).end();
  }
  if (id(room.owner) === id(req.user)) room.owner = room.members[0]; // someone else can now remove people
  await room.save();
  await systemNote(room, req.user, `${req.user.name} left the group`);
  res.status(204).end();
}));
