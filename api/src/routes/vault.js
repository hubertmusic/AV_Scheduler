// Each team's vault: stream keys, ProPresenter licenses, accounts, Wi-Fi… The head leader keeps it,
// with the leaders the admin or head leader give the Vault privilege. They can give anyone else on
// the team access to all of it or chosen entries, for 30 minutes up to "until taken back". Others
// don't see it at all. Secrets are encrypted in the database, only shown when someone taps Show,
// and every look is in the vault's log. Also: everyone's notes, private unless they share one.
import { Router } from 'express';
import { Note, User, VAULT_CATEGORIES, VaultEntry, VaultGrant, VaultLog } from '../models.js';
import { bad, forbidden, isHttpUrl, isId, membershipOf, normalizeUrl, notFound, str, wrap } from '../lib/util.js';
import { teamsList } from '../lib/teams.js';
import { open, seal, vaultBroken, vaultKeyFromEnv } from '../lib/secrets.js';

export const vaultRouter = Router();
export const notesRouter = Router();

// Who keeps a team's vault: its head leader, and leaders with the Vault privilege (given by the
// admin or the head leader on Team & roles). Being the Crew Call admin isn't enough on its own:
// the admin needs that place on the team too, so the Church Admin vault stays theirs.
export const keepsVault = (user, team) => {
  const m = membershipOf(user, team);
  return !!m && (m.head || (m.role === 'leader' && !!m.perms?.vault));
};
const isLeader = keepsVault;
// For the tab: whether this person sees a vault on this team at all
export async function vaultFor(user, team) {
  if (keepsVault(user, team)) return { keeper: true };
  if (!membershipOf(user, team)) return null;
  const now = new Date();
  const g = await VaultGrant.findOne({ team, user: user._id, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }, { expiresAt: 1 }).lean();
  return g ? { keeper: false, until: g.expiresAt } : null;
}
const MAX_GRANT_DAYS = 365;

vaultRouter.use((req, res, next) => {
  if (req.previewing) return next(forbidden('The vault isn’t shown in a preview.'));
  if (!membershipOf(req.user, req.team.key)) {
    if (req.method === 'GET' && req.path === '/') return res.json({ team: req.team.name, leader: false, access: null, entries: [] });
    return next(forbidden(`You aren’t on the ${req.team.name}, so its vault isn’t yours to open.`));
  }
  if (req.method !== 'GET') res.locals.activity = `Worked in the ${req.team.name} vault`;
  next();
});

