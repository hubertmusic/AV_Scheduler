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

/**
 * items: [{ uid, event, positionLabel, crew, lineup, updatedAt }]
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
    if (!it.positionLabel) {
      lines.push(...infoEvent(it, tz, now, link));
      continue;
    }
    const start = localToDate(e.date, e.call, tz);
    let end = localToDate(e.date, e.end, tz);
    if (end <= start) end = new Date(start.getTime() + 2 * 3600 * 1000);
    const isCheck = e.kind === 'soundcheck';
    const top = [...(it.notices || []), e.notes ? `IMPORTANT FOR THIS SHIFT: ${e.notes}` : ''].filter(Boolean);
    const body = [
      `${it.positionLabel} for ${e.title}.`,
      it.viaRegular ? `This is your regular ${it.viaRegular} shift.` : '',
      `Call time ${e.call}, ${isCheck ? 'sound check' : 'service'} starts ${e.start}.`,
      it.groups ? `${isCheck ? 'Sound checking' : 'With'}: ${it.groups}` : '',
      it.lineup ? `Who's serving:\n${it.lineup}` : it.crew ? `Crew: ${it.crew}` : '',
      link ? `Confirm, swap, transfer or drop this shift in Crew Call: ${link}` : 'Confirm, swap, transfer or drop this shift in Crew Call.',
    ].filter(Boolean);
    const desc = [...top, ...(top.length ? [''] : []), ...body].join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${it.uid}`,
      `DTSTAMP:${now}`,
      `LAST-MODIFIED:${fmt(it.updatedAt || new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(`${it.positionLabel} — ${e.title}`)}`,
      `DESCRIPTION:${esc(desc)}`,
      ...(link ? [`URL:${link}`] : []),
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      ...(alertDays > 0
        ? [
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${esc(`You're on ${it.positionLabel} for ${e.title} on ${dayWord(e.date, tz)}`)}`,
            `TRIGGER:-P${alertDays}D`,
            'END:VALARM',
          ]
        : []),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`Call time for ${e.title}`)}`,
      'TRIGGER:-PT60M',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// A service or rehearsal you're not on: shown as free time, no reminders
function infoEvent(it, tz, now, link) {
  const e = it.event;
  const start = localToDate(e.date, e.start, tz);
  let end = localToDate(e.date, e.end, tz);
  if (end <= start) end = new Date(start.getTime() + 2 * 3600 * 1000);
  const kind = { soundcheck: 'Sound check', rehearsal: `${it.teamName || 'Team'} rehearsal` }[e.kind] || 'Service';
  const desc = [
    `${kind}: ${e.title}. Starts ${e.start}.`,
    e.notes ? `Note: ${e.notes}` : '',
    it.lineup ? `Who's serving:\n${it.lineup}` : 'No one is scheduled yet.',
    link ? `Contacts and details in Crew Call: ${link}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
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
