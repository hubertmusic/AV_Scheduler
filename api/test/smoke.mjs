// End-to-end check against a running API with an EMPTY database.
//   BASE_URL=http://localhost:4000 node test/smoke.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4000';

function client() {
  let cookie = '';
  const send = async (method, path, body, isForm, extra = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    let data;
    if (type.includes('json')) data = await res.json().catch(() => null);
    else if (type.startsWith('text/')) data = await res.text();
    else data = Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  const call = (method, path, body) => send(method, path, body, false);
  call.as = (id) => (method, path, body) => send(method, path, body, false, { 'X-View-As': id });
  // upload(path, [{ name, type, bytes }], field)
  call.upload = (path, files, field = 'files') => {
    const fd = new FormData();
    for (const f of files) fd.append(field, new Blob([f.bytes], { type: f.type }), f.name);
    return send('POST', path, fd, true);
  };
  return call;
}

const ok = (r, code = 200) => {
  assert.equal(r.status, code, JSON.stringify(r.data));
  return r.data;
};
const step = (msg) => console.log('✓', msg);

const admin = client();
const crew1 = client();
const crew2 = client();

// Friday at least a week out, so nothing is "in the past".
const d = new Date();
d.setUTCDate(d.getUTCDate() + 7 + ((5 - d.getUTCDay() + 7) % 7));
const friday = d.toISOString().slice(0, 10);

let r = ok(await admin('GET', '/api/auth/status'));
assert.equal(r.needsSetup, true, 'database must be empty');
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Crew' }), 201);
assert.equal(ok(await admin('POST', '/api/auth/setup', { name: 'x', email: 'x@x.com', password: 'xxxxxxxx' }), 403) !== undefined, true);
step('first-run setup creates the admin once');

const boot = ok(await admin('GET', '/api/bootstrap'));
assert.equal(boot.positions.length, 6);
assert.equal(boot.settings.weekendTemplate.length, 4);
step('default positions and weekend template');

const add = async (name, email, positions) => ok(await admin('POST', '/api/people', { name, email, phone: '423 555 0100', positions }), 201);
const m = await add('Marcus T.', 'marcus@example.com', ['foh', 'stream']);
const n = await add('Nia J.', 'nia@example.com', ['foh', 'stream']);
assert.ok(m.inviteUrl.includes('/invite/'));
assert.equal(m.person.phone, '14235550100');
const tok = (u) => u.inviteUrl.split('/invite/')[1];
ok(await crew1('GET', `/api/auth/invite/${tok(m)}`));
ok(await crew1('POST', `/api/auth/invite/${tok(m)}`, { password: 'marcuspass' }));
ok(await crew2('POST', `/api/auth/invite/${tok(n)}`, { password: 'niapass12' }));
ok(await crew1('GET', `/api/auth/invite/${tok(m)}`), 404);
step('invites: add people, accept link, link is single-use');

// Crew can't edit the schedule
ok(await crew1('POST', '/api/events/weekend', { friday }), 403);
r = ok(await admin('POST', '/api/events/weekend', { friday }));
assert.equal(r.created, 4);
r = ok(await admin('POST', '/api/events/weekend', { friday }));
assert.equal(r.created, 0);
step('weekend built from template; second run creates nothing; crew blocked');

const sunday = new Date(Date.parse(friday) + 2 * 864e5).toISOString().slice(0, 10);
let events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
assert.equal(events.length, 4);
const vespers = events.find((e) => e.title === 'Vespers');
const worship = events.find((e) => e.title === 'Worship Service');

ok(await admin('PUT', `/api/events/${vespers.id}/assign/foh`, { userId: m.person.id }));
ok(await admin('PUT', `/api/events/${worship.id}/assign/foh`, { userId: n.person.id }));
ok(await admin('PUT', `/api/events/${vespers.id}/assign/light`, { userId: m.person.id }), 400);
events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
assert.equal(events.find((e) => e.id === vespers.id).assignments.foh, m.person.id);
step('placing people; can’t place on a position the service doesn’t need');

// Calendar feed
const me1 = ok(await crew1('GET', '/api/bootstrap')).me;
const feedPath = new URL(me1.calUrl).pathname;
let ics = await crew1('GET', feedPath);
assert.equal(ics.status, 200);
assert.match(ics.data, /BEGIN:VCALENDAR/);
assert.match(ics.data, /SUMMARY:FOH Audio — Vespers/);
assert.equal((ics.data.match(/BEGIN:VEVENT/g) || []).length, 1);
assert.match(ics.data.replace(/\r\n /g, ''), /\r\nURL:http[^\r]*\/#mine\r\n/, 'each event links back to My shifts');
step('personal calendar feed lists the shift');

// Transfer request: Marcus gives Vespers FOH to Nia (Nia is free for Vespers)
const opts = ok(await crew1('GET', `/api/requests/options?type=transfer&eventId=${vespers.id}&position=foh`));
assert.ok(opts.some((o) => o.id === n.person.id));
const tr = ok(await crew1('POST', '/api/requests', { type: 'transfer', eventId: vespers.id, position: 'foh', targetUserId: n.person.id, note: 'Out of town' }), 201);
ok(await crew1('POST', '/api/requests', { type: 'drop', eventId: vespers.id, position: 'foh' }), 409);
ok(await crew1('GET', '/api/requests'), 403);
const list = ok(await admin('GET', '/api/requests'));
assert.equal(list[0].status, 'pending');
r = ok(await admin('POST', `/api/requests/${tr.id}/approve`));
assert.equal(r.status, 'approved');
events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
assert.equal(events.find((e) => e.id === vespers.id).assignments.foh, n.person.id);
ics = await crew1('GET', feedPath);
assert.equal((ics.data.match(/BEGIN:VEVENT/g) || []).length, 0);
ics = await crew2('GET', new URL(ok(await crew2('GET', '/api/bootstrap')).me.calUrl).pathname);
assert.equal((ics.data.match(/BEGIN:VEVENT/g) || []).length, 2);
step('transfer request → approve → schedule and both calendar feeds update');

// Pickup by Marcus of an open spot, then swap
let ov = ok(await crew1('GET', '/api/me/overview'));
const pick = ov.pickups.find((p) => p.id === worship.id && p.position === 'stream');
assert.ok(pick, 'Marcus should be able to pick up Worship stream');
const pr = ok(await crew1('POST', '/api/requests', { type: 'pickup', eventId: worship.id, position: 'stream' }), 201);
ok(await admin('POST', `/api/requests/${pr.id}/approve`));
// Swap Marcus's Worship stream with Nia's Vespers stream. While Nia is also on
// Worship (FOH) the swap would double-book her, so it isn't offered.
ok(await admin('PUT', `/api/events/${vespers.id}/assign/stream`, { userId: n.person.id }), 200);
let sw = ok(await crew1('GET', `/api/requests/options?type=swap&eventId=${worship.id}&position=stream`));
assert.ok(!sw.some((o) => o.eventId === vespers.id), 'double-booking swap must not be offered');
ok(await admin('PUT', `/api/events/${worship.id}/assign/foh`, { userId: boot.me.id }));
sw = ok(await crew1('GET', `/api/requests/options?type=swap&eventId=${worship.id}&position=stream`));
assert.ok(sw.some((o) => o.eventId === vespers.id));
const sreq = ok(await crew1('POST', '/api/requests', { type: 'swap', eventId: worship.id, position: 'stream', targetEventId: vespers.id }), 201);
r = ok(await admin('POST', `/api/requests/${sreq.id}/approve`));
assert.equal(r.status, 'approved', r.reason);
events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
assert.equal(events.find((e) => e.id === worship.id).assignments.stream, n.person.id);
assert.equal(events.find((e) => e.id === vespers.id).assignments.stream, m.person.id);
step('pick-up and swap requests apply correctly');

// Stale request is denied with a reason instead of corrupting the schedule
const drop = ok(await crew1('POST', '/api/requests', { type: 'drop', eventId: vespers.id, position: 'stream' }), 201);
const stale = ok(await crew2('POST', '/api/requests', { type: 'transfer', eventId: vespers.id, position: 'foh', targetUserId: m.person.id }), 201);
ok(await admin('PUT', `/api/events/${vespers.id}/assign/foh`, { userId: null }));
r = ok(await admin('POST', `/api/requests/${stale.id}/approve`));
assert.equal(r.status, 'denied');
assert.ok(r.reason);
ok(await crew1('POST', `/api/requests/${drop.id}/cancel`));
step('stale requests are refused with a reason; requesters can cancel');

// Leader privileges
ok(await admin('PATCH', `/api/people/${n.person.id}`, { role: 'leader', leaderTitle: 'Audio lead' }));
let nb = ok(await crew2('GET', '/api/bootstrap')).me;
assert.equal(nb.can.approve, true);
assert.equal(nb.can.people, false);
ok(await crew2('GET', '/api/requests'));
ok(await admin('PATCH', `/api/people/${n.person.id}`, { perms: { approve: false } }));
ok(await crew2('GET', '/api/requests'), 403);
ok(await crew2('PATCH', `/api/people/${m.person.id}`, { role: 'leader' }), 403);
step('team leaders get only the privileges the admin grants');

// Unavailability hides pickups
ov = ok(await crew1('GET', '/api/me/overview'));
const afternoon = events.find((e) => e.title === 'Afternoon Program');
assert.ok(ov.pickups.some((p) => p.id === afternoon.id));
ok(await crew1('PUT', `/api/events/${afternoon.id}/unavailable`, { unavailable: true }));
ov = ok(await crew1('GET', '/api/me/overview'));
assert.ok(!ov.pickups.some((p) => p.id === afternoon.id));
step('marking unavailable removes those pick-ups');

// Resources
ok(await crew1('POST', '/api/resources', { title: 'x' }), 403);
const res1 = ok(await admin('POST', '/api/resources', { title: 'FOH checklist', url: 'https://example.com/foh', position: 'foh', kind: 'Checklist', minutes: 3 }), 201);
ok(await admin('POST', '/api/resources', { title: 'bad', url: 'javascript:alert(1)' }), 400);
assert.equal(ok(await admin('POST', '/api/resources', { title: 'Practice', url: 'practiceav.fyi' }), 201).url, 'https://practiceav.fyi', 'bare domains get https:// added');
assert.ok(ok(await crew1('GET', '/api/resources')).some((r) => r.id === res1.id));
step('resources: managers add links, unsafe links rejected');

// Outside groups + sound checks
ok(await crew1('POST', '/api/groups', { name: 'x' }), 403);
const band = ok(await admin('POST', '/api/groups', {
  name: 'Praise Team', contactName: 'Leah W.', phone: '(423) 555-0199', groupLink: 'https://chat.whatsapp.com/abc',
  notes: '4 vocal mics, DI for keys', members: [{ name: 'Leah W.', phone: '4235550199', role: 'Vocals' }, { name: '', role: 'skip me' }],
}), 201);
assert.equal(band.phone, '14235550199');
assert.equal(band.members.length, 1);
ok(await admin('POST', '/api/groups', { name: 'bad', groupLink: 'javascript:x' }), 400);
const crewView = ok(await crew1('GET', '/api/groups')).find((g) => g.id === band.id);
assert.equal(crewView.name, 'Praise Team');
assert.equal(crewView.phone, undefined, 'crew must not see group contact numbers');

const sc = ok(await admin('POST', `/api/events/${worship.id}/soundcheck`, { call: '09:30', start: '09:45', end: '10:15', needs: ['foh', 'stream'], groups: [band.id], copyCrew: true }), 201);
assert.equal(sc.kind, 'soundcheck');
assert.equal(sc.forEvent, worship.id);
assert.deepEqual(sc.groups, [band.id]);
assert.equal(sc.copied, 2, 'FOH and stream crew copied from the service');
events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
const scRow = events.find((e) => e.id === sc.id);
assert.equal(scRow.assignments.stream, n.person.id);
ics = await crew2('GET', new URL(ok(await crew2('GET', '/api/bootstrap')).me.calUrl).pathname);
assert.match(ics.data, /Sound check · Worship Service/);
assert.match(ics.data, /Sound checking: Praise Team/);
step('outside groups, sound checks copy the service crew and land in calendars');

const tmpl = ok(await admin('GET', '/api/bootstrap')).settings.weekendTemplate;
const withCheck = [...tmpl, { day: 1, title: 'Worship sound check', kind: 'soundcheck', call: '09:30', start: '09:45', end: '10:15', needs: ['foh'], groups: [band.id] }];
const saved = ok(await admin('PATCH', '/api/settings', { weekendTemplate: withCheck }));
assert.equal(saved.weekendTemplate.find((t) => t.kind === 'soundcheck').groups[0], band.id);
const nextFri = new Date(Date.parse(friday) + 7 * 864e5).toISOString().slice(0, 10);
assert.equal(ok(await admin('POST', '/api/events/weekend', { friday: nextFri })).created, 5);
const nextSun = new Date(Date.parse(nextFri) + 2 * 864e5).toISOString().slice(0, 10);
const nextEvents = ok(await admin('GET', `/api/events?from=${nextFri}&to=${nextSun}`));
assert.ok(nextEvents.some((e) => e.kind === 'soundcheck' && e.groups[0] === band.id));
ok(await admin('DELETE', `/api/groups/${band.id}`), 204);
events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
assert.deepEqual(events.find((e) => e.id === sc.id).groups, []);
step('sound checks in the weekend template; deleting a group cleans up');

// ---------- service plans ----------
ok(await crew1('PATCH', `/api/plans/${worship.id}`, { notes: 'x' }), 403);
ok(await admin('PATCH', `/api/people/${n.person.id}`, { perms: { plans: true } }));
let plan = ok(await crew2('PATCH', `/api/plans/${worship.id}`, {
  sermonTitle: 'Living Water', speaker: 'Pastor James', notes: 'Point 1: thirst\nPoint 2: the well',
  scriptures: [{ reference: 'John 4:13-14', version: 'KJV', text: 'Whosoever drinketh of this water shall thirst again' }, { reference: '' }],
}));
assert.equal(plan.sermonTitle, 'Living Water');
assert.equal(plan.scriptures.length, 1);
assert.equal(ok(await crew1('GET', `/api/plans/${worship.id}`)).notes, 'Point 1: thirst\nPoint 2: the well');
step('pastor notes and Bible texts: plan editors write, everyone reads');

ok(await crew1('POST', '/api/songs', { title: 'x' }), 403);
const song = ok(await crew2('POST', '/api/songs', { title: 'Amazing Grace', artist: 'John Newton', lyrics: '[Verse 1]\nAmazing grace how sweet the sound  \nThat saved a wretch like me\n\n\n\nchorus:\nMy chains are gone\n\n' }), 201);
plan = ok(await crew2('PATCH', `/api/plans/${worship.id}`, { songs: [{ song: song.id, key: 'G' }, { song: '0123456789abcdef01234567' }] }));
assert.equal(plan.songs.length, 1);
assert.equal(plan.songs[0].song.title, 'Amazing Grace');
const txt = await crew1('GET', `/api/songs/${song.id}/propresenter.txt`);
assert.equal(txt.data, 'Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nChorus\nMy chains are gone\n');
step('song library + ProPresenter text export (labels become groups)');

const proBytes = Buffer.from('fake-pro-binary\x00\x01\x02');
ok(await crew2.upload(`/api/songs/${song.id}/pro`, [{ name: 'Amazing Grace.txt', type: 'text/plain', bytes: 'nope' }], 'file'), 400);
let sv = ok(await crew2.upload(`/api/songs/${song.id}/pro`, [{ name: 'Amazing Grace.pro', type: 'application/octet-stream', bytes: proBytes }], 'file'));
assert.equal(sv.pro.name, 'Amazing Grace.pro');
assert.equal(sv.proOutdated, false);
const proDl = await crew1('GET', sv.pro.url);
assert.equal(proDl.status, 200);
assert.ok(Buffer.compare(proDl.data, proBytes) === 0, '.pro downloads byte-for-byte');
assert.match(proDl.headers.get('content-disposition'), /attachment/);
await new Promise((r) => setTimeout(r, 20));
sv = ok(await crew2('PATCH', `/api/songs/${song.id}`, { lyrics: 'Verse 1\nAmazing grace (edited)' }));
assert.equal(sv.proOutdated, true, 'editing lyrics flags the stored .pro as outdated');
step('.pro files stored per song, downloaded intact, flagged when lyrics change');

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
ok(await crew1.upload(`/api/plans/${worship.id}/media`, [{ name: 'x.png', type: 'image/png', bytes: png }]), 403);
plan = ok(await crew2.upload(`/api/plans/${worship.id}/media`, [
  { name: 'Sermon slide.png', type: 'image/png', bytes: png },
  { name: 'evil.html', type: 'text/html', bytes: '<script>alert(1)</script>' },
]), 201);
assert.equal(plan.media.length, 2);
const img = await crew1('GET', plan.media.find((m) => m.originalName === 'Sermon slide.png').url);
assert.equal(img.headers.get('content-type'), 'image/png');
assert.match(img.headers.get('content-disposition'), /^inline/);
const html = await crew1('GET', plan.media.find((m) => m.originalName === 'evil.html').url);
assert.equal(html.headers.get('content-type'), 'application/octet-stream');
assert.match(html.headers.get('content-disposition'), /^attachment/);
const big = await crew2.upload(`/api/plans/${worship.id}/media`, [{ name: 'huge.mp4', type: 'video/mp4', bytes: Buffer.alloc(81 * 1024 * 1024) }]);
assert.equal(big.status, 413, JSON.stringify(big.data));
assert.match(big.data.error, /80 MB/);
step('media uploads: images preview inline, risky types download only, 80 MB cap');

const zip = await crew1('GET', `/api/plans/${worship.id}/propresenter.zip`);
assert.equal(zip.status, 200);
assert.equal(zip.headers.get('content-type'), 'application/zip');
assert.equal(zip.data.subarray(0, 2).toString(), 'PK');
assert.ok(zip.data.includes(Buffer.from('01 Amazing Grace.txt')) && zip.data.includes(Buffer.from('01 Amazing Grace.pro')) && zip.data.includes(Buffer.from('Bible texts.txt')));
assert.ok(zip.data.includes(Buffer.from('Media/Sermon slide.png')) && zip.data.includes(Buffer.from('Media/evil.html')), 'uploaded media in the zip');
assert.ok(zip.data.includes(Buffer.from('Worship Service.pptx')), 'PowerPoint in the zip');
step('ProPresenter download: songs (.txt + .pro), Bible texts, notes, media and a PowerPoint in one zip');

const deck = await crew1('GET', `/api/plans/${worship.id}/service.pptx`);
assert.equal(deck.status, 200);
assert.match(deck.headers.get('content-type'), /presentationml/);
assert.match(deck.headers.get('content-disposition'), /^attachment; filename=".*Worship Service\.pptx"/);
assert.equal(deck.data.subarray(0, 2).toString(), 'PK');
assert.ok(deck.data.includes(Buffer.from('ppt/slides/slide1.xml')));
step('PowerPoint download of the service');

// ---------- guest links ----------
ok(await crew1('POST', `/api/guest-links/${worship.id}`, { name: 'Guest' }), 403);
const gl = ok(await crew2('POST', `/api/guest-links/${worship.id}`, { name: 'Guest Speaker', note: 'Slides and your text please' }), 201);
const hours = (Date.parse(gl.expiresAt) - Date.now()) / 3600e3;
assert.ok(hours > 3.9 && hours <= 4, `expires in ${hours} h`);
const gtoken = gl.url.split('/guest/')[1];
const guest = client();
const gpage = ok(await guest('GET', `/api/guest/${gtoken}`));
assert.equal(gpage.event.title, 'Worship Service');
assert.equal(gpage.notes, undefined, 'guests see only their link, not the plan');
ok(await guest('GET', '/api/plans/' + worship.id), 401);
ok(await guest.upload(`/api/guest/${gtoken}/files`, [{ name: 'Guest slides.pdf', type: 'application/pdf', bytes: '%PDF-1.4 test' }, { name: 'reject-me.mov', type: 'video/quicktime', bytes: 'mov' }]), 201);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'note', text: 'Please put up the outline before I start.' }), 201);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'scripture', reference: 'Psalm 23:1', version: 'NKJV', text: 'The Lord is my shepherd' }), 201);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'song', title: 'Way Maker', key: 'E', lyrics: 'Verse 1\nYou are here' }), 201);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'nope' }), 400);
assert.equal(ok(await crew1('GET', `/api/plans/${worship.id}`)).media.some((m) => m.originalName === 'Guest slides.pdf'), false, 'crew can’t see unapproved uploads');
plan = ok(await crew2('GET', `/api/plans/${worship.id}`));
const pending = plan.submissions.filter((x) => x.status === 'pending');
assert.equal(pending.length, 5);
ok(await crew1('POST', `/api/submissions/${pending[0].id}/approve`), 403);
const rejectMe = pending.find((x) => x.media?.originalName === 'reject-me.mov');
ok(await crew2('POST', `/api/submissions/${rejectMe.id}/reject`));
ok(await crew2('GET', rejectMe.media.url), 404);
for (const x of pending.filter((x) => x.id !== rejectMe.id)) ok(await crew2('POST', `/api/submissions/${x.id}/approve`));
plan = ok(await crew1('GET', `/api/plans/${worship.id}`));
assert.match(plan.notes, /From Guest Speaker:\nPlease put up the outline/);
assert.ok(plan.scriptures.some((x) => x.reference === 'Psalm 23:1'));
assert.ok(plan.songs.some((x) => x.song.title === 'Way Maker'));
assert.ok(plan.media.some((m) => m.originalName === 'Guest slides.pdf'));
assert.equal(ok(await guest('GET', `/api/guest/${gtoken}`)).submissions.filter((x) => x.status === 'approved').length, 4);
ok(await crew2('POST', `/api/guest-links/link/${gl.id}/revoke`));
r = await guest('GET', `/api/guest/${gtoken}`);
assert.equal(r.status, 410);
assert.match(r.data.error, /expired/);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'note', text: 'late' }), 410);
ok(await guest('GET', '/api/guest/not-a-real-token-1234567890'), 404);
step('guest links: 4-hour expiry, upload-only access, nothing lands until approved, revoked links refuse');

