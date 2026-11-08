// Order of service, service rundown and congregation bulletin, against a running API with an
// EMPTY database:   BASE_URL=http://localhost:4000 node test/order.mjs
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
const crew = client();
const anon = client();
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Grace Church' }), 201);
const inv = ok(await admin('POST', '/api/people', { name: 'Ava Crew', email: 'ava@example.com', phone: '4235550101', positions: ['foh'] }), 201);
ok(await crew('POST', `/api/auth/invite/${inv.inviteUrl.split('/invite/')[1]}`, { password: 'avapass12' }));

const svc = ok(await admin('POST', '/api/events', { date: iso(6), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const song = ok(await admin('POST', '/api/songs', { title: 'Amazing Grace', lyrics: 'Verse 1\nAmazing grace' }), 201);
ok(await admin('PATCH', `/api/plans/${svc.id}`, { sermonTitle: 'Living Water', speaker: 'Pastor James', scriptures: [{ reference: 'John 4:13-14', version: 'KJV', text: '13 Jesus answered…' }], songs: [{ song: song.id, key: 'G' }] }));

let p = ok(await admin('PATCH', `/api/plans/${svc.id}`, {
  order: [
    { kind: 'heading', title: 'Worship', minutes: 9, who: 'x' },
    { kind: 'item', title: 'Welcome', who: 'Elder Ruth', minutes: 5, notes: 'Handheld mic 2' },
    { kind: 'song', title: 'Amazing Grace', who: 'Praise team', minutes: 4, notes: 'Lyrics on screen' },
    { kind: 'bogus', title: 'Offering', minutes: 3, bulletin: true },
    { kind: 'item', title: '', minutes: 2 },
    { kind: 'item', title: 'Video check', minutes: 1, notes: 'Mute stage', bulletin: false },
    { kind: 'sermon', title: 'Sermon', who: 'Pastor James', minutes: 999 },
  ],
  announcements: 'Potluck after church.',
}));
assert.deepEqual(p.order.map((x) => [x.kind, x.title, x.minutes]), [['heading', 'Worship', 0], ['item', 'Welcome', 5], ['song', 'Amazing Grace', 4], ['item', 'Offering', 3], ['item', 'Video check', 1], ['sermon', 'Sermon', 300]]);
assert.equal(p.order[0].who, '', 'headings have no who');
assert.equal(p.announcements, 'Potluck after church.');
assert.ok(p.share.rundown && p.share.bulletin && p.share.rundown !== p.share.bulletin, 'two separate links');
ok(await crew('PATCH', `/api/plans/${svc.id}`, { order: [] }), 403);
assert.equal(ok(await crew('GET', `/api/plans/${svc.id}`)).order.length, 6, 'crew can read it');
step('order of service saves, cleaned up (kinds, blank lines, minutes)');

const rd = ok(await anon('GET', `/api/public/rundown/${p.share.rundown}`));
assert.equal(rd.kind, 'rundown');
assert.equal(rd.event.start, '11:00');
assert.equal(rd.order.length, 6, 'rundown has everything, including crew-only lines');
assert.equal(rd.order[1].notes, 'Handheld mic 2');
assert.equal(rd.order[1].minutes, 5);
assert.equal(rd.songs[0].key, 'G');
assert.equal(rd.scriptures[0].text, '13 Jesus answered…');
assert.equal(rd.crew.length, 1, 'one position');
assert.equal(rd.crew[0].name, '', 'open position');
assert.ok(!JSON.stringify(rd).includes('4235550101'), 'no phone numbers on a shared link');
step('rundown link: times, cues, keys, Bible texts and crew positions, no sign-in');

const bl = ok(await anon('GET', `/api/public/bulletin/${p.share.bulletin}`));
assert.equal(bl.kind, 'bulletin');
assert.equal(bl.orgName, 'Grace Church');
assert.deepEqual(bl.order.map((x) => x.title), ['Worship', 'Welcome', 'Amazing Grace', 'Offering', 'Sermon'], 'crew-only lines left out');
assert.ok(bl.order.every((x) => !('notes' in x) && !('minutes' in x)), 'no cues or times');
assert.deepEqual(bl.songs, [], 'songs already in the order are not listed twice');
const song2 = ok(await admin('POST', '/api/songs', { title: 'How Great Thou Art' }), 201);
ok(await admin('PATCH', `/api/plans/${svc.id}`, { songs: [{ song: song.id, key: 'G' }, { song: song2.id }] }));
assert.deepEqual(ok(await anon('GET', `/api/public/bulletin/${p.share.bulletin}`)).songs.map((x) => x.title), ['How Great Thou Art'], 'songs not named in the order are listed');
assert.equal(bl.scriptures[0].reference, 'John 4:13-14');
assert.ok(!('text' in bl.scriptures[0]));
assert.equal(bl.announcements, 'Potluck after church.');
assert.ok(!('crew' in bl));
ok(await anon('GET', `/api/public/bulletin/${p.share.rundown}`), 404);
ok(await anon('GET', `/api/public/rundown/${p.share.bulletin}`), 404);
ok(await anon('GET', '/api/public/rundown/not-a-real-token-at-all'), 404);
step('bulletin link: order without times or cues, sermon, Bible texts, announcements');

ok(await crew('POST', `/api/plans/${svc.id}/share/rundown`), 403);
const renewed = ok(await admin('POST', `/api/plans/${svc.id}/share/rundown`));
assert.notEqual(renewed.share.rundown, p.share.rundown);
assert.equal(renewed.share.bulletin, p.share.bulletin, 'only that link changes');
ok(await anon('GET', `/api/public/rundown/${p.share.rundown}`), 404);
ok(await anon('GET', `/api/public/rundown/${renewed.share.rundown}`));
ok(await admin('POST', `/api/plans/${svc.id}/share/flyer`), 404);
step('a leader can replace a link; the old one stops working');

const nextWeek = ok(await admin('POST', '/api/events', { date: iso(13), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const other = ok(await admin('POST', '/api/events', { date: iso(12), title: 'Vespers', call: '17:00', start: '18:00', end: '19:00', needs: ['foh'] }), 201);
ok(await admin('PATCH', `/api/plans/${other.id}`, { order: [{ title: 'Vespers song' }] }));
const copied = ok(await admin('POST', `/api/plans/${nextWeek.id}/order/copy-last`));
assert.equal(copied.copiedFrom.date, iso(6), 'prefers the last service with the same name');
assert.equal(copied.order.length, 6);
assert.equal(copied.order[1].notes, 'Handheld mic 2');
assert.equal(copied.announcements, '', 'announcements are weekly, not copied');
const first = ok(await admin('POST', '/api/events', { date: iso(1), title: 'Prayer Breakfast', call: '07:00', start: '07:30', end: '08:30', needs: ['foh'] }), 201);
ok(await admin('POST', `/api/plans/${first.id}/order/copy-last`), 400);
const viaCopy = ok(await admin('POST', '/api/events', { date: iso(20), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const r = ok(await admin('POST', `/api/plans/${viaCopy.id}/copy`, { from: svc.id, order: true }));
assert.ok(r.copied.includes('order of service'));
assert.equal(ok(await admin('GET', `/api/plans/${viaCopy.id}`)).order.length, 6);
step('copy last week’s order, or copy it from any service');

ok(await admin('POST', '/api/plans/archive-weekend', { events: [svc.id], delete: true }));
ok(await anon('GET', `/api/public/bulletin/${p.share.bulletin}`), 404);
ok(await anon('GET', `/api/public/rundown/${renewed.share.rundown}`), 404);
step('deleting a plan turns its links off');

console.log('\nAll order-of-service checks passed.');
