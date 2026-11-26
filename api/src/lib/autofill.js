import { Assignment, Event, User } from '../models.js';
import { addDays } from './util.js';
import { awayByEvent, isShadow, monthCountsByTeam, recentLoad, unavailableByEvent } from './availability.js';
import { baseKey, positionTeams } from './teams.js';
import { describeWeek, matchesWeek } from './regulars.js';

/**
 * Proposes people for every open spot on a weekend. Nothing is saved.
 * Rules: trained for the position, active, not away / marked unavailable, not already
 * on that service, under their monthly limit. Among those, it prefers people with the
 * fewest shifts this weekend, then on the same day, then this month, then over the last 8 weeks, then
 * whoever served longest ago. A sound check prefers whoever has that position on its service.
 * A service with no Lead yet prefers someone who's a Lead on that position.
 *
 * opts (used by the month planner, which plans on a draft instead of the saved schedule):
 *   draft:   [{ eventId, position, userId }] stands in for the saved assignments
 *   monthly: { 'YYYY-MM': { userId: shifts } } stands in for the saved monthly counts
 *   dates:   [from, to] plans those days instead of the weekend (weekday services; regulars,
 *            which are weekend rules, don't apply)
 *   keys:    Set of position keys: only fill those (one team's positions)
 *
 * Monthly limits and counts are per team: someone can sing twice a month and run slides once.
 * Monthly counts are keyed "userId|team".
 */
