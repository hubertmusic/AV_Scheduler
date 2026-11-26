import { firstName, fmtDay, fmtTime, prettyPhone } from './lib.js';

// WhatsApp recipients for outside groups: the contact person, plus the group chat when there's a link.
export function groupRecipients(groups, { members = false } = {}) {
  const out = [];
  for (const g of groups) {
    if (!g) continue;
    if (g.groupLink) out.push({ id: g.id, name: g.name, link: g.groupLink });
    if (g.phone) out.push({ id: `${g.id}-contact`, name: g.contactName || `${g.name} contact`, phone: g.phone, sub: `${g.name} contact · ${prettyPhone(g.phone)}` });
    if (members) {
      for (const m of g.members || []) {
        if (m.phone && m.phone !== g.phone) out.push({ id: `${g.id}-${m.phone}`, name: m.name, phone: m.phone, sub: `${g.name}${m.role ? ` · ${m.role}` : ''} · ${prettyPhone(m.phone)}` });
      }
    }
  }
  return out;
}

export function soundcheckText({ event, forEvent, groups, orgName, fromName }) {
  const names = groups.map((g) => g.name).join(' & ') || 'everyone';
  const lines = [
    `Hi ${groups.length === 1 && groups[0].contactName ? firstName(groups[0].contactName) : 'all'} — it’s ${firstName(fromName)} from ${orgName}.`,
    '',
    `Sound check for ${names}: ${fmtDay(event.date)} at ${fmtTime(event.start)}${forEvent ? `, ahead of ${forEvent.title} at ${fmtTime(forEvent.start)}` : ''}.`,
    `Please be set up and ready to play by ${fmtTime(event.start)}; we wrap by ${fmtTime(event.end)}.`,
  ];
  if (event.notes) lines.push('', event.notes);
  lines.push('', 'Let us know if anything changes (players, instruments, tracks or click).');
  return lines.join('\n');
}
