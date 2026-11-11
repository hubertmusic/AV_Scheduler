// Teams: the admin adds teams and picks each team's head leader; the head leader (or the admin)
// sets the team's name, WhatsApp group and which of its positions each weekend service needs.
import { Router } from 'express';
import { Position, Team, TEAM_KINDS, User } from '../models.js';
import { requireAdmin } from '../auth.js';
import { bad, conflict, forbidden, getSettings, isHttpUrl, isId, membershipOf, normalizeUrl, notFound, str, wrap } from '../lib/util.js';
import { forgetTeams, isTeamHead, mergeTeam, requireTeamHead, teamKeys, teamView } from '../lib/teams.js';

export const teamsRouter = Router();

const LEADER_PERMS = { edit: true, approve: true, message: true, resources: true, people: true, groups: false, plans: true };

async function loadTeam(key) {
  const t = await Team.findOne({ key });
  if (!t) throw notFound('That team no longer exists.');
  return t;
}

// GET /api/teams — every team with its head leader(s) and how many people and positions it has
teamsRouter.get('/', wrap(async (req, res) => {
  const [teams, people, positions] = await Promise.all([
    Team.find({}).sort({ order: 1, name: 1 }).lean(),
    User.find({ active: true }, { name: 1, teams: 1, role: 1 }).lean(),
    Position.find({}, { team: 1 }).lean(),
  ]);
  res.json(
    teams.map((t) => ({
      ...teamView(t),
      people: people.filter((u) => membershipOf(u, t.key)).length,
      positions: positions.filter((p) => (p.team || 'av') === t.key).length,
      heads: people.filter((u) => membershipOf(u, t.key)?.head).map((u) => ({ id: String(u._id), name: u.name })),
    }))
  );
}));

// POST /api/teams { name, kind } — admin
teamsRouter.post('/', requireAdmin, wrap(async (req, res) => {
  const name = str(req.body.name, 40);
  if (!name) throw bad('Name the team.');
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'team';
  let key = base;
  for (let i = 2; await Team.exists({ key }); i++) key = `${base}-${i}`;
  const t = await Team.create({ key, name, kind: TEAM_KINDS.includes(req.body.kind) ? req.body.kind : 'other', order: await Team.countDocuments({}) });
  forgetTeams();
  res.locals.activity = `Added the ${name}`;
  res.status(201).json(teamView(t));
}));

// PATCH /api/teams/:key { name, groupLink, kind } — the admin, or that team's head leader
teamsRouter.patch('/:key', wrap(async (req, res) => {
  const t = await loadTeam(req.params.key);
  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && !(t.key === req.team.key && isTeamHead(req))) throw forbidden('Only the admin or this team’s head leader can change it.');
  if (req.body.name !== undefined) {
    const name = str(req.body.name, 40);
    if (!name) throw bad('Name the team.');
    t.name = name;
  }
  if (req.body.groupLink !== undefined) {
    const link = normalizeUrl(str(req.body.groupLink, 300));
    if (link && !isHttpUrl(link)) throw bad('That doesn’t look like a link.');
    t.groupLink = link;
  }
  if (req.body.kind !== undefined) {
    if (!isAdmin) throw forbidden('Only the admin can change what kind of team this is.');
    if (!TEAM_KINDS.includes(req.body.kind)) throw bad('Pick AV, music or other.');
    if (t.key === 'av' && req.body.kind !== 'av') throw bad('The AV team stays an AV team.');
    t.kind = req.body.kind;
  }
  await t.save();
  forgetTeams();
  res.locals.activity = `Updated the ${t.name}`;
  res.json(teamView(t));
}));

// PUT /api/teams/:key/head { userId } — the admin picks a team's head leader (e.g. after an
// election). They join the team as a leader if needed; the previous head stays a leader.
teamsRouter.put('/:key/head', requireAdmin, wrap(async (req, res) => {
  const t = await loadTeam(req.params.key);
  if (!isId(req.body.userId)) throw bad('Pick a person.');
  const user = await User.findById(req.body.userId);
  if (!user || !user.active) throw bad('That person isn’t active.');
  if (user.role === 'admin') throw bad('You’re already over every team.');
  const before = (await User.find({ 'teams.team': t.key })).filter((u) => membershipOf(u, t.key)?.head);
  for (const u of before) {
    if (String(u._id) === String(user._id)) continue;
    membershipOf(u, t.key).head = false;
    await u.save();
  }
  let m = membershipOf(user, t.key);
  if (!m) {
    user.teams.push({ team: t.key, role: 'leader' });
    m = membershipOf(user, t.key);
  }
  m.role = 'leader';
  m.head = true;
  m.perms = { ...LEADER_PERMS };
  if (!m.title) m.title = `${t.name} leader`;
  await user.save();
  res.locals.activity = `Made ${user.name} head leader of the ${t.name}`;
  res.json({ ok: true });
}));

// PUT /api/teams/current/template { needs: [[keys] per template service] } — which of this team's
// positions each weekend template service needs. Other teams' positions stay as they are.
teamsRouter.put('/current/template', requireTeamHead, wrap(async (req, res) => {
  const list = req.body.needs;
  const s = await getSettings();
  if (!Array.isArray(list) || list.length !== s.weekendTemplate.length) throw conflict('The weekend template changed. Reload and try again.');
  const keys = await teamKeys(req);
  s.weekendTemplate = s.weekendTemplate.map((t, i) => ({ ...t.toObject(), needs: mergeTeam(t.needs, Array.isArray(list[i]) ? list[i] : [], keys) }));
  await s.save();
  res.locals.activity = `Set the ${req.team.name}’s positions on the weekend template`;
  res.json({ weekendTemplate: s.weekendTemplate });
}));
