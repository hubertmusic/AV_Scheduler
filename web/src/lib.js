// Pages with unsaved edits register here so switching tabs can warn first.
export const unsaved = new Set();

// ---------- API ----------
// "View as" (admin only): reads come back as that person sees them; changes are blocked.
let viewAsId = null;
export function setViewAs(id) {
  viewAsId = id || null;
}
export const previewing = () => Boolean(viewAsId);

export async function api(path, { method = 'GET', body } = {}) {
  if (viewAsId && method !== 'GET' && path !== '/activity/view') {
    const err = new Error('This is a preview, so nothing is saved. Exit the preview to make changes.');
    err.status = 403;
    err.preview = true;
    throw err;
  }
  if (viewAsId && path === '/activity/view') return null;
  const headers = body !== undefined ? { 'Content-Type': 'application/json' } : {};
  if (viewAsId) headers['X-View-As'] = viewAsId;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Multipart upload with progress (fetch can't report upload progress).
export function uploadFiles(path, files, { field = 'files', onProgress } = {}) {
  if (viewAsId) return Promise.reject(Object.assign(new Error('This is a preview, so nothing is saved. Exit the preview to make changes.'), { status: 403, preview: true }));
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of files) fd.append(field, f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        const msg = xhr.status === 413 && !data?.error ? 'That file is too big to upload.' : data?.error || `Upload failed (${xhr.status})`;
        const err = new Error(msg);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
    xhr.send(fd);
  });
}

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

// Public-domain translations from bible-api.com (it allows browser requests).
export const BIBLE_VERSIONS = [
  { id: 'kjv', label: 'KJV' },
  { id: 'web', label: 'WEB' },
  { id: 'asv', label: 'ASV' },
  { id: 'ylt', label: 'YLT' },
  { id: 'darby', label: 'Darby' },
];
export async function lookUpBible(reference, version = 'kjv') {
  const res = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${version}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.verses) throw new Error(data?.error || 'Couldn’t find that passage. Check the reference, e.g. John 3:16-17.');
  const text = data.verses.map((v) => `${v.verse} ${v.text.replace(/\s+/g, ' ').trim()}`).join(' ');
  return { reference: data.reference, text };
}

// ---------- dates (YYYY-MM-DD strings, treated as calendar days) ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sabbath'];
const SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAB'];

export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export const isoDay = (d) => d.toISOString().slice(0, 10);
export function addDays(s, n) {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}
export function todayISO() {
  const n = new Date();
  return isoDay(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}
// The Friday that starts "this" weekend: Sat/Sun look back, Mon–Thu look ahead.
export function fridayOf(s) {
  const dow = parseDay(s).getUTCDay();
  const diff = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
  return addDays(s, diff);
}
export function fmtDay(s) {
  const d = parseDay(s);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
export const dowShort = (s) => SHORT[parseDay(s).getUTCDay()];
export const dayNum = (s) => String(parseDay(s).getUTCDate());
export function weekendLabel(fri) {
  const a = parseDay(fri);
  const b = parseDay(addDays(fri, 2));
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}–${b.getUTCDate()}`
    : `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()} – ${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`;
}
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
export function addMinutes(t, n) {
  const [h, m] = t.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + n));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- people ----------
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
export const firstName = (name = '') => name.split(/\s+/)[0] || name;
export function roleLabel(p) {
  if (!p) return '';
  if (p.role === 'admin') return 'Admin';
  if (p.role === 'leader') return p.leaderTitle || 'Team leader';
  return 'Crew';
}

// ---------- WhatsApp ----------
export function waLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
export function prettyPhone(digits) {
  if (!digits) return '';
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return '+' + digits;
}

export const TYPE_LABEL = { swap: 'Swap', transfer: 'Transfer', pickup: 'Pick up', drop: 'Drop' };
export const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', denied: 'Denied', cancelled: 'Cancelled' };

// ---------- regular schedules ----------
export const WEEK_OPTIONS = [
  ['every', 'Every weekend'],
  ['1', '1st Sabbath of the month'],
  ['2', '2nd Sabbath of the month'],
  ['3', '3rd Sabbath of the month'],
  ['4', '4th Sabbath of the month'],
  ['5', '5th Sabbath of the month'],
  ['last', 'Last Sabbath of the month'],
  ['alt', 'Every other weekend'],
];
export function describeRule(r, posLabel) {
  const week = (WEEK_OPTIONS.find(([k]) => k === r.week) || WEEK_OPTIONS[0])[1];
  const svc = r.service || 'any service';
  const pos = r.positions?.length ? r.positions.map(posLabel).join(' or ') : 'any of their positions';
  return { week, svc, pos, text: `${week} · ${svc} · ${pos}` };
}

// Links to Booth Crew Academy go through Crew Call so people arrive signed in.
export function academyHref(url, academy) {
  if (!academy || !url) return url;
  try {
    const u = new URL(url);
    const bare = (h) => h.replace(/^www\./, '').toLowerCase();
    if (bare(u.host) !== bare(academy.host)) return url;
    return `/api/academy/go?to=${encodeURIComponent(u.pathname + u.search + u.hash)}`;
  } catch {
    return url;
  }
}