async function myGrant(req) {
  const now = new Date();
  return VaultGrant.findOne({ team: req.team.key, user: req.user._id, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).sort({ expiresAt: -1 }).lean();
}
// The entries this person may open: leaders all; crew with access the shared ones they were given
async function access(req) {
  if (isLeader(req.user, req.team.key)) return { leader: true, grant: null, allows: () => true };
  const grant = await myGrant(req);
  if (!grant) return { leader: false, grant: null, allows: () => false };
  const ids = new Set((grant.entries || []).map(String));
  return { leader: false, grant, allows: (e) => !e.leadersOnly && (grant.all || ids.has(String(e._id))) };
}

const log = (req, action, entry, detail = '') => VaultLog.create({ team: req.team.key, user: req.user._id, action, entry: entry?._id, entryTitle: entry?.title || '', detail });
const entryView = (e) => ({ id: String(e._id), title: e.title, category: e.category, url: e.url, hasUsername: !!e.username, hasSecret: !!e.secret, hasNotes: !!e.notes, leadersOnly: e.leadersOnly, updatedAt: e.updatedAt });

// GET /api/vault — what this person can see of the team's vault
vaultRouter.get('/', wrap(async (req, res) => {
  const a = await access(req);
  // Nothing at all for people who don't keep it and weren't given time
  if (!a.leader && !a.grant) return res.json({ team: req.team.name, leader: false, access: null, entries: [] });
  const base = { team: req.team.name, leader: a.leader, broken: vaultBroken(), keyFromEnv: vaultKeyFromEnv(), categories: VAULT_CATEGORIES };
  const entries = (await VaultEntry.find({ team: req.team.key }).sort({ category: 1, title: 1 }).lean()).filter(a.allows);
  const out = { ...base, access: a.leader ? { leader: true } : { all: a.grant.all, until: a.grant.expiresAt }, entries: entries.map(entryView) };
  if (a.leader) {
    const now = new Date();
    const [grants, logs] = await Promise.all([
      VaultGrant.find({ team: req.team.key, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).populate('user', 'name').populate('grantedBy', 'name').sort({ createdAt: -1 }).lean(),
      VaultLog.find({ team: req.team.key }).sort({ createdAt: -1 }).limit(80).populate('user', 'name').lean(),
    ]);
    const titles = Object.fromEntries(entries.map((e) => [String(e._id), e.title]));
    out.grants = grants.filter((g) => g.user).map((g) => ({ id: String(g._id), user: { id: String(g.user._id), name: g.user.name }, all: g.all, entries: (g.entries || []).map((x) => ({ id: String(x), title: titles[String(x)] || '(removed)' })), until: g.expiresAt, by: g.grantedBy?.name || '', at: g.createdAt }));
    out.log = logs.map((l) => ({ id: String(l._id), who: l.user?.name || '', action: l.action, entry: l.entryTitle, detail: l.detail, at: l.createdAt }));
    // Who can be given time: everyone on the team who doesn't already keep the vault
    const team = await User.find({ active: true, 'teams.team': req.team.key }, { name: 1, teams: 1 }).sort({ name: 1 }).lean();
    out.members = team.filter((u) => membershipOf(u, req.team.key) && !isLeader(u, req.team.key)).map((u) => ({ id: String(u._id), name: u.name }));
    out.keepers = team.filter((u) => isLeader(u, req.team.key)).map((u) => ({ id: String(u._id), name: u.name, head: !!membershipOf(u, req.team.key)?.head }));
  }
  res.json(out);
}));

async function loadEntry(req) {
  if (!isId(req.params.id)) throw notFound();
  const e = await VaultEntry.findOne({ _id: req.params.id, team: req.team.key });
  if (!e) throw notFound('That entry was removed.');
  return e;
}
const requireLeader = (req, res, next) => (isLeader(req.user, req.team.key) ? next() : next(forbidden('Only the head leader and leaders with the Vault privilege can do that.')));

// POST /api/vault/:id/reveal — the secret itself (logged)
vaultRouter.post('/:id/reveal', wrap(async (req, res) => {
  const e = await loadEntry(req);
  const a = await access(req);
  if (!a.allows(e)) throw forbidden(a.grant || a.leader ? 'That entry is for leaders only.' : 'Your time in the vault has ended. Ask a leader for more.');
  const out = { username: open(e.username), secret: open(e.secret), notes: open(e.notes) };
  await log(req, 'viewed', e);
  res.json(out);
}));

function readEntry(b, prev) {
  const out = {};
  if (!prev || b.title !== undefined) {
    out.title = str(b.title, 120);
    if (!out.title) throw bad('Name it (e.g. YouTube stream key).');
  }
  if (b.category !== undefined || !prev) out.category = VAULT_CATEGORIES.includes(b.category) ? b.category : 'Other';
  if (b.url !== undefined) {
    const url = normalizeUrl(str(b.url, 500));
    if (url && !isHttpUrl(url)) throw bad('That doesn’t look like a link.');
    out.url = url;
  }
  // Secret fields: undefined = keep; '' = clear
  if (b.username !== undefined) out.username = seal(str(b.username, 300));
  if (b.secret !== undefined) out.secret = seal(String(b.secret ?? '').slice(0, 4000));
  if (b.notes !== undefined) out.notes = seal(String(b.notes ?? '').slice(0, 4000));
  if (b.leadersOnly !== undefined) out.leadersOnly = !!b.leadersOnly;
  return out;
}
vaultRouter.post('/', requireLeader, wrap(async (req, res) => {
  if (vaultBroken()) throw bad('The vault key changed. Put the old VAULT_KEY back first.');
  const e = await VaultEntry.create({ ...readEntry(req.body || {}), team: req.team.key, createdBy: req.user._id, updatedBy: req.user._id });
  await log(req, 'added', e);
  res.status(201).json(entryView(e));
}));
vaultRouter.patch('/:id', requireLeader, wrap(async (req, res) => {
  if (vaultBroken()) throw bad('The vault key changed. Put the old VAULT_KEY back first.');
  const e = await loadEntry(req);
  Object.assign(e, readEntry(req.body || {}, e), { updatedBy: req.user._id });
  await e.save();
  await log(req, 'changed', e);
  res.json(entryView(e));
}));
vaultRouter.delete('/:id', requireLeader, wrap(async (req, res) => {
  const e = await loadEntry(req);
  await e.deleteOne();
  await VaultGrant.updateMany({ team: req.team.key }, { $pull: { entries: e._id } });
  await log(req, 'removed', e);
  res.status(204).end();
}));

// POST /api/vault/grants { userId, minutes | until (ISO) | unlimited, all, entries }
vaultRouter.post('/grants', requireLeader, wrap(async (req, res) => {
  const b = req.body || {};
  if (!isId(b.userId)) throw bad('Pick a person.');
  const user = await User.findById(b.userId);
  if (!user || !user.active || !membershipOf(user, req.team.key)) throw bad(`They aren’t on the ${req.team.name}.`);
  if (isLeader(user, req.team.key)) throw bad(`${user.name} already keeps the vault.`);
  let expiresAt = null;
  if (!b.unlimited) {
    if (b.until) expiresAt = new Date(b.until);
    else expiresAt = new Date(Date.now() + Math.round(Number(b.minutes) || 0) * 60 * 1000);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw bad('Pick how long, or a time in the future.');
    if (expiresAt - Date.now() > MAX_GRANT_DAYS * 24 * 3600 * 1000) throw bad('Pick up to a year, or no end.');
  }
  const all = b.all !== false;
  const entries = all ? [] : (await VaultEntry.find({ team: req.team.key, _id: { $in: (Array.isArray(b.entries) ? b.entries : []).filter(isId) }, leadersOnly: false }, { _id: 1 }).lean()).map((e) => e._id);
  if (!all && !entries.length) throw bad('Pick at least one entry.');
  await VaultGrant.deleteMany({ team: req.team.key, user: user._id }); // one grant per person: the newest
  const g = await VaultGrant.create({ team: req.team.key, user: user._id, all, entries, expiresAt, grantedBy: req.user._id });
  await VaultLog.create({ team: req.team.key, user: req.user._id, action: 'granted', detail: `${user.name}: ${all ? 'the whole vault' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}, ${expiresAt ? `until ${expiresAt.toISOString()}` : 'until taken back'}` });
  res.status(201).json({ id: String(g._id), until: g.expiresAt });
}));
vaultRouter.delete('/grants/:id', requireLeader, wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const g = await VaultGrant.findOne({ _id: req.params.id, team: req.team.key }).populate('user', 'name');
  if (!g) throw notFound();
  await g.deleteOne();
  await VaultLog.create({ team: req.team.key, user: req.user._id, action: 'revoked', detail: g.user?.name || '' });
  res.status(204).end();
}));

