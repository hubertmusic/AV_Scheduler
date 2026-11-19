import { DateTime } from 'luxon';
import { localToDate } from './util.js';

const dayWord = (date, tz) => DateTime.fromISO(date, { zone: tz }).toFormat('cccc, LLL d').replace('Saturday', 'Sabbath');

const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function esc(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines longer than 75 octets are folded with CRLF + space.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const max = first ? 75 : 74;
    let end = Math.min(i + max, bytes.length);
    // don't split a multi-byte UTF-8 character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push((first ? '' : ' ') + bytes.subarray(i, end).toString('utf8'));
    i = end;
    first = false;
  }
  return parts.join('\r\n');
}

// 24-hour "13:05" → "1:05 PM"
export const t12 = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
// Who's serving, one team at a time, one person per line
const lineupText = (lineup) =>
  (lineup || []).map((t) => [t.team, ...t.rows.map((r) => `• ${r.label}: ${r.name}${r.you ? ' (you)' : ''}`)].join('\n')).join('\n\n');
// Sections with a label and a blank line between them, so the description is easy to scan
const sections = (list) =>
  list
    .filter((x) => x && x[1])
    .map(([label, text]) => (label ? `${label}\n${text}` : text))
    .join('\n\n');
const RULE = '────────────';

/**
 * items: [{ uid, event, positionLabel, teamName, confirmed, alsoOn, lineup, updatedAt }]
 * A shift (positionLabel set) starts at the call time so people arrive on time, with reminders.
 * Every other service and rehearsal (positionLabel empty) is shown as free time, with who's
 * serving on each team, so everyone sees the whole picture from one subscription.
 */
