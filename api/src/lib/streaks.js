// Burnout watch: how many weekends in a row each person has served. Any shift Friday to Sunday
// counts (shadowing doesn't).
import { DateTime } from 'luxon';
import { Assignment, Event } from '../models.js';
import { addDays, fridayOf } from './util.js';

const isWeekend = (d) => [5, 6, 7].includes(DateTime.fromISO(d).weekday);

// Weekends (by their Friday) each person serves between two Fridays
async function servedWeekends(fromFriday, toFriday) {
  const events = await Event.find({ date: { $gte: fromFriday, $lte: addDays(toFriday, 2) } }, { date: 1 }).lean();
  const fri = Object.fromEntries(events.filter((e) => isWeekend(e.date)).map((e) => [String(e._id), fridayOf(e.date)]));
  const asg = await Assignment.find({ event: { $in: Object.keys(fri) } }, { user: 1, event: 1, position: 1 }).lean();
  const out = {};
  for (const a of asg) if (!a.position.endsWith('+shadow')) (out[String(a.user)] ||= new Set()).add(fri[String(a.event)]);
  return out;
}

const run = (set, friday) => {
  let n = 0;
  for (let f = friday; set?.has(f); f = addDays(f, -7)) n++;
  return n;
};

// { userId: weekends in a row ending at `friday` }
export async function streaksEnding(friday, weeks = 16) {
  const served = await servedWeekends(addDays(friday, -7 * (weeks - 1)), friday);
  return Object.fromEntries(Object.entries(served).map(([uid, set]) => [uid, run(set, friday)]).filter(([, n]) => n > 0));
}

// The longer of: the run through the coming weekend, or through the weekend just gone
export async function currentStreaks(today, weeks = 16) {
  const next = fridayOf(today);
  const served = await servedWeekends(addDays(next, -7 * weeks), next);
  const out = {};
  for (const [uid, set] of Object.entries(served)) {
    const n = Math.max(run(set, next), run(set, addDays(next, -7)));
    if (n > 0) out[uid] = n;
  }
  return out;
}