// ---------- availability, auto-fill, confirmations, shadows ----------
// Fresh crew for a clean weekend two weeks out
const fri3 = new Date(Date.parse(friday) + 14 * 864e5).toISOString().slice(0, 10);
const sun3 = new Date(Date.parse(fri3) + 2 * 864e5).toISOString().slice(0, 10);
const extra = [];
for (const [nm, pos] of [['Ava A.', ['foh', 'pro']], ['Ben B.', ['foh', 'stream']], ['Cara C.', ['pro', 'cam']], ['Dev D.', ['stream', 'cam', 'light', 'prod']], ['Eli E.', ['foh', 'cam']]]) {
  const x = ok(await admin('POST', '/api/people', { name: nm, email: nm[0].toLowerCase() + 'x@example.com', positions: pos }), 201);
  const c = client();
  ok(await c('POST', `/api/auth/invite/${tok(x)}`, { password: 'password1' }));
  extra.push({ ...x.person, c });
}
const [ava, ben, cara, dev, eli] = extra;
ok(await admin('POST', '/api/events/weekend', { friday: fri3 }));
let ev3 = ok(await admin('GET', `/api/events?from=${fri3}&to=${sun3}`));
const vesp3 = ev3.find((e) => e.title === 'Vespers');

// Ben is away the whole weekend; Ava allows 1 shift a month
ok(await ben.c('POST', '/api/me/blackouts', { from: fri3, to: sun3, note: 'Camp' }), 201);
ok(await ben.c('POST', '/api/me/blackouts', { from: sun3, to: fri3 }), 400);
ok(await ava.c('PUT', '/api/me/limit', { maxPerMonth: 1 }));
ev3 = ok(await admin('GET', `/api/events?from=${fri3}&to=${sun3}`));
assert.ok(ev3.every((e) => e.away.includes(ben.id)), 'blackout shows as away on every service');
assert.ok(!ok(await ben.c('GET', '/api/me/overview')).pickups.some((p) => p.date >= fri3 && p.date <= sun3), 'no pick-ups offered while away');
step('away dates and monthly limits');

