// Who has a page open right now (a meeting, a service plan): key → user id → { name, at, writing }.
// Kept in memory: it only matters for the next few seconds, and a restart just empties it.
const rooms = new Map();
const HERE_MS = 12000;

export function whoIsHere(key, user, writing = '') {
  const now = Date.now();
  const room = rooms.get(key) || new Map();
  if (user) room.set(String(user._id), { name: user.name, at: now, writing });
  for (const [k, v] of room) if (now - v.at > HERE_MS) room.delete(k);
  if (room.size) rooms.set(key, room);
  else rooms.delete(key);
  // forget pages nobody has looked at for a while
  if (rooms.size > 300) for (const [k, r] of rooms) if (![...r.values()].some((v) => now - v.at < HERE_MS)) rooms.delete(k);
  return [...room].map(([id, v]) => ({ id, name: v.name, writing: v.writing || '' }));
}
