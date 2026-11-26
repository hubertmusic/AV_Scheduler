// Chat: who's online, team rooms, named groups, one-on-one chats. Against a running API with an
// EMPTY database:   BASE_URL=http://localhost:4000 node test/chat.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
function client(team = '') {
  let cookie = '';
  const call = async (method, p, body, extra = {}) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.team ? { 'X-Team': call.team } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : await res.text();
    return { status: res.status, data };
  };
  call.team = team;
  return call;
}
const ok = (r, code = 200) => {
  assert.equal(r.status, code, `${code} expected, got ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const step = (m) => console.log('✓', m);

const admin = client('av');
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Church' }), 201);
const O = ok(await admin('GET', '/api/bootstrap')).allTeams.find((t) => t.kind === 'office').key;
async function person(c, name, email, team) {
  const r = ok(await c('POST', '/api/people', { name, email }), 201);
  const p = client(team);
  ok(await p('POST', `/api/auth/invite/${r.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  return { id: r.person.id, c: p };
}
const ben = await person(admin, 'Ben', 'ben@example.com', 'av');
const cam = await person(admin, 'Cam', 'cam@example.com', 'av');
const adminP = client('praise');
ok(await adminP('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
const pia = await person(adminP, 'Pia', 'pia@example.com', 'praise');
// Church Admin: Olivia is its head
const adminO = client(O);
ok(await adminO('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
const olivia = await person(adminO, 'Olivia', 'olivia@example.com', O);
ok(await admin('PUT', `/api/teams/${O}/head`, { userId: olivia.id }));

// ---------- online ----------
let s = ok(await ben.c('GET', '/api/chat/sync'));
assert.equal(s.people.find((p) => p.name === 'Ben').status, 'online');
assert.equal(s.people.find((p) => p.name === 'Pia').status, 'offline', 'not checked in yet');
ok(await pia.c('GET', '/api/chat/sync?away=1'));
s = ok(await ben.c('GET', '/api/chat/sync'));
assert.equal(s.people.find((p) => p.name === 'Pia').status, 'away', 'Crew Call open in a background tab');
assert.ok(s.people.find((p) => p.name === 'Olivia'), 'everyone on Crew Call is listed');
assert.deepEqual(s.people.find((p) => p.name === 'Olivia').teams, [], 'but Church Admin membership isn’t shown to others');
step('who’s online: online, away (background tab) or offline; everyone listed; Church Admin membership stays private');

// ---------- team rooms ----------
const roomNames = (x) => x.rooms.map((r) => r.name).sort();
assert.deepEqual(roomNames(s), ['AV Team']);
const avRoom = s.rooms.find((r) => r.kind === 'team').id;
ok(await ben.c('POST', `/api/chat/rooms/${avRoom}/messages`, { text: 'Who has the spare XLR?' }), 201);
s = ok(await cam.c('GET', '/api/chat/sync'));
assert.equal(s.rooms.find((r) => r.id === avRoom).unread, 1);
assert.equal(s.rooms.find((r) => r.id === avRoom).last.text, 'Who has the spare XLR?');
ok(await cam.c('POST', `/api/chat/rooms/${avRoom}/seen`), 204);
assert.equal(ok(await cam.c('GET', '/api/chat/sync')).rooms.find((r) => r.id === avRoom).unread, 0);
ok(await pia.c('GET', `/api/chat/rooms/${avRoom}/messages`), 404, 'not on the AV Team');
ok(await pia.c('POST', `/api/chat/rooms/${avRoom}/messages`, { text: 'hi' }), 404);
const oRooms = ok(await olivia.c('GET', '/api/chat/sync')).rooms;
const officeRoom = oRooms.find((r) => r.kind === 'team').id;
assert.equal(oRooms.find((r) => r.kind === 'team').name, 'Church Admin');
ok(await olivia.c('POST', `/api/chat/rooms/${officeRoom}/messages`, { text: 'Board budget draft attached' }), 201);
ok(await admin('GET', `/api/chat/rooms/${officeRoom}/messages`), 404, 'the admin isn’t on Church Admin, so can’t read its room');
assert.ok(!ok(await admin('GET', '/api/chat/sync')).rooms.some((r) => r.id === officeRoom));
step('team rooms: each team’s members only; Church Admin’s room is closed even to the admin; unread counts clear when read');

// ---------- one-on-one ----------
const dm = ok(await ben.c('POST', '/api/chat/direct', { userId: pia.id })).id;
assert.equal(ok(await pia.c('POST', '/api/chat/direct', { userId: ben.id })).id, dm, 'the same chat either way');
ok(await ben.c('POST', `/api/chat/rooms/${dm}/messages`, { text: 'Can you sing Sabbath?\nSecond line' }), 201);
s = ok(await pia.c('GET', '/api/chat/sync'));
const dmView = s.rooms.find((r) => r.id === dm);
assert.deepEqual([dmView.kind, dmView.name, dmView.with, dmView.unread], ['direct', 'Ben', ben.id, 1]);
const page = ok(await pia.c('GET', `/api/chat/rooms/${dm}/messages`));
assert.equal(page.messages[0].text, 'Can you sing Sabbath?\nSecond line', 'line breaks kept');
ok(await cam.c('GET', `/api/chat/rooms/${dm}/messages`), 404, 'nobody else reads it');
ok(await admin('GET', `/api/chat/rooms/${dm}/messages`), 404, 'not even the admin');
ok(await ben.c('POST', '/api/chat/direct', { userId: ben.id }), 400);
step('one-on-one chats with anyone on Crew Call; private to the two of them');

// New messages arrive through sync for open rooms
const t0 = ok(await ben.c('GET', `/api/chat/sync?open=${dm}`)).now; // the server's clock
ok(await pia.c('POST', `/api/chat/rooms/${dm}/messages`, { text: 'Yes!' }), 201);
s = ok(await ben.c('GET', `/api/chat/sync?open=${dm}&since=${encodeURIComponent(t0)}`));
assert.deepEqual(s.messages.map((m) => [m.name, m.text]), [['Pia', 'Yes!']]);
// Taking a message back
const mine = ok(await ben.c('POST', `/api/chat/rooms/${dm}/messages`, { text: 'oops wrong chat' }), 201);
ok(await pia.c('DELETE', `/api/chat/messages/${mine.id}`), 404, 'only the sender can remove it');
ok(await ben.c('DELETE', `/api/chat/messages/${mine.id}`), 204);
const after = ok(await pia.c('GET', `/api/chat/rooms/${dm}/messages`)).messages.find((m) => m.id === mine.id);
assert.deepEqual([after.deleted, after.text], [true, '']);
ok(await ben.c('POST', `/api/chat/rooms/${dm}/messages`, { text: '   ' }), 400);
step('new messages come through the regular check-in; senders can take a message back');

// ---------- named groups ----------
ok(await ben.c('POST', '/api/chat/groups', { name: '', members: [cam.id] }), 400);
ok(await ben.c('POST', '/api/chat/groups', { name: 'Just me', members: [] }), 400);
const g = ok(await ben.c('POST', '/api/chat/groups', { name: 'Sabbath crew', emoji: '🎚️', color: 'green', members: [cam.id, pia.id, 'nope'] }), 201).id;
s = ok(await pia.c('GET', '/api/chat/sync'));
let gv = s.rooms.find((r) => r.id === g);
assert.deepEqual([gv.name, gv.emoji, gv.color, gv.members.map((m) => m.name).sort(), gv.owner], ['Sabbath crew', '🎚️', 'green', ['Ben', 'Cam', 'Pia'], ben.id]);
assert.equal(gv.last.system, true, 'starts with “Ben started …”');
ok(await pia.c('PATCH', `/api/chat/rooms/${g}`, { name: 'Sabbath crew + band', color: 'purple', add: [olivia.id] }));
gv = ok(await ben.c('GET', '/api/chat/sync')).rooms.find((r) => r.id === g);
assert.deepEqual([gv.name, gv.color, gv.members.length], ['Sabbath crew + band', 'purple', 4], 'anyone in it can rename it and add people');
ok(await pia.c('PATCH', `/api/chat/rooms/${g}`, { remove: [cam.id] }), 403);
ok(await ben.c('PATCH', `/api/chat/rooms/${g}`, { remove: [cam.id] }));
ok(await cam.c('GET', `/api/chat/rooms/${g}/messages`), 404, 'removed people lose the chat');
const notes = ok(await ben.c('GET', `/api/chat/rooms/${g}/messages`)).messages.filter((m) => m.system).map((m) => m.text);
assert.ok(notes.some((t) => /Pia renamed the group/.test(t)) && notes.some((t) => /added Olivia/.test(t)) && notes.some((t) => /removed Cam/.test(t)));
ok(await ben.c('POST', `/api/chat/rooms/${g}/leave`), 204);
gv = ok(await pia.c('GET', '/api/chat/sync')).rooms.find((r) => r.id === g);
assert.ok(gv.owner && gv.owner !== ben.id, 'someone else looks after the group');
ok(await ben.c('PATCH', `/api/chat/rooms/${dm}`, { name: 'x' }), 400, 'one-on-one chats can’t be renamed');
step('named groups: pick people, name, emoji and colour; anyone in it renames or adds; the starter removes; anyone leaves');

// ---------- privacy ----------
ok(await admin('GET', '/api/chat/sync', null, { 'X-View-As': ben.id }), 403);
for (const p of [`/api/chat/rooms/${dm}/messages`, '/api/chat/sync?away=0']) ok(await admin('GET', p, null, { 'X-View-As': pia.id }), 403);
// "View as" gets a look at the dock: who's online, their team rooms, counts — no words, no names of private chats
ok(await ben.c('GET', '/api/chat/preview'), 403, 'only in a preview');
const before = ok(await pia.c('GET', '/api/chat/sync')).people.find((p) => p.name === 'Pia').lastSeen;
const pv = ok(await admin('GET', '/api/chat/preview', null, { 'X-View-As': pia.id }));
assert.equal(pv.me, pia.id);
assert.deepEqual(pv.rooms.map((r) => r.name), ['Praise Team'], 'their team rooms');
assert.ok(pv.private.chats >= 1 && pv.private.groups >= 1, 'private chats are only counted');
const raw = JSON.stringify(pv);
for (const t of ['Sabbath crew', 'XLR', 'Sabbath?', 'Ben started']) assert.ok(!raw.includes(t), `no “${t}” in a preview`);
assert.ok(!pv.rooms.some((r) => 'last' in r || 'members' in r));
assert.equal(pv.people.find((p) => p.name === 'Olivia').teams.length, 0, 'still as Pia sees people');
assert.equal(ok(await ben.c('GET', '/api/chat/sync')).people.find((p) => p.name === 'Pia').lastSeen, before, 'a preview doesn’t mark them online');
if (process.env.MONGO_URL) {
  const { MongoClient } = await import('mongodb');
  const db = new MongoClient(process.env.MONGO_URL);
  await db.connect();
  const raw = await db.db().collection('chatmessages').find({ deletedAt: null }).toArray();
  assert.ok(raw.length > 3 && raw.every((m) => m.text.startsWith('v1:')), 'stored scrambled');
  assert.ok(!JSON.stringify(raw).includes('Sabbath?'));
  await db.close();
}
const feed = JSON.stringify(ok(await admin('GET', '/api/activity/feed?limit=200')));
assert.ok(!feed.includes('XLR') && !feed.includes('Sabbath?'), 'no chat in the activity log');
step('chat messages aren’t in previews (only the shape of the dock) or the activity log, and they’re stored scrambled');

// ---------- calling someone on WhatsApp ----------
ok(await admin('PATCH', `/api/people/${cam.id}`, { phone: '4235550199' }));
let peopleSeen = ok(await ben.c('GET', '/api/chat/sync')).people;
assert.equal(peopleSeen.find((p) => p.name === 'Cam').phone, undefined, 'crew don’t see other crew’s numbers');
assert.ok(ok(await admin('GET', '/api/chat/sync')).people.find((p) => p.name === 'Cam').phone, 'people who message the crew do');
ok(await admin('PATCH', `/api/people/${cam.id}`, { role: 'leader' }));
peopleSeen = ok(await ben.c('GET', '/api/chat/sync')).people;
assert.ok(peopleSeen.find((p) => p.name === 'Cam').phone, 'leaders’ numbers are for everyone');
step('the People list offers WhatsApp only where the number may be seen');

// ---------- archive and delete ----------
{
  const say = async (c, room, text) => ok(await c('POST', `/api/chat/rooms/${room}/messages`, { text }), 201);
  const roomOf = async (c, rid) => ok(await c('GET', '/api/chat/sync')).rooms.find((r) => r.id === rid);
  const texts = async (c, rid) => ok(await c('GET', `/api/chat/rooms/${rid}/messages`)).messages.filter((m) => !m.system).map((m) => m.text);
  // One-on-one: Ben and Cam
  const d = ok(await ben.c('POST', '/api/chat/direct', { userId: cam.id })).id;
  await say(ben.c, d, 'Mic 3 is fixed');
  await say(cam.c, d, 'Thanks!');
  ok(await ben.c('POST', `/api/chat/rooms/${d}/archive`, { archived: true }));
  assert.equal((await roomOf(ben.c, d)).archived, true, 'archived for Ben');
  assert.equal((await roomOf(cam.c, d)).archived, false, 'not for Cam');
  assert.deepEqual(await texts(ben.c, d), ['Mic 3 is fixed', 'Thanks!'], 'archiving keeps the messages');
  await say(cam.c, d, 'One more thing');
  assert.equal((await roomOf(ben.c, d)).archived, false, 'a new message brings it back');
  ok(await ben.c('POST', `/api/chat/rooms/${d}/archive`, { archived: true }));
  ok(await ben.c('POST', `/api/chat/rooms/${d}/archive`, { archived: false }));
  assert.equal((await roomOf(ben.c, d)).archived, false, 'or move it back by hand');
  step('archive: hidden just for you, messages kept, back when someone writes (or by hand)');

  ok(await ben.c('POST', `/api/chat/rooms/${d}/clear`));
  assert.deepEqual(await texts(ben.c, d), [], 'deleted for Ben: he sees nothing from before');
  assert.equal((await roomOf(ben.c, d)).archived, true, 'and it leaves his list');
  assert.equal((await roomOf(ben.c, d)).last, null);
  assert.deepEqual(await texts(cam.c, d), ['Mic 3 is fixed', 'Thanks!', 'One more thing'], 'Cam still has everything');
  await say(cam.c, d, 'You there?');
  assert.deepEqual(await texts(ben.c, d), ['You there?'], 'new messages show for Ben, the old ones don’t');
  assert.equal((await roomOf(ben.c, d)).archived, false);
  let sync = ok(await ben.c('GET', `/api/chat/sync?open=${d}&since=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}`));
  assert.deepEqual(sync.messages.filter((m) => m.room === d).map((m) => m.text), ['You there?'], 'nor in the live check-in');
  // Both delete it: gone for good
  ok(await ben.c('POST', `/api/chat/rooms/${d}/clear`));
  assert.equal(ok(await cam.c('POST', `/api/chat/rooms/${d}/clear`)).removed, true, 'deleted by both: removed for good');
  ok(await ben.c('GET', `/api/chat/rooms/${d}/messages`), 404);
  if (process.env.MONGO_URL) {
    const { MongoClient } = await import('mongodb');
    const db = new MongoClient(process.env.MONGO_URL);
    await db.connect();
    const { ObjectId } = await import('mongodb');
    assert.equal(await db.db().collection('chatmessages').countDocuments({ room: new ObjectId(d) }), 0, 'its messages are gone from the database');
    await db.close();
  }
  const fresh = ok(await ben.c('POST', '/api/chat/direct', { userId: cam.id })).id;
  assert.notEqual(fresh, d, 'messaging again starts a new chat');
  assert.deepEqual(await texts(ben.c, fresh), []);
  step('delete for me: your copy is gone, the other person keeps theirs; once both delete it, it’s removed for good');

  // Groups
  const g = ok(await ben.c('POST', '/api/chat/groups', { name: 'Load-out', members: [cam.id, pia.id] }), 201).id;
  await say(cam.c, g, 'Truck at 9');
  ok(await cam.c('DELETE', `/api/chat/rooms/${g}`), 403, 'only whoever started it deletes it for everyone');
  ok(await cam.c('POST', `/api/chat/rooms/${g}/clear`));
  assert.deepEqual(await texts(cam.c, g), [], 'Cam deleted it for himself');
  assert.deepEqual(await texts(pia.c, g), ['Truck at 9'], 'Pia still has it');
  ok(await ben.c('DELETE', `/api/chat/rooms/${g}`), 204);
  for (const c of [ben.c, cam.c, pia.c]) {
    ok(await c('GET', `/api/chat/rooms/${g}/messages`), 404);
    assert.ok(!(await roomOf(c, g)), 'gone from everyone’s list');
  }
  // Team rooms can't be deleted, only deleted for yourself
  const team = ok(await ben.c('GET', '/api/chat/sync')).rooms.find((r) => r.kind === 'team');
  ok(await ben.c('DELETE', `/api/chat/rooms/${team.id}`), 400);
  ok(await ben.c('POST', `/api/chat/rooms/${team.id}/clear`));
  assert.ok(await roomOf(ben.c, team.id), 'the team room stays (archived) for Ben');
  ok(await pia.c('POST', `/api/chat/rooms/${team.id}/archive`, { archived: true }), 404, 'not her team');
  step('groups: whoever started one can delete it for everyone; others delete it for themselves or leave. Team rooms can only be deleted for yourself');
}

console.log('\nAll chat checks passed.');
