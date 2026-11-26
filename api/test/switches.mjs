// Extra features behind Settings → Extra features: live run-of-show, checklists, input list,
// problem reports, debrief, sign-offs. Against a running API with an EMPTY database:
//   BASE_URL=http://localhost:4000 node test/switches.mjs
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
  call.upload = (p, files, extra = {}, field = 'files') => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    for (const f of files) fd.append(field, new Blob([f.bytes], { type: f.type }), f.name);
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
const crew = client();
const learner = client();
const anon = client();
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Grace Church' }), 201);
async function member(c, name, email, body) {
  const inv = ok(await admin('POST', '/api/people', { name, email, phone: '', positions: body.positions || [] }), 201);
  ok(await c('POST', `/api/auth/invite/${inv.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  ok(await admin('PATCH', `/api/people/${inv.person.id}`, body));
  return inv.person.id;
}
const ava = await member(crew, 'Ava Lead', 'ava@example.com', { positions: ['foh', 'pro'], leads: ['foh'] });
const fay = await member(learner, 'Fay Learner', 'fay@example.com', { positions: ['pro'], trainee: ['foh'] });
const svc = ok(await admin('POST', '/api/events', { date: iso(0), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh', 'pro'] }), 201);
ok(await admin('PUT', `/api/events/${svc.id}/assign/foh`, { userId: ava }));
ok(await admin('PUT', `/api/events/${svc.id}/assign/foh+shadow`, { userId: fay }));

// ---------- switches ----------
let st = ok(await admin('GET', '/api/bootstrap')).settings;
assert.deepEqual(Object.values(st.features), [false, false, false, false, false, false], 'all off to start');
ok(await crew('GET', `/api/checklists/${svc.id}`), 404);
ok(await crew('GET', '/api/issues'), 404);
ok(await crew('GET', `/api/plans/${svc.id}/live`), 404);
ok(await crew('PATCH', '/api/settings', { features: { problems: true } }), 403);
st = ok(await admin('PATCH', '/api/settings', { features: { liveShow: true, checklists: true, inputList: true, problems: true, debrief: true, signoffs: true, bogus: true } }));
assert.ok(Object.values(st.features).every(Boolean));
assert.ok(!('bogus' in st.features));
step('extra features start off; only the admin turns them on');

// ---------- live run-of-show ----------
ok(await admin('PATCH', `/api/plans/${svc.id}`, { order: [{ kind: 'heading', title: 'Worship' }, { title: 'Welcome', minutes: 5 }, { kind: 'song', title: 'Amazing Grace', minutes: 5 }, { kind: 'sermon', title: 'Sermon', minutes: 30 }] }));
ok(await learner('POST', `/api/plans/${svc.id}/live`, { action: 'start' }));
let live = ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'start' }));
assert.equal(live.live.index, 1, 'headings are skipped');
assert.equal(live.live.log[0].title, 'Welcome');
live = ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'next' }));
assert.equal(live.order[live.live.index].title, 'Amazing Grace');
live = ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'goto', index: 3 }));
assert.equal(live.live.index, 3);
live = ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'prev' }));
assert.equal(live.live.index, 2);
ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'goto', index: 0 }), 400);
const stage = ok(await anon('GET', `/api/public/live/${live.stageToken}`));
assert.equal(stage.live.index, 2);
assert.equal(stage.order[2].title, 'Amazing Grace');
live = ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'next' }));
live = ok(await crew('POST', `/api/plans/${svc.id}/live`, { action: 'next' }));
assert.ok(live.live.endedAt, 'next on the last item ends it');
assert.equal(ok(await admin('GET', `/api/plans/${svc.id}`)).live.log.length, 5, 'the log feeds livestream chapters');
ok(await admin('POST', `/api/plans/${svc.id}/live`, { action: 'reset' }));
step('live run-of-show: start, next, back, jump, end, stage clock link, log kept');

// ---------- checklists ----------
st = ok(await admin('PATCH', '/api/settings', { checklists: { foh: ['Line check', 'Fresh mic batteries', 'Line check'], nope: ['x'], pro: [] } }));
assert.deepEqual(st.checklists, { foh: ['Line check', 'Fresh mic batteries'] });
let cl = ok(await crew('GET', `/api/checklists/${svc.id}`));
assert.equal(cl.positions.length, 1);
assert.equal(cl.positions[0].mine, true);
cl = ok(await crew('POST', `/api/checklists/${svc.id}`, { position: 'foh', item: 'Line check', done: true }));
assert.equal(cl.positions[0].done, 1);
assert.equal(cl.positions[0].items[0].by, 'Ava Lead');
cl = ok(await learner('POST', `/api/checklists/${svc.id}`, { position: 'foh', item: 'Fresh mic batteries', done: true }));
assert.equal(cl.positions[0].done, 2, 'the shadow can tick too');
ok(await crew('POST', `/api/checklists/${svc.id}`, { position: 'foh', item: 'Not on the list', done: true }), 400);
cl = ok(await admin('POST', `/api/checklists/${svc.id}`, { position: 'foh', item: 'Line check', done: false }));
assert.equal(cl.positions[0].done, 1);
step('checklists: per-position items set by the admin, ticked by whoever is on it');

// ---------- input list ----------
ok(await admin('PATCH', `/api/plans/${svc.id}`, { inputs: [{ ch: '1', source: 'Pastor (lapel)', mic: 'ULXD 1' }, { ch: '2', source: 'Lead vocal', mic: 'SM58' }, { ch: '', source: '' }] }));
assert.equal(ok(await admin('GET', `/api/plans/${svc.id}`)).inputs.length, 2);
const next = ok(await admin('POST', '/api/events', { date: iso(7), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const copied = ok(await admin('POST', `/api/plans/${next.id}/inputs/copy-last`));
assert.equal(copied.inputs[0].source, 'Pastor (lapel)');
const plan = ok(await admin('GET', `/api/plans/${svc.id}`));
assert.equal(ok(await anon('GET', `/api/public/rundown/${plan.share.rundown}`)).inputs.length, 2, 'the rundown link shows inputs');
step('input list: edit, copy last week’s, shown on the rundown');

// ---------- problem reports ----------
const mic = ok(await admin('POST', '/api/gear', { name: 'Wireless mic 3', category: 'Microphones' }), 201);
const issue = ok(await crew('POST', '/api/issues', { title: 'Mic 3 crackles', details: 'During the sermon', eventId: svc.id, gearId: mic.id }), 201);
assert.equal(issue.gear.name, 'Wireless mic 3');
assert.equal(issue.event.title, 'Worship Service');
assert.equal(ok(await crew('GET', '/api/gear')).find((g) => g.id === mic.id).attention, 'Mic 3 crackles', 'the gear item is flagged');
ok(await crew('POST', `/api/issues/${issue.id}/fix`, {}), 403);
const fixed = ok(await admin('POST', `/api/issues/${issue.id}/fix`, { note: 'New capsule' }));
assert.equal(fixed.status, 'fixed');
assert.equal(ok(await crew('GET', '/api/gear')).find((g) => g.id === mic.id).attention, '', 'and cleared when fixed');
assert.equal(ok(await crew('GET', '/api/issues?status=open')).length, 0);
ok(await admin('POST', `/api/issues/${issue.id}/reopen`));
assert.equal(ok(await crew('GET', '/api/issues?status=open')).length, 1);
step('problem reports: anyone reports, leaders fix, gear flag follows');

// ---------- debrief ----------
let pend = ok(await crew('GET', '/api/debrief/pending'));
assert.deepEqual(pend.map((e) => e.id), [svc.id]);
ok(await crew('POST', `/api/debrief/${svc.id}`, {}), 400);
const db = ok(await crew('POST', `/api/debrief/${svc.id}`, { wentWell: 'Smooth transitions', problems: 'Stage monitor too loud', ideas: 'Label the snake', toFixList: true }), 201);
assert.ok(db.issue, 'problems can go straight to the fix list');
assert.equal(ok(await crew('GET', '/api/debrief/pending')).length, 0);
ok(await crew('GET', `/api/debrief/${svc.id}`), 403);
const answers = ok(await admin('GET', `/api/debrief/${svc.id}`));
assert.equal(answers[0].name, 'Ava Lead');
assert.equal(answers[0].ideas, 'Label the snake');
const outsider = client();
await member(outsider, 'Ozzy Out', 'ozzy@example.com', { positions: ['pro'] });
ok(await outsider('POST', `/api/debrief/${svc.id}`, { wentWell: 'x' }), 403);
step('debrief: people who served check in; leaders read; problems to the fix list');

// ---------- sign-offs ----------
ok(await learner('POST', '/api/signoffs', { userId: fay, position: 'foh' }), 403);
const over = ok(await crew('GET', '/api/me/overview'));
assert.equal(over.shifts.find((s) => s.id === svc.id).learner, fay, 'the Lead sees who shadowed them');
const so = ok(await crew('POST', '/api/signoffs', { userId: fay, position: 'foh', eventId: svc.id, note: 'Ran the whole service' }), 201);
assert.ok(so.positions.includes('foh') && !so.trainee.includes('foh'));
ok(await crew('POST', '/api/signoffs', { userId: fay, position: 'foh' }), 400);
const hist = ok(await admin('GET', `/api/signoffs?userId=${fay}`));
assert.equal(hist[0].by, 'Ava Lead');
step('training sign-offs: a Lead moves a learner from Learning to Capable');

ok(await admin('PATCH', '/api/settings', { features: { problems: false } }));
ok(await crew('GET', '/api/issues'), 404);
step('turning a feature off hides it again');

console.log('\nAll extra-feature checks passed.');