const preview = ok(await admin('GET', `/api/weekend/autofill?friday=${fri3}`));
assert.ok(preview.proposals.length > 0);
assert.ok(!preview.proposals.some((p) => p.userId === ben.id), 'never proposes someone who is away');
const avaMonth = fri3.slice(0, 7);
const avaPicks = preview.proposals.filter((p) => p.userId === ava.id);
assert.ok(avaPicks.length <= 1, 'respects a monthly limit of 1');
for (const e of ev3) {
  const users = preview.proposals.filter((p) => p.eventId === e.id).map((p) => p.userId);
  assert.equal(new Set(users).size, users.length, `nobody twice on ${e.title}`);
}
const people3 = ok(await admin('GET', '/api/people'));
for (const p of preview.proposals) assert.ok(people3.find((x) => x.id === p.userId).positions.includes(p.position), 'only trained people');
ok(await crew1('GET', `/api/weekend/autofill?friday=${fri3}`), 403);
const applied = ok(await admin('POST', '/api/weekend/autofill', { friday: fri3, picks: preview.proposals.slice(0, 5) }));
assert.equal(applied.applied, 5);
assert.equal(ok(await admin('POST', '/api/weekend/autofill', { friday: fri3, picks: preview.proposals.slice(0, 5) })).applied, 0, 'already-filled spots are skipped');
step(`auto-fill: ${preview.proposals.length} proposed, ${preview.unfilled.length} unfillable, rules respected, apply is safe to repeat`);

