// Resources & help: who can see each resource (everyone, team leaders, head leaders, the admin),
// files kept in Crew Call and sent only to those people, "Your guide", and resources on every team.
// Against a running API with an EMPTY database:   BASE_URL=http://localhost:4000 node test/resources.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
function client(team = 'av') {
  let cookie = '';
  const call = async (method, p, body) => {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.team ? { 'X-Team': call.team } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type: ct, disposition: res.headers.get('content-disposition') || '' };
  };
  call.team = team;
  return call;
}
const ok = (r, code = 200) => {
  assert.equal(r.status, code, `${code} expected, got ${r.status}: ${JSON.stringify(r.data)?.slice(0, 300)}`);
  return r.data;
};
const step = (m) => console.log('✓', m);
const PDF = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
function form(fields, file, name = 'guide.pdf', type = 'application/pdf') {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  if (file) f.append('file', new Blob([file], { type }), name);
  return f;
}

// ---------- people ----------
const admin = client('av');
const adminP = client('praise');
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Grace Church' }), 201);
ok(await adminP('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
async function person(c, name, email, team = 'av') {
  const r = ok(await c('POST', '/api/people', { name, email }), 201);
  const pc = client(team);
  ok(await pc('POST', `/api/auth/invite/${r.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  return { id: r.person.id, c: pc };
}
const crew = await person(admin, 'Casey', 'casey@example.com');
const lead = await person(admin, 'Lena', 'lena@example.com');
const head = await person(admin, 'Hank', 'hank@example.com');
const praise = await person(adminP, 'Pia', 'pia@example.com', 'praise');
ok(await admin('PATCH', `/api/people/${lead.id}`, { role: 'leader' }));
ok(await admin('PATCH', `/api/people/${lead.id}`, { perms: { resources: true } }));
ok(await admin('PUT', '/api/teams/av/head', { userId: head.id }));
const lb = ok(await lead.c('GET', '/api/bootstrap')).me;
assert.equal(lb.role, 'leader');
assert.equal(lb.can.resources, true);
assert.equal(ok(await head.c('GET', '/api/bootstrap')).me.head, true);

// ---------- links, with an audience ----------
const titles = async (c) => ok(await c('GET', '/api/resources')).map((r) => r.title).sort();
const plain = ok(await lead.c('POST', '/api/resources', { title: 'FOH checklist', url: 'example.com/foh', position: 'foh' }), 201);
assert.equal(plain.audience, 'all', 'everyone on the team by default');
assert.equal(plain.url, 'https://example.com/foh');
ok(await lead.c('POST', '/api/resources', { title: 'Leader notes', url: 'https://example.com/lead', audience: 'leaders' }), 201);
ok(await lead.c('POST', '/api/resources', { title: 'Too high', url: 'https://example.com/x', audience: 'heads' }), 403);
ok(await lead.c('POST', '/api/resources', { title: 'Nope', audience: 'everyone!' }), 400);
ok(await head.c('POST', '/api/resources', { title: 'Head notes', url: 'https://example.com/head', audience: 'heads' }), 201);
ok(await admin('POST', '/api/resources', { title: 'Server notes', url: 'https://example.com/srv', audience: 'admin' }), 201);
ok(await crew.c('POST', '/api/resources', { title: 'Crew can’t add', url: 'https://example.com' }), 403);
assert.deepEqual(await titles(crew.c), ['FOH checklist']);
assert.deepEqual(await titles(lead.c), ['FOH checklist', 'Leader notes']);
assert.deepEqual(await titles(head.c), ['FOH checklist', 'Head notes', 'Leader notes']);
assert.deepEqual(await titles(admin), ['FOH checklist', 'Head notes', 'Leader notes', 'Server notes']);
assert.deepEqual(await titles(praise.c), [], 'another team doesn’t see AV’s resources');
step('each resource says who can see it; each level sees its own and below; nobody can share above their own level');

// ---------- files ----------
const vol = ok(await admin('POST', '/api/resources', form({ title: 'Crew Call – Volunteer guide', guide: 'true', kind: 'Guide' }, PDF('volunteer'), 'Crew Call - Volunteer guide.pdf')), 201);
assert.equal(vol.file.name, 'Crew Call - Volunteer guide.pdf');
assert.equal(vol.file.mime, 'application/pdf');
assert.equal(vol.url, '');
assert.equal(vol.guide, true);
const ldr = ok(await admin('POST', '/api/resources', form({ title: 'Crew Call – Team leader guide', guide: 'true', audience: 'leaders' }, PDF('leader'))), 201);
const cmp = ok(await admin('POST', '/api/resources', form({ title: 'Crew Call – Complete guide', guide: 'true', audience: 'admin' }, PDF('complete'))), 201);
const untitled = ok(await lead.c('POST', '/api/resources', form({}, PDF('x'), 'Patch list.pdf')), 201);
assert.equal(untitled.title, 'Patch list', 'a file without a title is named after the file');

let f = await crew.c('GET', `/api/resources/${vol.id}/file`);
assert.equal(f.status, 200);
assert.ok(f.type.startsWith('application/pdf'), 'a PDF opens in the browser');
assert.ok(f.data.toString().includes('volunteer'));
f = await crew.c('GET', `/api/resources/${vol.id}/file?download=1`);
assert.ok(f.disposition.startsWith('attachment'), '?download=1 saves it instead');
ok(await crew.c('GET', `/api/resources/${ldr.id}/file`), 404);
ok(await crew.c('GET', `/api/resources/${cmp.id}/file`), 404);
ok(await lead.c('GET', `/api/resources/${ldr.id}/file`));
ok(await lead.c('GET', `/api/resources/${cmp.id}/file`), 404);
ok(await head.c('GET', `/api/resources/${cmp.id}/file`), 404);
assert.ok(ok(await admin('GET', `/api/resources/${cmp.id}/file`)).toString().includes('complete'));
ok(await client('av')('GET', `/api/resources/${vol.id}/file`), 401);
ok(await praise.c('GET', `/api/resources/${vol.id}/file`), 404, 'another team can’t open it either');
step('files are kept in Crew Call and sent only to the people the resource is for (a forwarded link doesn’t open for anyone else)');

// ---------- your guide: the one for the highest level you can see ----------
const pick = (list) => list.filter((r) => r.guide && (r.file || r.url)).sort((a, b) => ({ all: 0, leaders: 1, heads: 2, admin: 3 })[b.audience] - ({ all: 0, leaders: 1, heads: 2, admin: 3 })[a.audience])[0]?.title;
assert.equal(pick(ok(await crew.c('GET', '/api/resources'))), 'Crew Call – Volunteer guide');
assert.equal(pick(ok(await lead.c('GET', '/api/resources'))), 'Crew Call – Team leader guide');
assert.equal(pick(ok(await head.c('GET', '/api/resources'))), 'Crew Call – Team leader guide');
assert.equal(pick(ok(await admin('GET', '/api/resources'))), 'Crew Call – Complete guide');
step('“Your guide”: crew get the volunteer guide, leaders the team leader guide, the admin the complete guide');

// ---------- every team (admin only) ----------
ok(await admin('PATCH', `/api/resources/${vol.id}`, { everyTeam: true }));
ok(await admin('PATCH', `/api/resources/${ldr.id}`, { everyTeam: true }));
assert.deepEqual(await titles(praise.c), ['Crew Call – Volunteer guide'], 'Praise crew see the every-team guide for their level');
ok(await praise.c('GET', `/api/resources/${vol.id}/file`));
ok(await praise.c('GET', `/api/resources/${ldr.id}/file`), 404);
ok(await admin('PUT', '/api/teams/praise/head', { userId: praise.id }));
assert.deepEqual(await titles(praise.c), ['Crew Call – Team leader guide', 'Crew Call – Volunteer guide'], 'the Praise head leader sees the leader guide too');
const leadEvery = ok(await lead.c('POST', '/api/resources', { title: 'Sneaky', url: 'https://example.com', everyTeam: true }), 201);
assert.equal(leadEvery.everyTeam, false, 'only the admin puts something on every team');
let seen = ok(await head.c('GET', '/api/resources')).find((r) => r.id === vol.id);
assert.equal(seen.canEdit, false, 'every-team resources are the admin’s to change');
ok(await head.c('PATCH', `/api/resources/${vol.id}`, { title: 'Hijack' }), 403);
ok(await head.c('DELETE', `/api/resources/${vol.id}`), 403);
step('the admin can put a resource on every team (still only for the people chosen); only the admin changes those');

// ---------- editing, replacing and removing files ----------
const rLead = ok(await lead.c('GET', '/api/resources'));
assert.equal(rLead.find((r) => r.title === 'FOH checklist').canEdit, true);
ok(await lead.c('PATCH', `/api/resources/${plain.id}`, { audience: 'admin' }), 403);
const moved = ok(await lead.c('PATCH', `/api/resources/${plain.id}`, { audience: 'leaders' }));
assert.equal(moved.audience, 'leaders');
assert.ok(!(await titles(crew.c)).includes('FOH checklist'), 'crew lose it once it’s for leaders');
ok(await lead.c('PATCH', `/api/resources/${cmp.id}`, { title: 'x' }), 404, 'a leader can’t even find the admin’s');
const replaced = ok(await admin('POST', `/api/resources/${vol.id}/file`, form({}, PDF('volunteer v2'), 'Volunteer guide v2.pdf')));
assert.equal(replaced.file.name, 'Volunteer guide v2.pdf');
assert.ok(ok(await crew.c('GET', `/api/resources/${vol.id}/file`)).toString().includes('v2'));
ok(await lead.c('POST', `/api/resources/${vol.id}/file`, form({}, PDF('x'))), 403);
const noFile = ok(await lead.c('PATCH', `/api/resources/${untitled.id}`, { removeFile: true, url: 'https://example.com/patch' }));
assert.equal(noFile.file, null);
assert.equal(noFile.url, 'https://example.com/patch');
ok(await lead.c('GET', `/api/resources/${untitled.id}/file`), 404);
ok(await admin('DELETE', `/api/resources/${cmp.id}`), 204);
ok(await admin('GET', `/api/resources/${cmp.id}/file`), 404);
step('leaders change their team’s resources within their level; files can be replaced or removed; removing a resource removes its file');

// ---------- activity ----------
await new Promise((r) => setTimeout(r, 300));
const actions = ok(await admin('GET', '/api/activity/feed?kind=change&limit=100')).map((a) => a.action);
assert.ok(actions.includes('Added a resource for team leaders'), 'adding a resource is in the Activity log, with who it’s for');
assert.ok(actions.includes('Removed a resource'));
step('changes show in Activity');
console.log('\nAll resource tests passed.');
