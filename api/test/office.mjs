// Church Admin: committees and privacy, the office calendar (repeats, sharing with every team,
// rooms, Needs AV), meetings (agenda, minutes, motions), goals, action items, documents, event
// requests, the yearly rhythm, the agenda overview and sign-in help. Against a running API with an
// EMPTY database and SMTP_URL=json:
//   BASE_URL=http://localhost:4000 node test/office.mjs
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
    return { status: res.status, data, headers: res.headers };
  };
  const call = (method, p, body) => send(method, p, body, false);
  call.team = team;
  call.form = (p, fields, file) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append('file', new Blob([file.bytes], { type: file.type }), file.name);
    return send('POST', p, fd, true);
  };
  return call;
}
const ok = (r, code = 200) => {
  assert.equal(r.status, code, `${code} expected, got ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const step = (msg) => console.log('✓', msg);
const iso = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const unfold = (ics) => String(ics).replace(/\r\n /g, '');
const nextWeekday = (wd, after = 1) => {
  for (let n = after; n < after + 8; n++) if (new Date(iso(n) + 'T12:00:00').getDay() === wd) return iso(n);
};

// ---------- setup ----------
const admin = client('av');
ok(await admin('POST', '/api/auth/setup', { name: 'Hub M.', email: 'admin@example.com', password: 'adminpass1', orgName: 'Test Church' }), 201);
let boot = ok(await admin('GET', '/api/bootstrap'));
const officeTeam = boot.allTeams.find((t) => t.kind === 'office');
assert.ok(officeTeam, 'a Church Admin team out of the box');
assert.equal(officeTeam.name, 'Church Admin');
const O = officeTeam.key;
const adminO = client(O);
ok(await adminO('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
let bootO = ok(await adminO('GET', '/api/bootstrap'));
assert.equal(bootO.team.kind, 'office');
assert.deepEqual(bootO.committees.map((c) => c.key), ['board', 'finance', 'nominating']);
assert.deepEqual(bootO.office.rooms.map((r) => r.name), ['Sanctuary', 'Fellowship hall', 'Board room']);
step('a Church Admin team with Church Board, Finance and Nominating committees and rooms');

async function invite(c, name, email) {
  const r = ok(await c('POST', '/api/people', { name, email, phone: '4235550' + String(100 + Math.floor(Math.random() * 800)) }), 201);
  return { id: r.person.id, token: r.inviteUrl?.split('/invite/')[1] };
}
async function signIn(p, team) {
  const c = client(team);
  ok(await c('POST', `/api/auth/invite/${p.token}`, { password: 'password123' }));
  return c;
}
// The admin starts the team with its head leader; after that only Church Admin's own leaders add people
const olivia = await invite(adminO, 'Olivia', 'olivia@example.com');
ok(await admin('PUT', `/api/teams/${O}/head`, { userId: olivia.id }));
const oliviaC = await signIn(olivia, O);
ok(await adminO('POST', '/api/people', { name: 'Nope', email: 'nope@example.com' }), 403);
const lee = await invite(oliviaC, 'Lee', 'lee@example.com');
const sam = await invite(oliviaC, 'Sam', 'sam@example.com');
const bea = await invite(oliviaC, 'Bea', 'bea@example.com');
const fred = await invite(oliviaC, 'Fred', 'fred@example.com');
const ben = await invite(admin, 'Ben', 'ben@example.com');
const leeC = await signIn(lee, O);
const samC = await signIn(sam, O);
let beaC = await signIn(bea, O);
const fredC = await signIn(fred, O);
const benC = await signIn(ben, 'av');

// Committees and offices
ok(await oliviaC('PATCH', '/api/office/committees/board', { members: [lee.id, sam.id, bea.id], quorum: 3 }));
ok(await oliviaC('PATCH', `/api/people/${fred.id}`, { committees: ['finance'] }));
const termSoon = iso(30);
ok(await oliviaC('PATCH', `/api/people/${sam.id}`, { offices: [{ committee: 'board', role: 'Secretary', termEnds: termSoon }] }));
ok(await oliviaC('PATCH', `/api/people/${lee.id}`, { role: 'leader', leaderTitle: 'Board chair', perms: { edit: true, plans: true, approve: true } }));
ok(await samC('PATCH', `/api/people/${bea.id}`, { committees: ['finance'] }), 403);
const comms = ok(await oliviaC('GET', '/api/office/committees'));
assert.deepEqual(comms.find((c) => c.key === 'board').members.map((m) => m.name).sort(), ['Bea', 'Lee', 'Sam']);
assert.equal(comms.find((c) => c.key === 'board').quorum, 3);
const samBoot = ok(await samC('GET', '/api/bootstrap'));
assert.deepEqual(samBoot.me.offices, [{ committee: 'board', role: 'Secretary', termEnds: termSoon }]);
step('the head leader sets committee members, quorums, offices with terms, and leaders');

// ---------- privacy: Church Admin people don't see the service side ----------
const oBoot = ok(await oliviaC('GET', '/api/bootstrap'));
assert.equal(oBoot.serviceSide, false);
assert.equal(oBoot.academy, null);
assert.deepEqual(oBoot.teams.map((t) => t.key), [O]);
for (const p of ['/api/events', '/api/plans', '/api/weekend/check', '/api/requests']) ok(await oliviaC('GET', p), 403);
ok(await benC('GET', '/api/office/events'), 403);
step('people only on Church Admin don’t see services, plans, line-ups or the Academy; AV can’t open Church Admin');

// ---------- the calendar ----------
const tue = nextWeekday(2, 3);
const until = iso(200);
const board = ok(await leeC('POST', '/api/office/events', { title: 'Church board', type: 'board', date: tue, start: '19:00', end: '20:30', room: 'Board room', committees: ['board'], repeat: { freq: 'monthly-nth', until } }), 201);
assert.match(board.repeat, /Tuesday of every month/);
let leeEvents = ok(await leeC('GET', `/api/office/events?from=${iso(0)}&to=${until}`)).filter((e) => e.title === 'Church board');
assert.ok(leeEvents.length >= 6 && leeEvents.length <= 8, `monthly dates: ${leeEvents.length}`);
assert.ok(leeEvents.every((e) => new Date(e.date + 'T12:00:00').getDay() === 2), 'every one on a Tuesday');
ok(await leeC('POST', '/api/office/events', { title: 'Budget', type: 'committee', date: iso(5), start: '18:00', committees: ['finance'] }), 403);
ok(await samC('POST', '/api/office/events', { title: 'Mine', date: iso(5), start: '18:00' }), 403);
// Finance can't see the board's meetings; the board can
assert.equal(ok(await fredC('GET', `/api/office/events?from=${iso(0)}&to=${until}`)).filter((e) => e.title === 'Church board').length, 0);
ok(await fredC('GET', `/api/office/events/${board.id}`), 403);
assert.ok(ok(await beaC('GET', `/api/office/events?from=${iso(0)}&to=${until}`)).some((e) => e.id === board.id));
// Passed down to Finance: they see it, read-only
const shared = ok(await leeC('POST', '/api/office/events', { title: 'Budget review', type: 'committee', date: iso(9), start: '18:00', committees: ['board'], sharedWith: ['finance'] }), 201);
const fredShared = ok(await fredC('GET', `/api/office/events/${shared.id}`));
assert.equal(fredShared.canEdit, false);
// A joint meeting of two committees, made by the head
const joint = ok(await oliviaC('POST', '/api/office/events', { title: 'Joint board & finance', type: 'committee', date: iso(11), start: '18:00', committees: ['board', 'finance'] }), 201);
assert.ok(ok(await fredC('GET', `/api/office/events/${joint.id}`)));
step('calendar: repeats (2nd Tuesday monthly), committee privacy, joint meetings and passing items down');

// Edit this one or every later date; remove from here on
const third = leeEvents[2];
ok(await leeC('PATCH', `/api/office/events/${third.id}?scope=future`, { title: 'Church board (new room)', room: 'Fellowship hall' }));
leeEvents = ok(await leeC('GET', `/api/office/events?from=${iso(0)}&to=${until}`)).filter((e) => e.series === board.series).sort((a, b) => a.date.localeCompare(b.date));
assert.equal(leeEvents[1].title, 'Church board');
assert.ok(leeEvents.slice(2).every((e) => e.title === 'Church board (new room)' && e.room === 'Fellowship hall'));
ok(await leeC('PATCH', `/api/office/events/${leeEvents[0].id}`, { start: '18:30' }));
ok(await beaC('PATCH', `/api/office/events/${leeEvents[0].id}`, { title: 'x' }), 403);
ok(await leeC('DELETE', `/api/office/events/${leeEvents[5].id}?scope=future`), 204);
const left = ok(await leeC('GET', `/api/office/events?from=${iso(0)}&to=${iso(400)}`)).filter((e) => e.series === board.series);
assert.equal(left.length, 5, 'removed from the 6th date on');
// RSVP and quorum
ok(await beaC('PUT', `/api/office/events/${board.id}/rsvp`, { status: 'yes' }));
ok(await samC('PUT', `/api/office/events/${board.id}/rsvp`, { status: 'no' }));
const full = ok(await leeC('GET', `/api/office/events/${board.id}`));
assert.equal(full.quorum, 3);
assert.deepEqual(full.rsvps, { yes: 1, no: 1, maybe: 0 });
assert.equal(full.audience.find((a) => a.name === 'Bea').rsvp, 'yes');
step('calendar: change one date or all later ones, remove from a date on, RSVPs against the quorum');

// Shared with every team
const biz = ok(await oliviaC('POST', '/api/office/events', { title: 'Church business meeting', type: 'business', date: iso(12), start: '14:00', end: '16:00', room: 'Sanctuary', visibility: 'everyone' }), 201);
const benShared = ok(await benC('GET', `/api/office/shared?from=${iso(0)}&to=${iso(60)}`));
assert.ok(benShared.some((e) => e.id === biz.id), 'AV sees church events shared with every team');
assert.ok(!benShared.some((e) => e.id === board.id), 'but not board meetings');
const icsOf = async (c) => unfold((await c('GET', new URL(ok(await c('GET', '/api/bootstrap')).me.calUrl).pathname)).data);
let benIcs = await icsOf(benC);
assert.match(benIcs, /Church business meeting/);
assert.doesNotMatch(benIcs, /Church board/);
// An AV service doesn't show on Church Admin calendars
const sat = nextWeekday(6, 2);
const svc = ok(await admin('POST', '/api/events', { date: sat, title: 'Worship Service', call: '10:15', start: '11:00', end: '12:30', needs: ['foh'] }), 201);
const beaIcs = await icsOf(beaC);
assert.doesNotMatch(beaIcs, /Worship Service/, 'no services on a Church Admin-only calendar');
assert.match(beaIcs, /Church board/);
assert.match(beaIcs, /LOCATION:Board room/);
assert.match(beaIcs, /TRIGGER:-PT60M/, 'meeting reminders for people invited');
const fredIcs = await icsOf(fredC);
assert.doesNotMatch(fredIcs, /SUMMARY:Church board/, 'Finance doesn’t get the board’s meetings');
assert.match(fredIcs, /Budget review/);
step('one calendar: Church Admin items by committee, church events shared with AV and Praise, no services for Church Admin');

// Rooms: services use the Sanctuary
let check = ok(await oliviaC('GET', `/api/office/rooms/check?date=${sat}&start=10:00&end=11:30&room=Sanctuary`));
assert.deepEqual(check.conflicts.map((c) => c.what), ['Service']);
check = ok(await fredC('GET', `/api/office/rooms/check?date=${tue}&start=19:30&end=20:00&room=Board%20room`));
assert.deepEqual(check.conflicts.map((c) => c.what), ['Booked'], 'other committees’ bookings show as Booked');
assert.equal(ok(await oliviaC('GET', `/api/office/rooms/check?date=${sat}&start=14:00&end=15:00&room=Sanctuary`)).conflicts.length, 0);
step('room check: services and other bookings, without details people can’t see');

// Needs AV: a matching spot on the AV schedule
const av = ok(await oliviaC('POST', '/api/office/events', { title: 'Members’ forum', type: 'event', date: iso(15), start: '18:00', end: '19:30', room: 'Sanctuary', visibility: 'everyone', needsAv: true, avNote: 'Two handheld mics' }), 201);
let avEv = ok(await admin('GET', `/api/events?from=${iso(15)}&to=${iso(15)}`)).find((e) => e.title === 'Members’ forum');
assert.ok(avEv, 'it appears on the AV schedule');
assert.equal(avEv.call, '17:30');
assert.match(avEv.notes, /Two handheld mics/);
ok(await oliviaC('PATCH', `/api/office/events/${av.id}`, { start: '18:30', end: '20:00' }));
avEv = ok(await admin('GET', `/api/events?from=${iso(15)}&to=${iso(15)}`)).find((e) => e.title === 'Members’ forum');
assert.equal(avEv.start, '18:30');
ok(await oliviaC('PATCH', `/api/office/events/${av.id}`, { needsAv: false }));
assert.ok(!ok(await admin('GET', `/api/events?from=${iso(15)}&to=${iso(15)}`)).some((e) => e.title === 'Members’ forum'));
ok(await oliviaC('POST', '/api/office/events', { title: 'x', date: iso(16), allDay: true, needsAv: true }), 400);
benIcs = await icsOf(benC);
step('Needs AV: the event shows on the AV schedule and follows changes');

// ---------- sign-in help ----------
ok(await samC('POST', `/api/people/${bea.id}/reset-link`), 403);
const link = ok(await oliviaC('POST', `/api/people/${lee.id}/reset-link`));
assert.match(link.url, /\/reset\/[A-Za-z0-9_-]+$/);
assert.equal(link.hours, 24);
ok(await oliviaC('POST', `/api/people/${ben.id}/reset-link`), 404);
const adminId = ok(await admin('GET', '/api/bootstrap')).me.id;
ok(await oliviaC('POST', `/api/people/${adminId}/reset-link`), 403);
// Forgot password by email
ok(await client()('POST', '/api/auth/forgot', { email: 'nobody@example.com' }));
ok(await client()('POST', '/api/auth/forgot', { email: 'BEA@example.com' }));
const mails = ok(await client()('GET', '/api/auth/test-mail'));
const mail = mails.filter((m) => m.to === 'bea@example.com' && /Reset/.test(m.subject)).pop();
assert.ok(mail, 'a reset email to Bea');
assert.equal(mails.filter((m) => m.to === 'nobody@example.com').length, 0);
const resetToken = mail.text.match(/\/reset\/([A-Za-z0-9_-]+)/)[1];
assert.equal(ok(await client()('GET', `/api/auth/reset/${resetToken}`)).name, 'Bea');
const beaNew = client(O);
ok(await beaNew('POST', `/api/auth/reset/${resetToken}`, { password: 'short' }), 400);
ok(await beaNew('POST', `/api/auth/reset/${resetToken}`, { password: 'brandnewpass1' }));
ok(await beaC('GET', '/api/bootstrap'), 401);
beaC = beaNew;
ok(await client()('GET', `/api/auth/reset/${resetToken}`), 404);
ok(await client()('POST', '/api/auth/login', { email: 'bea@example.com', password: 'brandnewpass1' }));
step('sign-in help: “Forgot password?” emails a one-hour link; leaders make 24-hour links for their team; never for the admin');

// ---------- meetings: agenda, minutes, motions, action items ----------
ok(await beaC('PUT', `/api/office/events/${board.id}/agenda`, { agenda: [{ title: 'x' }] }), 403);
let mtg = ok(await leeC('PUT', `/api/office/events/${board.id}/agenda`, { agenda: [{ kind: 'heading', title: 'Opening' }, { title: 'Prayer', presenter: 'Pastor Jo', minutes: 5 }, { title: 'Roof repair bids', presenter: 'Fred', minutes: 20, notes: 'Three bids' }] }));
assert.equal(mtg.agendaItems, 2);
const sent = ok(await leeC('POST', `/api/office/events/${board.id}/send-agenda`));
assert.equal(sent.sent, 3, 'the board’s members get the agenda by email');
assert.ok(ok(await client()('GET', '/api/auth/test-mail')).some((m) => m.to === 'sam@example.com' && /Agenda: Church board/.test(m.subject) && /Roof repair bids — Fred/.test(m.text)));
// Minutes: the secretary by default
ok(await beaC('PUT', `/api/office/events/${board.id}/minutes`, { minutes: 'x' }), 403);
mtg = ok(await samC('PUT', `/api/office/events/${board.id}/minutes`, { minutes: 'Opened with prayer.', present: [lee.id, sam.id, bea.id] }));
assert.equal(mtg.canMinutes, true);
assert.equal(mtg.minutesStatus, 'draft');
// The secretary is away: a leader opens the minutes to anyone in the meeting
ok(await samC('POST', `/api/office/events/${board.id}/minutes-open`, { open: true }), 403);
ok(await leeC('POST', `/api/office/events/${board.id}/minutes-open`, { open: true }));
ok(await beaC('PUT', `/api/office/events/${board.id}/minutes`, { minutes: 'Opened with prayer. Discussed the roof.' }));
ok(await fredC('PUT', `/api/office/events/${board.id}/minutes`, { minutes: 'x' }), 403);
mtg = ok(await samC('POST', `/api/office/events/${board.id}/motions`, { text: 'Accept the Smith roofing bid of $18,400', movedBy: 'Lee', secondedBy: 'Bea', result: 'passed', votesFor: 3 }), 201);
assert.equal(mtg.motions[0].result, 'passed');
const act = ok(await samC('POST', '/api/office/actions', { meeting: board.id, title: 'Sign the roofing contract', owner: bea.id, due: iso(-2) }), 201);
ok(await fredC('POST', '/api/office/actions', { meeting: board.id, title: 'x' }), 403);
step('meetings: agenda emailed to the committee; the secretary takes minutes; a leader can open them to anyone; motions and action items');

// ---------- meeting by WhatsApp call, and the live meeting page ----------
ok(await beaC('PUT', `/api/office/events/${board.id}/call`, { link: 'https://call.whatsapp.com/video/AbC123' }), 403);
ok(await leeC('PUT', `/api/office/events/${board.id}/call`, { link: 'http://call.whatsapp.com/video/AbC123' }), 400);
ok(await leeC('PUT', `/api/office/events/${board.id}/call`, { link: 'https://example.com/phish' }), 400);
mtg = ok(await leeC('PUT', `/api/office/events/${board.id}/call`, { link: 'https://call.whatsapp.com/video/AbC123' }));
assert.equal(mtg.callLink, 'https://call.whatsapp.com/video/AbC123');
assert.equal(ok(await beaC('GET', `/api/office/events/${board.id}`)).callLink, mtg.callLink, 'everyone in the meeting gets the Join button');
assert.equal(ok(await beaC('GET', '/api/office/mine')).events.find((e) => e.id === board.id).callLink, mtg.callLink);
ok(await leeC('POST', `/api/office/events/${board.id}/send-agenda`));
assert.ok(ok(await client()('GET', '/api/auth/test-mail')).some((m) => m.to === 'sam@example.com' && m.text.includes('Join the call: https://call.whatsapp.com/video/AbC123')), 'the agenda email has the call link');
// Who has it open, and what they're writing
let live = ok(await samC('GET', `/api/office/events/${board.id}/live`));
assert.deepEqual(live.here.map((p) => p.name), ['Sam']);
ok(await beaC('GET', `/api/office/events/${board.id}/live?writing=minutes`));
live = ok(await samC('GET', `/api/office/events/${board.id}/live`));
assert.deepEqual(live.here.map((p) => [p.name, p.writing]).sort(), [['Bea', 'minutes'], ['Sam', '']]);
assert.notEqual((await fredC('GET', `/api/office/events/${board.id}/live`)).status, 200, 'only people in the meeting');
// Any change gives a new version, so open pages reload
const v1 = live.v;
ok(await beaC('PUT', `/api/office/events/${board.id}/minutes`, { minutes: 'Opened with prayer. Discussed the roof. Bids reviewed.' }));
assert.notEqual(ok(await samC('GET', `/api/office/events/${board.id}/live`)).v, v1, 'minutes changed');
// Now discussing: whoever runs the meeting or takes the minutes moves it along
const items = mtg.agenda.filter((x) => x.kind === 'item');
assert.notEqual((await fredC('PUT', `/api/office/events/${board.id}/live`, { item: items[0].id })).status, 200);
ok(await leeC('PUT', `/api/office/events/${board.id}/live`, { item: '000000000000000000000000' }), 400);
mtg = ok(await leeC('PUT', `/api/office/events/${board.id}/live`, { item: items[1].id }));
assert.equal(mtg.liveItem, items[1].id);
assert.equal(ok(await beaC('GET', `/api/office/events/${board.id}/live`)).liveItem, items[1].id, 'everyone sees which item');
mtg = ok(await leeC('PUT', `/api/office/events/${board.id}/agenda`, { agenda: mtg.agenda.map((x) => ({ ...x, minutes: x.minutes + 1 })) }));
assert.equal(mtg.agenda.find((x) => x.id === mtg.liveItem)?.title, 'Roof repair bids', 'editing the agenda keeps the item being discussed');
assert.equal(ok(await beaC('PUT', `/api/office/events/${board.id}/live`, { item: null })).liveItem, null, 'the minute-taker can move it too');
const feedText = JSON.stringify(ok(await adminO('GET', '/api/activity/feed?limit=100')));
assert.ok(!feedText.includes('Roof repair bids'), 'the activity log never names a confidential item');
step('meetings: a WhatsApp call link with a Join button (and in the agenda email); the live page shows who’s here, what they’re writing and the item being discussed');

// Agenda overview: what needs attention
let ov = ok(await leeC('GET', '/api/office/overview?zoom=month'));
assert.ok(ov.attention.overdue.some((a) => a.id === act.id), 'overdue action items');
assert.ok(ov.attention.terms.some((t) => t.person === 'Sam' && t.role === 'Secretary'), 'terms ending soon');
assert.ok(ov.attention.noAgenda.some((x) => x.id === shared.id) || ov.attention.noAgenda.length > 0, 'meetings soon without an agenda');
const beaMine = ok(await beaC('GET', '/api/office/mine'));
assert.ok(beaMine.actions.some((a) => a.id === act.id));
assert.ok(beaMine.events.some((e) => e.id === board.id));
assert.ok(!beaMine.events.some((e) => e.id === joint.id && false));
ok(await beaC('PATCH', `/api/office/actions/${act.id}`, { done: true }));
ok(await beaC('PATCH', `/api/office/actions/${act.id}`, { title: 'Renamed' }), 403);
ov = ok(await leeC('GET', '/api/office/overview?zoom=month'));
assert.ok(!ov.attention.overdue.some((a) => a.id === act.id));
// Approving the minutes locks them
mtg = ok(await leeC('POST', `/api/office/events/${board.id}/minutes-approve`));
assert.equal(mtg.minutesStatus, 'approved');
ok(await samC('PUT', `/api/office/events/${board.id}/minutes`, { minutes: 'changed' }), 403);
ok(await samC('POST', `/api/office/events/${board.id}/motions`, { text: 'late' }), 403);
// Votes on record
const votes = ok(await beaC('GET', '/api/office/motions?q=roof'));
assert.equal(votes.length, 1);
assert.equal(votes[0].meeting.approved, true);
assert.equal(ok(await fredC('GET', '/api/office/motions?q=roof')).length, 0, 'Finance can’t see the board’s votes');
step('action items tick off; minutes approve and lock; votes on record are searchable');

// ---------- goals ----------
const goal = ok(await leeC('POST', '/api/office/goals', { title: 'Replace the sanctuary roof', committees: ['board'], due: iso(500), status: 'on-track', milestones: [{ title: 'Pick a contractor', due: iso(20), owner: bea.id }, { title: 'Raise funds', due: iso(300) }] }), 201);
assert.equal(goal.progress, 0);
ok(await beaC('POST', '/api/office/goals', { title: 'x' }), 403);
let g2 = ok(await beaC('PATCH', `/api/office/goals/${goal.id}`, { milestones: [{ id: goal.milestones[0].id, done: true }] }));
assert.equal(g2.progress, 50, 'a milestone’s owner ticks it off');
assert.equal(g2.milestones.length, 2);
assert.equal(ok(await fredC('GET', '/api/office/goals')).length, 0);
ok(await leeC('PATCH', `/api/office/goals/${goal.id}`, { sharedWith: ['finance'] }));
assert.equal(ok(await fredC('GET', '/api/office/goals')).length, 1, 'passed down to Finance');
ov = ok(await leeC('GET', `/api/office/overview?zoom=3y`));
assert.ok(ov.goals.some((x) => x.id === goal.id), 'the 3-year view shows the goal');
assert.ok(ov.events.length >= 1);
const q = ok(await leeC('GET', '/api/office/overview?zoom=quarter'));
assert.ok(q.from.endsWith('-01') && q.to > q.from);
step('goals: milestones, owners tick them off, progress, privacy, the 3-year and quarter views');

// ---------- documents ----------
const doc = ok(await oliviaC.form('/api/office/docs', { title: 'Church bylaws', category: 'Bylaws', committees: 'board' }, { name: 'bylaws.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 test') }), 201);
ok(await samC.form('/api/office/docs', { title: 'x', url: 'https://example.com' }), 403);
const linkDoc = ok(await oliviaC.form('/api/office/docs', { title: 'Giving policy', category: 'Policies', url: 'example.com/giving' }), 201);
assert.equal(linkDoc.url, 'https://example.com/giving');
const beaDocs = ok(await beaC('GET', '/api/office/docs'));
assert.deepEqual(beaDocs.docs.map((d) => d.title).sort(), ['Church bylaws', 'Giving policy']);
assert.ok(beaDocs.minutes.some((m) => m.id === board.id), 'approved minutes are in the library');
assert.deepEqual(ok(await fredC('GET', '/api/office/docs')).docs.map((d) => d.title), ['Giving policy'], 'board-only documents stay with the board');
const file = await beaC('GET', `/api/office/docs/${doc.id}/file`);
assert.equal(file.status, 200);
assert.match(String(file.data), /%PDF/);
ok(await fredC('GET', `/api/office/docs/${doc.id}/file`), 404);
step('documents: files and links, board-only, approved minutes listed with them');

// ---------- event requests from anyone ----------
const reqd = ok(await benC('POST', '/api/office/requests', { title: 'Youth movie night', date: iso(20), start: '19:00', end: '21:00', room: 'Fellowship hall', needsAv: true, notes: 'Projector please' }), 201);
assert.equal(reqd.status, 'pending');
ok(await samC('GET', '/api/office/requests'), 403);
const reqs = ok(await oliviaC('GET', '/api/office/requests'));
assert.equal(reqs[0].requestedBy, 'Ben');
const approved = ok(await oliviaC('POST', `/api/office/requests/${reqd.id}/approve`, { reply: 'Approved — enjoy!' }));
assert.equal(approved.status, 'approved');
assert.equal(ok(await benC('GET', '/api/office/requests/mine'))[0].status, 'approved');
assert.ok(ok(await benC('GET', `/api/office/shared?from=${iso(20)}&to=${iso(20)}`)).some((e) => e.title === 'Youth movie night'));
assert.ok(ok(await admin('GET', `/api/events?from=${iso(20)}&to=${iso(20)}`)).some((e) => e.title === 'Youth movie night'), 'and it asked for AV');
step('event requests: anyone asks; Church Admin approves into the calendar (and the AV schedule when needed)');

// ---------- yearly rhythm ----------
const year = Number(iso(0).slice(0, 4)) + 1;
ok(await samC('PUT', '/api/office/year-plan', { items: [] }), 403);
const yp = ok(await leeC('PUT', '/api/office/year-plan', { items: [{ title: 'Week of Prayer', type: 'event', month: 3, nth: 1, weekday: 6, visibility: 'everyone' }, { title: 'Budget due', type: 'deadline', month: 10, day: 31, committees: ['finance'] }] }));
assert.equal(yp.items.length, 2);
let fill = ok(await leeC('POST', '/api/office/year-plan/fill', { year }));
assert.deepEqual(fill, { added: 2, skipped: 0 });
fill = ok(await leeC('POST', '/api/office/year-plan/fill', { year }));
assert.deepEqual(fill, { added: 0, skipped: 2 }, 'filling twice doesn’t double up');
const yearEvents = ok(await leeC('GET', `/api/office/events?from=${year}-01-01&to=${year}-12-31`));
const wop = yearEvents.find((e) => e.title === 'Week of Prayer');
assert.equal(new Date(wop.date + 'T12:00:00').getDay(), 6);
assert.ok(wop.date.startsWith(`${year}-03-`) && Number(wop.date.slice(8)) <= 7, 'first Sabbath of March');
assert.ok(!yearEvents.some((e) => e.title === 'Budget due'), 'Finance’s deadline isn’t on the board chair’s calendar');
assert.ok(ok(await fredC('GET', `/api/office/events?from=${year}-01-01&to=${year}-12-31`)).some((e) => e.title === 'Budget due' && e.date === `${year}-10-31` && e.allDay));
step('yearly rhythm: set once, fill in a year (first Sabbath of March, Oct 31…), never twice');

// ---------- announcements to a service's bulletin ----------
ok(await oliviaC('PUT', `/api/office/events/${board.id}/bulletin`, { service: svc.id }), 400);
ok(await oliviaC('PUT', `/api/office/events/${biz.id}/bulletin`, { service: svc.id, text: 'Church business meeting this afternoon at 2 PM in the sanctuary.' }));
const plan = ok(await admin('GET', `/api/plans/${svc.id}`));
assert.equal(plan.officeAnnouncements.length, 1);
ok(await benC('POST', `/api/office/bulletin/${biz.id}/add`), 403);
ok(await admin('POST', `/api/office/bulletin/${biz.id}/add`));
assert.match(ok(await admin('GET', `/api/plans/${svc.id}`)).announcements, /business meeting this afternoon/);
step('announcements: Church Admin asks, a service plan leader adds it to the bulletin');

// ---------- committees come and go ----------
const yc = ok(await oliviaC('POST', '/api/office/committees', { name: 'Building Committee', color: 'orange' }), 201);
assert.equal(yc.key, 'building-committee');
ok(await leeC('POST', '/api/office/committees', { name: 'x' }), 403);
ok(await oliviaC('DELETE', '/api/office/committees/building-committee'), 204);
ok(await oliviaC('PATCH', '/api/office/setup', { rooms: [{ name: 'Sanctuary', services: true }, { name: 'Chapel' }], remindMinutes: 30, remindDays: 2 }));
assert.deepEqual(ok(await oliviaC('GET', '/api/bootstrap')).office.rooms.map((r) => r.name), ['Sanctuary', 'Chapel']);
ok(await leeC('PATCH', '/api/office/setup', { remindMinutes: 5 }), 403);
step('the head leader adds and removes committees and sets rooms and reminders');

// ---------- confidential: even the admin sees only what their membership allows ----------
let adminEvents = ok(await adminO('GET', `/api/office/events?from=${iso(0)}&to=${iso(400)}`));
assert.ok(adminEvents.length > 0 && adminEvents.every((e) => e.visibility === 'everyone'), 'the admin sees only items shared with every team');
ok(await adminO('GET', `/api/office/events/${board.id}`), 403);
assert.equal(ok(await adminO('GET', '/api/office/goals')).length, 0);
assert.equal(ok(await adminO('GET', '/api/office/motions')).length, 0);
assert.equal(ok(await adminO('GET', '/api/office/docs')).docs.filter((d) => d.title === 'Church bylaws').length, 0);
assert.ok(!ok(await adminO('GET', '/api/office/overview?zoom=year')).events.some((e) => e.id === board.id));
assert.equal(ok(await adminO('GET', '/api/office/actions')).length, 0);
ok(await adminO('PUT', `/api/office/events/${board.id}/agenda`, { agenda: [] }), 403);
ok(await adminO('POST', '/api/office/events', { title: 'x', date: iso(3), start: '10:00' }), 403);
ok(await adminO('PATCH', `/api/office/events/${biz.id}`, { title: 'x' }), 403);
// …but still manages it: committees, rooms, people's roles, event requests
ok(await adminO('POST', '/api/office/committees', { name: 'Building Committee' }), 201);
ok(await adminO('PATCH', '/api/office/setup', { remindMinutes: 45 }));
ok(await adminO('PATCH', `/api/people/${fred.id}`, { role: 'leader' }));
ok(await adminO('PATCH', `/api/people/${fred.id}`, { role: 'crew' }));
assert.ok(ok(await adminO('GET', '/api/office/committees')).find((c) => c.key === 'board').members.length > 0, 'the admin sees who is on each committee');
// The admin's "View as" preview doesn't open Church Admin
const peek = await fetch(`${BASE}/api/office/events`, { headers: { Cookie: (await (async () => { const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com', password: 'adminpass1' }) }); return r.headers.get('set-cookie').split(';')[0]; })()), 'X-Team': O, 'X-View-As': bea.id } });
assert.equal(peek.status, 403, 'no peeking through a preview');
// The Activity log never names confidential items
const feed = [];
for (let before = ''; ; ) {
  const page = ok(await admin('GET', `/api/activity/feed?limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`));
  feed.push(...page);
  if (page.length < 200) break;
  before = page[page.length - 1].at || page[page.length - 1].createdAt;
}
const activity = JSON.stringify(feed);
for (const secret of ['Church board', 'roof', 'Roof', 'bylaws', 'Budget review']) assert.ok(!activity.includes(secret), `the activity log mentions “${secret}”`);
assert.match(activity, /Church business meeting/, 'items shared with every team can be named');
step('confidential: the admin manages people, committees and rooms but can’t read Church Admin items, preview them, or see them in the log');

// The admin joins the board only when Church Admin asks, and accepts
ok(await oliviaC('PATCH', `/api/people/${adminId}`, { committees: ['board'] }), 403);
ok(await oliviaC('POST', '/api/people', { name: 'Hub', email: 'admin@example.com' }), 201);
let ab = ok(await admin('GET', '/api/bootstrap'));
assert.deepEqual(ab.invites.map((i) => i.teamName), ['Church Admin']);
ok(await admin('POST', `/api/account/invites/${O}/accept`));
ok(await oliviaC('PATCH', '/api/office/committees/board', { members: [lee.id, sam.id, bea.id, adminId] }));
assert.ok(ok(await adminO('GET', `/api/office/events/${board.id}`)), 'now on the board, the admin sees its meetings');
ok(await adminO('PATCH', '/api/office/committees/finance', { members: [fred.id, adminId] }));
assert.ok(!ok(await adminO('GET', '/api/office/committees')).find((c) => c.key === 'finance').members.some((m) => m.id === adminId), 'the admin can’t put themselves on a committee');
step('the admin is on Church Admin only when its leaders ask and they accept; committee places come from the head leader');

// ---------- tiers: the pastor on the AV team is asked to join ----------
// Which teams each person can bring someone onto, from Team & roles
assert.deepEqual(ok(await oliviaC('GET', '/api/bootstrap')).addTo, [{ key: O, name: 'Church Admin', ask: true }]);
const adminAddTo = ok(await admin('GET', '/api/bootstrap')).addTo;
assert.ok(adminAddTo.some((t) => t.key === 'av' && !t.ask) && adminAddTo.some((t) => t.key === 'praise' && !t.ask), 'the admin adds to every service team');
assert.ok(!adminAddTo.some((t) => t.key === O), 'but not to Church Admin once it has a head leader');
assert.deepEqual(ok(await samC('GET', '/api/bootstrap')).addTo, [], 'a board member without the privilege can’t add anyone');
// Picked by name from everyone on Crew Call (no email needed)
assert.ok(ok(await oliviaC('GET', '/api/bootstrap')).everyone.some((p) => p.id === ben.id), 'the picker lists people on other teams');
ok(await oliviaC('POST', '/api/people', { userId: 'nope' }), 400);
ok(await oliviaC('POST', '/api/people', { userId: '0123456789abcdef01234567' }), 404);
ok(await samC('POST', '/api/people', { userId: ben.id }), 403);
assert.equal(ok(await oliviaC('POST', '/api/people', { userId: ben.id }), 201).asked, true);
let benBoot = ok(await benC('GET', '/api/bootstrap'));
assert.deepEqual(benBoot.teams.map((t) => t.key), ['av'], 'not on their profile until they accept');
assert.equal(benBoot.invites[0].from, 'Olivia');
assert.ok(ok(await oliviaC('GET', '/api/people/asked')).some((p) => p.name === 'Ben'));
ok(await samC('GET', '/api/people/asked'), 200);
assert.equal(ok(await samC('GET', '/api/people/asked')).length, 0, 'only leaders see who has been asked');
ok(await oliviaC('POST', '/api/people', { name: 'Ben', email: 'ben@example.com' }), 409);
ok(await oliviaC('POST', '/api/people', { userId: ben.id }), 409);
ok(await benC('POST', `/api/account/invites/${O}/accept`));
benBoot = ok(await benC('GET', '/api/bootstrap'));
assert.deepEqual(benBoot.teams.map((t) => t.key).sort(), ['av', O].sort());
// Declining
const tia = await invite(admin, 'Tia', 'tia@example.com');
const tiaC = await signIn(tia, 'av');
ok(await leeC('POST', '/api/people', { name: 'Tia', email: 'tia@example.com' }), 403);
ok(await oliviaC('POST', '/api/people', { name: 'Tia', email: 'tia@example.com' }), 201);
ok(await tiaC('POST', `/api/account/invites/${O}/decline`));
assert.deepEqual(ok(await tiaC('GET', '/api/bootstrap')).teams.map((t) => t.key), ['av']);
// On the service side, picking someone from another team adds them straight away
const adminPraise = client('praise');
ok(await adminPraise('POST', '/api/auth/login', { email: 'admin@example.com', password: 'adminpass1' }));
assert.equal(ok(await adminPraise('POST', '/api/people', { userId: tia.id }), 201).joined, true);
assert.deepEqual(ok(await tiaC('GET', '/api/bootstrap')).teams.map((t) => t.key).sort(), ['av', 'praise']);
step('tiers: someone on AV (the pastor) is asked to join, picked by name or by email, and Church Admin shows on their profile only once they accept');

// ---------- who's on Church Admin shows only to the admin and its leaders ----------
const tiaBoot = ok(await tiaC('GET', '/api/bootstrap'));
assert.deepEqual(tiaBoot.everyone.find((p) => p.id === ben.id).teams, ['av'], 'AV crew don’t see that Ben is on Church Admin');
assert.ok(ok(await admin('GET', '/api/bootstrap')).everyone.find((p) => p.id === ben.id).teams.includes(O));
assert.deepEqual(ok(await tiaC('GET', '/api/teams')).find((t) => t.key === O).heads, []);
const fredPeople = ok(await fredC('GET', '/api/bootstrap')).people.map((p) => p.name).sort();
assert.ok(!fredPeople.includes('Bea') && !fredPeople.includes('Sam'), `Finance doesn’t see the board’s members: ${fredPeople}`);
assert.ok(fredPeople.includes('Olivia'));
const samView = ok(await samC('GET', '/api/office/committees'));
assert.equal(samView.find((c) => c.key === 'board').members.length, 0, 'committee lists are for leaders');
step('who’s on Church Admin and its committees shows only to the admin and Church Admin leaders');

// Reset links and email changes are announced to the person
const before = ok(await client()('GET', '/api/auth/test-mail')).length;
ok(await oliviaC('POST', `/api/people/${sam.id}/reset-link`));
ok(await oliviaC('PATCH', `/api/people/${sam.id}`, { email: 'sam2@example.com' }));
const after = ok(await client()('GET', '/api/auth/test-mail')).slice(before - 30 > 0 ? 0 : 0);
assert.ok(after.some((m) => m.to === 'sam@example.com' && /sign-in link was made/.test(m.subject)));
assert.ok(after.some((m) => m.to === 'sam@example.com' && /email was changed/.test(m.subject)));
step('a reset link or an email change is always announced to the person, so nobody can quietly take over an account');

console.log('\nAll Church Admin checks passed.');
