// End-to-end check against a running API with an EMPTY database.
//   BASE_URL=http://localhost:4000 node test/smoke.mjs
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

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
  call.bg = (method, path, body) => send(method, path, body, false, { 'X-Background': '1' });
  call.cookie = (c) => (c === undefined ? cookie : (cookie = c));
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
// Weekends are built ahead by a background job; keep it out of the way until it's tested below.
ok(await admin('PATCH', '/api/settings', { autoBuildWeeks: 0 }));
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
// The feed holds your own shifts plus every other service as an info item; count only shifts
const shiftsIn = (d) => (String(d).replace(/\r\n /g, '').match(/^UID:(?!.*-info-).*$/gm) || []).length;
const feedPath = new URL(me1.calUrl).pathname;
let ics = await crew1('GET', feedPath);
assert.equal(ics.status, 200);
assert.match(ics.data, /BEGIN:VCALENDAR/);
assert.match(ics.data, /SUMMARY:FOH Audio — Vespers/);
assert.equal(shiftsIn(ics.data), 1);
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
assert.equal(shiftsIn(ics.data), 0);
ics = await crew2('GET', new URL(ok(await crew2('GET', '/api/bootstrap')).me.calUrl).pathname);
assert.equal(shiftsIn(ics.data), 2);
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

// Crew add songs and Bible texts; the sermon, pastor's notes and order stay with leaders
ok(await crew1('PATCH', `/api/plans/${worship.id}`, { sermonTitle: 'Mine now' }), 403);
ok(await crew1('PATCH', `/api/plans/${worship.id}`, { notes: 'x' }), 403);
ok(await crew1('PATCH', `/api/plans/${worship.id}`, { order: [] }), 403);
const crewSong = ok(await crew1('POST', '/api/songs', { title: 'Crew pick' }), 201);
ok(await crew1('PATCH', `/api/songs/${crewSong.id}`, { retired: true }), 403);
ok(await crew1('DELETE', `/api/songs/${crewSong.id}`), 403);
ok(await crew2('DELETE', `/api/songs/${crewSong.id}`), 204);
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
// Crew can add slides and remove their own; only leaders remove other people's
const crewSlide = ok(await crew1.upload(`/api/plans/${worship.id}/media`, [{ name: 'x.png', type: 'image/png', bytes: png }]), 201).media[0];
ok(await crew1('DELETE', `/api/media/${crewSlide.id}`), 204);
plan = ok(await crew2.upload(`/api/plans/${worship.id}/media`, [
  { name: 'Sermon slide.png', type: 'image/png', bytes: png },
  { name: 'evil.html', type: 'text/html', bytes: '<script>alert(1)</script>' },
]), 201);
assert.equal(plan.media.length, 2);
ok(await crew1('DELETE', `/api/media/${plan.media[0].id}`), 403);
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
assert.match(gl.code, /^\d{6}$/, 'a 6-digit code leaders can send');
assert.equal(gl.state, 'open');
assert.ok(Date.parse(gl.closesAt) > Date.now() && Date.parse(gl.closesAt) < Date.parse(gl.expiresAt), 'locks before the link stops working');
const gtoken = gl.url.split('/add/')[1];
const guest = client();
let gpage = ok(await guest('GET', `/api/guest/${gtoken}`));
assert.equal(gpage.needsCode, true);
assert.equal(gpage.event, undefined, 'nothing about the service before the code');
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'note', text: 'no code' }), 401);
r = ok(await guest('POST', `/api/guest/${gtoken}/unlock`, { code: gl.code === '000000' ? '111111' : '000000' }), 401);
assert.match(r.error, /tries left/);
ok(await guest('POST', `/api/guest/${gtoken}/unlock`, { code: gl.code }), 204);
gpage = ok(await guest('GET', `/api/guest/${gtoken}`));
assert.equal(gpage.event.title, 'Worship Service');
assert.equal(gpage.schedule.state, 'open');
assert.equal(gpage.notes, undefined, 'guests see only their own items, not the plan');
ok(await guest('GET', '/api/plans/' + worship.id), 401);

