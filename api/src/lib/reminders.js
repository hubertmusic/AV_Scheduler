import { DateTime } from 'luxon';
import { config } from '../config.js';
import { Activity, Assignment, Event, Plan, Position } from '../models.js';
import { addDays, getSettings, localToDate, todayIn } from './util.js';
import { mailerReady, sendMail } from './mailer.js';
import { logActivity } from './activity.js';
import { baseOf, isShadow } from './availability.js';
import { noticeLinesFor } from '../routes/announcements.js';

export function fmtDay(date) {
  return DateTime.fromISO(date).toFormat('cccc, LLL d').replace('Saturday', 'Sabbath');
}
export function fmtTime(t) {
  return DateTime.fromFormat(t, 'HH:mm').toFormat('h:mm a');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function reminderContent(a, labels, orgName) {
  const e = a.event;
  const pos = `${labels[baseOf(a.position)] || baseOf(a.position)}${isShadow(a.position) ? ' (shadowing)' : ''}`;
  const crew = await Assignment.find({ event: e._id }).populate('user', 'name').lean();
  const crewLine = crew
    .filter((c) => c.user)
    .map((c) => `${c.user.name} – ${labels[baseOf(c.position)] || c.position}${isShadow(c.position) ? ' (shadow)' : ''}`)
    .join('\n  ');
  const plan = await Plan.findOne({ event: e._id }).populate('songs.song', 'title').lean();
  const songs = (plan?.songs || []).filter((s) => s.song).map((s, i) => `${i + 1}. ${s.song.title}${s.key ? ` (${s.key})` : ''}`);
  const first = a.user.name.split(' ')[0];
  const subject = `Reminder: ${pos} · ${e.title}, ${fmtDay(e.date)}`;
  const notices = await noticeLinesFor(e.date);
  if (e.notes) notices.push(`IMPORTANT FOR THIS SHIFT: ${e.notes}`);
  const lines = [
    `Hi ${first},`,
    '',
    ...(notices.length ? [...notices, ''] : []),
    `You're on ${pos} for ${e.title} on ${fmtDay(e.date)}.`,
    `Call time: ${fmtTime(e.call)} (starts ${fmtTime(e.start)}).`,
    '',
    `Crew:\n  ${crewLine}`,
  ];
  if (songs.length) lines.push('', `Songs:\n  ${songs.join('\n  ')}`);
  lines.push(
    '',
    `${a.confirmedAt ? 'You’ve confirmed — thanks!' : 'Please confirm you’ll be there'}: ${config.publicUrl}/#mine`,
    `Quick review before your shift: ${config.publicUrl}/#resources`,
    `Can't make it? Request a swap or drop in Crew Call as soon as you can.`,
    '',
    `— ${orgName}`
  );
  const text = lines.join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#17191c">${text
    .split('\n\n')
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
    .join('')}</div>`;
  return { subject, text, html };
}

// Emails everyone whose shift starts within the reminder window and hasn't been reminded yet.
export async function runReminders(now = new Date()) {
  if (!mailerReady()) return { sent: 0, skipped: 'Email isn’t set up' };
  const s = await getSettings();
  if (!s.reminderEmails) return { sent: 0, skipped: 'Email reminders are turned off' };
  const today = todayIn(s.timezone);
  const events = await Event.find({ date: { $gte: today, $lte: addDays(today, s.reminderDays + 1) } }).lean();
  const byId = Object.fromEntries(events.map((e) => [String(e._id), e]));
  const due = await Assignment.find({ event: { $in: events.map((e) => e._id) }, reminderEmailAt: null }).populate('user');
  const labels = Object.fromEntries((await Position.find({}).lean()).map((p) => [p.key, p.label]));
  let sent = 0;
  for (const a of due) {
    const e = byId[String(a.event)];
    if (!e || !a.user || !a.user.active || !a.user.email) continue;
    const start = localToDate(e.date, e.call, s.timezone).getTime();
    if (now.getTime() < start - s.reminderDays * 24 * 3600 * 1000 || now.getTime() >= start) continue;
    try {
      const msg = await reminderContent({ ...a.toObject(), event: e, user: a.user }, labels, s.orgName);
      await sendMail({ to: a.user.email, ...msg });
      a.reminderEmailAt = new Date();
      await a.save();
      sent++;
      await logActivity({ kind: 'system', who: a.user.name, user: a.user, action: `Reminder email sent to ${a.user.name} for ${e.title} (${fmtDay(e.date)})` });
    } catch (err) {
      console.error('reminder failed:', err.message);
      await logActivity({ kind: 'system', who: a.user.name, user: a.user, action: `Reminder email to ${a.user.name} failed: ${err.message}` });
    }
  }
  return { sent };
}

async function pruneActivity() {
  await Activity.deleteMany({ createdAt: { $lt: new Date(Date.now() - 180 * 24 * 3600 * 1000) } });
}

export function startReminderJob() {
  const tick = () => runReminders().catch((e) => console.error('reminder job:', e.message));
  pruneActivity().catch(() => {});
  setInterval(() => pruneActivity().catch(() => {}), 24 * 3600 * 1000);
  setTimeout(tick, 30 * 1000);
  setInterval(tick, 15 * 60 * 1000);
}