// Confirmations reset when someone else takes the spot
ev3 = ok(await admin('GET', `/api/events?from=${fri3}&to=${sun3}`));
const firstPick = preview.proposals[0];
const holderClient = extra.find((x) => x.id === firstPick.userId)?.c || (firstPick.userId === n.person.id ? crew2 : null);
if (holderClient) {
  ok(await holderClient('POST', '/api/me/confirm', { eventId: firstPick.eventId, slot: firstPick.position }));
  ev3 = ok(await admin('GET', `/api/events?from=${fri3}&to=${sun3}`));
  assert.equal(ev3.find((e) => e.id === firstPick.eventId).confirmed[firstPick.position], true);
}
ok(await crew1('POST', '/api/me/confirm', { eventId: firstPick.eventId, slot: firstPick.position }), 404);
const swapIn = extra.find((x) => x.id !== firstPick.userId && x.id !== ben.id && people3.find((p) => p.id === x.id).positions.includes(firstPick.position));
if (swapIn) {
  ok(await admin('PUT', `/api/events/${firstPick.eventId}/assign/${firstPick.position}`, { userId: swapIn.id }));
  ev3 = ok(await admin('GET', `/api/events?from=${fri3}&to=${sun3}`));
  assert.equal(ev3.find((e) => e.id === firstPick.eventId).confirmed[firstPick.position], undefined, 'new person starts unconfirmed');
}
step('shift confirmations, reset when the spot changes hands');

