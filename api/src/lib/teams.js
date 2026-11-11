// Teams: AV, Praise and any others. Each has its own people, positions and leaders; services,
// plans, songs and the calendar are shared. Every request works "in" one team (the X-Team
// header, from the team switcher); team screens see positions, people and assignments through
// that team, and saves are merged back so other teams' data is never touched.
import { Position, Settings, Team, User } from '../models.js';
import { forbidden, membershipOf, roleIn } from './util.js';

export const AV = 'av';
const PERM_KEYS = ['edit', 'approve', 'message', 'resources', 'people', 'groups', 'plans'];
const allPerms = () => Object.fromEntries(PERM_KEYS.map((p) => [p, true]));

// ---- small caches (teams and positions rarely change) ----
let teamCache = { at: 0, list: [] };
let posCache = { at: 0, list: [] };
export async function teamsList() {
  if (Date.now() - teamCache.at > 10000) teamCache = { at: Date.now(), list: await Team.find({}).sort({ order: 1, name: 1 }).lean() };
  return teamCache.list;
}
export async function positionsList() {
  if (Date.now() - posCache.at > 10000) posCache = { at: Date.now(), list: await Position.find({}).sort({ order: 1, label: 1 }).lean() };
  return posCache.list;
}
export const forgetTeams = () => (teamCache.at = 0);
export const forgetPositions = () => (posCache.at = 0);

export const teamView = (t) => ({ key: t.key, name: t.name, kind: t.kind, groupLink: t.groupLink || '', order: t.order || 0 });
export const isAvTeam = (team) => (team?.kind || 'av') === 'av';

// Position key -> team key
export async function positionTeams() {
  return Object.fromEntries((await positionsList()).map((p) => [p.key, p.team || AV]));
}
export const baseKey = (k) => String(k).replace(/\+shadow$/, '');

// Keys of the positions on the team this request works in (memoized on the request)
export async function teamKeys(req) {
  if (!req._teamKeys) req._teamKeys = new Set((await positionsList()).filter((p) => (p.team || AV) === req.team.key).map((p) => p.key));
  return req._teamKeys;
}
// Only this team's entries of a list of position keys (shadow slots follow their position)
export const onlyTeam = (list, keys) => (list || []).filter((k) => keys.has(baseKey(k)));
// Replace this team's entries in a list of position keys, keeping other teams' entries
export const mergeTeam = (old, next, keys) => [...new Set([...(old || []).filter((k) => !keys.has(baseKey(k))), ...(next || []).filter((k) => keys.has(baseKey(k)))])];

// Which team a request works in: the X-Team header if they're on it, else their first team.
export async function resolveTeam(req, user) {
  const teams = await teamsList();
  const keys = teams.map((t) => t.key);
  const mine = user.role === 'admin' ? keys : (user.teams || []).map((m) => m.team).filter((k) => keys.includes(k));
  const wanted = req.get('x-team');
  const key = wanted && mine.includes(wanted) ? wanted : mine[0] || AV;
  return teams.find((t) => t.key === key) || { key, name: 'AV Team', kind: 'av' };
}

// The person's teams, for the switcher
export async function teamsOf(user) {
  const teams = await teamsList();
  if (user.role === 'admin') return teams.map(teamView);
  return teams.filter((t) => membershipOf(user, t.key)).map(teamView);
}

// Admin, the team's head, or a leader of this team
export const isTeamLeader = (req) => ['admin', 'leader'].includes(roleIn(req.user, req.team.key));
export const requireTeamLeader = (req, res, next) => (isTeamLeader(req) ? next() : next(forbidden('Only a team leader can do that.')));
// The admin or this team's head leader (they choose the team's leaders)
export const isTeamHead = (req) => req.user.role === 'admin' || !!membershipOf(req.user, req.team.key)?.head;
export const requireTeamHead = (req, res, next) => (isTeamHead(req) ? next() : next(forbidden('Only the admin or this team’s head leader can do that.')));
// Gear, media, outside groups, the livestream and the Academy belong to AV
export const requireAvTeam = (req, res, next) => (req.user.role === 'admin' || isAvTeam(req.team) ? next() : next(forbidden('That’s part of the AV team’s side.')));
// Anyone on a team (crew can edit songs, Bible texts and announcements)
export const requireMember = (req, res, next) => (roleIn(req.user, req.team.key) ? next() : next(forbidden('You aren’t on this team.')));

// ---- one-time move onto teams ----
export async function ensureTeams() {
  if (!(await Team.exists({}))) {
    await Team.create([
      { key: AV, name: 'AV Team', kind: 'av', order: 0 },
      { key: 'praise', name: 'Praise Team', kind: 'music', order: 1 },
    ]);
  }
  await Position.updateMany({ $or: [{ team: { $exists: false } }, { team: null }, { team: '' }] }, { $set: { team: AV } });
  const s = await Settings.findOne({ key: 'main' });
  if (s?.groupLink) await Team.updateOne({ key: AV, groupLink: '' }, { $set: { groupLink: s.groupLink } });
  const loose = await User.find({ $or: [{ teams: { $exists: false } }, { teams: { $size: 0 } }] });
  for (const u of loose) {
    const isAdmin = u.role === 'admin';
    u.teams = [
      {
        team: AV,
        role: isAdmin || u.role === 'leader' ? 'leader' : 'crew',
        head: isAdmin,
        title: u.leaderTitle || '',
        perms: isAdmin ? allPerms() : u.role === 'leader' ? Object.fromEntries(PERM_KEYS.map((p) => [p, !!u.perms?.[p]])) : {},
        maxPerMonth: u.maxPerMonth || 0,
      },
    ];
    await u.save();
  }
  forgetTeams();
  forgetPositions();
  if (loose.length) console.log(`Moved ${loose.length} people onto the AV team.`);
}