// Open window: submitted items go straight into the plan
ok(await guest.upload(`/api/guest/${gtoken}/files`, [{ name: 'Guest slides.pdf', type: 'application/pdf', bytes: '%PDF-1.4 test' }]), 201);
assert.equal(ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'note', text: 'Please put up the outline before I start.' }), 201).status, 'live');
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'scripture', reference: 'Psalm 23:1', version: 'NKJV', text: 'The Lord is my shepherd' }), 201);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'nope' }), 400);
// A draft stays private until submitted
assert.equal(ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'song', title: 'Way Makr', key: 'D', lyrics: 'Verse 1\nYou are here', draft: true }), 201).status, 'draft');
plan = ok(await crew1('GET', `/api/plans/${worship.id}`));
assert.match(plan.notes, /From Guest Speaker:\nPlease put up the outline/);
assert.ok(plan.scriptures.some((x) => x.reference === 'Psalm 23:1'));
assert.ok(plan.media.some((m) => m.originalName === 'Guest slides.pdf'), 'crew see guest files right away');
assert.ok(!plan.songs.some((x) => x.song.title.startsWith('Way Mak')), 'drafts aren’t in the plan');
gpage = ok(await guest('GET', `/api/guest/${gtoken}`));
const draft = gpage.submissions.find((x) => x.status === 'draft');
assert.equal(ok(await guest('PATCH', `/api/guest/${gtoken}/items/${draft.id}`, { title: 'Way Maker', key: 'D', lyrics: 'Verse 1\nYou are here' })).status, 'draft');
assert.equal(ok(await guest('PATCH', `/api/guest/${gtoken}/items/${draft.id}`, { title: 'Way Maker', key: 'E', lyrics: 'Verse 1\nYou are here', submit: true })).status, 'live');
// Editing a live item updates the plan in place
const noteItem = gpage.submissions.find((x) => x.kind === 'note');
ok(await guest('PATCH', `/api/guest/${gtoken}/items/${noteItem.id}`, { text: 'Outline first, then the video.' }));
const scrItem = gpage.submissions.find((x) => x.kind === 'scripture');
ok(await guest('PATCH', `/api/guest/${gtoken}/items/${scrItem.id}`, { reference: 'Psalm 23:1-3', version: 'NKJV', text: 'The Lord is my shepherd…' }));
plan = ok(await crew1('GET', `/api/plans/${worship.id}`));
assert.match(plan.notes, /From Guest Speaker:\nOutline first, then the video\./);
assert.ok(!plan.notes.includes('Please put up the outline'), 'the old text was replaced, not added again');
assert.equal(plan.scriptures.filter((x) => x.reference.startsWith('Psalm 23')).length, 1);
assert.ok(plan.songs.some((x) => x.song.title === 'Way Maker' && x.key === 'E'));
// Taking a file back out while open
const fileItem = gpage.submissions.find((x) => x.kind === 'media');
ok(await guest('DELETE', `/api/guest/${gtoken}/items/${fileItem.id}`), 204);
assert.ok(!ok(await crew1('GET', `/api/plans/${worship.id}`)).media.some((m) => m.originalName === 'Guest slides.pdf'));
step('guest links: 6-digit code, submitted items go straight in, drafts stay private, edits update the plan');

