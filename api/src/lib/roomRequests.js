// Room and event requests go straight onto the agenda of Church Admin's next board meeting, from
// a member signed in or from anyone with the shareable request link. If no board meeting is on the
// calendar yet, they wait and are added when one is. The board sees who asked and any clash with
// the room; whoever decides, the person who asked gets an email back.
import { DateTime } from 'luxon';
import { OfficeEvent, OfficeRequest, User } from '../models.js';
import { getSettings, todayIn } from './util.js';
import { mailerReady, sendMail } from './mailer.js';
import { logActivity } from './activity.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const fmtDay = (d) => DateTime.fromISO(d).toFormat('cccc, LLL d').replace('Saturday', 'Sabbath');
const fmtTime = (t) => (t ? DateTime.fromFormat(t, 'HH:mm').toFormat('h:mm a') : '');
export const whenOf = (r) => `${fmtDay(r.date)}${r.start ? `, ${fmtTime(r.start)}${r.end ? `–${fmtTime(r.end)}` : ''}` : ''}`;

// A board meeting: the Board type, or a business/committee meeting for the Church Board committee
const BOARD = { $or: [{ type: 'board' }, { type: { $in: ['business', 'committee'] }, committees: 'board' }] };

// The next board meeting that hasn't happened yet (today's counts until it starts)
export async function nextBoardMeeting(team) {
  const s = await getSettings();
  const today = todayIn(s.timezone);
  const now = DateTime.now().setZone(s.timezone || 'America/New_York').toFormat('HH:mm');
  const list = await OfficeEvent.find({ team, date: { $gte: today }, minutesApprovedAt: null, ...BOARD }).sort({ date: 1, start: 1 }).limit(5);
  return list.find((m) => m.date > today || (m.start && m.start > now)) || null;
}

const sourceLine = (r, asker) => {
  const who = r.from?.name || asker?.name || 'Someone';
  const reach = (r.source === 'link' ? [r.from?.email, r.from?.phone] : [asker?.email, asker?.phone]).filter(Boolean).join(', ');
  return `Asked by ${who}${reach ? ` (${reach})` : ''}${r.source === 'link' ? ' through the room request link' : ''}.`;
};
function agendaNotes(r, asker) {
  return [
    `${whenOf(r)} · ${r.room || 'No room picked'}${r.people ? ` · about ${r.people} people` : ''}${r.needsAv ? ' · needs AV' : ''}`,
    sourceLine(r, asker),
    r.notes ? `“${r.notes.length > 500 ? `${r.notes.slice(0, 500)}…` : r.notes}”` : '',
    'Approve or decline it in Planning → Requests; they get an email either way.',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000); // what the agenda editor keeps
}

// Put a pending request on the next board meeting's agenda. Returns the meeting, or null when
// there's no board meeting on the calendar yet (it waits; see attachWaiting).
export async function attachRequest(r) {
  if (r.meeting || r.status !== 'pending') return null;
  const m = await nextBoardMeeting(r.team);
  if (!m) return null;
  const asker = r.requestedBy ? await User.findById(r.requestedBy, { name: 1, email: 1, phone: 1 }).lean() : null;
  const item = { kind: 'item', title: `Room request: ${r.title}`, presenter: r.from?.name || asker?.name || '', minutes: 5, notes: agendaNotes(r, asker) };
  // Keep it ahead of a closing item ("Adjourn", "Closing prayer") if the agenda ends with one
  const last = m.agenda[m.agenda.length - 1];
  if (last && /adjourn|closing|close in prayer|benediction/i.test(last.title)) m.agenda.splice(m.agenda.length - 1, 0, item);
  else m.agenda.push(item);
  await m.save();
  const added = m.agenda.find((a) => a.title === item.title && a.notes === item.notes);
  r.meeting = m._id;
  r.agendaItem = added?._id;
  await r.save();
  return m;
}

// Requests that came in while no board meeting was on the calendar
export async function attachWaiting(team) {
  const waiting = await OfficeRequest.find({ team, status: 'pending', meeting: null }).sort({ createdAt: 1 }).limit(100);
  let n = 0;
  for (const r of waiting) if (await attachRequest(r)) n++;
  return n;
}