// Trainee shadow
ok(await admin('PATCH', `/api/people/${eli.id}`, { trainee: ['light'] }));
const worship3 = ev3.find((e) => e.title === 'Worship Service');
ok(await admin('PUT', `/api/events/${worship3.id}/assign/light+shadow`, { userId: eli.id }));
ok(await admin('PUT', `/api/events/${worship3.id}/assign/nope+shadow`, { userId: eli.id }), 400);
const eliOv = ok(await eli.c('GET', '/api/me/overview'));
assert.ok(eliOv.shifts.some((x) => x.shadow && x.position === 'light'));
const eliIcs = await eli.c('GET', new URL(ok(await eli.c('GET', '/api/bootstrap')).me.calUrl).pathname);
assert.match(eliIcs.data, /Lighting \(shadowing\) — Worship Service/);
step('trainee shadow spots show in My shifts and calendars');

// Copy last weekend onto the following one
const fri4 = new Date(Date.parse(fri3) + 7 * 864e5).toISOString().slice(0, 10);
const copied = ok(await admin('POST', '/api/weekend/copy', { friday: fri4 }));
assert.ok(copied.created >= 4 && copied.copied > 0, JSON.stringify(copied));
step(`copy last weekend: ${copied.created} services, ${copied.copied} placements, ${copied.skipped.length} skipped with reasons`);

