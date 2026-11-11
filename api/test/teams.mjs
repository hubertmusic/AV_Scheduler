// Teams: the AV team and the Praise team share services, plans, songs and one calendar, but each has
// its own positions, people, spots and leaders. Against a running API with an EMPTY database:
//   BASE_URL=http://localhost:4000 node test/teams.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';

function client(team = '') {
  let cookie = '';
  const send = async (method, p, body, isForm) => {
    const res = await fetch(BASE + p, {
      method,
      headers: {
        ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(call.team ? { 'X-Team': call.team } : {}),
      },
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
  call.team = team;
  call.upload = (p, files, field = 'files') => {
    const fd = new FormData();
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
const unfold = (ics) => String(ics).replace(/\r\n /g, '');
const shiftsIn = (ics) => (unfold(ics).match(/^UID:(?!.*-info-).*$/gm) || []).length;

// ---------- setup: two teams out of the box ----------
const admin = client('av');
const adminP = client('praise'); // the admin working on the Praise side (same sign-in, switched)
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Church' }), 201);
await adminP('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' });
let boot = ok(await admin('GET', '/api/bootstrap'));
assert.deepEqual(boot.allTeams.map((t) => [t.key, t.kind]), [['av', 'av'], ['praise', 'music']]);
assert.equal(boot.team.key, 'av');
assert.equal(boot.teams.length, 2, 'the admin can switch to every team');
assert.ok(boot.positions.length > 0 && boot.positions.every((p) => p.team === 'av'));
let bootP = ok(await adminP('GET', '/api/bootstrap'));
assert.equal(bootP.team.key, 'praise');
assert.equal(bootP.positions.length, 0, 'the Praise team starts with its own, empty, position list');
assert.ok(bootP.allPositions.length === boot.positions.length, 'everyone can still read every team’s position names');
step('AV and Praise teams exist; each request works in the team picked at the top');

// Praise positions are the Praise team's own
const wl = ok(await adminP('POST', '/api/positions', { label: 'Worship leader' }), 201).key;
const vox = ok(await adminP('POST', '/api/positions', { label: 'Vocals' }), 201).key;
const keys = ok(await adminP('POST', '/api/positions', { label: 'Keys' }), 201).key;
bootP = ok(await adminP('GET', '/api/bootstrap'));
assert.deepEqual(bootP.positions.map((p) => p.key), [wl, vox, keys]);
boot = ok(await admin('GET', '/api/bootstrap'));
assert.ok(!boot.positions.some((p) => p.key === vox), 'Praise positions aren’t on the AV side');
ok(await adminP('PATCH', '/api/positions/foh', { label: 'Hijack' }), 403);
step('positions: each team adds and edits only its own');

// ---------- people: one login, one or more teams ----------
async function invite(c, name, email, positions = []) {
  const r = ok(await c('POST', '/api/people', { name, email, phone: '4235550' + String(100 + Math.floor(Math.random() * 800)), positions }), 201);
  if (!r.inviteUrl || r.joined) return { id: r.person.id, r };
  return { id: r.person.id, r, token: r.inviteUrl.split('/invite/')[1] };
}
async function signIn(p, team) {
  const c = client(team);
  ok(await c('POST', `/api/auth/invite/${p.token}`, { password: 'password123' }));
  return c;
}
const ben = await invite(admin, 'Ben', 'ben@example.com', ['foh']);
const lee = await invite(admin, 'Lee', 'lee@example.com', ['pro']);
ok(await admin('PATCH', `/api/people/${lee.id}`, { role: 'leader', leaderTitle: 'Media lead' }));
const ava = await invite(admin, 'Ava', 'ava@example.com', ['foh', 'cam']);
const pia = await invite(adminP, 'Pia', 'pia@example.com', [wl, vox]);
const sam = await invite(adminP, 'Sam', 'sam@example.com', [keys]);
const tia = await invite(adminP, 'Tia', 'tia@example.com', [vox, 'foh']);
assert.ok(!tia.r.person.positions.includes('foh'), 'a team can’t train people on another team’s positions');
// Ava already has a login from the AV team: she joins the Praise team with the same one
const avaP = await invite(adminP, 'Ava', 'AVA@example.com', [vox]);
assert.equal(avaP.r.joined, true);
assert.equal(avaP.id, ava.id);
ok(await adminP('POST', '/api/people', { name: 'Ava', email: 'ava@example.com' }), 409);

const benC = await signIn(ben, 'av');
const leeC = await signIn(lee, 'av');
const avaC = await signIn(ava, 'av');
const avaCP = client('praise');
ok(await avaCP('POST', '/api/auth/login', { email: 'ava@example.com', password: 'password123' }));
const piaC = await signIn(pia, 'praise');
const samC = await signIn(sam, 'praise');
const tiaC = await signIn(tia, 'praise');

const avaBoot = ok(await avaC('GET', '/api/bootstrap'));
assert.deepEqual(avaBoot.teams.map((t) => t.key), ['av', 'praise'], 'someone on two teams can switch between them');
const tiaBoot = ok(await tiaC('GET', '/api/bootstrap'));
assert.deepEqual(tiaBoot.teams.map((t) => t.key), ['praise']);
// Tia asks for the AV side but isn't on it: she gets her own team
const tiaAsAv = client('av');
ok(await tiaAsAv('POST', '/api/auth/login', { email: 'tia@example.com', password: 'password123' }));
assert.equal(ok(await tiaAsAv('GET', '/api/bootstrap')).team.key, 'praise');
// Each side lists only its own people; everyone sees every name for line-ups
assert.deepEqual(tiaBoot.people.map((p) => p.name).sort(), ['Ava', 'Pia', 'Sam', 'Tia']);
assert.ok(tiaBoot.everyone.some((p) => p.name === 'Ben'));
const avPeople = ok(await admin('GET', '/api/people'));
assert.ok(!(avPeople.people || avPeople).some((p) => p.name === 'Pia'), 'the AV side doesn’t list Praise-only people');
step('people: one login per person; someone on two teams switches; each team lists its own people');

// Ava's training is per team: changing it on one side leaves the other alone
ok(await adminP('PATCH', `/api/people/${ava.id}`, { positions: [vox, keys] }));
const avaAv = ok(await admin('GET', '/api/bootstrap')).people.find((p) => p.id === ava.id);
assert.deepEqual(avaAv.positions.sort(), ['cam', 'foh']);
const avaPr = ok(await adminP('GET', '/api/bootstrap')).people.find((p) => p.id === ava.id);
assert.deepEqual(avaPr.positions.sort(), [keys, vox].sort());
step('training is per team: the Praise side can’t touch AV positions and the other way round');

// ---------- leaders: the admin picks the head leader; the head picks the other leaders ----------
ok(await piaC('PATCH', `/api/people/${sam.id}`, { role: 'leader' }), 403);
ok(await admin('PUT', '/api/teams/praise/head', { userId: pia.id }));
let piaBoot = ok(await piaC('GET', '/api/bootstrap'));
assert.equal(piaBoot.me.head, true);
assert.equal(piaBoot.me.role, 'leader');
assert.ok(Object.values(piaBoot.me.can).every(Boolean) || piaBoot.me.can.plans, 'the head leader has every privilege on their team');
ok(await piaC('PATCH', `/api/people/${sam.id}`, { role: 'leader', leaderTitle: 'Band lead', perms: { edit: true, approve: true, plans: true } }));
const samBoot = ok(await samC('GET', '/api/bootstrap'));
assert.equal(samBoot.me.role, 'leader');
assert.equal(samBoot.me.leaderTitle, 'Band lead');
assert.equal(samBoot.me.can.edit, true);
assert.equal(samBoot.me.head, false);
ok(await samC('PATCH', `/api/people/${tia.id}`, { role: 'leader' }), 403);
ok(await samC('PATCH', `/api/people/${pia.id}`, { name: 'Nope' }), 403);
ok(await piaC('PATCH', `/api/people/${ben.id}`, { name: 'Nope' }), 404);
ok(await leeC('PATCH', `/api/people/${tia.id}`, { name: 'Nope' }), 403);
// Being a leader on the Praise side gives nothing on the AV side
assert.equal(ok(await avaC('GET', '/api/bootstrap')).me.role, 'crew');
ok(await piaC('PATCH', '/api/teams/praise', { name: 'Praise & Worship', groupLink: 'https://chat.whatsapp.com/praise123' }));
ok(await piaC('PATCH', '/api/teams/praise', { kind: 'av' }), 403);
ok(await piaC('PATCH', '/api/teams/av', { name: 'Ours now' }), 403);
piaBoot = ok(await piaC('GET', '/api/bootstrap'));
assert.equal(piaBoot.team.name, 'Praise & Worship');
assert.equal(piaBoot.settings.groupLink, 'https://chat.whatsapp.com/praise123', 'message sheets use the team’s own WhatsApp group');
step('leaders: the admin sets the head leader; the head names leaders and privileges; roles stay per team');

// ---------- the AV side's own parts ----------
for (const p of ['/api/gear', '/api/groups', '/api/library']) ok(await piaC('GET', p), 403);
ok(await piaC('GET', '/api/planner/month?month=' + iso(0).slice(0, 7)));
ok(await samC('GET', '/api/planner/month?month=' + iso(0).slice(0, 7)), 403);
step('gear, outside groups and the media library stay on the AV side; the month planner is for each head leader');

// ---------- weekend template: each team ticks its own positions ----------
const s0 = ok(await admin('GET', '/api/bootstrap')).settings.weekendTemplate;
const worshipIdx = s0.findIndex((t) => t.title === 'Worship Service');
assert.ok(worshipIdx >= 0);
const needs = s0.map((t, i) => (i === worshipIdx ? [wl, vox, keys, 'foh'] : []));
ok(await samC('PUT', '/api/teams/current/template', { needs }), 403);
const tmpl = ok(await piaC('PUT', '/api/teams/current/template', { needs })).weekendTemplate;
assert.deepEqual(tmpl[worshipIdx].needs.filter((k) => [wl, vox, keys].includes(k)).sort(), [wl, vox, keys].sort());
assert.deepEqual(tmpl[worshipIdx].needs.filter((k) => !(k in { [wl]: 1, [vox]: 1, [keys]: 1 })), s0[worshipIdx].needs, 'AV positions on the template are untouched');
step('weekend template: the Praise head leader sets the Praise positions on each service; AV ones stay');

// ---------- a shared service: each team fills its own spots ----------
const sat = (() => {
  for (let n = 3; n < 10; n++) if (new Date(iso(n) + 'T12:00:00').getDay() === 6) return iso(n);
})();
const svc = ok(await admin('POST', '/api/events', { date: sat, title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh', 'pro'] }), 201);
ok(await piaC('PATCH', `/api/events/${svc.id}`, { needs: [wl, vox, 'foh-is-not-mine'] }));
ok(await piaC('PATCH', `/api/events/${svc.id}`, { title: 'Praise night', needs: [wl, vox] }), 403);
ok(await piaC('PATCH', `/api/events/${svc.id}`, { start: '09:00' }), 403);
let avEvents = ok(await admin('GET', `/api/events?from=${sat}&to=${sat}`));
let avSvc = avEvents.find((e) => e.id === svc.id);
assert.deepEqual(avSvc.needs.sort(), ['foh', 'pro']);
assert.equal(avSvc.otherNeeds, 2);
let prSvc = ok(await piaC('GET', `/api/events?from=${sat}&to=${sat}`)).find((e) => e.id === svc.id);
assert.deepEqual(prSvc.needs.sort(), [vox, wl].sort());
assert.equal(prSvc.otherNeeds, 2);
// AV edits its needs: the Praise ones stay
ok(await admin('PATCH', `/api/events/${svc.id}`, { needs: ['foh', 'pro', 'cam'] }));
prSvc = ok(await piaC('GET', `/api/events?from=${sat}&to=${sat}`)).find((e) => e.id === svc.id);
assert.deepEqual(prSvc.needs.sort(), [vox, wl].sort());

// Placing people
ok(await admin('PUT', `/api/events/${svc.id}/assign/foh`, { userId: ben.id }));
ok(await admin('PUT', `/api/events/${svc.id}/assign/cam`, { userId: ava.id }));
ok(await piaC('PUT', `/api/events/${svc.id}/assign/${wl}`, { userId: pia.id }));
ok(await samC('PUT', `/api/events/${svc.id}/assign/${vox}`, { userId: tia.id }));
ok(await piaC('PUT', `/api/events/${svc.id}/assign/foh`, { userId: tia.id }), 403);
ok(await piaC('PUT', `/api/events/${svc.id}/assign/${vox}`, { userId: ben.id }), 400);
ok(await tiaC('PUT', `/api/events/${svc.id}/assign/${vox}`, { userId: tia.id }), 403);
avSvc = ok(await admin('GET', `/api/events?from=${sat}&to=${sat}`)).find((e) => e.id === svc.id);
assert.equal(avSvc.assignments.foh, ben.id);
assert.equal(avSvc.assignments[vox], undefined, 'the AV grid shows only AV spots');
assert.equal(avSvc.otherFilled, 2);
// Praise can't remove a service AV is scheduled on
ok(await piaC('DELETE', `/api/events/${svc.id}`), 403);
step('shared services: each team sets and fills its own spots; the name and times stay with AV');

// ---------- who's serving: everyone sees every team's line-up and who to ask ----------
const lu = ok(await benC('GET', `/api/events/${svc.id}/lineup`));
assert.deepEqual(lu.teams.map((t) => t.key), ['av', 'praise']);
const luP = lu.teams.find((t) => t.key === 'praise');
assert.equal(luP.name, 'Praise & Worship');
assert.equal(luP.groupLink, 'https://chat.whatsapp.com/praise123');
assert.equal(luP.slots.find((x) => x.position === vox).person.name, 'Tia');
assert.ok(luP.slots.find((x) => x.position === vox).person.phone, 'phone numbers so people can reach each other');
assert.deepEqual(luP.leaders.map((l) => l.name), ['Pia']);
assert.ok(lu.teams.find((t) => t.key === 'av').leaders.some((l) => l.name === 'Hub M.'), 'the admin is the AV team’s head leader');
ok(await tiaC('GET', `/api/events/${svc.id}/lineup`));
step('who’s serving: both teams’ line-ups, phones, WhatsApp groups and head leaders, for anyone signed in');

// ---------- rehearsals: a team's own, seen by everyone ----------
const reh = ok(await samC('POST', '/api/events', { date: iso(2), title: 'Midweek rehearsal', kind: 'rehearsal', call: '18:30', start: '19:00', end: '20:30', needs: [vox, keys] }), 201);
assert.equal(reh.team, 'praise');
assert.equal(reh.kind, 'rehearsal');
ok(await samC('PUT', `/api/events/${reh.id}/assign/${keys}`, { userId: sam.id }));
const benSees = ok(await benC('GET', `/api/events?from=${iso(2)}&to=${iso(2)}`)).find((e) => e.id === reh.id);
assert.ok(benSees, 'AV sees Praise rehearsals');
assert.equal(benSees.team, 'praise');
assert.deepEqual(benSees.needs, []);
ok(await leeC('PATCH', `/api/events/${reh.id}`, { title: 'Ours' }), 403);
ok(await leeC('DELETE', `/api/events/${reh.id}`), 403);
ok(await admin('PATCH', `/api/events/${reh.id}`, { notes: 'Room B' }));
ok(await admin('POST', `/api/events/${svc.id}/soundcheck`, { start: '09:45', call: '09:30', end: '10:15' }), 201);
ok(await piaC('POST', `/api/events/${svc.id}/soundcheck`, { start: '09:45', call: '09:30', end: '10:15' }), 403);
step('rehearsals: each team’s own, visible to every team; sound checks stay with AV');

// ---------- one calendar: your shifts plus everything else, with who's serving ----------
const icsOf = async (c) => {
  const url = new URL(ok(await c('GET', '/api/bootstrap')).me.calUrl).pathname;
  return unfold((await c('GET', url)).data);
};
const benIcs = await icsOf(benC);
assert.equal(shiftsIn(benIcs), 1, 'Ben has one shift');
assert.match(benIcs, /Who's serving:/);
assert.match(benIcs, /Praise & Worship/);
assert.match(benIcs, /Vocals: Tia/);
assert.match(benIcs, /Praise & Worship rehearsal — Midweek rehearsal/, 'AV crew see Praise rehearsals');
const tiaIcs = await icsOf(tiaC);
assert.equal(shiftsIn(tiaIcs), 1);
assert.match(tiaIcs, /FOH Audio: Ben/, 'Praise sees who’s on AV for the service they sing');
// Ava is on both teams: one feed with her AV shift and the Praise rehearsal
const avaIcs = await icsOf(avaC);
assert.equal(shiftsIn(avaIcs), 1);
assert.match(avaIcs, /Midweek rehearsal/);
assert.equal(avaIcs.match(/BEGIN:VCALENDAR/g).length, 1);
step('one calendar subscription: your shifts with reminders, plus every service and rehearsal with each team’s line-up');

// ---------- My shifts across teams ----------
ok(await piaC('PUT', `/api/events/${reh.id}/assign/${vox}`, { userId: ava.id }));
const avaOv = ok(await avaC('GET', '/api/me/overview'));
assert.deepEqual(avaOv.shifts.map((s) => s.team).sort(), ['av', 'praise']);
step('My shifts lists every team’s shifts, each marked with its team');

// ---------- service plans: leaders lead, everyone adds the details ----------
let plan = ok(await tiaC('GET', `/api/plans/${svc.id}`));
assert.deepEqual(plan.rights, { lead: false, details: true, av: false });
ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { sermonTitle: 'Mine' }), 403);
ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { notes: 'Pastor notes' }), 403);
ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { order: [{ kind: 'item', title: 'Welcome' }] }), 403);
ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { inputs: [] }), 403);
ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { assets: [] }), 403);
plan = ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { scriptures: [{ reference: 'Psalm 23', version: 'KJV', text: 'The Lord is my shepherd' }], announcements: 'Potluck after' }));
assert.equal(plan.scriptures.length, 1);
const song = ok(await tiaC('POST', '/api/songs', { title: 'Goodness of God', notes: 'Capo 2 · G C D' }), 201);
assert.equal(song.notes, 'Capo 2 · G C D');
plan = ok(await tiaC('PATCH', `/api/plans/${svc.id}`, { songs: [{ song: song.id, key: 'A', note: 'Acapella first verse' }] }));
assert.equal(plan.songs[0].note, 'Acapella first verse');
ok(await tiaC('PATCH', `/api/songs/${song.id}`, { notes: 'Capo 2 · G C D Em' }));
ok(await tiaC('DELETE', `/api/songs/${song.id}`), 403);
ok(await tiaC.upload(`/api/songs/${song.id}/pro`, [{ name: 'x.pro', type: 'application/octet-stream', bytes: Buffer.from('pro') }], 'file'), 403);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
plan = ok(await tiaC.upload(`/api/plans/${svc.id}/media`, [{ name: 'lyrics slide.png', type: 'image/png', bytes: png }]), 201);
const slide = plan.media.find((m) => m.originalName === 'lyrics slide.png');
assert.equal(slide.uploadedById, tia.id);
// The head leader leads the plan
plan = ok(await piaC('PATCH', `/api/plans/${svc.id}`, { sermonTitle: 'The Good Shepherd', speaker: 'Pastor Jo', order: [{ kind: 'song', title: 'Goodness of God', who: 'Praise', minutes: 5 }] }));
assert.deepEqual(plan.rights, { lead: true, details: true, av: false });
ok(await piaC('PATCH', `/api/plans/${svc.id}`, { inputs: [] }), 403);
// AV crew add details too, and the AV side keeps the input list and library
plan = ok(await benC('GET', `/api/plans/${svc.id}`));
assert.deepEqual(plan.rights, { lead: false, details: true, av: true });
ok(await benC('PATCH', `/api/plans/${svc.id}`, { sermonTitle: 'x' }), 403);
ok(await benC('DELETE', `/api/media/${slide.id}`), 403);
ok(await piaC('DELETE', `/api/media/${slide.id}`), 204);
step('plans: leaders set the sermon, notes and order; everyone adds Bible texts, songs, chord notes, announcements and slides');

