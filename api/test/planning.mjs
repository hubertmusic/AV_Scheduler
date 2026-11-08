// Planning tab: skill levels, flow-chart boards and the month planner, against a running API with
// an EMPTY database:   BASE_URL=http://localhost:4000 node test/planning.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';

function client() {
  let cookie = '';
  const send = async (method, p, body, isForm) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    let data;
    if (type.includes('json')) data = await res.json().catch(() => null);
    else if (type.startsWith('text/')) data = await res.text();
    else data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  };
  const call = (method, p, body) => send(method, p, body, false);
  call.upload = (p, files, extra = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    for (const f of files) fd.append('files', new Blob([f.bytes], { type: f.type }), f.name);
    return send('POST', p, fd, true);
  };
  return call;
}
const ok = (r, code = 200) => {
  assert.equal(r.status, code, JSON.stringify(r.data));
  return r.data;
};
const step = (msg) => console.log('✓', msg);
const iso = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const admin = client();
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Crew' }), 201);
async function member(name, email, body) {
  const inv = ok(await admin('POST', '/api/people', { name, email, phone: '', positions: body.positions || [] }), 201);
  const c = client();
  ok(await c('POST', `/api/auth/invite/${inv.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  ok(await admin('PATCH', `/api/people/${inv.person.id}`, body));
  return { id: inv.person.id, c };
}
const ava = await member('Ava', 'ava@example.com', { positions: ['foh', 'pro'], leads: ['foh', 'cam'] });
const ben = await member('Ben', 'ben@example.com', { positions: ['foh', 'pro'] });
const cy = await member('Cy', 'cy@example.com', { positions: ['pro'], trainee: ['foh'] });
const dee = await member('Dee', 'dee@example.com', { positions: ['foh'], maxPerMonth: 1 });
const lee = await member('Lee', 'lee@example.com', { positions: [] });
ok(await admin('PATCH', `/api/people/${lee.id}`, { role: 'leader', leaderTitle: 'Media lead' }));

// ---------- skill levels ----------
const people = ok(await admin('GET', '/api/people'));
const avaView = (people.people || people).find((p) => p.id === ava.id);
assert.deepEqual(avaView.leads, ['foh'], 'Lead only on positions they’re trained for');
ok(await admin('PATCH', `/api/people/${ava.id}`, { positions: ['pro', 'foh'] }));
step('skill levels: Learning, Capable and Lead per position');

// ---------- boards ----------
ok(await ben.c('GET', '/api/boards'), 403);
ok(await ben.c('POST', '/api/boards', { title: 'Nope' }), 403);
const week = ok(await lee.c('POST', '/api/boards', { title: 'Week kickoff', template: 'week' }), 201);
assert.equal(week.nodes.length, 6);
assert.equal(week.edges.length, 4);
assert.equal(week.createdBy, 'Lee');
const mine = ok(await admin('POST', '/api/boards', { title: 'Ideas' }), 201);
assert.equal(mine.nodes.length, 0);
let saved = ok(await admin('PUT', `/api/boards/${week.id}`, {
  rev: week.rev,
  title: 'Week of the 14th',
  nodes: [...week.nodes, { id: 'p1', type: 'person', x: 10, y: 600, label: 'Can cover FOH', color: 'green', personId: ava.id }, { id: 'bad id!', type: 'box', x: 0, y: 0, label: 'x' }],
  edges: [...week.edges, { id: 'e9', source: 'fill', target: 'p1', label: 'Ask' }, { id: 'e10', source: 'p1', target: 'ghost' }],
}));
assert.equal(saved.rev, week.rev + 1);
assert.equal(saved.title, 'Week of the 14th');
assert.equal(saved.nodes.length, 7, 'bad node ids are dropped');
assert.equal(saved.edges.length, 5, 'lines to missing boxes are dropped');
assert.equal(saved.nodes.find((n) => n.id === 'p1').personId, ava.id);
ok(await lee.c('PUT', `/api/boards/${week.id}`, { rev: week.rev, nodes: [], edges: [] }), 409);
const fresh = ok(await lee.c('GET', `/api/boards/${week.id}`));
assert.equal(fresh.updatedBy, 'Hub M.');
ok(await lee.c('PUT', `/api/boards/${week.id}`, { rev: fresh.rev, nodes: fresh.nodes.slice(0, 2), edges: fresh.edges }));
assert.equal(ok(await lee.c('GET', `/api/boards/${week.id}`)).edges.length, 1, 'lines go with their boxes');
const list = ok(await lee.c('GET', '/api/boards'));
assert.equal(list.length, 2);
assert.ok(list.every((b) => b.nodes === undefined && typeof b.size === 'number'));
ok(await lee.c('DELETE', `/api/boards/${mine.id}`), 403);
ok(await admin('DELETE', `/api/boards/${week.id}`), 204);
step('flow-chart boards: shared by admin and leaders, saved with a version check');

// ---------- month planner ----------
ok(await lee.c('GET', '/api/planner/month?month=2026-01'), 403);
ok(await admin('GET', '/api/planner/month?month=2026-13'), 400);
const now = new Date();
const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const month = next.toISOString().slice(0, 7);
const sats = [];
for (let d = 1; d <= 28; d++) {
  const dt = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), d));
  if (dt.getUTCDay() === 6) sats.push(dt.toISOString().slice(0, 10));
}
const ev1 = ok(await admin('POST', '/api/events', { date: sats[0], title: 'Worship', call: '10:00', start: '11:00', end: '12:00', needs: ['foh', 'pro'] }), 201);
const ev2 = ok(await admin('POST', '/api/events', { date: sats[1], title: 'Worship', call: '10:00', start: '11:00', end: '12:00', needs: ['foh', 'pro'] }), 201);
ok(await ben.c('PUT', `/api/events/${ev2.id}/unavailable`, { unavailable: true }));

let mp = ok(await admin('GET', `/api/planner/month?month=${month}`));
assert.deepEqual(mp.events.map((e) => e.id), [ev1.id, ev2.id]);
assert.ok(mp.unavailable[ev2.id].includes(ben.id));
assert.deepEqual(mp.people.find((p) => p.id === cy.id).trainee, ['foh']);
assert.equal(mp.assignments.length, 0);

const fill = ok(await admin('POST', '/api/planner/autofill', { month, draft: [] }));
assert.equal(fill.proposals.length, 4, JSON.stringify(fill));
assert.ok(!fill.proposals.some((p) => p.eventId === ev2.id && p.userId === ben.id), 'never someone who is unavailable');
assert.ok(fill.proposals.filter((p) => p.userId === dee.id).length <= 1, 'monthly limit holds across weekends');
assert.ok(fill.proposals.some((p) => p.userId === ava.id && p.position === 'foh' && /Lead/.test(p.reason)), 'a Lead is preferred when a service has none');
assert.equal(ok(await admin('GET', `/api/planner/month?month=${month}`)).assignments.length, 0, 'auto-fill is only a draft');

// A draft already holding Ava on ev1 FOH: auto-fill plans around it
const around = ok(await admin('POST', '/api/planner/autofill', { month, draft: [{ eventId: ev1.id, position: 'foh', userId: ava.id }] }));
assert.ok(!around.proposals.some((p) => p.eventId === ev1.id && p.position === 'foh'));
assert.ok(!around.proposals.some((p) => p.eventId === ev1.id && p.userId === ava.id), 'not twice on one service');

let ap = ok(await admin('POST', '/api/planner/apply', { changes: fill.proposals.map(({ eventId, position, userId }) => ({ eventId, position, userId })) }));
assert.equal(ap.applied, 4);
mp = ok(await admin('GET', `/api/planner/month?month=${month}`));
assert.equal(mp.assignments.length, 4);
step('month planner: availability, draft auto-fill (limits, Leads, unavailability), apply');

const at = (pos, eid = ev1.id) => mp.assignments.find((a) => a.eventId === eid && a.position === pos)?.userId;
ap = ok(await admin('POST', '/api/planner/apply', { changes: [{ eventId: ev1.id, position: 'foh', userId: ava.id }, { eventId: ev1.id, position: 'pro', userId: ben.id }] }));
mp = ok(await admin('GET', `/api/planner/month?month=${month}`));
assert.equal(at('foh'), ava.id);
assert.equal(at('pro'), ben.id);
ap = ok(await admin('POST', '/api/planner/apply', { changes: [{ eventId: ev1.id, position: 'foh', userId: ben.id }, { eventId: ev1.id, position: 'pro', userId: ava.id }] }));
assert.equal(ap.applied, 2, JSON.stringify(ap));
mp = ok(await admin('GET', `/api/planner/month?month=${month}`));
assert.equal(at('foh'), ben.id, 'swapped');
assert.equal(at('pro'), ava.id, 'swapped');
step('swapping two people on one service works');

ap = ok(await admin('POST', '/api/planner/apply', { changes: [{ eventId: ev2.id, position: 'foh', userId: cy.id }, { eventId: ev1.id, position: 'foh+shadow', userId: cy.id }, { eventId: ev1.id, position: 'cam', userId: ava.id }] }));
assert.equal(ap.applied, 1);
assert.equal(ap.skipped.length, 2);
assert.match(ap.skipped.find((s) => s.position === 'foh').why, /isn’t trained/);
assert.match(ap.skipped.find((s) => s.position === 'cam').why, /doesn’t need/);
mp = ok(await admin('GET', `/api/planner/month?month=${month}`));
assert.equal(at('foh+shadow'), cy.id, 'learners go in as a shadow');
ap = ok(await admin('POST', '/api/planner/apply', { changes: [{ eventId: ev1.id, position: 'foh+shadow', userId: null }] }));
assert.equal(ap.applied, 1);
ok(await admin('POST', '/api/planner/apply', { changes: [] }), 400);
step('apply checks training, shadows and positions; empty spots can be cleared');

console.log('\nAll planning checks passed.');
