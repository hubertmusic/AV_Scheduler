// Gear → Reports: crew report problems and missing gear (and see only their own); team leaders and
// the admin get the inventory, audits, equipment requests, store links and the full report.
// Against a running API with an EMPTY database:   BASE_URL=http://localhost:4000 node test/reports.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
function client(team = 'av') {
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
  assert.equal(r.status, code, `${code} expected, got ${r.status}: ${JSON.stringify(r.data)?.slice(0, 300)}`);
  return r.data;
};
const step = (m) => console.log('✓', m);

// ---------- people ----------
const admin = client();
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Grace Church' }), 201);
async function person(name, email) {
  const r = ok(await admin('POST', '/api/people', { name, email }), 201);
  const c = client();
  ok(await c('POST', `/api/auth/invite/${r.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  return { id: r.person.id, c };
}
const crew = await person('Casey', 'casey@example.com');
const crew2 = await person('Drew', 'drew@example.com');
const lead = await person('Lena', 'lena@example.com');
ok(await admin('PATCH', `/api/people/${lead.id}`, { role: 'leader' }));
// a leader with none of the usual privileges is still a team leader here
ok(await admin('PATCH', `/api/people/${lead.id}`, { perms: { plans: false, edit: false, approve: false, message: false } }));

// ---------- inventory ----------
const mic = ok(await lead.c('POST', '/api/gear', { name: 'Wireless mic 3', category: 'Microphones', brand: 'Shure', model: 'SLXD24/B58', serial: 'SX123', assetTag: 'AV-031', quantity: 1, location: 'Booth cabinet', cost: '549.99', purchasedOn: '2024-03-10', condition: 'good' }), 201);
assert.equal(mic.brand, 'Shure');
assert.equal(mic.cost, 549.99);
assert.equal(mic.purchasedOn, '2024-03-10');
const di = ok(await admin('POST', '/api/gear', { name: 'DI box', category: 'Cables & DI', quantity: 4, cost: 39.5 }), 201);
const cam = ok(await admin('POST', '/api/gear', { name: 'Camera 2', category: 'Video', condition: 'fair' }), 201);
ok(await crew.c('POST', '/api/gear', { name: 'Nope' }), 403);
ok(await crew.c('PATCH', `/api/gear/${mic.id}`, { cost: 1 }), 403);
const edited = ok(await lead.c('PATCH', `/api/gear/${di.id}`, { location: 'Stage box drawer', condition: 'nope', purchasedOn: 'soon' }));
assert.equal(edited.location, 'Stage box drawer');
assert.equal(edited.condition, '', 'unknown conditions are ignored');
assert.equal(edited.purchasedOn, '', 'only real dates');
assert.ok(ok(await crew.c('GET', '/api/gear')).some((g) => g.name === 'DI box'), 'crew still see the gear to check out and report');
let sum = ok(await lead.c('GET', '/api/reports/summary'));
assert.equal(sum.items, 3);
assert.equal(sum.units, 6);
assert.equal(sum.value, 549.99 + 4 * 39.5);
assert.equal(sum.unpriced, 1);
ok(await crew.c('GET', '/api/reports/summary'), 403);
step('team leaders (even without other privileges) and the admin keep the inventory: brand, model, serial, tag, quantity, location, value, condition; crew can’t change it');

// ---------- problems and missing gear ----------
const p1 = ok(await crew.c('POST', '/api/reports/problems', { kind: 'problem', gearId: mic.id, title: 'Crackles when moved', details: 'Sunday 2nd service' }), 201);
assert.equal(p1.kind, 'problem');
const miss = ok(await crew.c('POST', '/api/reports/problems', { kind: 'missing', gearId: cam.id }), 201);
assert.equal(miss.title, 'Camera 2 is missing', 'a missing report names the item by itself');
ok(await crew.c('POST', '/api/reports/problems', { kind: 'problem' }), 400);
const other = ok(await crew2.c('POST', '/api/reports/problems', { kind: 'other', title: 'Booth light flickers' }), 201);
let mine = ok(await crew.c('GET', '/api/reports/problems'));
assert.equal(mine.lead, false);
assert.deepEqual(mine.list.map((x) => x.title).sort(), ['Camera 2 is missing', 'Crackles when moved'], 'crew see only what they reported');
let all = ok(await lead.c('GET', '/api/reports/problems'));
assert.equal(all.lead, true);
assert.equal(all.list.length, 3);
let g = ok(await admin('GET', '/api/gear'));
assert.equal(g.find((x) => x.id === cam.id).missing, true, 'reported missing shows on the item');
assert.equal(g.find((x) => x.id === mic.id).attention, 'Crackles when moved');
assert.equal(ok(await lead.c('GET', '/api/bootstrap')).gearReports.open, 3, 'leaders get a count for the tab');
assert.equal(ok(await crew.c('GET', '/api/bootstrap')).gearReports, null);
ok(await crew.c('POST', `/api/reports/problems/${p1.id}/resolve`, {}), 403);
ok(await crew.c('DELETE', `/api/reports/problems/${other.id}`), 403);
ok(await crew2.c('DELETE', `/api/reports/problems/${other.id}`), 204);
const found = ok(await lead.c('POST', `/api/reports/problems/${miss.id}/resolve`, { note: 'It was in the youth room' }));
assert.equal(found.status, 'fixed');
assert.equal(ok(await admin('GET', '/api/gear')).find((x) => x.id === cam.id).missing, false, 'found: no longer missing');
ok(await lead.c('POST', `/api/reports/problems/${miss.id}/reopen`));
assert.equal(ok(await admin('GET', '/api/gear')).find((x) => x.id === cam.id).missing, true);
ok(await lead.c('POST', `/api/reports/problems/${p1.id}/resolve`, { note: 'New capsule' }));
assert.equal(ok(await admin('GET', '/api/gear')).find((x) => x.id === mic.id).attention, '', 'fixed: the item is fine again');
step('crew report problems and missing gear and see only their own; leaders see all, mark fixed or found, and the item follows');

// ---------- audit ----------
const audit = ok(await lead.c('POST', '/api/reports/audits'), 201);
assert.equal(ok(await admin('POST', '/api/reports/audits'), 201).id, audit.id, 'one audit at a time: starting again carries on with it');
ok(await crew.c('POST', '/api/reports/audits'), 403);
ok(await lead.c('POST', `/api/reports/audits/${audit.id}/mark`, { gearId: mic.id, status: 'found' }));
ok(await lead.c('POST', `/api/reports/audits/${audit.id}/mark`, { gearId: cam.id, status: 'found', note: 'On the tripod' }));
ok(await admin('POST', `/api/reports/audits/${audit.id}/mark`, { gearId: di.id, status: 'missing' }));
let a = ok(await lead.c('POST', `/api/reports/audits/${audit.id}/mark`, { gearId: di.id, status: 'damaged', note: 'Cracked case' }));
assert.deepEqual(a.counts, { found: 2, missing: 0, damaged: 1, checked: 3 }, 'marking again changes the answer');
ok(await lead.c('POST', `/api/reports/audits/${audit.id}/mark`, { gearId: di.id, status: 'nope' }), 400);
const fin = ok(await lead.c('POST', `/api/reports/audits/${audit.id}/finish`));
assert.ok(fin.finishedAt);
ok(await lead.c('POST', `/api/reports/audits/${audit.id}/mark`, { gearId: di.id, status: 'found' }), 400);
g = ok(await admin('GET', '/api/gear'));
assert.equal(g.find((x) => x.id === cam.id).missing, false, 'found in the audit: no longer missing');
assert.ok(g.find((x) => x.id === cam.id).auditedAt);
all = ok(await lead.c('GET', '/api/reports/problems?status=open')).list;
assert.ok(all.some((x) => x.title === 'DI box needs repair' && x.details === 'Cracked case'), 'damaged goes on the problem list');
assert.ok(!all.some((x) => x.title === 'Camera 2 is missing'), 'the missing report was closed');
// a second audit: something not found
const a2 = ok(await lead.c('POST', '/api/reports/audits'), 201);
assert.notEqual(a2.id, audit.id);
ok(await lead.c('POST', `/api/reports/audits/${a2.id}/mark`, { gearId: mic.id, status: 'missing', note: 'Not in the cabinet' }));
ok(await lead.c('POST', `/api/reports/audits/${a2.id}/finish`));
assert.equal(ok(await admin('GET', '/api/gear')).find((x) => x.id === mic.id).missing, true);
assert.ok(ok(await lead.c('GET', '/api/reports/problems?status=open')).list.some((x) => x.kind === 'missing' && x.gear?.id === mic.id));
const history = ok(await lead.c('GET', '/api/reports/audits'));
assert.equal(history.length, 2);
sum = ok(await lead.c('GET', '/api/reports/summary'));
assert.equal(sum.missing, 1);
assert.ok(sum.lastAuditAt);
ok(await lead.c('DELETE', `/api/reports/audits/${audit.id}`), 403);
step('audits: one at a time, mark found / missing / needs repair, finish puts missing and damaged on the problem list and clears what turned up');

// ---------- equipment requests ----------
const r1 = ok(await lead.c('POST', '/api/reports/requests', { title: 'Shure SM58', details: 'Spares for the choir', quantity: 3, unitCost: 99, links: [{ label: 'Sweetwater', url: 'https://www.sweetwater.com/store/detail/SM58' }, { label: 'bad', url: 'javascript:alert(1)' }], neededBy: '2026-12-20' }), 201);
assert.equal(r1.total, 297);
assert.equal(r1.links.length, 1, 'only real web links');
ok(await lead.c('POST', '/api/reports/requests', { title: '' }), 400);
ok(await crew.c('POST', '/api/reports/requests', { title: 'Free stuff' }), 403);
ok(await crew.c('GET', '/api/reports/requests'), 403);
const r2 = ok(await admin('POST', '/api/reports/requests', { title: 'Camera battery', quantity: 2, unitCost: 45.5 }), 201);
const appr = ok(await admin('PATCH', `/api/reports/requests/${r1.id}`, { status: 'approved', note: 'From the AV budget' }));
assert.equal(appr.status, 'approved');
assert.equal(appr.decidedBy, 'Hub M.');
ok(await admin('PATCH', `/api/reports/requests/${r1.id}`, { status: 'bought' }), 400);
sum = ok(await lead.c('GET', '/api/reports/summary'));
assert.equal(sum.requests.waiting, 1);
assert.equal(sum.requests.waitingCost, 91);
assert.equal(sum.requests.approvedCost, 297);
ok(await admin('DELETE', `/api/reports/requests/${r2.id}`), 204);
step('equipment requests: what, why, how many, estimate and where it was priced; approve, order, receive or decline; totals for the budget');

// ---------- stores and links ----------
let links = ok(await lead.c('GET', '/api/reports/links'));
assert.ok(links.filter((l) => l.store).length >= 5, 'starts with a list of stores to price things at');
assert.ok(links.every((l) => !l.store || l.url.includes('{q}')));
links = ok(await lead.c('POST', '/api/reports/links', { label: 'Our Sweetwater sales engineer', url: 'https://www.sweetwater.com/sweetcare/', note: 'Ask for Jordan' }), 201);
const mineLink = links.find((l) => l.label === 'Our Sweetwater sales engineer');
assert.equal(mineLink.store, false);
ok(await lead.c('POST', '/api/reports/links', { label: 'Bad', url: 'ftp://x' }), 400);
links = ok(await lead.c('PATCH', `/api/reports/links/${mineLink.id}`, { url: 'https://example.com/search?q={q}' }));
assert.equal(links.find((l) => l.id === mineLink.id).store, true, 'a {q} in the address makes it a store to search');
const gone = links.find((l) => l.label === 'eBay (used)');
links = ok(await lead.c('DELETE', `/api/reports/links/${gone.id}`));
assert.ok(!links.some((l) => l.label === 'eBay (used)'));
assert.ok(!ok(await lead.c('GET', '/api/reports/links')).some((l) => l.label === 'eBay (used)'), 'a removed store stays removed');
ok(await crew.c('GET', '/api/reports/links'), 403);
step('stores to price things at and other links: a starting list leaders can fix, remove and add to');

// ---------- full report ----------
const full = ok(await lead.c('GET', '/api/reports/full'));
assert.equal(full.church, 'Grace Church');
assert.equal(full.gear.length, 3);
assert.equal(full.gear.find((x) => x.name === 'Wireless mic 3').serial, 'SX123');
assert.ok(full.open.length >= 2);
assert.ok(full.fixed.length >= 1);
assert.equal(full.requests.length, 1);
assert.equal(full.audit.counts.missing, 1, 'the latest finished audit');
ok(await crew.c('GET', '/api/reports/full'), 403);
step('the full report has everything: totals, inventory, open and recently fixed problems, requests and the last audit');
console.log('\nAll reports tests passed.');
