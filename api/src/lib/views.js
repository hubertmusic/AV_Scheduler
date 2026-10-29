import { config } from '../config.js';
import { can } from './util.js';

// What everyone may see about a person. Phones of leaders and the admin are
// visible to everyone (so crew can reach them); everyone else's phone only to
// people who message the crew or manage people.
export function personView(u, viewer) {
  const vc = can(viewer);
  const isSelf = String(u._id) === String(viewer._id);
  const isLead = u.role === 'admin' || u.role === 'leader';
  const out = {
    id: String(u._id),
    name: u.name,
    role: u.role,
    leaderTitle: u.leaderTitle,
    positions: u.positions,
    trainee: u.trainee || [],
    active: u.active,
  };
  if (isSelf || vc.people || vc.edit) {
    out.regulars = (u.regulars || []).map((r) => ({ id: String(r._id), week: r.week, anchor: r.anchor, service: r.service, positions: r.positions, note: r.note }));
    out.maxPerMonth = u.maxPerMonth || 0;
    out.availabilityUpdatedAt = u.availabilityUpdatedAt || null;
  }
  if (isLead || isSelf || vc.message || vc.people) out.phone = u.phone;
  if (isSelf || vc.people) {
    out.email = u.email;
    out.invited = !u.passwordHash;
  }
  if (isLead) out.perms = can(u);
  return out;
}

export function meView(u) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    leaderTitle: u.leaderTitle,
    positions: u.positions,
    regulars: (u.regulars || []).map((r) => ({ id: String(r._id), week: r.week, anchor: r.anchor, service: r.service, positions: r.positions, note: r.note })),
    can: can(u),
    calUrl: `${config.publicUrl}/cal/${u.calToken}.ics`,
  };
}

export function eventView(e) {
  return {
    id: String(e._id),
    date: e.date,
    title: e.title,
    start: e.start,
    call: e.call,
    end: e.end,
    needs: e.needs,
    notes: e.notes,
    kind: e.kind || 'service',
    groups: (e.groups || []).map(String),
    forEvent: e.forEvent ? String(e.forEvent) : null,
    manual: Boolean(e.manual),
  };
}

// Crew see group names (so they know who's at a sound check); contact details
// only go to people who manage groups or message on the team's behalf.
export function groupView(g, viewer) {
  const vc = can(viewer);
  const out = { id: String(g._id), name: g.name };
  if (vc.groups || vc.message) {
    Object.assign(out, {
      contactName: g.contactName,
      phone: g.phone,
      groupLink: g.groupLink,
      notes: g.notes,
      members: (g.members || []).map((m) => ({ name: m.name, phone: m.phone, role: m.role })),
    });
  }
  return out;
}

const brief = (u) => (u ? { id: String(u._id), name: u.name, phone: u.phone } : null);
const briefEvent = (e) => (e ? { id: String(e._id), date: e.date, title: e.title, start: e.start } : null);

export function requestView(r) {
  return {
    id: String(r._id),
    type: r.type,
    status: r.status,
    note: r.note,
    reason: r.reason,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    from: brief(r.from),
    event: briefEvent(r.event),
    position: r.position,
    targetUser: brief(r.targetUser),
    targetEvent: briefEvent(r.targetEvent),
    targetPosition: r.targetPosition || '',
    decidedBy: brief(r.decidedBy),
  };
}