// After a decision, say so on the agenda item (unless that meeting's minutes are approved)
export async function markOnAgenda(r, deciderName) {
  if (!r.meeting || !r.agendaItem) return;
  const m = await OfficeEvent.findById(r.meeting);
  if (!m || m.minutesApprovedAt) return;
  // Saving the agenda gives items new ids, so fall back to its title
  const item = m.agenda.id(r.agendaItem) || m.agenda.find((a) => a.title === `Room request: ${r.title}`);
  if (!item) return;
  const word = r.status === 'approved' ? 'approved' : 'declined';
  item.title = `Room request (${word}): ${r.title}`;
  item.notes = `${item.notes}\n${word[0].toUpperCase()}${word.slice(1)} by ${deciderName || 'a leader'}${r.reply ? `: “${r.reply}”` : '.'}`.slice(0, 1000);
  await m.save();
}

const overlaps = (a, b) => !a.start || !b.start || ((a.start < (b.end || '23:59')) && (b.start < (a.end || '23:59')));
const sameRoom = (a, b) => a && b && a.trim().toLowerCase() === b.trim().toLowerCase();
// What's already in that room then: calendar items, and other requests waiting
export async function clashesFor(r, { titles = true } = {}) {
  if (!r.room || !r.date) return [];
  const [events, others] = await Promise.all([
    OfficeEvent.find({ team: r.team, date: r.date, room: { $ne: '' } }, { title: 1, room: 1, start: 1, end: 1, allDay: 1 }).lean(),
    OfficeRequest.find({ team: r.team, date: r.date, status: 'pending', room: { $ne: '' }, ...(r._id ? { _id: { $ne: r._id } } : {}) }, { title: 1, room: 1, start: 1, end: 1 }).lean(),
  ]);
  const hit = (x) => sameRoom(x.room, r.room) && overlaps(r, x.allDay ? {} : x) && String(x._id) !== String(r.event || '');
  return [
    ...events.filter(hit).map((x) => ({ kind: 'booked', ...(titles ? { title: x.title } : {}), start: x.start, end: x.end })),
    ...others.filter(hit).map((x) => ({ kind: 'asked', ...(titles ? { title: x.title } : {}), start: x.start, end: x.end })),
  ];
}

async function mailTo(to, subject, lines) {
  if (!to || !mailerReady()) return;
  const s = await getSettings();
  const text = [...lines, '', `— ${s.orgName}`].join('\n');
  try {
    await sendMail({ to, subject, text, html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>` });
  } catch (e) {
    await logActivity({ kind: 'system', who: 'Crew Call', action: `Couldn’t email ${to} about a room request: ${e.message}` });
  }
}
const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// "We got it" for someone who used the link (members see their requests in Crew Call)
export async function mailReceived(r, meeting) {
  await mailTo(r.from?.email, `We got your request: ${r.title}`, [
    `Hi ${first(r.from?.name)},`,
    '',
    `Thanks. We got your request for “${r.title}” on ${whenOf(r)}${r.room ? ` in the ${r.room}` : ''}.`,
    meeting ? `The church board will look at it when it meets on ${fmtDay(meeting.date)}.` : 'The church board will look at it at its next meeting.',
    'We’ll email you as soon as it’s decided.',
  ]);
}

// Approved or declined: tell whoever asked
export async function mailDecision(r) {
  let to = r.from?.email;
  let name = r.from?.name;
  if (!to && r.requestedBy) {
    const u = await User.findById(r.requestedBy, { name: 1, email: 1, active: 1 }).lean();
    if (u?.active) [to, name] = [u.email, u.name];
  }
  const ok = r.status === 'approved';
  await mailTo(to, `${ok ? 'Approved' : 'Not approved'}: ${r.title}`, [
    `Hi ${first(name)},`,
    '',
    ok
      ? `Good news: your request for “${r.title}” on ${whenOf(r)}${r.room ? ` in the ${r.room}` : ''} is approved. It’s on the church calendar.`
      : `Your request for “${r.title}” on ${whenOf(r)}${r.room ? ` in the ${r.room}` : ''} wasn’t approved.`,
    ...(r.reply ? ['', `Note from the board: ${r.reply}`] : []),
    ...(ok ? [] : ['', 'Reply to the church office if you’d like to talk about another date or room.']),
  ]);
}

