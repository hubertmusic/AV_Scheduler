import crypto from 'node:crypto';
import { DateTime } from 'luxon';
import { PERMS, Settings } from '../models.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const forbidden = (msg = 'You don’t have permission to do that.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

// Wrap async route handlers so thrown errors reach the error middleware.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
export function isId(v) {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}

export function normalizePhone(raw, countryCode = '1') {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && countryCode) return countryCode + digits;
  return digits;
}

// "practiceav.fyi/path" -> "https://practiceav.fyi/path". Leaves http(s) links alone.
// Anything else (javascript:, mailto:, plain words) is returned unchanged so isHttpUrl rejects it.
export function normalizeUrl(v) {
  const s = String(v || '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s)) return `https://${s.replace(/^\/\//, '')}`;
  return s;
}

export function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getSettings() {
  let s = await Settings.findOne({ key: 'main' });
  if (!s) s = await Settings.create({ key: 'main', weekendTemplate: DEFAULT_TEMPLATE });
  return s;
}

export function todayIn(tz) {
  return DateTime.now().setZone(tz).toISODate();
}

// The Friday that starts the weekend a date belongs to (Sat/Sun look back, Mon–Thu look ahead).
export function fridayOf(iso) {
  const wd = DateTime.fromISO(iso, { zone: 'utc' }).weekday; // Mon=1 … Sun=7
  return addDays(iso, wd === 6 ? -1 : wd === 7 ? -2 : 5 - wd);
}

export function addDays(iso, n) {
  return DateTime.fromISO(iso, { zone: 'utc' }).plus({ days: n }).toISODate();
}

// Wall-clock date + time in the org's zone -> JS Date (UTC instant)
export function localToDate(date, time, tz) {
  return DateTime.fromISO(`${date}T${time}`, { zone: tz }).toJSDate();
}

export function can(user) {
  const none = Object.fromEntries(PERMS.map((p) => [p, false]));
  if (!user) return none;
  if (user.role === 'admin') return Object.fromEntries(PERMS.map((p) => [p, true]));
  if (user.role === 'leader') return Object.fromEntries(PERMS.map((p) => [p, !!user.perms?.[p]]));
  return none;
}

export const DEFAULT_POSITIONS = [
  { key: 'foh', label: 'FOH Audio', order: 0 },
  { key: 'stream', label: 'Stream Audio', order: 1 },
  { key: 'pro', label: 'ProPresenter', order: 2 },
  { key: 'cam', label: 'Camera / PTZ', order: 3 },
  { key: 'light', label: 'Lighting', order: 4 },
  { key: 'prod', label: 'Producer', order: 5 },
];

export const DEFAULT_TEMPLATE = [
  { day: 0, title: 'Vespers', start: '19:00', call: '18:15', end: '20:30', needs: ['foh', 'stream', 'pro', 'cam'] },
  { day: 1, title: 'Sabbath School', start: '09:30', call: '08:45', end: '10:45', needs: ['foh', 'pro'] },
  { day: 1, title: 'Worship Service', start: '11:00', call: '10:15', end: '12:30', needs: ['foh', 'stream', 'pro', 'cam', 'light', 'prod'] },
  { day: 1, title: 'Afternoon Program', start: '16:00', call: '15:30', end: '17:30', needs: ['foh', 'pro', 'cam'] },
];
