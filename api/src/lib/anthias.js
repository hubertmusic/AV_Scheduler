// Sending a screen's playlist straight into Anthias (https://anthias.screenly.io), through its API.
// Crew Call adds each item to Anthias's own playlist, keeps it up to date (name, dates, duration,
// on/off, order) and removes what was deleted here. It only touches items it added itself; anything
// added in Anthias directly is left alone. Crew Call has to be able to reach the Pi, which means
// being on the same network (the church server); otherwise use the screen's live link.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Agent, fetch, FormData } from 'undici';
import { Screen, SignageAsset } from '../models.js';
import { open } from './secrets.js';
import { assetFile, onScreen } from './signage.js';

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false }, headersTimeout: 30000, bodyTimeout: 10 * 60000 });
const PREFIX = 'Crew Call · ';
const FAR = new Date('2099-12-31T00:00:00Z');

export class AnthiasError extends Error {}

function base(screen) {
  const u = String(screen.anthias?.url || '').trim().replace(/\/+$/, '');
  if (!u) throw new AnthiasError('Add the Anthias address first (like https://192.168.1.50).');
  return `${u}/api/v2`;
}
function headers(screen) {
  const a = screen.anthias || {};
  const secret = a.secret ? open(a.secret) : '';
  if (a.auth === 'token' && secret) return { Authorization: `Bearer ${secret}` };
  if (a.auth === 'basic' && a.user) return { Authorization: `Basic ${Buffer.from(`${a.user}:${secret}`).toString('base64')}` };
  return {};
}

// People-friendly reasons
function explain(e, screen) {
  const where = screen.anthias?.url || 'Anthias';
  const code = e?.cause?.code || e?.code || '';
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(code)) return `Can’t reach Anthias at ${where}. Crew Call and the screen have to be on the same network for this; until then, use the screen’s live link.`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) return `Anthias at ${where} uses its own certificate. Tick “Anthias uses its own certificate” and try again.`;
  return e?.message || 'Anthias didn’t answer.';
}

async function call(screen, path, { method = 'GET', json, form, raw } = {}) {
  const res = await fetch(`${base(screen)}${path}`, {
    method,
    headers: { Accept: 'application/json', ...headers(screen), ...(json ? { 'Content-Type': 'application/json' } : {}), ...(raw ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: json ? JSON.stringify(json) : form || raw,
    dispatcher: screen.anthias?.insecure !== false ? insecureAgent : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(form ? 10 * 60000 : 20000),
  });
  // Anthias sends people who aren't signed in to its login page instead of saying 401
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) throw new AnthiasError('Anthias turned down the sign-in. Check the API token (or user name and password) in Anthias → Settings.');
  if (res.status === 404 && method === 'GET' && path === '/assets') throw new AnthiasError('That address answered, but it doesn’t look like Anthias (no /api/v2). Check the address.');
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const e = new AnthiasError(`Anthias said ${res.status}${body && typeof body === 'object' ? `: ${JSON.stringify(body).slice(0, 200)}` : ''}`);
    e.status = res.status;
    throw e;
  }
  return body;
}

// Try the connection: how many items are in Anthias now
export async function testAnthias(screen) {
  try {
    const list = await call(screen, '/assets');
    const items = Array.isArray(list) ? list : list?.results || [];
    return { ok: true, total: items.length, ours: items.filter((a) => String(a.name || '').startsWith(PREFIX)).length };
  } catch (e) {
    return { ok: false, error: explain(e, screen) };
  }
}

// One Anthias item per picture, video, web page, or PDF page
function partsOf(a, screen) {
  const seconds = a.seconds > 0 ? a.seconds : screen.seconds || 10;
  const common = { start_date: (a.startAt || a.createdAt || new Date()).toISOString(), end_date: (a.endAt || FAR).toISOString(), is_enabled: a.enabled ? 1 : 0 };
  if (a.kind === 'web') return [{ part: 0, file: `uri:${a.uri}`, uri: a.uri, body: { ...common, name: `${PREFIX}${a.name}`, mimetype: 'webpage', duration: seconds } }];
  if (a.kind === 'pdf') return a.pages.map((p, i) => ({ part: i, file: p, path: assetFile(a, i), body: { ...common, name: `${PREFIX}${a.name} (page ${i + 1})`, mimetype: 'image', duration: seconds } }));
  if (a.kind === 'video') return [{ part: 0, file: a.storedName, path: assetFile(a), body: { ...common, name: `${PREFIX}${a.name}`, mimetype: 'video', duration: a.seconds > 0 ? a.seconds : a.videoSeconds || 30 } }];
  return [{ part: 0, file: a.storedName, path: assetFile(a), body: { ...common, name: `${PREFIX}${a.name}`, mimetype: 'image', duration: seconds } }];
}
const keyOf = (p) => crypto.createHash('sha1').update(JSON.stringify([p.file, p.body])).digest('hex');

