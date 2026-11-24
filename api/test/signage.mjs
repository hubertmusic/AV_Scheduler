// Digital signage: screens, items, upload links, the live player, service plans both ways, and
// sending to Anthias (against a stand-in Anthias started here). Against a running API with an
// EMPTY database:   BASE_URL=http://localhost:4000 MONGO_URL=… node test/signage.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:4000';
function client(team = '') {
  let cookie = '';
  const call = async (method, p, body, extra = {}) => {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(call.team ? { 'X-Team': call.team } : {}), ...extra },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => null) : ct.startsWith('image/') || ct.startsWith('video/') ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, data, type: ct };
  };
  call.team = team;
  return call;
}
const anon = client();
const ok = (r, code = 200) => {
  assert.equal(r.status, code, `${code} expected, got ${r.status}: ${JSON.stringify(r.data)?.slice(0, 300)}`);
  return r.data;
};
const step = (m) => console.log('✓', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- test files ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signage-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  pages.forEach((text, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`);
    const s = `BT /F1 24 Tf 40 90 Td (${text}) Tj ET`;
    objs.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const pdf = makePdf(['Potluck Sabbath', 'Bring a dish']);
const mov = path.join(dir, 'clip.avi');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15', '-c:v', 'mpeg4', mov]);
const form = (files, fields = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  for (const [name, buf, type] of files) f.append('files', new Blob([buf], { type }), name);
  return f;
};

// ---------- a stand-in Anthias ----------
const anthias = { assets: new Map(), files: 0, calls: [], next: 1, order: '' };
const fake = http.createServer((req, res) => {
  let body = [];
  req.on('data', (d) => body.push(d));
  req.on('end', () => {
    body = Buffer.concat(body);
    anthias.calls.push(`${req.method} ${req.url}`);
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(obj === undefined ? '' : JSON.stringify(obj));
    };
    if (req.headers.authorization !== 'Bearer tok123') {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
    const m = req.url.match(/^\/api\/v2\/assets\/([^/?]+)$/);
    if (req.method === 'GET' && req.url === '/api/v2/assets') return send(200, [...anthias.assets.values()]);
    if (req.method === 'POST' && req.url === '/api/v2/file_asset') {
      anthias.files++;
      assert.ok(body.includes('file_upload'), 'uploads the file as file_upload');
      return send(200, { uri: `/data/anthias_assets/f${anthias.files}`, ext: '.bin' });
    }
    if (req.method === 'POST' && req.url === '/api/v2/assets/order') {
      anthias.order = new URLSearchParams(body.toString()).get('ids');
      return send(204);
    }
    if (req.method === 'POST' && req.url === '/api/v2/assets') {
      const j = JSON.parse(body.toString());
      for (const k of ['name', 'uri', 'mimetype', 'start_date', 'end_date', 'duration', 'is_enabled']) assert.ok(j[k] !== undefined, `Anthias needs ${k}`);
      const id = `a${anthias.next++}`;
      anthias.assets.set(id, { asset_id: id, ...j });
      return send(201, anthias.assets.get(id));
    }
    if (m && req.method === 'PATCH') {
      if (!anthias.assets.has(m[1])) return send(404, { error: 'no' });
      Object.assign(anthias.assets.get(m[1]), JSON.parse(body.toString()));
      return send(200, anthias.assets.get(m[1]));
    }
    if (m && req.method === 'DELETE') {
      anthias.assets.delete(m[1]);
      return send(204);
    }
    send(404, { error: 'not here' });
  });
});
await new Promise((r) => fake.listen(4599, '127.0.0.1', r));

// ---------- people ----------
const admin = client('av');
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Grace Church' }), 201);
async function person(name, email, team) {
  const r = ok(await admin('POST', '/api/people', { name, email }), 201);
  const p = client(team);
  ok(await p('POST', `/api/auth/invite/${r.inviteUrl.split('/invite/')[1]}`, { password: 'password123' }));
  return { id: r.person.id, c: p };
}
const ben = await person('Ben', 'ben@example.com', 'av'); // crew
const pia = await person('Pia', 'pia@example.com', 'av');
const adminP = client('praise');
ok(await adminP('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
ok(await adminP('POST', '/api/people', { userId: pia.id }), 201);
pia.c.team = 'praise';
ok(await adminP('PATCH', `/api/people/${pia.id}`, { role: 'leader', perms: { signage: true } }));

ok(await ben.c('GET', '/api/signage'), 403);
assert.equal(ok(await ben.c('GET', '/api/bootstrap')).signage, null, 'crew don’t see the Signage tab');
assert.deepEqual(ok(await pia.c('GET', '/api/bootstrap')).signage, { waiting: 0 }, 'a Praise leader with the Signage privilege does');
// Team leaders manage it unless it's turned off for them; the admin or a head leader can give it to a crew member
const hana = await person('Hana', 'hana@example.com', 'av');
const leo = await person('Leo', 'leo@example.com', 'av');
ok(await admin('PUT', '/api/teams/av/head', { userId: hana.id }));
ok(await hana.c('GET', '/api/signage'), 200);
ok(await hana.c('PATCH', `/api/people/${leo.id}`, { role: 'leader' }));
ok(await leo.c('GET', '/api/signage'), 200);
ok(await hana.c('PATCH', `/api/people/${leo.id}`, { perms: { signage: false } }));
ok(await leo.c('GET', '/api/signage'), 403);
ok(await leo.c('PATCH', `/api/people/${ben.id}`, { perms: { signage: true } }), 403);
ok(await ben.c('PATCH', `/api/people/${ben.id}`, { perms: { signage: true } }), 403);
ok(await ben.c('GET', '/api/signage'), 403);
ok(await hana.c('PATCH', `/api/people/${ben.id}`, { perms: { signage: true, edit: true, people: true } }));
ok(await ben.c('GET', '/api/signage'), 200);
assert.deepEqual(ok(await ben.c('GET', '/api/bootstrap')).signage, { waiting: 0 }, 'a crew member given it sees the Signage tab');
const benView = ok(await hana.c('GET', '/api/bootstrap')).people.find((x) => x.id === ben.id);
assert.equal(benView.role, 'crew', 'still a crew member');
assert.deepEqual(benView.perms, { signage: true }, 'given only signage, not the leader privileges');
ok(await ben.c('POST', '/api/people', { name: 'Zed', email: 'zed@example.com' }), 403);
ok(await hana.c('PATCH', `/api/people/${ben.id}`, { role: 'leader' }));
ok(await hana.c('PATCH', `/api/people/${ben.id}`, { role: 'crew' }));
ok(await ben.c('GET', '/api/signage'), 403);
assert.equal(ok(await ben.c('GET', '/api/bootstrap')).signage, null, 'a leader moved back to crew doesn’t keep it');
let s = ok(await admin('GET', '/api/signage'));
assert.deepEqual(s.assets, []);
step('signage is for the admin, head leaders and team leaders (unless turned off), plus crew members the admin or a head leader gives it to');

// ---------- screens ----------
s = ok(await admin('POST', '/api/signage/screens', { name: 'Lobby' }), 201);
s = ok(await pia.c('POST', '/api/signage/screens', { name: 'Fellowship hall' }), 201);
const [lobby, hall] = s.screens;
assert.equal(lobby.name, 'Lobby');
assert.match(lobby.link, /\/screen\/[A-Za-z0-9_-]{20,}$/);
const lobbyToken = lobby.link.split('/screen/')[1];
const hallToken = hall.link.split('/screen/')[1];
let play = ok(await anon('GET', `/api/screen/${lobbyToken}`));
assert.deepEqual(play.items, []);
assert.equal(play.church, 'Grace Church');
ok(await anon('GET', '/api/screen/notarealtokennotarealtoken'), 404);
step('screens each have their own live link');

// ---------- items ----------
s = ok(await pia.c('POST', '/api/signage/assets', form([['welcome.png', PNG, 'image/png']], { seconds: '8' })), 201);
const welcome = s.assets.find((a) => a.name === 'welcome');
assert.equal(welcome.kind, 'image');
assert.equal(welcome.seconds, 8);
assert.equal(welcome.live, true);
s = ok(await admin('POST', '/api/signage/assets', form([['potluck.pdf', pdf, 'application/pdf']], { screens: [hall.id] })), 201);
s = ok(await admin('POST', '/api/signage/assets', form([['clip.avi', fs.readFileSync(mov), 'video/x-msvideo']])), 201);
ok(await admin('POST', '/api/signage/assets', form([['notes.docx', Buffer.from('x'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']])), 400);
s = ok(await admin('POST', '/api/signage/assets/web', { uri: 'https://example.org/events', name: 'Events page', seconds: 20 }), 201);
ok(await admin('POST', '/api/signage/assets/web', { uri: 'javascript:alert(1)' }), 400);
// Wait for the PDF and video to be prepared
for (let i = 0; i < 60; i++) {
  s = ok(await admin('GET', '/api/signage'));
  if (s.assets.every((a) => a.processing !== 'working')) break;
  await sleep(500);
}
const potluck = s.assets.find((a) => a.name === 'potluck');
const clip = s.assets.find((a) => a.name === 'clip');
assert.equal(potluck.processing, 'ready', potluck.processError);
assert.equal(potluck.pages, 2, 'one picture per PDF page');
assert.equal(clip.processing, 'ready', clip.processError);
assert.equal(clip.mime, 'video/mp4', 'made into an MP4 every screen can play');
assert.equal(clip.videoSeconds, 2);
const vfile = ok(await admin('GET', clip.file));
assert.ok(vfile.length > 1000);
assert.equal(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', '-'], { input: vfile }).toString().trim(), 'h264');
step('pictures, PDFs (a picture per page), videos (made into H.264 MP4) and web pages; Word files are turned away with how to make a PDF');

// ---------- the live player ----------
play = ok(await anon('GET', `/api/screen/${lobbyToken}`));
assert.deepEqual(play.items.map((i) => i.name), ['welcome', 'clip', 'Events page'], 'the lobby doesn’t get the hall-only PDF');
assert.equal(play.items[0].seconds, 8);
assert.equal(play.items[1].kind, 'video');
assert.equal(play.items[1].seconds, 0, 'videos play to the end');
const hallPlay = ok(await anon('GET', `/api/screen/${hallToken}`));
assert.deepEqual(hallPlay.items.map((i) => i.name), ['welcome', 'potluck (page 1)', 'potluck (page 2)', 'clip', 'Events page']);
const img = await anon('GET', hallPlay.items[1].url);
assert.equal(img.type, 'image/png');
ok(await anon('GET', hallPlay.items[1].url.replace(hallToken, lobbyToken)), 404); // the hall's PDF isn't on the lobby
// Turn one off, give one an end in the past, move one later
const v1 = play.v;
s = ok(await admin('PATCH', `/api/signage/assets/${clip.id}`, { enabled: false }));
s = ok(await admin('PATCH', `/api/signage/assets/${welcome.id}`, { startAt: new Date(Date.now() - 3 * 864e5).toISOString(), endAt: new Date(Date.now() - 864e5).toISOString() }));
assert.equal(s.assets.find((a) => a.id === welcome.id).live, false);
ok(await admin('PATCH', `/api/signage/assets/${welcome.id}`, { startAt: new Date(Date.now() + 864e5).toISOString(), endAt: new Date(Date.now()).toISOString() }), 400);
play = ok(await anon('GET', `/api/screen/${lobbyToken}`));
assert.deepEqual(play.items.map((i) => i.name), ['Events page']);
assert.notEqual(play.v, v1, 'the version changes so screens reload');
s = ok(await admin('PATCH', `/api/signage/assets/${welcome.id}`, { startAt: null, endAt: null }));
s = ok(await admin('PATCH', `/api/signage/assets/${clip.id}`, { enabled: true }));
const web = s.assets.find((a) => a.kind === 'web');
s = ok(await admin('POST', '/api/signage/assets/order', { ids: [web.id, clip.id, welcome.id, potluck.id] }));
play = ok(await anon('GET', `/api/screen/${lobbyToken}`));
assert.deepEqual(play.items.map((i) => i.name), ['Events page', 'clip', 'welcome']);
const prev = ok(await admin('GET', `/api/signage/preview?screen=${hall.id}`));
assert.equal(prev.items.length, 5);
step('the live player shows what’s on, in order, on that screen; switched off, ended or not-yet items drop off');

// ---------- what each screen is showing now ----------
let now = ok(await admin('GET', '/api/signage/now'));
let st = now.screens.find((x) => x.id === lobby.id);
assert.equal(st.online, false, 'not checked in yet');
assert.equal(st.lastSeenAt, null);
ok(await ben.c('GET', '/api/signage/now'), 403);
ok(await anon('POST', `/api/screen/${lobbyToken}/now`, { player: 'x y', item: null }), 400);
ok(await anon('POST', '/api/screen/notarealtokennotarealtoken/now', { player: 'tv-lobby-1' }), 404);
const [first, second] = play.items;
ok(await anon('POST', `/api/screen/${lobbyToken}/now`, { player: 'tv-lobby-1', v: play.v, count: play.items.length, item: first, elapsed: 4, length: 20, next: second, w: 1920, h: 1080 }), 204);
ok(await anon('POST', `/api/screen/${lobbyToken}/now`, { player: 'tv-lobby-2', v: 'old', item: second, elapsed: 1, length: 2 }), 204);
now = ok(await pia.c('GET', '/api/signage/now'));
st = now.screens.find((x) => x.id === lobby.id);
assert.equal(st.online, true);
assert.ok(st.lastSeenAt);
assert.equal(st.players.length, 2, 'two TVs on one link show as two');
const tv1 = st.players.find((p) => p.player === 'tv-lobby-1');
assert.equal(tv1.item.name, 'Events page');
assert.equal(tv1.next.name, 'clip');
assert.equal(tv1.current, true, 'on the latest playlist');
assert.equal(tv1.size, '1920×1080');
assert.ok(Math.abs(now.serverNow - 4000 - tv1.startedAt) < 3000, 'when the item started, so the tab can count down and mirror it');
assert.equal(st.players.find((p) => p.player === 'tv-lobby-2').current, false, 'an old playlist shows as not caught up');
assert.equal(now.screens.find((x) => x.id === hall.id).online, false, 'other screens stay offline');
step('live-link screens check in with what they’re showing, how far in, what’s next, and whether they have the latest playlist');

// ---------- upload links ----------
s = ok(await admin('POST', '/api/signage/links', { label: 'Youth group', lasts: 'off' }), 201);
s = ok(await admin('POST', '/api/signage/links', { label: 'VBS week', lasts: '4h' }), 201);
ok(await admin('POST', '/api/signage/links', { lasts: 'forever' }), 400);
const youth = s.links.find((l) => l.label === 'Youth group');
const vbs = s.links.find((l) => l.label === 'VBS week');
assert.equal(youth.expiresAt, null);
assert.ok(new Date(vbs.expiresAt) - Date.now() > 3.9 * 3600e3);
const yt = youth.url.split('/send/')[1];
const info = ok(await anon('GET', `/api/send/${yt}`));
assert.equal(info.church, 'Grace Church');
ok(await anon('POST', `/api/send/${yt}`, form([['flyer.png', PNG, 'image/png']], {})), 400); // no name
ok(await anon('POST', `/api/send/${yt}`, form([['flyer.png', PNG, 'image/png'], ['notes.docx', Buffer.from('x'), 'application/msword']], { name: 'Tess' })), 400);
const sent = ok(await anon('POST', `/api/send/${yt}`, form([['flyer.png', PNG, 'image/png']], { name: 'Tess Youth', email: 'Tess@Example.com', note: 'Youth lock-in, Dec 12', endDate: '2026-12-12' })), 201);
assert.equal(sent.count, 1);
assert.deepEqual(ok(await admin('GET', '/api/bootstrap')).signage, { waiting: 1 });
s = ok(await admin('GET', '/api/signage'));
const flyer = s.assets.find((a) => a.status === 'pending');
assert.deepEqual(flyer.from, { name: 'Tess Youth', email: 'tess@example.com', note: 'Youth lock-in, Dec 12' });
assert.ok(flyer.endAt.startsWith('2026-12-1'), 'shows through the day they asked for');
assert.ok(!ok(await anon('GET', `/api/screen/${lobbyToken}`)).items.some((i) => i.name === 'flyer'), 'waits for approval');
s = ok(await pia.c('POST', `/api/signage/assets/${flyer.id}/approve`, { screens: [lobby.id] }));
assert.equal(s.assets.find((a) => a.id === flyer.id).status, 'approved');
assert.ok(ok(await anon('GET', `/api/screen/${lobbyToken}`)).items.some((i) => i.name === 'flyer'));
assert.ok(!ok(await anon('GET', `/api/screen/${hallToken}`)).items.some((i) => i.name === 'flyer'), 'only on the screen picked');
ok(await anon('POST', `/api/send/${yt}`, form([['spam.png', PNG, 'image/png']], { name: 'Bot', website: 'http://spam' })), 201); // the hidden box: pretend
assert.equal(ok(await admin('GET', '/api/bootstrap')).signage.waiting, 0, 'nothing from bots');
ok(await anon('POST', `/api/send/${yt}`, form([['second.png', PNG, 'image/png']], { name: 'Tess Youth' })), 201);
s = ok(await admin('GET', '/api/signage'));
s = ok(await admin('POST', `/api/signage/assets/${s.assets.find((a) => a.status === 'pending').id}/decline`));
assert.ok(!s.assets.some((a) => a.status === 'pending'));
s = ok(await admin('PATCH', `/api/signage/links/${youth.id}`, { on: false }));
ok(await anon('GET', `/api/send/${yt}`), 410);
if (process.env.MONGO_URL) {
  const { MongoClient } = await import('mongodb');
  const db = new MongoClient(process.env.MONGO_URL);
  await db.connect();
  await db.db().collection('signagelinks').updateOne({ label: 'VBS week' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await db.close();
  ok(await anon('GET', `/api/send/${vbs.url.split('/send/')[1]}`), 410);
}
step('upload links: until turned off or for a set time; uploads wait for approval and show on the screens picked; bots and Word files turned away');

// ---------- service plans both ways ----------
const iso = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const svc = ok(await admin('POST', '/api/events', { date: iso(5), title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: [] }), 201);
const fd = new FormData();
fd.append('files', new Blob([PNG], { type: 'image/png' }), 'sermon-art.png');
ok(await admin('POST', `/api/plans/${svc.id}/media`, fd), 201);
const pm = ok(await admin('GET', '/api/signage/plan-media'));
const fromPlan = pm.plans.find((p) => p.eventId === svc.id);
assert.equal(fromPlan.media[0].title, 'sermon-art.png');
s = ok(await admin('POST', '/api/signage/assets/from-media', { mediaId: fromPlan.media[0].id, screens: [hall.id] }), 201);
const art = s.assets.find((a) => a.name === 'sermon-art');
assert.equal(art.fromPlan, true);
assert.deepEqual(art.screens, [hall.id]);
ok(await admin('POST', `/api/signage/assets/${potluck.id}/to-plan`, { eventId: svc.id }));
const planMedia = ok(await admin('GET', `/api/plans/${svc.id}`)).media.map((m) => m.title);
assert.ok(planMedia.includes('potluck'), 'a screens item copied into the plan');
step('service plan media goes on the screens, and screen items go into a service plan');

// ---------- sending to Anthias ----------
s = ok(await admin('PATCH', `/api/signage/screens/${hall.id}`, { mode: 'anthias', anthias: { url: 'http://127.0.0.1:4599', auth: 'token', secret: 'wrong' } }));
let t = ok(await admin('POST', `/api/signage/screens/${hall.id}/test`));
assert.equal(t.ok, false);
assert.match(t.error, /sign-in/);
s = ok(await admin('PATCH', `/api/signage/screens/${hall.id}`, { anthias: { secret: 'tok123' } }));
assert.equal(s.screens.find((x) => x.id === hall.id).anthias.hasSecret, true);
assert.ok(!JSON.stringify(s).includes('tok123'), 'the token never comes back');
t = ok(await admin('POST', `/api/signage/screens/${hall.id}/test`));
assert.deepEqual(t, { ok: true, total: 0, ours: 0 });
let r = ok(await admin('POST', `/api/signage/screens/${hall.id}/sync`));
assert.equal(r.ok, true, r.error);
const names = () => [...anthias.assets.values()].map((a) => a.name).sort();
assert.deepEqual(names(), ['Crew Call · Events page', 'Crew Call · clip', 'Crew Call · potluck (page 1)', 'Crew Call · potluck (page 2)', 'Crew Call · sermon-art', 'Crew Call · welcome']);
assert.equal(anthias.files, 5, 'files uploaded once each (web pages aren’t files)');
const byName = (n) => [...anthias.assets.values()].find((a) => a.name === `Crew Call · ${n}`);
assert.equal(byName('Events page').mimetype, 'webpage');
assert.equal(byName('clip').mimetype, 'video');
assert.equal(byName('clip').duration, 2, 'videos run their length');
assert.equal(byName('welcome').duration, 8);
assert.equal(anthias.order.split(',').length, 6, 'and in Crew Call’s order');
// Change details, switch one off, delete one, move one off this screen
const before = anthias.files;
ok(await admin('PATCH', `/api/signage/assets/${welcome.id}`, { name: 'Welcome!', seconds: 12 }));
ok(await admin('PATCH', `/api/signage/assets/${web.id}`, { enabled: false }));
ok(await admin('DELETE', `/api/signage/assets/${clip.id}`));
ok(await admin('PATCH', `/api/signage/assets/${art.id}`, { screens: [lobby.id] }));
r = ok(await admin('POST', `/api/signage/screens/${hall.id}/sync`));
assert.equal(r.ok, true, r.error);
assert.deepEqual(names(), ['Crew Call · Events page', 'Crew Call · Welcome!', 'Crew Call · potluck (page 1)', 'Crew Call · potluck (page 2)']);
assert.equal(byName('Welcome!').duration, 12);
assert.equal(byName('Events page').is_enabled, 0, 'switched off in Anthias too');
assert.equal(anthias.files, before, 'details changed without uploading again');
// Nothing changed: nothing sent
const n = anthias.calls.length;
ok(await admin('POST', `/api/signage/screens/${hall.id}/sync`));
assert.ok(anthias.calls.slice(n).every((c) => c.startsWith('POST /api/v2/assets/order') || c.startsWith('DELETE')), anthias.calls.slice(n).join(', '));
// Changes are sent by themselves a few seconds later
ok(await admin('PATCH', `/api/signage/assets/${web.id}`, { enabled: true }));
await sleep(6000);
assert.equal(byName('Events page').is_enabled, 1, 'sent automatically');
// Can't reach it: says so
ok(await admin('PATCH', `/api/signage/screens/${hall.id}`, { anthias: { url: 'http://127.0.0.1:4598' } }));
r = ok(await admin('POST', `/api/signage/screens/${hall.id}/sync`));
assert.equal(r.ok, false);
assert.match(r.error, /same network/);
assert.match(r.screens.find((x) => x.id === hall.id).anthias.lastError, /same network/);
step('Crew Call sends a screen’s playlist into Anthias: adds, updates, switches off, removes and orders only its own items; says plainly when it can’t reach it');

// ---------- removing a screen ----------
s = ok(await admin('DELETE', `/api/signage/screens/${hall.id}`));
assert.equal(s.assets.find((a) => a.id === potluck.id).enabled, false, 'items only for that screen are switched off, not sent everywhere');
ok(await anon('GET', `/api/screen/${hallToken}`), 404);
step('removing a screen switches off what was only for it');

fake.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('\nAll signage checks passed.');