// ---------- notes (private unless the writer shares one) ----------
notesRouter.use((req, res, next) => {
  if (req.previewing) return next(forbidden('Notes are private, so they aren’t shown in a preview.'));
  if (req.method !== 'GET') res.locals.activity = 'Updated their notes';
  next();
});
const myTeamKeys = (user) => (user.teams || []).map((m) => m.team);
const MAX_SHARE_PEOPLE = 100;
const noteView = (n) => ({ id: String(n._id), title: n.title, body: open(n.body), pinned: n.pinned, updatedAt: n.updatedAt });
const myNoteView = (n) => ({ ...noteView(n), shareTeams: n.shareTeams || [], shareUsers: (n.shareUsers || []).filter((u) => u?.name).map((u) => ({ id: String(u._id), name: u.name })) });

// GET /api/notes — { mine, shared, teams }: their own notes, notes others shared with them, and
// the teams they can share with
notesRouter.get('/', wrap(async (req, res) => {
  const me = req.user._id;
  const keys = myTeamKeys(req.user);
  const [mine, shared, teams] = await Promise.all([
    Note.find({ user: me }).sort({ pinned: -1, updatedAt: -1 }).limit(500).populate('shareUsers', 'name').lean(),
    Note.find({ user: { $ne: me }, $or: [{ shareUsers: me }, ...(keys.length ? [{ shareTeams: { $in: keys } }] : [])] }).sort({ updatedAt: -1 }).limit(300).populate('user', 'name active').lean(),
    teamsList(),
  ]);
  const teamName = (k) => teams.find((t) => t.key === k)?.name || k;
  res.json({
    mine: mine.map(myNoteView),
    shared: shared
      .filter((n) => n.user && n.user.active !== false)
      .map((n) => {
        const viaTeams = (n.shareTeams || []).filter((k) => keys.includes(k)).map(teamName);
        const direct = (n.shareUsers || []).some((u) => String(u) === String(me));
        return { ...noteView(n), from: n.user.name, via: [...(direct ? ['you'] : []), ...viaTeams] };
      }),
    teams: keys.filter((k) => teams.some((t) => t.key === k)).map((k) => ({ key: k, name: teamName(k) })),
  });
}));