// After the deadline: locked. New items and changes wait for approval.
ok(await crew1('POST', `/api/guest-links/link/${gl.id}/lock`), 403);
assert.equal(ok(await crew2('POST', `/api/guest-links/link/${gl.id}/lock`)).state, 'locked');
assert.equal(ok(await guest('GET', `/api/guest/${gtoken}`)).schedule.state, 'locked');
assert.equal(ok(await guest('PATCH', `/api/guest/${gtoken}/items/${noteItem.id}`, { text: 'Late: skip the video.' })).status, 'change-pending');
ok(await guest('PATCH', `/api/guest/${gtoken}/items/${noteItem.id}`, { text: 'Late: skip the video, please.' }));
ok(await guest('DELETE', `/api/guest/${gtoken}/items/${scrItem.id}`), 400);
assert.equal(ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'scripture', reference: 'John 3:16', version: 'KJV', text: 'For God so loved' }), 201).status, 'pending');
ok(await guest.upload(`/api/guest/${gtoken}/files`, [{ name: 'reject-me.mov', type: 'video/quicktime', bytes: 'mov' }]), 201);
plan = ok(await crew1('GET', `/api/plans/${worship.id}`));
assert.match(plan.notes, /Outline first, then the video\./, 'not changed until approved');
assert.ok(!plan.media.some((m) => m.originalName === 'reject-me.mov'), 'crew can’t see unapproved late files');
plan = ok(await crew2('GET', `/api/plans/${worship.id}`));
let pending = plan.submissions.filter((x) => x.status === 'pending');
assert.equal(pending.length, 3, 'one change (updated, not doubled), one late Bible text, one late file');
assert.equal(pending.find((x) => x.replaces)?.data.text, 'Late: skip the video, please.');
ok(await crew1('POST', `/api/submissions/${pending[0].id}/approve`), 403);
const rejectMe = pending.find((x) => x.media?.originalName === 'reject-me.mov');
ok(await crew2('POST', `/api/submissions/${rejectMe.id}/reject`));
ok(await crew2('GET', rejectMe.media.url), 404);
for (const x of pending.filter((x) => x.id !== rejectMe.id)) ok(await crew2('POST', `/api/submissions/${x.id}/approve`));
plan = ok(await crew1('GET', `/api/plans/${worship.id}`));
assert.match(plan.notes, /From Guest Speaker:\nLate: skip the video, please\./);
assert.ok(!plan.notes.includes('Outline first'), 'the approved change replaced the old note');
assert.ok(plan.scriptures.some((x) => x.reference === 'John 3:16'));
gpage = ok(await guest('GET', `/api/guest/${gtoken}`));
assert.ok(gpage.submissions.every((x) => !x.change), 'no changes left waiting');
assert.equal(gpage.submissions.find((x) => x.kind === 'note').data.text, 'Late: skip the video, please.');
step('guest links: locked after the deadline, late items and changes wait for approval');

