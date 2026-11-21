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
step('chat isn’t in previews or the activity log, and messages are stored scrambled');

console.log('\nAll chat checks passed.');