// The public rundown lists both teams
const rundown = ok(await admin('GET', `/api/public/rundown/${plan.share.rundown}`));
assert.deepEqual([...new Set(rundown.crew.map((c) => c.team))], ['AV Team', 'Praise & Worship']);
const sheet = ok(await benC('GET', `/api/weekend/runsheet/${svc.id}`));
assert.ok(sheet.event.crew.some((c) => c.team === 'Praise & Worship' && c.name === 'Tia'));
step('the rundown and run sheet list every team’s crew, by team');

// ---------- requests stay with the team they belong to ----------
const drop = ok(await benC('POST', '/api/requests', { type: 'drop', eventId: svc.id, position: 'foh', note: 'Away' }), 201);
assert.ok(!ok(await piaC('GET', '/api/requests')).some((r) => r.id === drop.id), 'Praise leaders don’t see AV requests');
ok(await piaC('POST', `/api/requests/${drop.id}/approve`), 403);
assert.ok(ok(await admin('GET', '/api/requests')).some((r) => r.id === drop.id));
step('shift requests go to the leaders of the team they belong to');

// ---------- boards: per team, or shared with every team ----------
const board = ok(await piaC('POST', '/api/boards', { title: 'Praise setlist flow' }), 201);
assert.equal(board.team, 'praise');
ok(await leeC('GET', `/api/boards/${board.id}`), 404);
ok(await piaC('PUT', `/api/boards/${board.id}`, { shared: true, rev: board.rev }));
ok(await leeC('GET', `/api/boards/${board.id}`));
ok(await tiaC('GET', '/api/boards'), 403);
step('flow-chart boards: each team’s leaders, or shared with every team');

