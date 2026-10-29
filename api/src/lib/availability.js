import { Assignment, Blackout, Event, Unavailable, User } from '../models.js';
import { addDays } from './util.js';

export const SHADOW = '+shadow';
export const isShadow = (pos) => typeof pos === 'string' && pos.endsWith(SHADOW);
export const baseOf = (pos) => (isShadow(pos) ? pos.slice(0, -SHADOW.length) : pos);
export const shadowOf = (pos) => pos + SHADOW;

// A position key is valid for an event if the event needs it (or it's a shadow of one it needs).
export const slotValid = (ev, pos) => ev.needs.includes(baseOf(pos));

// For a list of events: eventId -> Set(userId) of people away on that date (blackout ranges).
export async function awayByEvent(events, userId = null) {
  if (!events.length) return {};
  const dates = events.map((e) => e.date).sort();
  const filter = { from: { $lte: dates[dates.length - 1] }, to: { $gte: dates[0] } };
  if (userId) filter.user = userId;
  const blackouts = await Blackout.find(filter).lean();
  const out = {};
  for (const e of events) {
    out[String(e._id)] = new Set(blackouts.filter((b) => b.from <= e.date && b.to >= e.date).map((b) => String(b.user)));
  }
  return out;
}

export async function unavailableByEvent(events, userId = null) {
  const filter = { event: { $in: events.map((e) => e._id) } };
  if (userId) filter.user = userId;
  const list = await Unavailable.find(filter).lean();
  const out = {};
  for (const u of list) (out[String(u.event)] ||= new Set()).add(String(u.user));
  return out;
}

export async function touchAvailability(userId) {
  await User.updateOne({ _id: userId }, { $set: { availabilityUpdatedAt: new Date() } });
}

// Number of shifts (not shadows) each person has in the calendar month of `date`.
export async function monthCounts(date) {
  const first = `${date.slice(0, 7)}-01`;
  const last = `${date.slice(0, 7)}-31`;
  const events = await Event.find({ date: { $gte: first, $lte: last } }, { _id: 1 }).lean();
  const asg = await Assignment.find({ event: { $in: events.map((e) => e._id) } }, { user: 1, position: 1 }).lean();
  const out = {};
  for (const a of asg) if (!isShadow(a.position)) out[String(a.user)] = (out[String(a.user)] || 0) + 1;
  return out;
}

// Shifts per person over the last `days` days, and the date of their most recent one.
export async function recentLoad(today, days = 56) {
  const events = await Event.find({ date: { $gte: addDays(today, -days), $lt: today } }, { _id: 1, date: 1 }).lean();
  const dateOf = Object.fromEntries(events.map((e) => [String(e._id), e.date]));
  const asg = await Assignment.find({ event: { $in: events.map((e) => e._id) } }, { user: 1, event: 1, position: 1 }).lean();
  const count = {};
  const last = {};
  for (const a of asg) {
    if (isShadow(a.position)) continue;
    const u = String(a.user);
    count[u] = (count[u] || 0) + 1;
    const d = dateOf[String(a.event)];
    if (!last[u] || d > last[u]) last[u] = d;
  }
  return { count, last };
}
