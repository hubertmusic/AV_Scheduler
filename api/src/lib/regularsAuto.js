import { DateTime } from 'luxon';
import { Assignment, Event, Skip, User } from '../models.js';
import { addDays, fridayOf, getSettings, todayIn } from './util.js';
import { planAutofill } from './autofill.js';
import { logActivity, posName } from './activity.js';

// Places people with a regular schedule (e.g. 2nd Sabbath) on a weekend, so the shift is
// on their calendar right away. Only the regulars pass of Auto-fill: everyone else still
// waits for a leader. `onlyEvents` limits it to services just created (so a regular a
// leader took off by hand isn't put back); `onlyUser` to one person's new rules.
export async function placeRegulars(friday, { onlyEvents = null, onlyUser = null } = {}) {
  const plan = await planAutofill(friday);
  let picks = plan.proposals.filter((p) => p.regular);
  if (onlyEvents) picks = picks.filter((p) => onlyEvents.has(p.eventId));
  if (onlyUser) picks = picks.filter((p) => p.userId === String(onlyUser));
  const placed = [];
  for (const p of picks) {
    const [taken, already] = await Promise.all([
      Assignment.exists({ event: p.eventId, position: p.position }),
      Assignment.exists({ event: p.eventId, user: p.userId }),
    ]);
    if (taken || already) continue;
    try {
      await Assignment.create({ event: p.eventId, position: p.position, user: p.userId, viaRegular: p.reason.replace(/^Regular:\s*/, '') });
      placed.push(p);
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }
  if (placed.length) {
    const evs = Object.fromEntries((await Event.find({ _id: { $in: placed.map((p) => p.eventId) } }).lean()).map((e) => [String(e._id), e]));
    const list = await Promise.all(placed.map(async (p) => `${p.userName} (${await posName(p.position)}, ${evs[p.eventId]?.title || 'service'})`));
    await logActivity({ kind: 'system', who: 'Crew Call', action: `Placed regulars for the weekend of ${DateTime.fromISO(friday).toFormat('LLL d')}: ${list.join(', ')}` });
  }
  return placed;
}

// Creates the template's services that a weekend is missing (skipping ones turned off,
// or left out of that weekend on purpose). Returns the ids it created.
export async function createMissingFromTemplate(friday) {
  const s = await getSettings();
  const skips = await Skip.find({ date: { $gte: friday, $lte: addDays(friday, 2) } }).lean();
  const created = new Set();
  for (const t of s.weekendTemplate.filter((x) => !x.off)) {
    const date = addDays(friday, t.day);
    if (skips.some((k) => k.date === date && k.title === t.title)) continue;
    if (await Event.exists({ date, title: t.title })) continue;
    const ev = await Event.create({ date, title: t.title, start: t.start, call: t.call, end: t.end, needs: [...t.needs], kind: t.kind || 'service', groups: t.groups || [] });
    created.add(String(ev._id));
  }
  return created;
}

// The next few weekends, starting with this one (or next, once this one has started).
export function upcomingFridays(today, weeks) {
  let f = fridayOf(today);
  if (today > f) f = addDays(f, 7);
  return Array.from({ length: weeks }, (_, i) => addDays(f, 7 * i));
}

// Daily: build weekends from the template N weeks ahead and place regulars on them.
export async function autoBuildAhead() {
  const s = await getSettings();
  if (!s.autoBuildWeeks || !s.weekendTemplate.some((t) => !t.off)) return { built: 0, placed: 0 };
  let built = 0;
  let placed = 0;
  for (const friday of upcomingFridays(todayIn(s.timezone), s.autoBuildWeeks)) {
    const created = await createMissingFromTemplate(friday);
    if (!created.size) continue;
    built += created.size;
    placed += (await placeRegulars(friday, { onlyEvents: created })).length;
    await logActivity({ kind: 'system', who: 'Crew Call', action: `Built the weekend of ${DateTime.fromISO(friday).toFormat('LLL d')} from the template (${created.size} service${created.size === 1 ? '' : 's'})` });
  }
  return { built, placed };
}

// After someone's regular schedule changes: put them on the weekends already built.
export async function applyRegularsFor(userId, weeks = 12) {
  const s = await getSettings();
  const user = await User.findById(userId).lean();
  if (!user || !user.active || !(user.regulars || []).length) return 0;
  let n = 0;
  for (const friday of upcomingFridays(todayIn(s.timezone), weeks)) {
    if (!(await Event.exists({ date: { $gte: friday, $lte: addDays(friday, 2) } }))) continue;
    n += (await placeRegulars(friday, { onlyUser: userId })).length;
  }
  return n;
}