// ---------- elections: a new head leader; taking someone off a team ----------
ok(await piaC('PUT', '/api/teams/praise/head', { userId: sam.id }), 403);
ok(await admin('PUT', '/api/teams/praise/head', { userId: sam.id }));
piaBoot = ok(await piaC('GET', '/api/bootstrap'));
assert.equal(piaBoot.me.head, false);
assert.equal(piaBoot.me.role, 'leader', 'the previous head stays a leader');
assert.equal(ok(await samC('GET', '/api/bootstrap')).me.head, true);
ok(await piaC('PATCH', `/api/people/${sam.id}`, { role: 'crew' }), 403);
ok(await piaC('PUT', '/api/teams/current/template', { needs }), 403);
// Taking Ava off the Praise team leaves her login, her AV team and her AV shifts
ok(await samC('PATCH', `/api/people/${ava.id}`, { onTeam: false }));
const avaAfter = ok(await avaC('GET', '/api/bootstrap'));
assert.deepEqual(avaAfter.teams.map((t) => t.key), ['av']);
const ov2 = ok(await avaC('GET', '/api/me/overview'));
assert.deepEqual(ov2.shifts.map((s) => s.team), ['av'], 'her Praise spots were freed, her AV ones kept');
assert.ok(!ok(await samC('GET', '/api/bootstrap')).people.some((p) => p.id === ava.id));
// Someone on two teams can only be deactivated by the admin
await invite(adminP, 'Ben', 'ben@example.com', [keys]);
ok(await leeC('PATCH', `/api/people/${ben.id}`, { active: false }), 403);
step('elections: the admin moves the head leader role; the head can take someone off the team without touching their other team');

// ---------- the admin adds another team ----------
ok(await piaC('POST', '/api/teams', { name: 'Choir', kind: 'music' }), 403);
const choir = ok(await admin('POST', '/api/teams', { name: 'Choir', kind: 'music' }), 201);
assert.equal(choir.key, 'choir');
const list = ok(await tiaC('GET', '/api/teams'));
assert.deepEqual(list.map((t) => t.key), ['av', 'praise', 'choir']);
assert.equal(list.find((t) => t.key === 'praise').heads[0].name, 'Sam');
step('the admin can add more teams (choir, greeters…)');

console.log('\nAll team checks passed.');