export function buildCalendar({ name, tz, items, link = '', alertDays = 0 }) {
  const now = fmt(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Crew Call//AV Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const it of items) {
    const e = it.event;
    if (it.office) {
      lines.push(...officeEvent(it, tz, now, link));
      continue;
    }
    if (!it.positionLabel) {
      lines.push(...infoEvent(it, tz, now, link));
      continue;
    }
    const start = localToDate(e.date, e.call, tz);
    let end = localToDate(e.date, e.end, tz);
    if (end <= start) end = new Date(start.getTime() + 2 * 3600 * 1000);
    const isCheck = e.kind === 'soundcheck';
    const role = `${it.positionLabel}${it.teamName ? ` (${it.teamName})` : ''}`;
    const double = it.alsoOn?.length ? it.alsoOn.join(' and ') : '';
    const important = [...(it.notices || []), e.notes ? `FOR THIS SHIFT: ${e.notes}` : ''].filter(Boolean).join('\n\n');
    const desc = sections([
      double && ['⚠️ DOUBLE-BOOKED', `You’re also on ${double} at this ${isCheck ? 'sound check' : 'service'}. Make sure you can cover both, or talk to a leader.`],
      important && ['📌 READ FIRST', important],
      ['YOUR ROLE', [role, it.viaRegular ? `Your regular ${it.viaRegular} shift` : ''].filter(Boolean).join('\n')],
      ['TIMES', [`Arrive: ${t12(e.call)}`, `${isCheck ? 'Sound check' : 'Service'}: ${t12(e.start)}${e.end ? ` – ${t12(e.end)}` : ''}`, dayWord(e.date, tz)].join('\n')],
      it.groups && [isCheck ? 'SOUND CHECKING' : 'WITH', it.groups],
      ['WHO’S SERVING', it.lineup?.length ? lineupText(it.lineup) : it.crew || ''],
      ['', RULE],
      [
        it.confirmed ? '✓ CONFIRMED' : 'PLEASE CONFIRM',
        [it.confirmed ? 'You’ve confirmed this shift.' : 'You haven’t confirmed this shift yet.', `${it.confirmed ? 'Swap' : 'Confirm, swap'}, transfer or drop it in Crew Call${link ? `:\n${link}` : '.'}`].join('\n'),
      ],
    ]);
    const title = `${e.title} — ${role}`;
    const alarm = (trigger, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${fmt(it.updatedAt || new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(double ? `⚠️ Double-booked: ${title}` : title)}`,
      `DESCRIPTION:${esc(desc)}`,
      ...(link ? [`URL:${link}`] : []),
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      ...(alertDays > 0 ? alarm(`-P${alertDays}D`, `You’re on ${it.positionLabel} for ${e.title} on ${dayWord(e.date, tz)}${double ? `, and also on ${double}` : ''}`) : []),
      // A double booking gets its own heads-up the day before
      ...(double && alertDays !== 1 ? alarm('-P1D', `Heads up: tomorrow you’re double-booked at ${e.title}: ${it.positionLabel} and ${double}`) : []),
      ...alarm('-PT60M', `Call time for ${e.title} (${it.positionLabel}${double ? ` + ${double}` : ''}) is ${t12(e.call)}`),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// A Church Admin item: a meeting, deadline or church event. Busy time with reminders when you're
// invited; otherwise free time.
const TYPE_WORD = { board: 'Board meeting', business: 'Business meeting', committee: 'Committee meeting', deadline: 'Deadline', event: 'Church event', other: '' };
function officeEvent(it, tz, now, link) {
  const e = it.event;
  const day = (d) => d.replace(/-/g, '');
  let when;
  if (e.allDay || !e.start) {
    const next = new Date(`${e.date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    when = [`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(next.toISOString().slice(0, 10))}`];
  } else {
    const start = localToDate(e.date, e.start, tz);
    let end = localToDate(e.date, e.end || e.start, tz);
    if (end <= start) end = new Date(start.getTime() + 3600 * 1000);
    when = [`DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`];
  }
  const desc = [TYPE_WORD[e.type] ? `${TYPE_WORD[e.type]} · ${it.teamName}` : it.teamName, e.room ? `Where: ${e.room}` : '', e.notes || '', link ? `Details in Crew Call: ${link}` : ''].filter(Boolean).join('\n\n');
  const alarms = [];
  if (it.invited && !(e.allDay || !e.start)) {
    if (it.remindDays > 0) alarms.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${e.title} on ${dayWord(e.date, tz)}`)}`, `TRIGGER:-P${it.remindDays}D`, 'END:VALARM');
    if (it.remindMinutes > 0) alarms.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(`${e.title} starts soon`)}`, `TRIGGER:-PT${it.remindMinutes}M`, 'END:VALARM');
  }
  return [
    'BEGIN:VEVENT',
    `UID:${it.uid}`,
    `DTSTAMP:${now}`,
    `LAST-MODIFIED:${fmt(it.updatedAt || new Date())}`,
    ...when,
    `SUMMARY:${esc(e.title)}`,
    ...(e.room ? [`LOCATION:${esc(e.room)}`] : []),
    `DESCRIPTION:${esc(desc)}`,
    ...(link ? [`URL:${link}`] : []),
    'STATUS:CONFIRMED',
    `TRANSP:${it.invited ? 'OPAQUE' : 'TRANSPARENT'}`,
    ...alarms,
    'END:VEVENT',
  ];
}

// A service or rehearsal you're not on: shown as free time, no reminders
function infoEvent(it, tz, now, link) {
  const e = it.event;
  const start = localToDate(e.date, e.start, tz);
  let end = localToDate(e.date, e.end, tz);
  if (end <= start) end = new Date(start.getTime() + 2 * 3600 * 1000);
  const kind = { soundcheck: 'Sound check', rehearsal: `${it.teamName || 'Team'} rehearsal` }[e.kind] || 'Service';
  const desc = sections([
    [kind.toUpperCase(), [`${t12(e.start)}${e.end ? ` – ${t12(e.end)}` : ''}`, dayWord(e.date, tz)].join('\n')],
    e.notes && ['📌 NOTE', e.notes],
    ['WHO’S SERVING', it.lineup?.length ? lineupText(it.lineup) : 'No one is scheduled yet.'],
    link && ['', `Contacts and details in Crew Call:\n${link}`],
  ]);
  return [
    'BEGIN:VEVENT',
    `UID:${it.uid}`,
    `DTSTAMP:${now}`,
    `LAST-MODIFIED:${fmt(it.updatedAt || new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(e.kind === 'rehearsal' ? `${it.teamName || 'Team'} rehearsal — ${e.title}` : e.title)}`,
    `DESCRIPTION:${esc(desc)}`,
    ...(link ? [`URL:${link}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}