// Weekend check
const chk = ok(await admin('GET', `/api/weekend/check?friday=${fri3}`));
assert.ok(chk.open.length > 0 && chk.unconfirmed.length > 0 && chk.plansMissing.length > 0);
assert.ok(chk.availability.stale.some((p) => p.id === eli.id), 'people who never updated availability are listed');
assert.ok(!chk.availability.stale.some((p) => p.id === ben.id));
ok(await crew1('GET', `/api/weekend/check?friday=${fri3}`), 403);
ok(await admin('POST', '/api/weekend/reminded', { ids: [chk.reminders[0].id] }));
assert.equal(ok(await admin('GET', `/api/weekend/check?friday=${fri3}`)).reminders.find((r) => r.id === chk.reminders[0].id).waReminded, true);
step('weekend check: open spots, unconfirmed, missing plan items, stale availability, WhatsApp reminder tracking');

// Email reminders (test transport): a shift tomorrow should be emailed once
const tmr = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const soon = ok(await admin('POST', '/api/events', { date: tmr, title: 'Midweek', call: '18:00', start: '18:30', end: '19:30', needs: ['foh'] }), 201);
ok(await admin('PUT', `/api/events/${soon.id}/assign/foh`, { userId: ava.id }));
const run1 = ok(await admin('POST', '/api/weekend/reminders/run'));
assert.ok(run1.sent >= 1, JSON.stringify(run1));
assert.equal(ok(await admin('POST', '/api/weekend/reminders/run')).sent, 0, 'never emails the same shift twice');
ok(await crew1('POST', '/api/weekend/reminders/run'), 403);
step('email reminders go out once per shift');

// Run sheet
const rs = ok(await crew1('GET', `/api/weekend/runsheet/${worship.id}`));
assert.equal(rs.event.title, 'Worship Service');
assert.ok(rs.related.some((x) => x.kind === 'soundcheck'));
assert.ok(rs.plan.songs.length >= 1 && rs.plan.scriptures.length >= 1);
step('run sheet: crew, sound check, songs, Bible texts and notes in one place');

// Load report
const load = ok(await admin('GET', '/api/people/load'));
assert.ok(Object.values(load).some((x) => x.upcoming > 0));
ok(await crew1('GET', '/api/people/load'), 403);
step('load report');

