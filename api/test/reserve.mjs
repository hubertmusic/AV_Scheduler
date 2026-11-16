// Room requests: the shareable link anyone can use without an account, and how every request
// (link or signed in) goes straight onto the next board meeting's agenda. Against a running API
// with an EMPTY database and SMTP_URL=json:
//   BASE_URL=http://localhost:4000 node test/reserve.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
function client(team = '') {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.team ? { 'X-Team': call.team } : {}) },
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
const iso = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const mail = async () => ok(await client()('GET', '/api/auth/test-mail'));

// ---------- setup: Church Admin with a head, a board chair who approves, a board member ----------
const admin = client('av');
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Church' }), 201);
const O = ok(await admin('GET', '/api/bootstrap')).allTeams.find((t) => t.kind === 'office').key;
const adminO = client(O);
ok(await adminO('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
async function person(c, name, email, team) {
  const r = ok(await c('POST', '/api/people', { name, email, phone: '4235550123' }), 201);
  const p = client(team);
  ok(await p('POST', `/api/auth/invite/${r.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  return { id: r.person.id, c: p };
}
const olivia = await person(adminO, 'Olivia', 'olivia@example.com', O);
ok(await admin('PUT', `/api/teams/${O}/head`, { userId: olivia.id }));
const lee = await person(olivia.c, 'Lee', 'lee@example.com', O);
ok(await olivia.c('PATCH', `/api/people/${lee.id}`, { role: 'leader', perms: { edit: true, plans: true, approve: true } }));
const sam = await person(olivia.c, 'Sam', 'sam@example.com', O);
ok(await olivia.c('PATCH', '/api/office/committees/board', { members: [lee.id, sam.id] }));
const ben = await person(admin, 'Ben', 'ben@example.com', 'av');

// ---------- the link: off until someone turns it on; only approvers manage it ----------
assert.deepEqual(ok(await olivia.c('GET', '/api/office/request-link')), { on: false, token: '', url: '', madeAt: null });
ok(await sam.c('GET', '/api/office/request-link'), 403);
ok(await sam.c('POST', '/api/office/request-link', { renew: true }), 403);
ok(await ben.c('GET', '/api/office/request-link'), 403);
let link = ok(await adminO('POST', '/api/office/request-link', { renew: true })); // the admin can manage it too
assert.equal(link.on, true);
assert.match(link.token, /^[A-Za-z0-9_-]{24}$/);
assert.ok(link.url.endsWith(`/reserve/${link.token}`) && /^https?:\/\//.test(link.url), 'a full link on the public address');
const pub = client();
const R = `/api/reserve/${link.token}`;
const form = ok(await pub('GET', R));
assert.deepEqual(form.rooms, ['Sanctuary', 'Fellowship hall', 'Board room']);
assert.equal(form.church, 'Test Church');
assert.deepEqual(Object.keys(form).sort(), ['church', 'rooms', 'today'], 'nothing else about the church leaks out');
ok(await pub('GET', '/api/reserve/not-a-real-token-at-all-xyz'), 404);
step('the room request link: turned on by Church Admin approvers or the admin; shows only the church name and rooms');

// ---------- someone asks before any board meeting is on the calendar: it waits ----------
const shower = { name: 'Maria Lopez', email: 'Maria@Example.com', phone: '423-555-0199', title: 'Baby shower', date: iso(25), start: '14:00', end: '16:00', room: 'fellowship hall', people: 40, needsAv: false, notes: 'We’ll bring our own decorations' };
assert.deepEqual(ok(await pub('POST', R, shower), 201), { ok: true, meetingDate: null });
let reqs = ok(await lee.c('GET', '/api/office/requests'));
assert.equal(reqs.length, 1);
const showerReq = reqs[0];
assert.equal(showerReq.room, 'Fellowship hall', 'matched to the room’s real name');
assert.equal(showerReq.source, 'link');
assert.equal(showerReq.requestedBy, 'Maria Lopez');
assert.deepEqual(showerReq.contact, { email: 'maria@example.com', phone: '423-555-0199' });
assert.equal(showerReq.people, 40);
assert.equal(showerReq.waiting, true);
assert.equal(showerReq.meeting, null);
let mails = await mail();
assert.ok(mails.some((m) => m.to === 'maria@example.com' && /We got your request: Baby shower/.test(m.subject) && /its next meeting/.test(m.text)));
step('a request sent before a board meeting is scheduled waits, and the person gets a “we got it” email');

// A board meeting is scheduled: the waiting request goes onto its agenda
const meet1 = ok(await lee.c('POST', '/api/office/events', { title: 'Church board', type: 'board', date: iso(10), start: '19:00', end: '20:30', room: 'Board room', committees: ['board'] }), 201);
let m1 = ok(await lee.c('GET', `/api/office/events/${meet1.id}`));
assert.equal(m1.agenda.length, 1);
assert.equal(m1.agenda[0].title, 'Room request: Baby shower');
assert.equal(m1.agenda[0].presenter, 'Maria Lopez');
assert.match(m1.agenda[0].notes, /Fellowship hall · about 40 people/);
assert.match(m1.agenda[0].notes, /maria@example\.com, 423-555-0199/);
assert.match(m1.agenda[0].notes, /own decorations/);
reqs = ok(await lee.c('GET', '/api/office/requests'));
assert.deepEqual([reqs[0].waiting, reqs[0].meeting.id, reqs[0].meetsAfter], [false, meet1.id, false]);
assert.ok(ok(await sam.c('GET', `/api/office/events/${meet1.id}`)).agenda.some((a) => /Baby shower/.test(a.title)), 'the board sees it on the agenda');
step('when a board meeting is added, waiting requests go onto its agenda with who asked and how to reach them');

// ---------- with a meeting on the calendar, new requests go straight on, before “Adjourn” ----------
ok(await lee.c('PUT', `/api/office/events/${meet1.id}/agenda`, { agenda: [...m1.agenda, { title: 'Treasurer’s report' }, { title: 'Adjourn' }] }));
const bake = { name: 'Tom', email: 'tom@example.com', title: 'Bake sale', date: iso(5), room: 'Sanctuary' };
assert.deepEqual(ok(await pub('POST', R, bake), 201), { ok: true, meetingDate: iso(10) });
m1 = ok(await lee.c('GET', `/api/office/events/${meet1.id}`));
assert.deepEqual(m1.agenda.map((a) => a.title), ['Room request: Baby shower', 'Treasurer’s report', 'Room request: Bake sale', 'Adjourn']);
assert.match(m1.agenda[2].notes, /No room|Sanctuary/);
assert.ok((await mail()).some((m) => m.to === 'tom@example.com' && new RegExp(`when it meets on`).test(m.text)));
const bakeReq = ok(await lee.c('GET', '/api/office/requests')).find((r) => r.title === 'Bake sale');
assert.equal(bakeReq.meetsAfter, true, 'flagged: the board meets after the date they asked for');
// Signed-in members' requests go on the agenda too
const movie = ok(await ben.c('POST', '/api/office/requests', { title: 'Youth movie night', date: iso(20), start: '19:00', end: '21:00', room: 'Sanctuary', people: 25, needsAv: true }), 201);
assert.equal(movie.meetingDate, iso(10));
m1 = ok(await lee.c('GET', `/api/office/events/${meet1.id}`));
assert.equal(m1.agenda[3].title, 'Room request: Youth movie night');
assert.match(m1.agenda[3].notes, /Asked by Ben \(ben@example\.com/);
step('new requests (from the link or signed in) go straight onto the next board meeting’s agenda, ahead of “Adjourn”');

// ---------- clashes: the board sees what’s booked; the public only hears “may be taken” ----------
ok(await lee.c('POST', '/api/office/events', { title: 'Women’s ministry brunch', type: 'event', date: iso(25), start: '13:00', end: '15:00', room: 'Fellowship hall' }), 201);
const s = showerReq;
const sClash = ok(await lee.c('GET', '/api/office/requests')).find((r) => r.id === s.id).clashes;
assert.deepEqual(sClash, [{ kind: 'booked', title: 'Women’s ministry brunch', start: '13:00', end: '15:00' }]);
assert.deepEqual(ok(await pub('GET', `${R}/check?date=${iso(25)}&start=14:30&end=15:30&room=Fellowship%20hall`)), { taken: true });
assert.deepEqual(ok(await pub('GET', `${R}/check?date=${iso(25)}&start=15:00&end=17:00&room=Fellowship%20hall`)), { taken: true }, 'the baby shower request is waiting for 2–4');
assert.deepEqual(ok(await pub('GET', `${R}/check?date=${iso(25)}&start=17:00&end=18:00&room=Fellowship%20hall`)), { taken: false });
assert.deepEqual(ok(await pub('GET', `${R}/check?date=${iso(25)}&start=14:00&room=Board%20room`)), { taken: false });
step('clashes: the board sees what’s already booked or asked for; the public form only says the room may be taken');

// ---------- checks on what people send ----------
ok(await pub('POST', R, { ...bake, email: '' }), 400);
ok(await pub('POST', R, { ...bake, name: '' }), 400);
ok(await pub('POST', R, { ...bake, date: iso(-1) }), 400);
ok(await pub('POST', R, { ...bake, start: '18:00', end: '17:00' }), 400);
ok(await pub('POST', R, { ...bake, date: iso(800) }), 400);
const before = ok(await lee.c('GET', '/api/office/requests')).length;
ok(await pub('POST', R, { ...bake, title: 'Spam', website: 'http://spam.example' }), 201); // a bot filled the hidden box
assert.equal(ok(await lee.c('GET', '/api/office/requests')).length, before, 'bots are quietly ignored');
step('the form needs a name, an email, a future date and sensible times; bots are ignored');

// ---------- deciding: the agenda says so, and they get an email ----------
ok(await sam.c('POST', `/api/office/requests/${s.id}/approve`, {}), 403);
ok(await lee.c('POST', `/api/office/requests/${s.id}/approve`, { reply: 'Please stack the chairs after.' }));
const bakeId = bakeReq.id;
ok(await lee.c('POST', `/api/office/requests/${bakeId}/decline`, { reply: 'The sanctuary isn’t used for sales. Try the fellowship hall.' }));
m1 = ok(await lee.c('GET', `/api/office/events/${meet1.id}`));
assert.equal(m1.agenda[0].title, 'Room request (approved): Baby shower', 'found by its title after the agenda was saved');
assert.match(m1.agenda[0].notes, /Approved by Lee: “Please stack the chairs after\.”/);
assert.equal(m1.agenda[2].title, 'Room request (declined): Bake sale');
mails = await mail();
assert.ok(mails.some((m) => m.to === 'maria@example.com' && /^Approved: Baby shower/.test(m.subject) && /stack the chairs/.test(m.text)));
assert.ok(mails.some((m) => m.to === 'tom@example.com' && /^Not approved: Bake sale/.test(m.subject) && /fellowship hall/.test(m.text)));
const cal = ok(await lee.c('GET', `/api/office/events?from=${iso(24)}&to=${iso(26)}`));
assert.ok(cal.some((e) => e.title === 'Baby shower' && e.room === 'Fellowship hall'), 'approved requests are on the calendar');
ok(await lee.c('POST', `/api/office/requests/${movie.id}/approve`, {}));
assert.ok((await mail()).some((m) => m.to === 'ben@example.com' && /^Approved: Youth movie night/.test(m.subject)), 'members get an email too');
step('approving or declining marks the agenda item, adds approved ones to the calendar, and emails the person who asked');

// ---------- turning the link off, or making a new one ----------
link = ok(await olivia.c('POST', '/api/office/request-link', { on: false }));
assert.equal(link.on, false);
ok(await pub('GET', R), 410);
ok(await pub('POST', R, bake), 410);
link = ok(await olivia.c('POST', '/api/office/request-link', { renew: true }));
assert.equal(link.on, true);
ok(await pub('GET', R), 404, 'the old link stops working');
ok(await pub('GET', `/api/reserve/${link.token}`));
step('Church Admin can turn the link off, or make a new one so the old one stops working');

// Too many sent from one place in an hour: slowed down (mistakes didn't count toward it)
const pub2 = client();
for (let i = 0; i < 5; i++) ok(await pub2('POST', `/api/reserve/${link.token}`, { ...bake, title: `Event ${i}` }), 201);
ok(await pub2('POST', `/api/reserve/${link.token}`, { ...bake, title: 'One too many' }), 429);
step('eight sent requests an hour from one place; fixing a mistake doesn’t count');

console.log('\nAll room request checks passed.');
