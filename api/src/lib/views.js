import { config } from '../config.js';
import { can, membershipOf, roleIn } from './util.js';

// What everyone may see about a person, through the team the viewer is working in: their role,
// title, positions and monthly limit on that team. Phones of leaders and the admin are visible to
// everyone (so crew can reach them); everyone else's phone only to people who message the crew or
// manage people.
export function personView(u, viewer) {
  const team = viewer._team;
  const keys = viewer._teamKeys; // positions on the viewer's team (unset = no filtering)
  const lens = (list) => (keys ? (list || []).filter((k) => keys.has(String(k).replace(/\+shadow$/, ''))) : list || []);
  const vc = can(viewer);
  const isSelf = String(u._id) === String(viewer._id);
  const m = membershipOf(u, team);
  const role = roleIn(u, team);
  const isLead = u.role === 'admin' || (u.teams || []).some((t) => t.head || t.role === 'leader');
  const out = {
    id: String(u._id),
    name: u.name,
    role: role || 'crew',
    onTeam: !!role,
    head: u.role === 'admin' || !!m?.head,
    leaderTitle: m?.title || (u.role === 'admin' ? u.leaderTitle : ''),
    teams: (u.teams || []).map((t) => t.team),
    positions: lens(u.positions),
    trainee: lens(u.trainee),
    leads: lens(u.leads),
    active: u.active,
  };
  if (isSelf || vc.people || vc.edit) {
    out.regulars = (u.regulars || []).map((r) => ({ id: String(r._id), week: r.week, anchor: r.anchor, service: r.service, positions: r.positions, note: r.note }));
    out.maxPerMonth = m ? m.maxPerMonth || 0 : u.maxPerMonth || 0;
    out.availabilityUpdatedAt = u.availabilityUpdatedAt || null;
  }
  if (isLead || isSelf || vc.message || vc.people) out.phone = u.phone;
  if (isSelf || vc.people) {
    out.email = u.email;
    out.invited = !u.passwordHash;
  }
  if (role === 'leader' || role === 'admin') out.perms = can(u, team);
  return out;
}

export function meView(u) {
  const team = u._team;
  const m = membershipOf(u, team);
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: roleIn(u, team) || 'crew', // in the team they're working in; 'admin' is over all teams
    head: u.role === 'admin' || !!m?.head,
    leaderTitle: m?.title || (u.role === 'admin' ? u.leaderTitle : ''),
    team: team || null,
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
    team: e.team || null,
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