// ---------- regulars + template sync ----------
const fri5 = new Date(Date.parse(fri4) + 7 * 864e5).toISOString().slice(0, 10);
const sun5 = new Date(Date.parse(fri5) + 2 * 864e5).toISOString().slice(0, 10);
ok(await admin('POST', '/api/events/weekend', { friday: fri5 }));
const sab5 = new Date(Date.parse(fri5) + 864e5);
const nth5 = String(Math.ceil(sab5.getUTCDate() / 7));
const otherNth = nth5 === '1' ? '2' : '1';
ok(await admin('PATCH', `/api/people/${dev.id}`, { regulars: [{ week: nth5, service: 'Worship Service', positions: ['light', 'cam'] }, { week: 'bogus', service: '' }] }));
ok(await admin('PATCH', `/api/people/${cara.id}`, { regulars: [{ week: 'every', service: '', positions: [] }] }));
ok(await admin('PATCH', `/api/people/${eli.id}`, { regulars: [{ week: otherNth, service: 'Worship Service', positions: [] }] }));
ok(await admin('PATCH', `/api/people/${ben.id}`, { regulars: [{ week: nth5, service: 'Vespers', positions: [] }] }));
ok(await ben.c('POST', '/api/me/blackouts', { from: fri5, to: sun5 }), 201);
const devPerson = ok(await admin('GET', '/api/people')).find((p) => p.id === dev.id);
assert.equal(devPerson.regulars.length, 2);
assert.equal(devPerson.regulars[1].week, 'every', 'unknown week patterns fall back to every weekend');
assert.deepEqual(ok(await dev.c('GET', '/api/bootstrap')).me.regulars[0].positions, ['light', 'cam']);
ok(await crew1('PATCH', `/api/people/${dev.id}`, { regulars: [] }), 403);
ev3 = ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`));
const worship5 = ev3.find((e) => e.title === 'Worship Service');
const af5 = ok(await admin('GET', `/api/weekend/autofill?friday=${fri5}`));
const devPick = af5.proposals.find((p) => p.userId === dev.id && p.regular);
assert.ok(devPick, 'regular is placed');
assert.equal(devPick.eventId, worship5.id);
assert.equal(devPick.position, 'light', 'first listed position is preferred');
assert.match(devPick.reason, new RegExp(`Regular: ${['', '1st', '2nd', '3rd', '4th', '5th'][Number(nth5)]} Sabbath`));
assert.ok(af5.proposals.some((p) => p.userId === cara.id && p.regular), 'every-weekend regular placed in any service');
assert.ok(!af5.proposals.some((p) => p.userId === eli.id && p.regular), 'rule for another week does not apply');
assert.ok(af5.regularNotes.some((n) => n.userId === ben.id && /Away/.test(n.why)), 'away regulars are reported');
step('regular schedules: nth-Sabbath and every-weekend rules, preferred or any position, away regulars reported');

// Template changes reach weekends already built when you sync
const t0 = ok(await admin('GET', '/api/bootstrap')).settings.weekendTemplate;
const t1 = t0.map((t) => (t.title === 'Worship Service' ? { ...t, call: '09:55', needs: t.needs.filter((k) => k !== 'prod') } : t));
ok(await admin('PATCH', '/api/settings', { weekendTemplate: t1 }));
ok(await admin('PUT', `/api/events/${worship5.id}/assign/prod`, { userId: dev.id }));
let syncR = ok(await admin('POST', '/api/events/weekend', { friday: fri5 }));
const diff = syncR.differs.find((d) => d.id === worship5.id);
assert.ok(diff && diff.changed.includes('times') && diff.changed.includes('positions') && diff.placedOnDropped === 1, JSON.stringify(syncR));
assert.equal(ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`)).find((e) => e.id === worship5.id).call, '10:15', 'nothing changes without sync');
syncR = ok(await admin('POST', '/api/events/weekend', { friday: fri5, sync: true }));
assert.ok(syncR.updated >= 1 && syncR.cleared === 1);
const w5 = ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`)).find((e) => e.id === worship5.id);
assert.equal(w5.call, '09:55');
assert.ok(!w5.needs.includes('prod') && !w5.assignments.prod);
ok(await admin('PATCH', '/api/settings', { weekendTemplate: t0 }));
step('template sync: built weekends list what changed, and update (clearing removed positions) only when asked');

// Turning a service off (or removing it) in the template offers to take it off built weekends.
{
  const evs = ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`));
  const target = t0.find((t) => t.title !== 'Worship Service' && (t.kind || 'service') === 'service');
  const targetEv = evs.find((e) => e.title === target.title);
  const manual = ok(await admin('POST', '/api/events', { date: sun5, title: 'Special Concert', call: '17:00', start: '18:00', end: '20:00', needs: ['foh'] }), 201);
  const offT = t0.map((t) => (t.title === target.title ? { ...t, off: true } : t));
  assert.equal(ok(await admin('PATCH', '/api/settings', { weekendTemplate: offT })).weekendTemplate.find((t) => t.title === target.title).off, true);
  let r = ok(await admin('POST', '/api/events/weekend', { friday: fri5 }));
  const ex = r.extra.find((e) => e.id === targetEv.id);
  assert.ok(ex && ex.turnedOff, JSON.stringify(r.extra));
  assert.ok(!r.extra.some((e) => e.id === manual.id), 'services added by hand are never offered for removal');
  assert.ok(ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`)).some((e) => e.id === targetEv.id), 'nothing removed without asking');
  r = ok(await admin('POST', '/api/events/weekend', { friday: fri5, sync: true, syncIds: [], remove: [targetEv.id, manual.id] }));
  assert.equal(r.removed, 1);
  const after = ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`));
  assert.ok(!after.some((e) => e.id === targetEv.id) && after.some((e) => e.id === manual.id));
  r = ok(await admin('POST', '/api/events/weekend', { friday: fri5 }));
  assert.equal(r.created, 0, 'a turned-off service is not rebuilt');
  assert.equal(r.extra.length, 0);
  ok(await admin('PATCH', '/api/settings', { weekendTemplate: t0 }));
  r = ok(await admin('POST', '/api/events/weekend', { friday: fri5 }));
  assert.equal(r.created, 1, 'turning it back on brings it back');
  ok(await admin('DELETE', `/api/events/${manual.id}`), 204);
}
step('template on/off: turned-off or removed services can be taken off built weekends; hand-added ones are left alone');

// "No Vespers this week": a template service taken off one weekend stays off when synced.
{
  const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
  const fri6 = addDays(fri5, 7);
  ok(await admin('POST', '/api/events/weekend', { friday: fri6 }));
  let evs = ok(await admin('GET', `/api/events?from=${fri6}&to=${addDays(fri6, 2)}`));
  const vesp = evs.find((e) => e.title === 'Vespers');
  assert.ok(vesp && !vesp.manual);
  ok(await admin('DELETE', `/api/events/${vesp.id}`), 204);
  let r = ok(await admin('POST', '/api/events/weekend', { friday: fri6 }));
  assert.equal(r.created, 0, 'sync does not put a skipped service back');
  assert.ok(r.skipped.some((k) => k.title === 'Vespers'));
  const skips = ok(await crew1('GET', `/api/events/skips?from=${fri6}&to=${addDays(fri6, 2)}`));
  assert.equal(skips.length, 1);
  ok(await crew1('POST', `/api/events/skips/${skips[0].id}/restore`), 403);
  // the next weekend is untouched
  const fri7 = addDays(fri6, 7);
  r = ok(await admin('POST', '/api/events/weekend', { friday: fri7 }));
  assert.ok(ok(await admin('GET', `/api/events?from=${fri7}&to=${addDays(fri7, 2)}`)).some((e) => e.title === 'Vespers'), 'other weekends keep it');
  const back = ok(await admin('POST', `/api/events/skips/${skips[0].id}/restore`));
  assert.equal(back.title, 'Vespers');
  assert.equal(ok(await admin('GET', `/api/events/skips?from=${fri6}&to=${addDays(fri6, 2)}`)).length, 0);
  assert.ok(ok(await admin('GET', `/api/events?from=${fri6}&to=${addDays(fri6, 2)}`)).some((e) => e.title === 'Vespers'));
}
step('skipping a service for one weekend: sync leaves it out, other weekends keep it, and it can be brought back');