async function upload(screen, p, a) {
  if (!p.path || !fs.existsSync(p.path)) throw new AnthiasError(`The file for “${a.name}” is missing from the server.`);
  const form = new FormData();
  const blob = await fs.openAsBlob(p.path, { type: p.body.mimetype === 'video' ? 'video/mp4' : a.kind === 'pdf' ? 'image/png' : a.mime || 'application/octet-stream' });
  form.append('file_upload', blob, a.kind === 'pdf' ? `${a._id}-${p.part + 1}.png` : a.originalName || p.file);
  const r = await call(screen, '/file_asset', { method: 'POST', form });
  if (!r?.uri) throw new AnthiasError('Anthias took the file but didn’t say where it put it.');
  return r.uri;
}
const idOf = (r) => String(r?.asset_id || r?.id || '');

// Make Anthias match this screen's playlist. Returns { sent, removed } or throws an AnthiasError.
export async function syncScreen(screenId) {
  const screen = await Screen.findById(screenId);
  if (!screen || screen.mode !== 'anthias') return { sent: 0, removed: 0 };
  try {
    const assets = (await SignageAsset.find({ status: 'approved', processing: 'ready' }).sort({ order: 1, createdAt: 1 })).filter((a) => onScreen(a, screen._id));
    const sid = String(screen._id);
    const order = [];
    let sent = 0;
    // Items that were deleted here, or moved off this screen
    const trash = [...(screen.anthias.trash || [])];
    const stale = await SignageAsset.find({ 'anthias.screen': screen._id });
    for (const s of stale) {
      const keep = assets.some((a) => String(a._id) === String(s._id));
      const parts = keep ? partsOf(s, screen).map((p) => p.part) : [];
      const gone = s.anthias.filter((x) => String(x.screen) === sid && !parts.includes(x.part));
      if (!gone.length) continue;
      trash.push(...gone.map((x) => x.id));
      s.anthias = s.anthias.filter((x) => !gone.includes(x));
      await s.save();
    }
    for (const id of trash) {
      try {
        await call(screen, `/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch (e) {
        if (e.status !== 404) throw e; // already gone is fine
      }
    }
    screen.anthias.trash = [];
    for (const a of assets) {
      for (const p of partsOf(a, screen)) {
        const key = keyOf(p);
        const had = a.anthias.find((x) => String(x.screen) === sid && x.part === p.part);
        if (had && had.key === key) {
          order.push(had.id);
          continue;
        }
        if (had && had.file === p.file) {
          // Same file: just update the details
          await call(screen, `/assets/${encodeURIComponent(had.id)}`, { method: 'PATCH', json: p.body });
          had.key = key;
          order.push(had.id);
        } else {
          if (had) await call(screen, `/assets/${encodeURIComponent(had.id)}`, { method: 'DELETE' }).catch((e) => e.status === 404 || Promise.reject(e));
          const uri = p.uri || (await upload(screen, p, a));
          const made = await call(screen, '/assets', { method: 'POST', json: { ...p.body, uri, play_order: order.length, nocache: 0, skip_asset_check: 1 } });
          const id = idOf(made);
          if (!id) throw new AnthiasError('Anthias added the item but didn’t send back its id.');
          a.anthias = [...a.anthias.filter((x) => x !== had), { screen: screen._id, part: p.part, id, key, file: p.file }];
          order.push(id);
        }
        sent++;
        a.markModified('anthias');
        await a.save();
      }
    }
    if (order.length) {
      try {
        await call(screen, '/assets/order', { method: 'POST', raw: new URLSearchParams({ ids: order.join(',') }).toString() });
      } catch (e) {
        if (e.status && e.status < 500) await call(screen, '/assets/order', { method: 'POST', json: { ids: order.join(',') } });
        else throw e;
      }
    }
    screen.anthias.lastSyncAt = new Date();
    screen.anthias.lastError = '';
    screen.anthias.sent = order.length;
    await screen.save();
    return { sent, removed: trash.length, total: order.length };
  } catch (e) {
    screen.anthias.lastError = explain(e, screen);
    await screen.save().catch(() => {});
    throw new AnthiasError(screen.anthias.lastError);
  }
}

// After something changes: send to the Anthias screens it affects, a few seconds later (changes
// made together go in one send). Errors are kept on the screen for the Signage tab to show.
const timers = new Map();
export function syncSoon(screenIds = null, delay = 4000) {
  Screen.find({ mode: 'anthias', ...(screenIds?.length ? { _id: { $in: screenIds } } : {}) }, { _id: 1 })
    .lean()
    .then((list) => {
      for (const s of list) {
        const id = String(s._id);
        clearTimeout(timers.get(id));
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id);
            syncScreen(id).catch(() => {});
          }, delay)
        );
      }
    })
    .catch(() => {});
}

// Every 10 minutes, in case a send failed (the Pi was off) or Anthias was changed by hand
export function startAnthiasJob() {
  setInterval(() => syncSoon(null, 0), 10 * 60 * 1000).unref();
}

// Mark a deleted item's Anthias copies for removal on the next send
export async function forgetInAnthias(asset) {
  const bySid = new Map();
  for (const x of asset.anthias || []) bySid.set(String(x.screen), [...(bySid.get(String(x.screen)) || []), x.id]);
  for (const [sid, ids] of bySid) await Screen.updateOne({ _id: sid }, { $push: { 'anthias.trash': { $each: ids } } });
  if (bySid.size) syncSoon([...bySid.keys()]);
}
