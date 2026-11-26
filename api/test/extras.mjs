// Weekly links, order templates, announcement slides, gear, burnout watch and settings, against
// a running API with an EMPTY database:   BASE_URL=http://localhost:4000 node test/extras.mjs
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
const pastor = client();
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Grace Church' }), 201);
const inv = ok(await admin('POST', '/api/people', { name: 'Ava Crew', email: 'ava@example.com', phone: '4235550101', positions: ['foh'] }), 201);
ok(await crew('POST', `/api/auth/invite/${inv.inviteUrl.split('/invite/')[1]}`, { password: 'avapass12' }));
const ava = inv.person.id;

// ---------- weekly links ----------
ok(await crew('POST', '/api/standing-links', { name: 'Pastor James' }), 403);
ok(await pastor('GET', '/api/public/weekly/not-a-real-token-at-all-here'), 404);
const wl = ok(await admin('POST', '/api/standing-links', { name: 'Pastor James', serviceTitle: 'Worship Service', deadlineDays: 2, deadlineTime: '18:00' }), 201);
assert.match(wl.code, /^\d{6}$/);
assert.equal(wl.next, null, 'no service yet');
ok(await pastor('GET', `/api/public/weekly/${wl.token}`), 404);
const vespers = ok(await admin('POST', '/api/events', { date: iso(3), title: 'Vespers', call: '17:00', start: '18:00', end: '19:00', needs: ['foh'] }), 201);
const svc = ok(await admin('POST', '/api/events', { date: iso(6), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const later = ok(await admin('POST', '/api/events', { date: iso(13), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
let open = ok(await pastor('GET', `/api/public/weekly/${wl.token}`));
assert.equal(open.event.date, iso(6), 'the next Worship Service, not Vespers');
const again = ok(await pastor('GET', `/api/public/weekly/${wl.token}`));
assert.equal(again.token, open.token, 'same guest link all week');
let g = ok(await pastor('GET', `/api/guest/${open.token}`));
assert.equal(g.needsCode, true);
ok(await pastor('POST', `/api/guest/${open.token}/unlock`, { code: wl.code }), 204);
g = ok(await pastor('GET', `/api/guest/${open.token}`));
assert.equal(g.event.date, iso(6));
const closes = new Date(g.schedule.closesAt);
assert.equal(closes.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), iso(4), 'deadline 2 days before');
const plan = ok(await admin('GET', `/api/plans/${svc.id}`));
assert.equal(plan.guests.length, 1, 'it shows on the plan like any guest link');
const renewed = ok(await admin('POST', `/api/standing-links/${wl.id}/new-code`));
assert.notEqual(renewed.code, wl.code);
assert.equal(ok(await pastor('GET', `/api/guest/${open.token}`)).needsCode, true, 'the old code no longer works');
ok(await pastor('POST', `/api/guest/${open.token}/unlock`, { code: renewed.code }), 204);
ok(await admin('PATCH', `/api/standing-links/${wl.id}`, { deadlineDays: 1, deadlineTime: '20:00' }));
g = ok(await pastor('GET', `/api/guest/${open.token}`));
assert.equal(new Date(g.schedule.closesAt).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), '20', 'this week’s link follows the new deadline');
const list = ok(await admin('GET', '/api/standing-links'));
assert.equal(list.links[0].next.date, iso(6));
assert.ok(list.titles.includes('Worship Service') && list.titles.includes('Vespers'));
ok(await admin('DELETE', `/api/standing-links/${wl.id}`), 204);
ok(await pastor('GET', `/api/public/weekly/${wl.token}`), 404);
ok(await pastor('GET', `/api/guest/${open.token}`), 410);
step('weekly links: next matching service, deadline before it, one code, new code, turn off');

// ---------- order templates ----------
const order = [{ kind: 'item', title: 'Welcome', who: 'Elder' }, { kind: 'song', title: 'Opening song' }, { kind: 'sermon', title: 'Sermon', minutes: 30, notes: 'Lav mic' }];
ok(await crew('POST', '/api/order-templates', { name: 'x', order }), 403);
ok(await admin('POST', '/api/order-templates', { name: 'Empty', order: [] }), 400);
const tpl = ok(await admin('POST', '/api/order-templates', { name: 'Sabbath worship', serviceTitle: 'Worship Service', order }), 201);
assert.equal(tpl.order.length, 3);
const fresh = ok(await admin('GET', `/api/plans/${later.id}`));
assert.deepEqual(fresh.order.map((x) => x.title), ['Welcome', 'Opening song', 'Sermon'], 'new Worship Service plans start from the template');
assert.equal(fresh.order[2].notes, 'Lav mic');
assert.equal(ok(await admin('GET', `/api/plans/${vespers.id}`)).order.length, 0, 'other services start empty');
const added = ok(await admin('POST', `/api/plans/${vespers.id}/order/template/${tpl.id}`));
assert.equal(added.order.length, 3);
const tpl2 = ok(await admin('POST', '/api/order-templates', { name: 'Vespers', serviceTitle: 'Worship Service', order: order.slice(0, 1) }), 201);
const all = ok(await crew('GET', '/api/order-templates'));
assert.equal(all.find((t) => t.id === tpl.id).serviceTitle, '', 'one automatic template per service name');
assert.equal(all.find((t) => t.id === tpl2.id).serviceTitle, 'Worship Service');
ok(await admin('POST', '/api/order-templates', { name: 'Sabbath worship', serviceTitle: '', order: order.slice(0, 2) }));
assert.equal(ok(await admin('GET', '/api/order-templates')).find((t) => t.name === 'Sabbath worship').order.length, 2, 'same name replaces');
ok(await admin('DELETE', `/api/order-templates/${tpl2.id}`), 204);
step('order templates: save, auto-start new plans by service name, add by hand, replace, delete');

// ---------- announcement slides ----------
ok(await admin('GET', `/api/plans/${svc.id}/announcements.pptx`), 400);
ok(await admin('PATCH', `/api/plans/${svc.id}`, { announcements: 'Potluck after church\nBring a dish to share.\n\nPrayer meeting Wednesday 7 PM' }));
const pptx = ok(await crew('GET', `/api/plans/${svc.id}/announcements.pptx`));
assert.equal(pptx.subarray(0, 2).toString(), 'PK', 'a PowerPoint file');
step('announcement slides download as PowerPoint');

// ---------- settings ----------
let st = ok(await admin('PATCH', '/api/settings', { streamFooter: 'Give online: grace.example/give', burnoutWeeks: 3 }));
assert.equal(st.streamFooter, 'Give online: grace.example/give');
assert.equal(st.burnoutWeeks, 3);
ok(await admin('PATCH', '/api/settings', { burnoutWeeks: 40 }), 400);
step('livestream footer and burnout setting save');

// ---------- burnout watch ----------
const fridayOf = (d) => { const dt = new Date(`${d}T12:00:00Z`); const back = (dt.getUTCDay() + 2) % 7; return new Date(dt - back * 864e5).toISOString().slice(0, 10); };
const thisFri = (() => { const t = iso(0); const day = new Date(`${t}T12:00:00Z`).getUTCDay(); return day >= 1 && day <= 4 ? iso(5 - day) : fridayOf(t); })();
const plusDays = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
for (const w of [0, -7, -14, -21]) {
  const e = ok(await admin('POST', '/api/events', { date: plusDays(thisFri, w + 1), title: 'Streak Service', call: '10:00', start: '11:00', end: '12:00', needs: ['foh'] }), 201);
  ok(await admin('PUT', `/api/events/${e.id}/assign/foh`, { userId: ava }));
}
const load = ok(await admin('GET', '/api/people/load'));
assert.equal(load[ava].streak, 4, JSON.stringify(load[ava]));
const month = plusDays(thisFri, 28).slice(0, 7);
const mp = ok(await admin('GET', `/api/planner/month?month=${month}`));
assert.equal(mp.burnoutWeeks, 3);
assert.equal(typeof mp.streakBefore, 'object');
step('burnout watch: weekends in a row on Team, and before the month in the planner');

// ---------- gear ----------
ok(await crew('POST', '/api/gear', { name: 'Mic 3' }), 403);
const mic = ok(await admin('POST', '/api/gear', { name: 'Wireless mic 3', category: 'Microphones' }), 201);
const bag = ok(await admin('POST', '/api/gear', { name: 'Camera bag', category: 'Video' }), 201);
let m = ok(await crew('POST', `/api/gear/${mic.id}/out`, {}));
assert.equal(m.holder, 'Ava Crew');
m = ok(await crew('POST', `/api/gear/${mic.id}/out`, { name: 'Guest speaker', note: 'Lapel' }));
assert.equal(m.holder, 'Guest speaker');
m = ok(await crew('POST', `/api/gear/${mic.id}/log`, { action: 'battery' }));
assert.ok(m.batteryAt);
ok(await crew('POST', `/api/gear/${mic.id}/log`, { action: 'attention' }), 400);
m = ok(await crew('POST', `/api/gear/${mic.id}/log`, { action: 'attention', text: 'Crackles when moved' }));
assert.equal(m.attention, 'Crackles when moved');
m = ok(await crew('POST', `/api/gear/${mic.id}/in`, {}));
assert.equal(m.holder, null);
m = ok(await admin('POST', `/api/gear/${mic.id}/log`, { action: 'fixed', text: 'New capsule' }));
assert.equal(m.attention, '');
const logs = ok(await crew('GET', `/api/gear/${mic.id}/log`));
assert.deepEqual(logs.map((l) => l.action), ['fixed', 'in', 'attention', 'battery', 'out', 'out']);
const gearList = ok(await crew('GET', '/api/gear'));
assert.deepEqual(gearList.map((x) => x.name), ['Wireless mic 3', 'Camera bag']);
ok(await admin('DELETE', `/api/gear/${bag.id}`), 204);
step('gear: check out to yourself or someone, batteries, problems, fixed, return, log');

console.log('\nAll extras checks passed.');
