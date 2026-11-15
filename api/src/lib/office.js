// Church Admin (office teams): committees and who sees what, repeating calendar items, the
// yearly rhythm, and the daily job (fill repeats a year ahead, action-item and term reminders).
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { ActionItem, Committee, OfficeEvent, OfficeSeries, Team, User } from '../models.js';
import { addDays, forbidden, getSettings, membershipOf, todayIn } from './util.js';
import { forgetTeams, teamsList } from './teams.js';
import { mailerReady, sendMail } from './mailer.js';
import { logActivity } from './activity.js';

export const isOfficeTeam = (team) => team?.kind === 'office';
export const officeTeamKeys = async () => (await teamsList()).filter(isOfficeTeam).map((t) => t.key);
// Admin, or on at least one team that serves on services (AV, Praise…): sees services, line-ups
// and the Academy. People only on Church Admin don't.
export const onServiceTeam = async (user) => {
  if (user.role === 'admin') return true;
  const office = new Set(await officeTeamKeys());
  return (user.teams || []).some((m) => !office.has(m.team));
};
export const requireOfficeTeam = (req, res, next) => (isOfficeTeam(req.team) ? next() : next(forbidden('That’s part of the Church Admin side. Switch to it at the top.')));

const ids = (list) => (list || []).map(String);
const overlap = (a, b) => a.some((x) => b.includes(x));

// Can this person see an office item? Admin and the team's head see everything; others see items
// for the whole team, their committees, or committees it was shared with. Calendar items marked
// "everyone" also show to people who aren't on the team.
export function sees(user, item) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  const m = membershipOf(user, item.team);
  if (!m) return item.visibility === 'everyone';
  if (m.head) return true;
  const mine = m.committees || [];
  const owners = item.committees || [];
  if (!owners.length) return true;
  return overlap(mine, owners) || overlap(mine, item.sharedWith || []) || item.visibility === 'everyone';
}
// Can they change it? They need the privilege on the team, and to be in one of its own committees
// (shared-with committees only read it).
export function edits(user, item, can) {
  if (!user || !item) return false;
  if (user.role === 'admin') return true;
  const m = membershipOf(user, item.team);
  if (!m || !can) return false;
  if (m.head) return true;
  const owners = item.committees || [];
  return !owners.length || overlap(m.committees || [], owners);
}
export const assertSees = (user, item, what = 'that') => {
  if (!sees(user, item)) throw forbidden(`You can’t see ${what}.`);
};

// Mongo filter for the office items a member can see (the team's head and the admin see all)
export function visibleFilter(user, team) {
  if (user.role === 'admin') return { team };
  const m = membershipOf(user, team);
  if (!m) return { team, visibility: 'everyone' };
  if (m.head) return { team };
  const mine = m.committees || [];
  return { team, $or: [{ 'committees.0': { $exists: false } }, { committees: { $in: mine } }, { sharedWith: { $in: mine } }, { visibility: 'everyone' }] };
}

// Members of an item's audience (for invitations, RSVPs and sending the agenda): its committees'
// members, or the whole team. The head leader can see everything but is only invited to their own.
export async function audienceOf(item) {
  const people = await User.find({ active: true, 'teams.team': item.team }, { name: 1, email: 1, phone: 1, teams: 1 }).lean();
  const owners = [...(item.committees || []), ...(item.sharedWith || [])];
  return people.filter((u) => {
    const m = membershipOf(u, item.team);
    return m && (!owners.length || overlap(m.committees || [], owners));
  });
}

// Is this person a secretary for the meeting (of one of its committees, or of the whole team)?
export function isSecretary(user, ev) {
  const m = membershipOf(user, ev.team);
  if (!m) return false;
  const owners = ev.committees || [];
  return (m.offices || []).some((o) => /secretary|clerk/i.test(o.role) && (!o.committee || !owners.length || owners.includes(o.committee)));
}

// ---------- repeating items ----------
const lux = (iso) => DateTime.fromISO(iso, { zone: 'utc' });
const iso = (d) => d.toISODate();
const luxWeekday = (w) => (w === 0 ? 7 : w); // 0 Sunday … 6 Sabbath -> luxon 1 Mon … 7 Sun

export function nthWeekday(year, month, weekday, nth) {
  const want = luxWeekday(weekday);
  if (nth === -1) {
    let d = DateTime.utc(year, month, 1).endOf('month').startOf('day');
    while (d.weekday !== want) d = d.minus({ days: 1 });
    return d;
  }
  let d = DateTime.utc(year, month, 1);
  while (d.weekday !== want) d = d.plus({ days: 1 });
  d = d.plus({ weeks: Math.max(0, nth - 1) });
  return d.month === month ? d : null; // no 5th Tuesday this month
}

// The dates of a repeat between from and to (ISO), never before its first date or after until
export function seriesDates(s, from, to) {
  const out = [];
  const first = lux(s.first);
  const end = s.until && s.until < to ? s.until : to;
  const step = Math.max(1, s.interval || 1);
  for (let k = 0; k < 600; k++) {
    let d = null;
    if (s.freq === 'weekly') d = first.plus({ weeks: k * step });
    else if (s.freq === 'yearly') d = first.plus({ years: k * step });
    else {
      const m = first.startOf('month').plus({ months: k * step });
      if (s.freq === 'monthly-day') d = m.set({ day: Math.min(s.monthDay || first.day, m.daysInMonth) });
      else d = nthWeekday(m.year, m.month, s.weekday ?? first.weekday % 7, s.nth || 1);
    }
    if (!d) continue;
    const x = iso(d);
    if (x > end) break;
    if (x >= s.first && x >= from) out.push(x);
  }
  return out;
}