// Reopen for 30 minutes: edits go straight in again
const reopened = ok(await crew2('POST', `/api/guest-links/link/${gl.id}/reopen`, { minutes: 30 }));
assert.equal(reopened.state, 'open');
assert.ok(Math.abs(Date.parse(reopened.closesAt) - Date.now() - 30 * 60e3) < 60e3);
// Quick links: open now for 1–48 hours, or reopen for up to 48
const quick = ok(await crew2('POST', `/api/guest-links/${worship.id}`, { name: 'Worship leader', hours: 48 }), 201);
assert.equal(quick.state, 'open');
assert.ok(Math.abs(Date.parse(quick.closesAt) - Date.now() - 48 * 3600e3) < 60e3, 'open 48 hours from now');
assert.ok(Date.parse(quick.expiresAt) > Date.parse(quick.closesAt), 'late changes can still come in after it locks');
assert.match(quick.url, /\/add\/[A-Za-z0-9_-]+$/);
ok(await crew2('POST', `/api/guest-links/${worship.id}`, { name: 'Too long', hours: 72 }), 400);
ok(await crew2('POST', `/api/guest-links/link/${quick.id}/lock`));
const twoDays = ok(await crew2('POST', `/api/guest-links/link/${quick.id}/reopen`, { minutes: 48 * 60 }));
assert.ok(Math.abs(Date.parse(twoDays.closesAt) - Date.now() - 48 * 3600e3) < 60e3, 'reopened for 48 hours');
ok(await crew2('POST', `/api/guest-links/link/${quick.id}/revoke`));
ok(await guest('PATCH', `/api/guest/${gtoken}/items/${noteItem.id}`, { text: 'Reopened: video back in.' }));
assert.match(ok(await crew1('GET', `/api/plans/${worship.id}`)).notes, /Reopened: video back in\./);
// Schedule changes, and a guest can't add anything before it opens
const future = new Date(Date.now() + 2 * 864e5).toISOString();
ok(await crew2('PATCH', `/api/guest-links/link/${gl.id}`, { opensAt: future, closesAt: new Date(Date.now() + 864e5).toISOString() }), 400);
assert.equal(ok(await crew2('PATCH', `/api/guest-links/link/${gl.id}`, { opensAt: future, closesAt: new Date(Date.now() + 3 * 864e5).toISOString() })).state, 'waiting');
r = ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'note', text: 'too early' }), 400);
assert.match(r.error, /start adding/);
// A new code signs the guest out until they enter it
const fresh = ok(await crew2('POST', `/api/guest-links/link/${gl.id}/new-code`));
assert.notEqual(fresh.code, gl.code);
assert.equal(ok(await guest('GET', `/api/guest/${gtoken}`)).needsCode, true);
ok(await guest('POST', `/api/guest/${gtoken}/unlock`, { code: fresh.code }), 204);
ok(await crew2('POST', `/api/guest-links/link/${gl.id}/revoke`));
r = await guest('GET', `/api/guest/${gtoken}`);
assert.equal(r.status, 410);
assert.match(r.data.error, /expired/);
ok(await guest('POST', `/api/guest/${gtoken}/items`, { kind: 'note', text: 'late' }), 410);
ok(await guest('GET', '/api/guest/not-a-real-token-1234567890'), 404);
// Too many wrong codes lock the code until a leader makes a new one
const gl2 = ok(await crew2('POST', `/api/guest-links/${worship.id}`, { name: 'Choir' }), 201);
const t2 = gl2.url.split('/add/')[1];
const wrong = gl2.code === '123456' ? '654321' : '123456';
for (let i = 0; i < 8; i++) await guest('POST', `/api/guest/${t2}/unlock`, { code: wrong });
ok(await guest('POST', `/api/guest/${t2}/unlock`, { code: gl2.code }), 423);
step('guest links: reopen for a while, scheduled opening, new codes, revoked links refuse, wrong-code lockout');

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
ok(await ben.c('POST', '/api/me/blackouts', { from: fri5, to: sun5 }), 201);
ok(await admin('PATCH', `/api/people/${ben.id}`, { regulars: [{ week: nth5, service: 'Vespers', positions: [] }] }));
const devSaved = ok(await admin('PATCH', `/api/people/${dev.id}`, { regulars: [{ week: nth5, service: 'Worship Service', positions: ['light', 'cam'] }, { week: 'bogus', service: '' }] }));
assert.ok(devSaved.regularsPlaced >= 1, 'saving a regular schedule places them on weekends already built');
ok(await admin('PATCH', `/api/people/${cara.id}`, { regulars: [{ week: 'every', service: '', positions: [] }] }));
ok(await admin('PATCH', `/api/people/${eli.id}`, { regulars: [{ week: otherNth, service: 'Worship Service', positions: [] }] }));
const devPerson = ok(await admin('GET', '/api/people')).find((p) => p.id === dev.id);
assert.equal(devPerson.regulars.length, 2);
assert.equal(devPerson.regulars[1].week, 'every', 'unknown week patterns fall back to every weekend');
assert.deepEqual(ok(await dev.c('GET', '/api/bootstrap')).me.regulars[0].positions, ['light', 'cam']);
ok(await crew1('PATCH', `/api/people/${dev.id}`, { regulars: [] }), 403);
ev3 = ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`));
const worship5 = ev3.find((e) => e.title === 'Worship Service');
const holds = (e, uid) => Object.entries(e.assignments).find(([, a]) => (a.userId || a.user?.id || a.id || a) === uid);
assert.ok(holds(worship5, dev.id), JSON.stringify(worship5.assignments));
assert.equal(holds(worship5, dev.id)[0], 'light', 'first listed position is preferred');
assert.ok(ev3.some((e) => holds(e, cara.id)), 'every-weekend regular placed in any service');
assert.ok(!ev3.some((e) => holds(e, eli.id)), 'rule for another week does not apply');
assert.ok(!ev3.some((e) => holds(e, ben.id)), 'away regulars are not placed');
const af5 = ok(await admin('GET', `/api/weekend/autofill?friday=${fri5}`));
assert.ok(af5.regularNotes.some((n) => n.userId === ben.id && /Away/.test(n.why)), 'away regulars are reported');
const devShift = ok(await dev.c('GET', '/api/me/overview')).shifts.find((x) => x.id === worship5.id);
assert.match(devShift.regular, new RegExp(`${['', '1st', '2nd', '3rd', '4th', '5th'][Number(nth5)]} Sabbath`));
const devFeed = await client()('GET', new URL(ok(await dev.c('GET', '/api/bootstrap')).me.calUrl).pathname);
const devIcs = devFeed.data.replace(/\r\n /g, '');
assert.match(devIcs, /This is your regular .*Sabbath.* shift/, 'calendar says it is their regular shift');
assert.match(devIcs, /TRIGGER:-P5D/, 'calendar alert 5 days before');
assert.match(devIcs, /You're on Lighting for Worship Service on Sabbath/);
ok(await admin('PATCH', '/api/settings', { calendarAlertDays: 0 }));
assert.doesNotMatch((await client()('GET', new URL(ok(await dev.c('GET', '/api/bootstrap')).me.calUrl).pathname)).data, /TRIGGER:-P\d+D/, 'alert can be turned off');
ok(await admin('PATCH', '/api/settings', { calendarAlertDays: 5 }));
step('regular schedules: placed automatically (nth-Sabbath and every-weekend, preferred or any position), away regulars reported, calendar alert and note');

// A regular a leader takes off by hand isn't put back by Sync; a new weekend gets them straight away.
{
  ok(await admin('PUT', `/api/events/${worship5.id}/assign/light`, { userId: null }));
  ok(await admin('POST', '/api/events/weekend', { friday: fri5 }));
  assert.ok(!holds(ok(await admin('GET', `/api/events?from=${fri5}&to=${sun5}`)).find((e) => e.id === worship5.id), dev.id), 'sync leaves a removed regular off');
  ok(await admin('PUT', `/api/events/${worship5.id}/assign/light`, { userId: dev.id }));
  const plus = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
  let f = plus(fri5, 7);
  for (let i = 0; i < 10 && String(Math.ceil(new Date(Date.parse(f) + 864e5).getUTCDate() / 7)) !== nth5; i++) f = plus(f, 7);
  const bw = ok(await admin('POST', '/api/events/weekend', { friday: f }));
  assert.ok(bw.regularsPlaced >= 1, JSON.stringify(bw));
  const built = ok(await admin('GET', `/api/events?from=${f}&to=${plus(f, 2)}`));
  assert.ok(built.some((e) => e.title === 'Worship Service' && holds(e, dev.id)), `a freshly built weekend gets its regulars (${f})`);
}
// Build ahead: weekends a few weeks out are built and regulars placed without anyone pressing a button.
{
  ok(await admin('PATCH', '/api/settings', { autoBuildWeeks: 3 }));
  const r = ok(await admin('POST', '/api/weekend/build-ahead'));
  assert.ok(r.built >= 0);
  const thisFri = friday;
  for (let i = 0; i < 3; i++) {
    const f = new Date(Date.parse(thisFri) + 7 * i * 864e5).toISOString().slice(0, 10);
    const evs = ok(await admin('GET', `/api/events?from=${f}&to=${new Date(Date.parse(f) + 2 * 864e5).toISOString().slice(0, 10)}`));
    assert.ok(evs.length > 0, `weekend of ${f} is built`);
    assert.ok(evs.some((e) => holds(e, cara.id)), `every-weekend regular placed on ${f}`);
  }
  assert.equal(ok(await admin('POST', '/api/weekend/build-ahead')).built, 0, 'nothing built twice');
  ok(await crew1('POST', '/api/weekend/build-ahead'), 403);
  ok(await admin('PATCH', '/api/settings', { autoBuildWeeks: 0 }));
}
step('build ahead: upcoming weekends are built from the template with regulars placed; Sync never re-adds a regular taken off by hand');

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

// ---------- sign-in sessions ----------
{
  const SECRET = process.env.JWT_SECRET;
  const login = async (c, password = 'niapass12') => ok(await c('POST', '/api/auth/login', { email: 'nia@example.com', password }));
  let st = ok(await admin('GET', '/api/bootstrap')).settings;
  assert.equal(st.idleMinutes, 90);
  assert.equal(st.endOnBrowserClose, true);
  const raw = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nia@example.com', password: 'niapass12' }) });
  assert.ok(!/max-age|expires/i.test(raw.headers.get('set-cookie')), 'a browser-session cookie: gone when the browser closes');
  ok(await admin('PATCH', '/api/settings', { endOnBrowserClose: false }));
  await new Promise((res) => setTimeout(res, 15500)); // the server caches these rules for 15 s
  const raw2 = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nia@example.com', password: 'niapass12' }) });
  assert.match(raw2.headers.get('set-cookie'), /Max-Age/i, 'stays signed in across restarts when that’s turned off');
  ok(await admin('PATCH', '/api/settings', { endOnBrowserClose: true, idleMinutes: 5 }));
  assert.equal(ok(await admin('GET', '/api/bootstrap')).settings.idleMinutes, 15, 'at least 15 minutes');
  ok(await crew2('PATCH', '/api/settings', { idleMinutes: 0 }), 403);

  // Sign out everywhere
  const phone = client();
  const laptop = client();
  await login(phone);
  await login(laptop);
  ok(await phone('POST', '/api/account/sign-out-everywhere'), 204);
  r = ok(await laptop('GET', '/api/bootstrap'), 401);
  assert.match(r.error, /signed out/);
  ok(await phone('GET', '/api/bootstrap'), 401);
  step('sessions: browser-close cookie setting, sign out on all devices');

  // Admin signs one person out, then everyone else
  await login(phone);
  ok(await phone('POST', `/api/people/${n.person.id}/sign-out`), 403);
  ok(await admin('POST', `/api/people/${n.person.id}/sign-out`), 204);
  ok(await phone('GET', '/api/bootstrap'), 401);
  await login(phone);
  const everyone = ok(await admin('POST', '/api/settings/sign-out-everyone'));
  assert.ok(everyone.signedOut >= 1);
  ok(await phone('GET', '/api/bootstrap'), 401);
  ok(await admin('GET', '/api/bootstrap'), 200, 'the admin stays signed in');
  step('sessions: the admin can sign one person or everyone else out');

  // Idle timeout (15 minutes now). Background checks don't keep a session alive.
  await login(phone);
  const real = jwt.decode(decodeURIComponent(phone.cookie().split('=')[1]));
  const forge = (minutesAgo) => `cc_session=${jwt.sign({ uid: real.uid, sv: real.sv, la: Math.floor(Date.now() / 1000) - minutesAgo * 60 }, SECRET, { expiresIn: '30d' })}`;
  phone.cookie(forge(5));
  r = await phone.bg('GET', '/api/plans/pending');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), null, 'a background check doesn’t count as activity');
  r = await phone('GET', '/api/account/ping');
  assert.equal(r.status, 204);
  assert.ok(r.headers.get('set-cookie'), 'real activity refreshes the session');
  phone.cookie(forge(16));
  r = ok(await phone('GET', '/api/bootstrap'), 401);
  assert.match(r.error, /15 minutes without activity/);
  // Changing your password signs out your other devices, not this one
  await login(phone);
  await login(laptop);
  ok(await phone('POST', '/api/account/password', { current: 'niapass12', password: 'niapass34' }), 204);
  ok(await phone('GET', '/api/bootstrap'));
  ok(await laptop('GET', '/api/bootstrap'), 401);
  ok(await admin('PATCH', '/api/settings', { idleMinutes: 90 }));
  step('sessions: idle timeout, background checks don’t extend it, a password change signs out other devices');
}

console.log('\nAll checks passed.');
