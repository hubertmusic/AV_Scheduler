// Team vaults (leaders see them; crew get timed access) and private notes. Against a running API
// with an EMPTY database:   BASE_URL=http://localhost:4000 node test/vault.mjs
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
const adminId = ok(await admin('GET', '/api/bootstrap')).me.id;
async function person(c, name, email) {
  const r = ok(await c('POST', '/api/people', { name, email }), 201);
  const p = client(c.team);
  ok(await p('POST', `/api/auth/invite/${r.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  return { id: r.person.id, c: p };
}
const lee = await person(admin, 'Lee', 'lee@example.com');
ok(await admin('PATCH', `/api/people/${lee.id}`, { role: 'leader' }));
const cam = await person(admin, 'Cam', 'cam@example.com');
const dee = await person(admin, 'Dee', 'dee@example.com');

// ---------- leaders keep the vault ----------
const yt = ok(await lee.c('POST', '/api/vault', { title: 'YouTube stream key', category: 'Streaming', url: 'studio.youtube.com', username: 'church@example.com', secret: 'abcd-efgh-1234-5678', notes: 'Use the backup key if this fails' }), 201);
assert.equal(yt.url, 'https://studio.youtube.com');
assert.equal(yt.secret, undefined, 'secrets never come back in lists');
const pro = ok(await admin('POST', '/api/vault', { title: 'ProPresenter license', category: 'Software & licenses', secret: 'PP7-XXXX-YYYY' }), 201);
const router = ok(await admin('POST', '/api/vault', { title: 'Booth router admin', category: 'Wi-Fi & network', secret: 'r0uter!', leadersOnly: true }), 201);
ok(await cam.c('POST', '/api/vault', { title: 'x', secret: 'y' }), 403);
let v = ok(await lee.c('GET', '/api/vault'));
assert.equal(v.leader, true);
assert.deepEqual(v.members.map((m) => m.name), ['Cam', 'Dee'], 'leaders can give access to the rest of the team');
assert.equal(v.entries.find((e) => e.title === 'ProPresenter license').hasSecret, true);
assert.deepEqual(v.entries.map((e) => e.title).sort(), ['Booth router admin', 'ProPresenter license', 'YouTube stream key']);
assert.deepEqual(ok(await lee.c('POST', `/api/vault/${yt.id}/reveal`)), { username: 'church@example.com', secret: 'abcd-efgh-1234-5678', notes: 'Use the backup key if this fails' });
ok(await lee.c('PATCH', `/api/vault/${yt.id}`, { secret: 'new-key-9999' }));
assert.equal(ok(await lee.c('POST', `/api/vault/${yt.id}/reveal`)).secret, 'new-key-9999');
assert.equal(ok(await lee.c('POST', `/api/vault/${yt.id}/reveal`)).username, 'church@example.com', 'fields not sent stay as they were');
step('leaders add, change and open vault entries; secrets come back only when someone taps Show');

// ---------- crew: nothing until a leader gives access ----------
v = ok(await cam.c('GET', '/api/vault'));
assert.equal(v.access, null);
assert.equal(v.entries.length, 0);
assert.ok(v.leaders.some((l) => l.name === 'Lee'), 'crew see who to ask');
ok(await cam.c('POST', `/api/vault/${yt.id}/reveal`), 403);
ok(await cam.c('POST', '/api/vault/ask', { note: 'Streaming Sunday' }));
assert.ok(ok(await lee.c('GET', '/api/vault')).asks.some((a) => a.user.name === 'Cam' && a.note === 'Streaming Sunday'));
// 30 minutes, the whole vault (not the leaders-only entries)
ok(await lee.c('POST', '/api/vault/grants', { userId: cam.id, minutes: 30, all: true }), 201);
v = ok(await cam.c('GET', '/api/vault'));
assert.ok(v.access.until && Math.abs(new Date(v.access.until) - Date.now() - 30 * 60e3) < 60e3);
assert.deepEqual(v.entries.map((e) => e.title).sort(), ['ProPresenter license', 'YouTube stream key']);
assert.equal(ok(await cam.c('POST', `/api/vault/${pro.id}/reveal`)).secret, 'PP7-XXXX-YYYY');
ok(await cam.c('POST', `/api/vault/${router.id}/reveal`), 403);
assert.equal(ok(await lee.c('GET', '/api/vault')).asks.length, 0, 'answered asks drop off');
// Only chosen entries, for a custom time
ok(await lee.c('POST', '/api/vault/grants', { userId: cam.id, until: new Date(Date.now() + 2 * 864e5).toISOString(), all: false, entries: [yt.id, router.id] }), 201);
v = ok(await cam.c('GET', '/api/vault'));
assert.deepEqual(v.entries.map((e) => e.title), ['YouTube stream key'], 'leaders-only entries are never shared');
ok(await cam.c('POST', `/api/vault/${pro.id}/reveal`), 403);
// Unlimited, then taken back
ok(await lee.c('POST', '/api/vault/grants', { userId: dee.id, unlimited: true }), 201);
assert.equal(ok(await dee.c('GET', '/api/vault')).access.until, null);
const grants = ok(await lee.c('GET', '/api/vault')).grants;
assert.equal(grants.length, 2);
ok(await lee.c('DELETE', `/api/vault/grants/${grants.find((g) => g.user.name === 'Dee').id}`), 204);
ok(await dee.c('POST', `/api/vault/${yt.id}/reveal`), 403);
// Bad grants
ok(await lee.c('POST', '/api/vault/grants', { userId: cam.id, until: new Date(Date.now() - 1000).toISOString() }), 400);
ok(await lee.c('POST', '/api/vault/grants', { userId: lee.id, unlimited: true }), 400);
ok(await cam.c('POST', '/api/vault/grants', { userId: dee.id, unlimited: true }), 403);
step('crew get access only from a leader: 30 minutes, a custom time or no end; all or chosen entries; never leaders-only; taken back any time');

// The log shows every look
const logs = ok(await lee.c('GET', '/api/vault')).log;
assert.ok(logs.some((l) => l.who === 'Cam' && l.action === 'viewed' && l.entry === 'ProPresenter license'));
assert.ok(logs.some((l) => l.action === 'granted' && /Dee: the whole vault, until taken back/.test(l.detail)));
assert.ok(logs.some((l) => l.action === 'revoked' && l.detail === 'Dee'));
step('the vault log shows who opened what, and who gave or took back access');

// ---------- each team has its own vault; Church Admin's is theirs alone ----------
const adminP = client('praise');
ok(await adminP('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
ok(await adminP('GET', '/api/vault'), 403); // the admin isn’t on the Praise Team, so its vault stays shut
const adminO = client('office');
ok(await adminO('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
ok(await adminO('GET', '/api/vault'), 403);
// No peeking through "View as"
ok(await admin('GET', '/api/vault', null, { 'X-View-As': lee.id }), 403);
ok(await admin('GET', '/api/notes', null, { 'X-View-As': cam.id }), 403);
// Never in the Activity log
const feed = JSON.stringify(ok(await admin('GET', '/api/activity/feed?limit=200')));
for (const s of ['abcd-efgh', 'new-key-9999', 'PP7-XXXX', 'r0uter']) assert.ok(!feed.includes(s), `activity mentions ${s}`);
step('each team’s vault is separate; you can’t open a team’s vault without being on it; no preview; no secrets in the activity log');

// ---------- private notes ----------
const n = ok(await cam.c('POST', '/api/notes', { title: 'Sunday', body: 'Bring the spare XLR.\nCheck batteries.', pinned: true }), 201);
assert.equal(n.body, 'Bring the spare XLR.\nCheck batteries.');
ok(await cam.c('POST', '/api/notes', { title: 'Ideas', body: 'New lower thirds' }), 201);
let mine = ok(await cam.c('GET', '/api/notes'));
assert.deepEqual(mine.map((x) => x.title), ['Sunday', 'Ideas'], 'pinned first');
assert.equal(ok(await admin('GET', '/api/notes')).length, 0, 'nobody else sees them, not even the admin');
ok(await admin('PATCH', `/api/notes/${n.id}`, { body: 'x' }), 404);
ok(await cam.c('PATCH', `/api/notes/${n.id}`, { body: 'Bring two spare XLRs.' }));
assert.equal(ok(await cam.c('GET', '/api/notes'))[0].body, 'Bring two spare XLRs.');
const camO = client('office'); // notes are the same on every team's side
ok(await camO('POST', '/api/auth/login', { email: 'cam@example.com', password: 'password123' }));
assert.equal(ok(await camO('GET', '/api/notes')).length, 2);
ok(await cam.c('DELETE', `/api/notes/${n.id}`), 204);
assert.equal(ok(await cam.c('GET', '/api/notes')).length, 1);
step('notes: private to each person, the same on every team’s side');

// ---------- stored scrambled: someone reading the database sees nothing useful ----------
if (process.env.MONGO_URL) {
  const { MongoClient } = await import('mongodb');
  const db = new MongoClient(process.env.MONGO_URL);
  await db.connect();
  const raw = await db.db().collection('vaultentries').find({}).toArray();
  assert.equal(raw.length, 3);
  for (const e of raw) {
    assert.ok(e.secret.startsWith('v1:'), `${e.title} secret stored as ${e.secret}`);
    assert.ok(!JSON.stringify(e).includes('PP7-XXXX') && !JSON.stringify(e).includes('new-key-9999'));
  }
  const note = (await db.db().collection('notes').find({}).toArray())[0];
  assert.ok(note.body.startsWith('v1:') && !note.body.includes('lower thirds'));
  await db.close();
  step('passwords, keys and note text are stored scrambled in the database');
}

console.log('\nAll vault and notes checks passed.');