// Plain-language description, e.g. "2nd Tuesday of every month"
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sabbath'];
const NTH = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', '-1': 'last' };
export function describeSeries(s) {
  if (!s) return '';
  const every = (unit) => (s.interval > 1 ? `every ${s.interval} ${unit}s` : `every ${unit}`);
  const d = lux(s.first);
  let text;
  if (s.freq === 'weekly') text = `${WEEKDAYS[d.weekday % 7]}, ${every('week')}`;
  else if (s.freq === 'monthly-day') text = `Day ${s.monthDay || d.day} of ${every('month')}`;
  else if (s.freq === 'monthly-nth') text = `${NTH[s.nth] || `${s.nth}th`} ${WEEKDAYS[s.weekday ?? d.weekday % 7]} of ${every('month')}`;
  else text = `${d.toFormat('LLLL d')}, ${every('year')}`;
  return s.until ? `${text}, until ${lux(s.until).toFormat('LLL d, yyyy')}` : text;
}

const HORIZON_DAYS = 366;
// Create the repeat's dates up to a year ahead (or its end). Returns how many were added.
export async function fillSeries(series, today) {
  const horizon = addDays(today, HORIZON_DAYS);
  const from = series.filledTo ? addDays(series.filledTo, 1) : series.first;
  if (from > horizon || (series.until && from > series.until)) return 0;
  const dates = seriesDates(series, from, horizon);
  if (dates.length) await OfficeEvent.insertMany(dates.map((date) => ({ ...series.template, team: series.team, series: series._id, date })));
  series.filledTo = series.until && series.until < horizon ? series.until : horizon;
  await series.save();
  return dates.length;
}

// The date of a yearly-rhythm item in a given year
export function yearPlanDate(item, year) {
  if (item.day > 0) {
    const m = DateTime.utc(year, item.month, 1);
    return iso(m.set({ day: Math.min(item.day, m.daysInMonth) }));
  }
  const d = nthWeekday(year, item.month, item.weekday ?? 6, item.nth || 1);
  return d ? iso(d) : null;
}

// ---------- one-time setup ----------
const DEFAULT_COMMITTEES = [
  { key: 'board', name: 'Church Board', color: 'blue' },
  { key: 'finance', name: 'Finance Committee', color: 'green' },
  { key: 'nominating', name: 'Nominating Committee', color: 'purple' },
];
export async function ensureOffice() {
  if (await Team.exists({ kind: 'office' })) return;
  let key = 'office';
  for (let i = 2; await Team.exists({ key }); i++) key = `office-${i}`;
  await Team.create({
    key,
    name: 'Church Admin',
    kind: 'office',
    order: await Team.countDocuments({}),
    rooms: [{ name: 'Sanctuary', services: true }, { name: 'Fellowship hall' }, { name: 'Board room' }],
  });
  await Committee.insertMany(DEFAULT_COMMITTEES.map((c, i) => ({ ...c, team: key, order: i })));
  forgetTeams();
  console.log('Added the Church Admin team.');
}

// ---------- the daily job ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDay = (d) => DateTime.fromISO(d).toFormat('cccc, LLL d').replace('Saturday', 'Sabbath');

// Email each owner their action items due within 2 days or overdue, once a day
export async function remindActionItems(today) {
  if (!mailerReady()) return { sent: 0 };
  const s = await getSettings();
  const items = await ActionItem.find({ done: false, due: { $ne: '', $lte: addDays(today, 2) }, remindedOn: { $ne: today }, owner: { $ne: null } }).populate('owner', 'name email active');
  const byOwner = {};
  for (const it of items) if (it.owner?.active && it.owner.email) (byOwner[String(it.owner._id)] ||= { user: it.owner, items: [] }).items.push(it);
  let sent = 0;
  for (const { user, items: list } of Object.values(byOwner)) {
    const lines = list.map((it) => `• ${it.title} — ${it.due < today ? `overdue since ${fmtDay(it.due)}` : `due ${fmtDay(it.due)}`}`);
    const text = [`Hi ${user.name.split(' ')[0]},`, '', 'Your action items:', ...lines, '', `Mark them done in Crew Call: ${config.publicUrl}/#mine`, '', `— ${s.orgName}`].join('\n');
    try {
      await sendMail({ to: user.email, subject: `${list.length} action item${list.length === 1 ? '' : 's'} due`, text, html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>` });
      await ActionItem.updateMany({ _id: { $in: list.map((x) => x._id) } }, { $set: { remindedOn: today } });
      sent++;
    } catch (e) {
      await logActivity({ kind: 'system', who: user.name, user, action: `Action-item reminder to ${user.name} failed: ${e.message}` });
    }
  }
  return { sent };
}

export async function runOfficeJob() {
  const s = await getSettings();
  const today = todayIn(s.timezone);
  let added = 0;
  for (const series of await OfficeSeries.find({ $or: [{ until: '' }, { until: { $gte: today } }] })) added += await fillSeries(series, today);
  const mail = await remindActionItems(today);
  return { added, reminders: mail.sent };
}

export function startOfficeJob() {
  const tick = () => runOfficeJob().catch((e) => console.error('office job:', e.message));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, 6 * 3600 * 1000);
}
