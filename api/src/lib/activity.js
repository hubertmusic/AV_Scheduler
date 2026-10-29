import { DateTime } from 'luxon';
import { Activity, Position, User } from '../models.js';

export function clientIp(req) {
  return String(req?.headers?.['cf-connecting-ip'] || req?.ip || '').replace(/^::ffff:/, '');
}

export function deviceFrom(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, browser].filter(Boolean).join(' · ') || 'Unknown device';
}

export function calendarClient(ua = '') {
  if (/Google-Calendar-Importer|Google/i.test(ua)) return 'Google Calendar';
  if (/iOS|iPhone|iPad|dataaccessd/i.test(ua)) return 'iPhone/iPad Calendar';
  if (/CalendarAgent|Mac OS X|macOS/i.test(ua)) return 'Mac Calendar';
  if (/Outlook|Microsoft/i.test(ua)) return 'Outlook';
  if (/Mozilla/i.test(ua)) return 'Web browser';
  return 'Calendar app';
}

export async function logActivity({ user = null, who = '', kind, action, page = '', req = null }) {
  try {
    await Activity.create({
      user: user?._id || user || undefined,
      who: who || user?.name || '',
      kind,
      action: String(action).slice(0, 300),
      page,
      device: req ? deviceFrom(req.headers['user-agent']) : '',
      ip: req ? clientIp(req) : '',
    });
  } catch (e) {
    console.error('activity log failed:', e.message);
  }
}

// Keep "last seen" current without writing on every request.
export async function touchSeen(user) {
  const now = Date.now();
  if (user.lastSeenAt && now - user.lastSeenAt.getTime() < 5 * 60 * 1000) return;
  user.lastSeenAt = new Date(now);
  await User.updateOne({ _id: user._id }, { $set: { lastSeenAt: user.lastSeenAt } });
}

// Fallback descriptions for changes whose route didn't set res.locals.activity.
const LABELS = [
  [/^\/api\/events\/weekend\/copy/, 'Copied last weekend'],
  [/^\/api\/events\/weekend$/, 'Built a weekend from the template'],
  [/^\/api\/events\/[^/]+\/soundcheck/, 'Added a sound check'],
  [/^\/api\/events/, { POST: 'Added a service', PATCH: 'Edited a service', DELETE: 'Removed a service' }],
  [/^\/api\/requests\/[^/]+\/approve/, 'Approved a shift request'],
  [/^\/api\/requests\/[^/]+\/deny/, 'Denied a shift request'],
  [/^\/api\/requests\/[^/]+\/cancel/, 'Cancelled their shift request'],
  [/^\/api\/requests/, 'Sent a shift request'],
  [/^\/api\/people\/[^/]+\/invite/, 'Made an invite / reset link'],
  [/^\/api\/people/, { POST: 'Added a person', PATCH: 'Edited a person' }],
  [/^\/api\/plans\/[^/]+\/media/, 'Uploaded media to a plan'],
  [/^\/api\/plans/, 'Edited a service plan'],
  [/^\/api\/songs\/[^/]+\/pro/, { POST: 'Uploaded a .pro file', DELETE: 'Removed a .pro file' }],
  [/^\/api\/songs/, { POST: 'Added a song', PATCH: 'Edited a song', DELETE: 'Deleted a song' }],
  [/^\/api\/media/, { PATCH: 'Renamed media', DELETE: 'Deleted media' }],
  [/^\/api\/guest-links\/link\/[^/]+\/revoke/, 'Turned off a guest link'],
  [/^\/api\/guest-links/, 'Made a guest upload link'],
  [/^\/api\/submissions\/[^/]+\/approve/, 'Approved a guest upload'],
  [/^\/api\/submissions\/[^/]+\/reject/, 'Declined a guest upload'],
  [/^\/api\/resources/, { POST: 'Added a resource', PATCH: 'Edited a resource', DELETE: 'Removed a resource' }],
  [/^\/api\/groups/, { POST: 'Added a group', PATCH: 'Edited a group', DELETE: 'Removed a group' }],
  [/^\/api\/announcements/, 'Updated an announcement'],
  [/^\/api\/settings/, 'Changed settings'],
  [/^\/api\/positions/, 'Changed positions'],
  [/^\/api\/weekend\/autofill/, 'Auto-filled a weekend'],
  [/^\/api\/weekend\/reminded/, 'Marked WhatsApp reminders as sent'],
  [/^\/api\/account\/password/, 'Changed their password'],
  [/^\/api\/account\/calendar/, 'Made a new calendar link'],
  [/^\/api\/account/, 'Updated their account'],
];

function fallbackLabel(method, path) {
  for (const [re, label] of LABELS) {
    if (re.test(path)) return typeof label === 'string' ? label : label[method] || null;
  }
  return null;
}

// Logs every successful change a signed-in person makes.
export function changeLogger(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const path = req.originalUrl.split('?')[0];
  if (path.startsWith('/api/activity')) return next();
  res.on('finish', () => {
    if (!req.user || res.statusCode >= 400) return;
    const action = res.locals.activity || fallbackLabel(req.method, path);
    if (action) logActivity({ user: req.user, kind: 'change', action, req });
  });
  next();
}

// Friendly names for the activity feed: "Camera / PTZ", "Worship Service (Sabbath Oct 24)".

export async function posName(key) {
  const shadow = String(key).endsWith('+shadow');
  const base = shadow ? key.slice(0, -7) : key;
  const p = await Position.findOne({ key: base }).lean();
  return `${p?.label || base}${shadow ? ' (shadow)' : ''}`;
}

export function dayName(date) {
  const d = DateTime.fromISO(date);
  return d.isValid ? d.toFormat('ccc LLL d').replace(/^Sat/, 'Sabbath') : date;
}

export function evName(ev) {
  return ev ? `${ev.title} (${dayName(ev.date)})` : 'a service';
}