// Sharing: only with teams the writer is on, and with real people (not themselves)
async function readShare(req, b) {
  const out = {};
  if (b.shareTeams !== undefined) {
    const keys = myTeamKeys(req.user);
    out.shareTeams = [...new Set((Array.isArray(b.shareTeams) ? b.shareTeams : []).map(String))].filter((k) => keys.includes(k));
  }
  if (b.shareUsers !== undefined) {
    const ids = [...new Set((Array.isArray(b.shareUsers) ? b.shareUsers : []).map(String))].filter((id) => isId(id) && id !== String(req.user._id));
    if (ids.length > MAX_SHARE_PEOPLE) throw bad(`Share with up to ${MAX_SHARE_PEOPLE} people, or with a whole team.`);
    out.shareUsers = (await User.find({ _id: { $in: ids }, active: true }, { _id: 1 }).lean()).map((u) => u._id);
  }
  return out;
}
const fresh = async (n) => myNoteView(await Note.findById(n._id).populate('shareUsers', 'name').lean());

notesRouter.post('/', wrap(async (req, res) => {
  if ((await Note.countDocuments({ user: req.user._id })) >= 500) throw bad('You have 500 notes. Remove some first.');
  const b = req.body || {};
  const n = await Note.create({ user: req.user._id, title: str(b.title, 160), body: seal(String(b.body ?? '').slice(0, 50000)), pinned: !!b.pinned, ...(await readShare(req, b)) });
  res.status(201).json(await fresh(n));
}));
async function myNote(req) {
  if (!isId(req.params.id)) throw notFound();
  const n = await Note.findOne({ _id: req.params.id, user: req.user._id });
  if (!n) throw notFound('Only the person who wrote a note can change it.');
  return n;
}
notesRouter.patch('/:id', wrap(async (req, res) => {
  const n = await myNote(req);
  const b = req.body || {};
  if (b.title !== undefined) n.title = str(b.title, 160);
  if (b.body !== undefined) n.body = seal(String(b.body ?? '').slice(0, 50000));
  if (b.pinned !== undefined) n.pinned = !!b.pinned;
  Object.assign(n, await readShare(req, b));
  await n.save();
  res.json(await fresh(n));
}));
notesRouter.delete('/:id', wrap(async (req, res) => {
  const n = await myNote(req);
  await n.deleteOne();
  res.status(204).end();
}));
