import { Assignment, Event, User } from '../models.js';
import { addDays } from './util.js';
import { awayByEvent, isShadow, monthCounts, recentLoad, unavailableByEvent } from './availability.js';
import { describeWeek, matchesWeek } from './regulars.js';

/**
 * Proposes people for every open spot on a weekend. Nothing is saved.
 * Rules: trained for the position, active, not away / marked unavailable, not already
 * on that service, under their monthly limit. Among those, it prefers people with the
 * fewest shifts this weekend, then on the same day, then over the last 8 weeks, then
 * whoever served longest ago. A sound check prefers whoever has that position on its service.
 */
export async function planAutofill(friday) {
  const events = await Event.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).sort({ date: 1, start: 1 }).lean();
  if (!events.length) return { proposals: [], unfilled: [], regularNotes: [] };
  const [people, asg, unav, away, recent] = await Promise.all([
    User.find({ active: true }).lean(),
    Assignment.find({ event: { $in: events.map((e) => e._id) } }).lean(),
    unavailableByEvent(events),
    awayByEvent(events),
    recentLoad(friday, 56),
  ]);
  const months = [...new Set(events.map((e) => e.date.slice(0, 7)))];
  const monthly = Object.fromEntries(await Promise.all(months.map(async (m) => [m, await monthCounts(`${m}-01`)])));

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
    weekend[uid] = (weekend[uid] || 0) + 1;
    (sameDay[e.date] ||= {})[uid] = (sameDay[e.date][uid] || 0) + 1;
  };
  for (const a of asg) {
    const e = evById[String(a.event)];
    if (!e) continue;
    holder[`${e._id}|${a.position}`] = String(a.user);
    (onEvent[String(e._id)] ||= new Set()).add(String(a.user));
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
      const m = e.date.slice(0, 7);
      if (p.maxPerMonth && (monthly[m][uid] || 0) + (added[m]?.[uid] || 0) >= p.maxPerMonth) return false;
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
  for (const p of people) for (const r of p.regulars || []) if (matchesWeek(r, friday)) ruleEntries.push({ p, r });
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
      if (p.maxPerMonth && (monthly[m][uid] || 0) + (added[m]?.[uid] || 0) >= p.maxPerMonth) {
        why = 'Already at their monthly limit.';
        continue;
      }
      const wanted = r.positions.length ? r.positions.filter((k) => p.positions.includes(k)) : p.positions;
      const open = wanted.filter((k) => e.needs.includes(k) && !holder[`${eid}|${k}`]);
      if (!open.length) {
        why = 'Their positions are already filled on that service.';
        continue;
      }
      // Listed positions keep their order of preference; otherwise take the hardest spot to fill.
      const pos = r.positions.length ? open[0] : open.map((k) => [k, eligible(e, k).length]).sort((a, b) => a[1] - b[1])[0][0];
      add(e, pos, uid);
      (added[m] ||= {})[uid] = (added[m][uid] || 0) + 1;
      proposals.push({ eventId: eid, position: pos, userId: uid, userName: p.name, reason: `Regular: ${label}`, regular: true });
      placed = true;
      break;
    }
    if (!placed) regularNotes.push({ userId: uid, name: p.name, rule: label, why: why || 'No open spot for them.' });
  }

  // 2) Everyone else for the spots still open.
  let slots = [];
  for (const e of events) for (const pos of e.needs) if (!holder[`${e._id}|${pos}`]) slots.push({ e, pos });
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
        return (weekend[uid] || 0) * 100 + (sameDay[e.date]?.[uid] || 0) * 40 + (recent.count[uid] || 0) * 5;
      };
      list.sort((a, b) => score(a) - score(b) || (recent.last[String(a._id)] || '').localeCompare(recent.last[String(b._id)] || '') || a.name.localeCompare(b.name));
      pick = list[0];
      const n = recent.count[String(pick._id)] || 0;
      const w = weekend[String(pick._id)] || 0;
      reason = `${w ? `${w} other shift${w === 1 ? '' : 's'} this weekend · ` : ''}${n} shift${n === 1 ? '' : 's'} in the last 8 weeks`;
    }
    const uid = String(pick._id);
    add(e, pos, uid);
    const m = e.date.slice(0, 7);
    (added[m] ||= {})[uid] = (added[m][uid] || 0) + 1;
    proposals.push({ eventId: String(e._id), position: pos, userId: uid, userName: pick.name, reason });
  }
  const order = Object.fromEntries(events.map((e, i) => [String(e._id), i]));
  proposals.sort((a, b) => order[a.eventId] - order[b.eventId]);
  unfilled.sort((a, b) => order[a.eventId] - order[b.eventId]);
  return { proposals, unfilled, regularNotes };
}