// ---------- announcements ----------
ok(await crew1('PUT', '/api/announcements/permanent', { text: 'x' }), 403);
ok(await admin('PUT', '/api/announcements/permanent', { text: 'Arrive 15 minutes before call time. Wear black.' }));
ok(await admin('PUT', `/api/announcements/weekly/${sunday}`, { text: 'x' }), 400);
ok(await admin('PUT', `/api/announcements/weekly/${friday}`, { text: 'Communion this Sabbath — extra mic at the table.' }));
ok(await admin('PATCH', `/api/events/${worship.id}`, { notes: 'Baptism after the sermon: wireless lav for the pastor.' }));
let ann = ok(await crew1('GET', '/api/bootstrap')).announcements;
assert.equal(ann.permanent.text, 'Arrive 15 minutes before call time. Wear black.');
assert.equal(ann.weekly[friday].text, 'Communion this Sabbath — extra mic at the table.');
const feedText = (await crew2('GET', new URL(ok(await crew2('GET', '/api/bootstrap')).me.calUrl).pathname)).data.replace(/\r\n /g, '');
assert.match(feedText, /IMPORTANT: Arrive 15 minutes before call time/);
assert.match(feedText, /THIS WEEKEND: Communion this Sabbath/);
assert.match(feedText, /IMPORTANT FOR THIS SHIFT: Baptism after the sermon/);
const rs2 = ok(await crew1('GET', `/api/weekend/runsheet/${worship.id}`));
assert.equal(rs2.notices.weekly, 'Communion this Sabbath — extra mic at the table.');
ok(await admin('PUT', `/api/announcements/weekly/${friday}`, { text: '' }));
assert.equal(ok(await crew1('GET', '/api/announcements')).weekly[friday], undefined, 'clearing removes the weekly note');
step('announcements: permanent + weekly + per-shift notes reach calendars and run sheets; only schedule editors can change them');

// ---------- activity (admin only) ----------
ok(await crew1('GET', '/api/activity/feed'), 403);
ok(await crew1('GET', '/api/activity/people'), 403);
await client()('POST', '/api/auth/login', { email: 'marcus@example.com', password: 'wrong-password' });
ok(await crew1('POST', '/api/activity/view', { page: 'schedule' }), 204);
ok(await crew1('POST', '/api/activity/view', { page: 'schedule' }), 204);
const feed = ok(await admin('GET', '/api/activity/feed?limit=200'));
const mine = feed.filter((a) => a.userId === m.person.id);
assert.equal(mine.filter((a) => a.action === 'Viewed the schedule').length, 1, 'page views are de-duplicated');
assert.ok(mine.some((a) => a.kind === 'login-failed'));
assert.ok(mine.some((a) => a.kind === 'login'));
assert.ok(mine.some((a) => a.kind === 'calendar' && /Calendar synced/.test(a.action)));
assert.ok(feed.some((a) => a.kind === 'change' && /^Placed .* on/.test(a.action)));
assert.ok(feed.some((a) => a.kind === 'guest'));
assert.ok(feed.some((a) => a.kind === 'system' && /Reminder email sent/.test(a.action)));
assert.ok(ok(await admin('GET', '/api/activity/feed?kind=login')).every((a) => a.kind.startsWith('login')));
const rows = ok(await admin('GET', '/api/activity/people'));
const mrow = rows.find((r) => r.id === m.person.id);
assert.ok(mrow.lastLoginAt && mrow.calLastFetchedAt && mrow.views7 >= 1 && mrow.failedLogins30 >= 1, JSON.stringify(mrow));
step('activity: sign-ins, failed sign-ins, page views, calendar syncs, changes, guests and reminders — admin only');

// View as (admin preview)
{
  const asMarcus = admin.as(m.person.id);
  const real = ok(await crew1('GET', '/api/bootstrap'));
  const seen = ok(await asMarcus('GET', '/api/bootstrap'));
  assert.equal(seen.me.id, m.person.id);
  assert.equal(seen.me.role, real.me.role);
  assert.deepEqual(seen.me.can, real.me.can, 'same permissions as the person');
  assert.equal(seen.me.previewing, true);
  assert.ok(!seen.me.calUrl.includes(real.me.calUrl.split('/cal/')[1]), 'their private calendar link stays hidden');
  assert.deepEqual(seen.people.map((p) => [p.id, p.phone || null]), real.people.map((p) => [p.id, p.phone || null]), 'same phone numbers they can see');
  assert.deepEqual(ok(await asMarcus('GET', '/api/me/overview')).shifts?.map((x) => x.id), ok(await crew1('GET', '/api/me/overview')).shifts?.map((x) => x.id));
  ok(await asMarcus('GET', '/api/activity/feed'), 403);
  const before = ok(await admin('GET', `/api/plans/${worship.id}`)).notes;
  const blocked = await asMarcus('PATCH', `/api/plans/${worship.id}`, { notes: 'changed in preview' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.error, /previewing/);
  assert.equal(ok(await admin('GET', `/api/plans/${worship.id}`)).notes, before);
  ok(await asMarcus('POST', '/api/requests', { type: 'pickup' }), 403);
  ok(await admin.as('0123456789abcdef01234567')('GET', '/api/bootstrap'), 404);
  // Only the admin can preview; anyone else's header is ignored.
  const crewTry = ok(await crew2.as(m.person.id)('GET', '/api/bootstrap'));
  assert.notEqual(crewTry.me.id, m.person.id);
  assert.equal(ok(await admin('GET', '/api/bootstrap')).me.role, 'admin');
}
step('view as: the admin sees exactly what one person sees, and nothing can be changed while previewing');

// Deactivate frees shifts
ok(await admin('PATCH', `/api/people/${m.person.id}`, { active: false }));
const goneFeed = await client()('GET', feedPath);
assert.equal(goneFeed.status, 200);
assert.equal((goneFeed.data.match(/BEGIN:VEVENT/g) || []).length, 0, 'a turned-off person’s calendar empties instead of keeping old shifts');
events = ok(await admin('GET', `/api/events?from=${friday}&to=${sunday}`));
assert.equal(events.find((e) => e.id === vespers.id).assignments.stream, undefined);
ok(await crew1('GET', '/api/bootstrap'), 401);
step('deactivating someone signs them out and frees their upcoming shifts');

console.log('\nAll checks passed.');
