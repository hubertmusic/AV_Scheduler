// End-to-end check of the archive, media library and cold storage, against a running API
// with an EMPTY database. The API and this script must share the same ARCHIVE_DIR:
//
//   ARCHIVE_DIR=/tmp/cc-archive ARCHIVE_AFTER_DAYS=90 PURGE_VIDEO_AFTER_DAYS=200 npm start
//   ARCHIVE_DIR=/tmp/cc-archive BASE_URL=http://localhost:4000 node test/archive.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const ARCHIVE_DIR = process.env.ARCHIVE_DIR;
assert.ok(ARCHIVE_DIR, 'set ARCHIVE_DIR to the same folder the API uses');
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const MARKER = path.join(ARCHIVE_DIR, '.crewcall-archive');
fs.rmSync(MARKER, { force: true });

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
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Crew' }), 201);
const inv = ok(await admin('POST', '/api/people', { name: 'Ava Crew', email: 'ava@example.com', phone: '4235550101', positions: ['foh'] }), 201);
const tok = inv.inviteUrl.split('/invite/')[1];
ok(await crew('POST', `/api/auth/invite/${tok}`, { password: 'avapass12' }));

// Two services. "Old" gets filled in while it's upcoming, then dated back as if weeks went by.
const old = ok(await admin('POST', '/api/events', { date: iso(10), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const next = ok(await admin('POST', '/api/events', { date: iso(6), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const amazing = ok(await admin('POST', '/api/songs', { title: 'Amazing Grace', artist: 'John Newton', ccli: '22025', lyrics: 'Verse 1\nAmazing grace' }), 201);
const howGreat = ok(await admin('POST', '/api/songs', { title: 'How Great Thou Art', ccli: '14181', lyrics: 'Verse 1\nO Lord my God' }), 201);
ok(await admin('PATCH', `/api/plans/${old.id}`, {
  sermonTitle: 'Living Water', speaker: 'Pastor James', notes: 'Slide cue after the reading',
  scriptures: [{ reference: 'John 4:13-14', version: 'KJV', text: '13 Jesus answered…' }],
  songs: [{ song: amazing.id, key: 'G' }, { song: howGreat.id, key: 'Bb' }],
}));
const bg = Buffer.from('fake-mp4-background-loop-' + 'x'.repeat(2000));
const sermonSlides = Buffer.from('%PDF-1.4 sermon slides');
const sermonVideo = Buffer.from('fake-sermon-bumper-video-' + 'y'.repeat(3000));
let p = ok(await admin.upload(`/api/plans/${old.id}/media`, [
  { name: 'Heavenly_Starfield_1080p.mp4', type: 'video/mp4', bytes: bg },
  { name: 'Living Water slides.pdf', type: 'application/pdf', bytes: sermonSlides },
  { name: 'Sermon bumper.mp4', type: 'video/mp4', bytes: sermonVideo },
]), 201);
assert.equal(p.media.length, 3);
assert.equal(p.archived, false);
const bgMedia = p.media.find((m) => m.originalName.startsWith('Heavenly'));
const slides = p.media.find((m) => m.originalName.endsWith('.pdf'));
const bumper = p.media.find((m) => m.originalName.startsWith('Sermon bumper'));
step('a current plan is editable and takes uploads');

// ---------- media library ----------
let lib = ok(await admin('POST', `/api/library/from-media/${bgMedia.id}`, { category: 'Backgrounds' }));
assert.equal(lib.already, false);
p = ok(await admin('GET', `/api/plans/${old.id}`));
assert.equal(p.media.length, 2, 'the file left the plan’s own uploads…');
assert.deepEqual(p.assets.map((a) => a.id), [bgMedia.id], '…and the plan links to it in the library');
assert.equal(p.assets[0].category, 'Backgrounds');
let list = ok(await admin('GET', '/api/library'));
assert.equal(list.items.length, 1);
assert.equal(list.items[0].usage.upcoming, 1);
ok(await crew('GET', '/api/library'));
ok(await crew('POST', `/api/library/from-media/${slides.id}`, {}), 403);
step('save to library: the file moves to the library and the service links to it');

// Uploading the same background to another service links the library copy instead of storing it again
p = ok(await admin.upload(`/api/plans/${next.id}/media`, [{ name: 'starfield again.mp4', type: 'video/mp4', bytes: bg }]), 201);
assert.deepEqual(p.linked, ['Heavenly_Starfield_1080p.mp4']);
assert.equal(p.media.length, 0);
assert.equal(p.assets.length, 1);
// …and uploading it straight to the library is refused as a duplicate
const dup = ok(await admin.upload('/api/library', [{ name: 'copy.mp4', type: 'video/mp4', bytes: bg }], { category: 'Backgrounds' }), 201);
assert.equal(dup.added, 0);
assert.match(dup.skipped[0], /already in the library/);
const cd = ok(await admin.upload('/api/library', [{ name: '5 min countdown.mp4', type: 'video/mp4', bytes: Buffer.from('countdown!') }], { category: 'Countdowns' }), 201);
assert.equal(cd.added, 1);
list = ok(await admin('GET', '/api/library?category=Countdowns'));
assert.equal(list.items.length, 1);
const countdown = list.items[0];
p = ok(await admin('PATCH', `/api/plans/${next.id}`, { assets: [...p.assets.map((a) => a.id), countdown.id, 'ffffffffffffffffffffffff'] }));
assert.equal(p.assets.length, 2, 'unknown ids are dropped');
step('the same file is stored once: duplicates link to the library item');

// Library items come along in the ProPresenter zip
const zip = ok(await admin('GET', `/api/plans/${next.id}/propresenter.zip`));
assert.ok(zip.includes(Buffer.from('Media/Heavenly_Starfield_1080p.mp4')) && zip.includes(Buffer.from('Media/5 min countdown.mp4')));
step('library items are in Download for ProPresenter');

// ---------- archive ----------
ok(await admin('PATCH', `/api/events/${old.id}`, { date: iso(-100) }));
p = ok(await admin('GET', `/api/plans/${old.id}`));
assert.equal(p.archived, true);
assert.equal(p.sermonTitle, 'Living Water');
let r = ok(await admin('PATCH', `/api/plans/${old.id}`, { notes: 'too late' }), 400);
assert.match(r.error, /archive/);
ok(await admin.upload(`/api/plans/${old.id}/media`, [{ name: 'a.pdf', type: 'application/pdf', bytes: Buffer.from('x') }]), 400);
ok(await admin('POST', `/api/guest-links/${old.id}`, { name: 'Guest' }), 400);
const sum = ok(await admin('GET', `/api/plans/summary?from=${iso(-101)}&to=${iso(-99)}`));
assert.equal(sum[0].archived, true);
step('a service is archived from the day after: read-only, nothing deleted');

let arc = ok(await crew('GET', '/api/plans/archive'));
assert.equal(arc.items.length, 1);
assert.deepEqual(arc.items[0].songs, ['Amazing Grace', 'How Great Thou Art']);
assert.equal(arc.items[0].media, 3);
assert.equal(ok(await crew('GET', '/api/plans/archive?q=living')).items.length, 1, 'by sermon title');
assert.equal(ok(await crew('GET', '/api/plans/archive?q=how%20great')).items.length, 1, 'by song');
assert.equal(ok(await crew('GET', '/api/plans/archive?q=john%204')).items.length, 1, 'by Bible text');
assert.equal(ok(await crew('GET', '/api/plans/archive?q=nothing-like-this')).items.length, 0);
step('archive search: sermon, songs, Bible texts');

// Copy to this week
r = ok(await admin('POST', `/api/plans/${next.id}/copy`, { from: old.id, sermon: true, notes: true, scriptures: true, songs: true, assets: true, media: [slides.id] }));
assert.equal(r.sermonTitle, 'Living Water');
assert.match(r.notes, /From Worship Service/);
assert.equal(r.scriptures.length, 1);
assert.deepEqual(r.songs.map((s) => s.song.title), ['Amazing Grace', 'How Great Thou Art']);
assert.equal(r.assets.length, 2, 'background already linked, not doubled');
assert.equal(r.media.length, 1);
assert.notEqual(r.media[0].id, slides.id, 'files are copied, not shared');
assert.deepEqual(r.failed, []);
r = ok(await admin('POST', `/api/plans/${next.id}/copy`, { from: old.id, songs: true, scriptures: true }));
assert.equal(r.songs.length, 2, 'copying twice doesn’t duplicate songs');
assert.equal(r.scriptures.length, 1);
ok(await admin('POST', `/api/plans/${old.id}/copy`, { from: next.id, songs: true }), 400);
ok(await crew('POST', `/api/plans/${next.id}/copy`, { from: old.id, songs: true }), 403);
step('copy to this week: songs, Bible texts, notes, library items and copied files');

// Deleting a file from an archived plan frees the space but keeps the record
ok(await admin('DELETE', `/api/media/${slides.id}`), 204);
p = ok(await admin('GET', `/api/plans/${old.id}`));
assert.equal(p.media.find((m) => m.id === slides.id).stored, 'removed');
ok(await admin('GET', `/api/media/${slides.id}/file`), 410);
step('deleting from an archived plan keeps the record');

// ---------- song history ----------
let songs = ok(await crew('GET', '/api/songs'));
const ag = songs.find((s) => s.id === amazing.id);
assert.equal(ag.lastUsed, iso(-100));
assert.equal(ag.usedThisYear, 1);
const csv = ok(await admin('GET', `/api/songs/usage.csv?from=${iso(-200)}&to=${iso(0)}`));
assert.match(csv, /"Amazing Grace","John Newton","22025","1"/);
ok(await crew('GET', '/api/songs/usage.csv'), 403);
// A song past services used is retired, not deleted
r = ok(await admin('DELETE', `/api/songs/${howGreat.id}`));
assert.equal(r.retired, true);
assert.ok(!ok(await admin('GET', '/api/songs')).some((s) => s.id === howGreat.id), 'hidden from the library');
assert.ok(ok(await admin('GET', '/api/songs?all=1')).some((s) => s.id === howGreat.id && s.retired));
p = ok(await admin('GET', `/api/plans/${old.id}`));
assert.ok(p.songs.some((s) => s.song.id === howGreat.id), 'the archived plan still lists it');
p = ok(await admin('GET', `/api/plans/${next.id}`));
assert.ok(!p.songs.some((s) => s.song.id === howGreat.id), 'taken out of upcoming services');
const unused = ok(await admin('POST', '/api/songs', { title: 'Never sung' }), 201);
ok(await admin('DELETE', `/api/songs/${unused.id}`), 204);
assert.ok(!ok(await admin('GET', '/api/songs?all=1')).some((s) => s.id === unused.id), 'a song no past service used is really deleted');
step('song history, CCLI usage report, and retiring songs instead of deleting history');

// ---------- cold storage ----------
let st = ok(await admin('POST', '/api/library/storage/run'));
assert.equal(st.enabled, true);
assert.equal(st.ready, false);
assert.equal(st.lastRun.cold.moved, 0);
assert.match(st.lastRun.cold.skipped, /\.crewcall-archive/);
ok(await crew('GET', '/api/library/storage'), 403);
step('cold storage does nothing until the archive folder has its marker file');

fs.writeFileSync(MARKER, '');
st = ok(await admin('POST', '/api/library/storage/run'));
assert.equal(st.lastRun.cold.moved, 1, 'the sermon bumper (the slides were removed, the background is in the library)');
assert.equal(st.cold.count, 1);
p = ok(await admin('GET', `/api/plans/${old.id}`));
assert.equal(p.media.find((m) => m.id === bumper.id).stored, 'cold');
assert.ok(fs.readdirSync(ARCHIVE_DIR).some((f) => f.endsWith('.mp4')));
const fromCold = ok(await crew('GET', `/api/media/${bumper.id}/file?download=1`));
assert.ok(fromCold.equals(sermonVideo), 'opens from the archive');
assert.equal(ok(await admin('POST', '/api/library/storage/run')).lastRun.cold.moved, 0, 'nothing moved twice');
assert.equal(ok(await admin('GET', `/api/plans/${next.id}`)).assets.length, 2, 'library items never move');
step('files of services older than 90 days move to the archive and still open');

fs.rmSync(MARKER);
r = ok(await crew('GET', `/api/media/${bumper.id}/file`), 503);
assert.match(r.error, /NAS/);
r = ok(await admin('POST', `/api/plans/${next.id}/copy`, { from: old.id, media: [bumper.id] }));
assert.equal(r.failed.length, 1);
fs.writeFileSync(MARKER, '');
r = ok(await admin('POST', `/api/plans/${next.id}/copy`, { from: old.id, media: [bumper.id] }));
assert.deepEqual(r.failed, []);
assert.ok(r.media.some((m) => m.originalName === 'Sermon bumper.mp4' && m.stored === 'hot'), 'copied back out of the archive');
step('NAS offline: a clear message, and copying waits until it’s back');

// Old videos removed after PURGE_VIDEO_AFTER_DAYS, records kept
ok(await admin('PATCH', `/api/events/${old.id}`, { date: iso(-250) }));
st = ok(await admin('POST', '/api/library/storage/run'));
assert.equal(st.lastRun.purge.purged, 1);
p = ok(await admin('GET', `/api/plans/${old.id}`));
assert.equal(p.media.find((m) => m.id === bumper.id).stored, 'removed');
assert.equal(p.songs.length, 2);
ok(await admin('GET', `/api/media/${bumper.id}/file`), 410);
step('old videos can be removed to save space; the plan record stays');

// Library delete: used by a past service → file removed, record kept for history
ok(await admin('PATCH', `/api/events/${next.id}`, { date: iso(-1) }));
const later = ok(await admin('POST', '/api/events', { date: iso(13), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
ok(await admin('POST', `/api/plans/${later.id}/copy`, { from: next.id, assets: true }));
ok(await admin('DELETE', `/api/library/${countdown.id}`), 204);
assert.ok(!ok(await admin('GET', '/api/library')).items.some((i) => i.id === countdown.id));
assert.equal(ok(await admin('GET', `/api/plans/${later.id}`)).assets.length, 1, 'upcoming service loses it');
const pastAssets = ok(await admin('GET', `/api/plans/${next.id}`)).assets;
assert.equal(pastAssets.find((a) => a.id === countdown.id).stored, 'removed', 'past service still shows it was used');
step('deleting a library item keeps the history of past services');

console.log('\nAll archive checks passed.');