export async function planAutofill(friday, opts = {}) {
  const [from, to] = opts.dates || [friday, addDays(friday, 2)];
  const events = await Event.find({ date: { $gte: from, $lte: to } }).sort({ date: 1, start: 1 }).lean();
  if (!events.length) return { proposals: [], unfilled: [], regularNotes: [] };
  const evIds = new Set(events.map((e) => String(e._id)));
  const [people, saved, unav, away, recent] = await Promise.all([
    User.find({ active: true }).lean(),
    opts.draft ? [] : Assignment.find({ event: { $in: events.map((e) => e._id) } }).lean(),
    unavailableByEvent(events),
    awayByEvent(events),
    recentLoad(friday, 56),
  ]);
  const asg = opts.draft ? opts.draft.filter((a) => evIds.has(String(a.eventId))).map((a) => ({ event: a.eventId, position: a.position, user: a.userId })) : saved;
  const posTeam = await positionTeams();
  const teamOf = (pos) => posTeam[baseKey(pos)] || 'av';
  const months = [...new Set(events.map((e) => e.date.slice(0, 7)))];
  const monthly = Object.fromEntries(await Promise.all(months.map(async (m) => [m, opts.monthly?.[m] ? { ...opts.monthly[m] } : await monthCountsByTeam(`${m}-01`, posTeam)])));
  const personById = Object.fromEntries(people.map((p) => [String(p._id), p]));
  const leadOn = {}; // "eventId|team" -> true once someone who's a Lead on their position is on it
  const leadKey = (e, pos) => `${e._id ?? e}|${teamOf(pos)}`;
  const limitOf = (p, pos) => {
    const m = (p.teams || []).find((t) => t.team === teamOf(pos));
    return m ? m.maxPerMonth || 0 : p.maxPerMonth || 0;
  };
  const countKey = (uid, pos) => `${uid}|${teamOf(pos)}`;
  const monthCount = (m, uid, pos) => (monthly[m]?.[countKey(uid, pos)] || 0) + (added[m]?.[countKey(uid, pos)] || 0);
  const atLimit = (p, m, pos) => {
    const lim = limitOf(p, pos);
    return lim > 0 && monthCount(m, String(p._id), pos) >= lim;
  };
  const addCount = (m, uid, pos) => ((added[m] ||= {})[countKey(uid, pos)] = (added[m][countKey(uid, pos)] || 0) + 1);
  const fillable = (pos) => !opts.keys || opts.keys.has(baseKey(pos));

  const holder = {}; // "eventId|pos" -> userId
  const onEvent = {}; // eventId -> Set(userId)
  const weekend = {}; // userId -> shifts this weekend
  const sameDay = {}; // date -> { userId: n }
  const evById = Object.fromEntries(events.map((e) => [String(e._id), e]));
  const add = (e, pos, uid) => {
    const eid = String(e._id);
    holder[`${eid}|${pos}`] = uid;
    (onEvent[eid] ||= new Set()).add(uid);
    if (isShadow(pos)) return;
    if (personById[uid]?.leads?.includes(pos)) leadOn[leadKey(e, pos)] = true;
    weekend[uid] = (weekend[uid] || 0) + 1;
    (sameDay[e.date] ||= {})[uid] = (sameDay[e.date][uid] || 0) + 1;
  };
  for (const a of asg) {
    const e = evById[String(a.event)];
    if (!e) continue;
    holder[`${e._id}|${a.position}`] = String(a.user);
    (onEvent[String(e._id)] ||= new Set()).add(String(a.user));
    if (!isShadow(a.position) && personById[String(a.user)]?.leads?.includes(a.position)) leadOn[leadKey(e, a.position)] = true;
    if (!isShadow(a.position)) {
      weekend[String(a.user)] = (weekend[String(a.user)] || 0) + 1;
      (sameDay[e.date] ||= {})[String(a.user)] = (sameDay[e.date][String(a.user)] || 0) + 1;
    }
  }
  const added = {}; // month -> { userId: n } proposed in this run

  const eligible = (e, pos) =>
    people.filter((p) => {
      const uid = String(p._id);
      const eid = String(e._id);
      if (!p.positions.includes(pos)) return false;
      if (onEvent[eid]?.has(uid)) return false;
      if (unav[eid]?.has(uid) || away[eid]?.has(uid)) return false;
      if (atLimit(p, e.date.slice(0, 7), pos)) return false;
      return true;
    });

  const why = (e, pos) => {
    const trained = people.filter((p) => p.positions.includes(pos));
    if (!trained.length) return 'No one is trained for this position.';
    return 'Everyone trained is away, unavailable, already on this service or at their monthly limit.';
  };

  const proposals = [];
  const regularNotes = [];

  // 1) Regulars first: people who serve on a set pattern (e.g. 2nd Sabbath every month).
  //    Their job can vary: they get whichever of their positions is open (scarcest first),
  //    or the first open one from the positions the rule lists.
  const ruleEntries = [];
  if (!opts.dates) for (const p of people) for (const r of p.regulars || []) if (matchesWeek(r, friday)) ruleEntries.push({ p, r });
  ruleEntries.sort((a, b) => (b.r.positions.length ? 1 : 0) - (a.r.positions.length ? 1 : 0));
  const services = events.filter((e) => (e.kind || 'service') === 'service');
  for (const { p, r } of ruleEntries) {
    const uid = String(p._id);
    const label = `${describeWeek(r)}${r.service ? ` · ${r.service}` : ''}`;
    const evs = services.filter((e) => !r.service || e.title.toLowerCase() === r.service.toLowerCase());
    if (!evs.length) {
      regularNotes.push({ userId: uid, name: p.name, rule: label, why: r.service ? `There’s no “${r.service}” this weekend.` : 'No services this weekend.' });
      continue;
    }
    if (evs.some((e) => onEvent[String(e._id)]?.has(uid))) continue; // already placed
    let placed = false;
    let why = '';
    for (const e of evs) {
      const eid = String(e._id);
      if (away[eid]?.has(uid) || unav[eid]?.has(uid)) {
        why = 'Away or unavailable that weekend.';
        continue;
      }
      const m = e.date.slice(0, 7);
      const wanted = (r.positions.length ? r.positions.filter((k) => p.positions.includes(k)) : p.positions).filter(fillable);
      const free = wanted.filter((k) => e.needs.includes(k) && !holder[`${eid}|${k}`]);
      const open = free.filter((k) => !atLimit(p, m, k));
      if (!open.length) {
        why = free.length ? 'Already at their monthly limit.' : 'Their positions are already filled on that service.';
        continue;
      }
      // Listed positions keep their order of preference; otherwise take the hardest spot to fill.
      const pos = r.positions.length ? open[0] : open.map((k) => [k, eligible(e, k).length]).sort((a, b) => a[1] - b[1])[0][0];
      add(e, pos, uid);
      addCount(m, uid, pos);
      proposals.push({ eventId: eid, position: pos, userId: uid, userName: p.name, reason: `Regular: ${label}`, regular: true });
      placed = true;
      break;
    }
    if (!placed) regularNotes.push({ userId: uid, name: p.name, rule: label, why: why || 'No open spot for them.' });
  }

  // 2) Everyone else for the spots still open.
  let slots = [];
  for (const e of events) for (const pos of e.needs) if (fillable(pos) && !holder[`${e._id}|${pos}`]) slots.push({ e, pos });
  // Services before sound checks (so checks can follow their service), scarcest spots first.
  slots = slots
    .map((s) => ({ ...s, n: eligible(s.e, s.pos).length, check: s.e.kind === 'soundcheck' ? 1 : 0 }))
    .sort((a, b) => a.check - b.check || a.n - b.n || a.e.date.localeCompare(b.e.date) || a.e.start.localeCompare(b.e.start));

  const unfilled = [];
  for (const { e, pos } of slots) {
    const list = eligible(e, pos);
    if (!list.length) {
      unfilled.push({ eventId: String(e._id), position: pos, why: why(e, pos) });
      continue;
    }
    let pick = null;
    let reason = '';
    if (e.kind === 'soundcheck' && e.forEvent) {
      const svcHolder = holder[`${e.forEvent}|${pos}`];
      pick = list.find((p) => String(p._id) === svcHolder) || null;
      if (pick) reason = 'Same person as the service';
    }
    if (!pick) {
      const score = (p) => {
        const uid = String(p._id);
        const lead = !leadOn[leadKey(e, pos)] && p.leads?.includes(pos) ? -60 : 0;
        const month = monthCount(e.date.slice(0, 7), uid, pos); // spreads shifts across the month
        return (weekend[uid] || 0) * 100 + (sameDay[e.date]?.[uid] || 0) * 40 + month * 25 + (recent.count[uid] || 0) * 5 + lead;
      };
      list.sort((a, b) => score(a) - score(b) || (recent.last[String(a._id)] || '').localeCompare(recent.last[String(b._id)] || '') || a.name.localeCompare(b.name));
      pick = list[0];
      const n = recent.count[String(pick._id)] || 0;
      const w = weekend[String(pick._id)] || 0;
      reason = `${w ? `${w} other shift${w === 1 ? '' : 's'} this weekend · ` : ''}${n} shift${n === 1 ? '' : 's'} in the last 8 weeks`;
    }
    if (!leadOn[leadKey(e, pos)] && pick.leads?.includes(pos)) reason = `Lead on this position · ${reason}`;
    const uid = String(pick._id);
    add(e, pos, uid);
    addCount(e.date.slice(0, 7), uid, pos);
    proposals.push({ eventId: String(e._id), position: pos, userId: uid, userName: pick.name, reason });
  }
  const order = Object.fromEntries(events.map((e, i) => [String(e._id), i]));
  proposals.sort((a, b) => order[a.eventId] - order[b.eventId]);
  unfilled.sort((a, b) => order[a.eventId] - order[b.eventId]);
  return { proposals, unfilled, regularNotes };
}
