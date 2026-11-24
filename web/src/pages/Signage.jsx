// Signage: what the church's screens show, laid out like Anthias's own screen. Active and inactive
// items with their start, end and duration and an on/off switch, dragged into order. Each item can
// go on every screen or only some. Things come from uploads, web pages, a service plan's media, or
// upload links people are sent (those wait under Waiting). Screens get their playlist through a live
// link added to Anthias once, or Crew Call sends each item into Anthias itself.
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDay, fmtSize, uploadFiles } from '../lib.js';
import { DropZone, Empty, Modal, useApp } from '../ui.jsx';
import { Qr } from '../qr.jsx';
import { Sortable, TileHandle } from '../tiles.jsx';
import { Player } from '../signagePlayer.jsx';
import './signage.css';

const PARTS = [
  ['playlist', 'Playlist'],
  ['waiting', 'Waiting'],
  ['screens', 'Screens'],
  ['links', 'Upload links'],
];
const KIND = { image: 'Picture', video: 'Video', pdf: 'PDF', web: 'Web page' };
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/heic,video/*,application/pdf,.pdf,.mov,.mp4,.m4v';
const store = {
  get: (k, d) => {
    try {
      return localStorage.getItem(k) || d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

// datetime-local <-> ISO, in this browser's time
const toInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromInput = (v) => (v ? new Date(v).toISOString() : null);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function durationText(a) {
  if (a.kind === 'video') return a.seconds > 0 ? `${a.seconds}s` : a.videoSeconds ? `${mmss(a.videoSeconds)} (whole)` : 'Whole video';
  if (a.seconds === 0) return 'Stays on';
  return `${a.seconds}s${a.kind === 'pdf' && a.pages > 1 ? ` × ${a.pages} pages` : ''}`;
}
// Why an item isn't showing right now
function why(a, now = Date.now()) {
  if (a.processing === 'working') return 'Getting it ready…';
  if (a.processing === 'failed') return `Couldn’t get it ready: ${a.processError}`;
  if (!a.enabled) return 'Switched off';
  if (a.startAt && new Date(a.startAt) > now) return `Starts ${when(a.startAt)}`;
  if (a.endAt && new Date(a.endAt) <= now) return `Ended ${when(a.endAt)}`;
  return '';
}

// ---------- what each screen is showing right now ----------
// Live-link screens check in every 10 seconds and whenever a new item starts.
function useNowPlaying() {
  const [now, setNow] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    let t;
    let on = true;
    const load = async () => {
      if (!document.hidden) {
        try {
          const r = await api('/signage/now', { background: true });
          if (on) setNow({ ...r, skew: r.serverNow - Date.now() });
        } catch {
          /* try again */
        }
      }
      if (on) t = setTimeout(load, 3000);
    };
    load();
    const tick = setInterval(() => setTick((x) => x + 1), 1000); // count the seconds down
    return () => {
      on = false;
      clearTimeout(t);
      clearInterval(tick);
    };
  }, []);
  return now;
}
function playing(now, sid) {
  const st = now?.screens.find((x) => x.id === sid);
  if (!st) return null;
  const p = st.players[0];
  const at = Date.now() + (now.skew || 0);
  const left = p?.length ? Math.max(0, Math.ceil(p.length - (at - p.startedAt) / 1000)) : null;
  return { ...st, p, left, players: st.players.filter((x) => at - x.at < 35000).length, follow: st.online && p?.item ? { id: p.item.id, startedAt: p.startedAt - (now.skew || 0) } : null };
}
const assetOf = (itemId) => String(itemId || '').split(':')[0];

export default function Signage() {
  const app = useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [part, setPartRaw] = useState(() => store.get('cc-signage-part', 'playlist'));
  const [screen, setScreenRaw] = useState(() => store.get('cc-signage-screen', 'all'));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(false);
  const now = useNowPlaying();
  const setPart = (p) => (setPartRaw(p), store.set('cc-signage-part', p));
  const setScreen = (s) => (setScreenRaw(s), store.set('cc-signage-screen', s));

  const load = useCallback(() => api('/signage', { background: true }).then(setD, (e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  // While something is being got ready (a video, a PDF), check back
  const working = d?.assets.some((a) => a.processing === 'working');
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [working, load]);
  // Keep the badge on the tab current
  const waiting = d?.assets.filter((a) => a.status === 'pending') || [];
  useEffect(() => {
    if (d && app.signage && app.signage.waiting !== waiting.length) app.setSignageWaiting?.(waiting.length);
  }, [d, waiting.length, app]);

  const act = async (fn, msg) => {
    try {
      const out = await fn();
      if (out?.assets) setD(out);
      if (msg) app.toast(msg);
      return out || true;
    } catch (e) {
      app.toast(e.message);
      return null;
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!d) return <div className="loading">Loading…</div>;
  const screenName = (id) => d.screens.find((s) => s.id === id)?.name || 'a removed screen';
  if (screen !== 'all' && !d.screens.some((s) => s.id === screen)) setScreen('all');

  return (
    <div className="stack sg">
      <header className="page-head">
        <div>
          <h1>Signage</h1>
          <p className="muted">What the church screens show. Separate from service plans, but you can bring in anything from a plan, or send a screen item to one.</p>
        </div>
      </header>

      <div className="seg seg-scroll" role="group" aria-label="Show">
        {PARTS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={part === id} onClick={() => setPart(id)}>
            {label}
            {id === 'waiting' && waiting.length > 0 && <span className="sg-count">{waiting.length}</span>}
          </button>
        ))}
      </div>

      {part === 'playlist' && (
        <Playlist d={d} setD={setD} load={load} act={act} now={now} screen={screen} setScreen={setScreen} onAdd={() => setAdding(true)} onEdit={setEditing} onPreview={(sid) => setPreview(sid || screen)} waiting={waiting.length} toWaiting={() => setPart('waiting')} screenName={screenName} />
      )}
      {part === 'waiting' && <Waiting d={d} act={act} list={waiting} />}
      {part === 'screens' && <Screens d={d} act={act} now={now} onMirror={setPreview} />}
      {part === 'links' && <Links d={d} act={act} />}

      {adding && <AddAsset d={d} act={act} screen={screen} onClose={() => setAdding(false)} />}
      {editing && d.assets.find((a) => a.id === editing) && <EditAsset d={d} act={act} a={d.assets.find((a) => a.id === editing)} onClose={() => setEditing(null)} />}
      {preview && <Preview d={d} screen={preview} now={now} onClose={() => setPreview(false)} />}
    </div>
  );
}

// ---------- the playlist (Anthias's Active / Inactive lists) ----------
function Playlist({ d, setD, load, act, now, screen, setScreen, onAdd, onEdit, onPreview, waiting, toWaiting, screenName }) {
  const shown = d.assets.filter((a) => a.status === 'approved' && (screen === 'all' || !a.screens.length || a.screens.includes(screen)));
  const active = shown.filter((a) => a.live);
  const inactive = shown.filter((a) => !a.live);
  const [order, setOrder] = useState(active.map((a) => a.id));
  const key = active.map((a) => a.id).join(',');
  useEffect(() => setOrder(key ? key.split(',') : []), [key]);
  const byId = (id) => d.assets.find((a) => a.id === id);
  // Which screens are showing an item this second
  const onNowOf = (a) => (a ? d.screens.filter((sc) => { const st = playing(now, sc.id); return st?.online && assetOf(st.p?.item?.id) === a.id; }).map((sc) => sc.name) : []);
  // Moving items in a screen's list keeps everything else where it was
  const reorder = (next) => {
    const all = d.assets.filter((a) => a.status === 'approved').map((a) => a.id);
    const moved = new Set(next);
    let k = 0;
    const ids = all.map((id) => (moved.has(id) ? next[k++] : id));
    act(() => api('/signage/assets/order', { method: 'POST', body: { ids } }));
  };
  const toggle = (a) => {
    setD((old) => ({ ...old, assets: old.assets.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x)) })); // flip it now; the server's answer follows
    act(() => api(`/signage/assets/${a.id}`, { method: 'PATCH', body: { enabled: !a.enabled } })).then((r) => r || load());
  };

  return (
    <>
      <div className="sg-bar">
        <div className="seg seg-scroll" role="group" aria-label="Screen">
          <button type="button" aria-pressed={screen === 'all'} onClick={() => setScreen('all')}>
            All screens
          </button>
          {d.screens.map((s) => (
            <button key={s.id} type="button" aria-pressed={screen === s.id} onClick={() => setScreen(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="row-wrap">
          <button type="button" className="btn btn-ghost" onClick={() => onPreview()} disabled={!active.length}>
            ▶ Preview
          </button>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            + Add
          </button>
        </div>
      </div>
      {waiting > 0 && (
        <button type="button" className="sg-waiting" onClick={toWaiting}>
          <strong>{waiting}</strong> sent with an upload link {waiting === 1 ? 'is' : 'are'} waiting for a look <span aria-hidden="true">›</span>
        </button>
      )}
      {d.screens.length > 0 && <LiveStrip d={d} now={now} onMirror={onPreview} />}
      {!d.screens.length && <p className="sg-tip">No screens yet. Add your screens under <strong>Screens</strong> to get each one’s link for Anthias.</p>}

      <section className="card sg-table" aria-label="Active">
        <h2>
          Active <span className="muted small">showing now{screen !== 'all' ? ` on ${screenName(screen)}` : ''}, in this order</span>
        </h2>
        {active.length ? (
          <>
            <TableHead drag />
            <Sortable
              order={order.filter(byId)}
              onChange={setOrder}
              onDone={reorder}
              titleOf={(id) => byId(id)?.name}
              className="sg-rows"
              itemClass="sg-row-wrap"
              helpId="sg-drag-help"
              renderItem={(id) => <Row a={byId(id)} drag onToggle={toggle} onEdit={onEdit} act={act} screenName={screenName} onNow={onNowOf(byId(id))} />}
            />
            <p className="muted small" id="sg-drag-help">
              Drag ⠿ to change the order, or focus it and use the arrow keys.
            </p>
          </>
        ) : (
          <Empty>Nothing is showing right now{screen !== 'all' ? ' on this screen' : ''}. Add something, or switch an item on below.</Empty>
        )}
      </section>

      <section className="card sg-table" aria-label="Inactive">
        <h2>
          Inactive <span className="muted small">switched off, scheduled for later, ended, or still getting ready</span>
        </h2>
        {inactive.length ? (
          <>
            <TableHead />
            <div className="sg-rows">
              {inactive.map((a) => (
                <div key={a.id} className="sg-row-wrap">
                  <Row a={a} onToggle={toggle} onEdit={onEdit} act={act} screenName={screenName} onNow={onNowOf(a)} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted small">Nothing here.</p>
        )}
      </section>
    </>
  );
}

function TableHead({ drag }) {
  return (
    <div className={`sg-row sg-head ${drag ? '' : 'sg-nodrag'}`} aria-hidden="true">
      {drag && <span />}
      <span />
      <span>Name</span>
      <span>Start</span>
      <span>End</span>
      <span>Duration</span>
      <span>On</span>
      <span />
    </div>
  );
}

function Thumb({ a, size = 'sm' }) {
  if (a.thumb) return <img className={`sg-thumb sg-thumb-${size}`} src={a.thumb} alt="" loading="lazy" />;
  if (a.kind === 'video' && a.processing === 'ready') return <video className={`sg-thumb sg-thumb-${size}`} src={`${a.file}#t=0.5`} preload="metadata" muted playsInline />;
  return (
    <span className={`sg-thumb sg-thumb-${size} sg-thumb-icon`} aria-hidden="true">
      {a.kind === 'web' ? '🌐' : a.kind === 'video' ? '🎬' : a.kind === 'pdf' ? '📄' : '🖼'}
    </span>
  );
}

function Row({ a, drag, onToggle, onEdit, act, screenName, onNow = [] }) {
  const note = why(a);
  return (
    <div className={`sg-row ${drag ? '' : 'sg-nodrag'} ${a.processing === 'failed' ? 'sg-failed' : ''}`}>
      {drag && <TileHandle />}
      <button type="button" className="sg-thumb-btn" onClick={() => onEdit(a.id)} aria-label={`Edit ${a.name}`}>
        <Thumb a={a} />
      </button>
      <div className="sg-name">
        <button type="button" className="link-btn sg-title" onClick={() => onEdit(a.id)}>
          {a.name}
        </button>
        <span className="sg-meta">
          {KIND[a.kind]}
          {a.size ? ` · ${fmtSize(a.size)}` : ''}
          {' · '}
          {a.screens.length ? a.screens.map(screenName).join(', ') : 'All screens'}
          {a.from && ` · from ${a.from.name}`}
          {a.fromPlan && ' · from a service plan'}
        </span>
        {note && <span className={`sg-why ${a.processing === 'failed' ? 'sg-why-bad' : ''}`}>{note}</span>}
        {onNow.length > 0 && (
          <span className="sg-onnow">
            <span className="sg-dot sg-dot-on" aria-hidden="true" /> On screen now: {onNow.join(', ')}
          </span>
        )}
        <span className="sg-when-m">
          {a.startAt ? when(a.startAt) : 'Now'} → {a.endAt ? when(a.endAt) : 'no end'} · {durationText(a)}
        </span>
      </div>
      <span className="sg-cell" data-label="Start">
        {a.startAt ? when(a.startAt) : '—'}
      </span>
      <span className="sg-cell" data-label="End">
        {a.endAt ? when(a.endAt) : 'No end'}
      </span>
      <span className="sg-cell" data-label="Duration">
        {durationText(a)}
      </span>
      <label className="sg-switch" title={a.enabled ? 'On: switch off' : 'Off: switch on'}>
        <input type="checkbox" role="switch" checked={a.enabled} onChange={() => onToggle(a)} aria-label={`${a.name} on`} />
        <span aria-hidden="true" />
      </label>
      <div className="sg-actions">
        <button type="button" className="icon-btn" onClick={() => onEdit(a.id)} aria-label={`Edit ${a.name}`} title="Edit">
          ✎
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Delete ${a.name}`}
          title="Delete"
          onClick={() => window.confirm(`Take “${a.name}” off the screens and delete it?`) && act(() => api(`/signage/assets/${a.id}`, { method: 'DELETE' }), 'Deleted')}
        >
          🗑
        </button>
      </div>
    </div>
  );
}

// ---------- live: what each screen shows this second ----------
function ScreenStatus({ s, st, onMirror, long = false }) {
  if (s.mode === 'anthias')
    return (
      <span className="sg-live-line">
        <span className="sg-dot" aria-hidden="true" />
        <span>
          {!long && <strong>{s.name}: </strong>}{long ? 'Played' : 'played'} by Anthias itself{s.anthias.lastSyncAt ? `; last sent ${when(s.anthias.lastSyncAt)}` : ''}
        </span>
      </span>
    );
  if (!st?.online)
    return (
      <span className="sg-live-line">
        <span className={`sg-dot ${st?.lastSeenAt ? 'sg-dot-off' : ''}`} aria-hidden="true" />
        <span>
          {!long && <strong>{s.name}: </strong>}{st?.lastSeenAt ? `${long ? 'Offline' : 'offline'} · last seen ${when(st.lastSeenAt)}` : long ? 'Not connected yet. Once its link is playing in Anthias, it shows here.' : 'not connected yet'}
        </span>
      </span>
    );
  const p = st.p;
  return (
    <span className="sg-live-line">
      <span className="sg-dot sg-dot-on" aria-hidden="true" />
      <span>
        {!long && <strong>{s.name}: </strong>}{p?.item ? (
          <>
            {long && 'Showing '}
            <q>{p.item.name}</q>
          </>
        ) : long ? 'Online, with nothing to show right now' : 'online, nothing to show'}
        {p?.item && st.left !== null && <span className="sg-left"> · {st.left}s left</span>}
        {p?.next && p.next.id !== p.item?.id && <span className="muted"> · next: {p.next.name}</span>}
        {st.players > 1 && <span className="muted"> · on {st.players} TVs</span>}
        {p?.current === false && <span className="sg-why"> · picking up your changes…</span>}
        {long && p?.size && <span className="muted"> · {p.size}</span>}
      </span>
      {onMirror && p?.item && (
        <button type="button" className="link-btn small sg-watch" onClick={() => onMirror(s.id)}>
          Watch
        </button>
      )}
    </span>
  );
}
function LiveStrip({ d, now, onMirror }) {
  return (
    <section className="sg-live" aria-label="On the screens now" aria-live="off">
      {d.screens.map((s) => (
        <ScreenStatus key={s.id} s={s} st={playing(now, s.id)} onMirror={onMirror} />
      ))}
    </section>
  );
}

// ---------- where and when (shared by Add, Edit and Approve) ----------
function ScreensPick({ screens, value, onChange }) {
  const all = !value.length;
  if (!screens.length) return null;
  return (
    <fieldset className="field sg-screens">
      <legend>Which screens</legend>
      <label className="check">
        <input type="radio" checked={all} onChange={() => onChange([])} />
        <span>All screens</span>
      </label>
      <label className="check">
        <input type="radio" checked={!all} onChange={() => onChange([screens[0].id])} />
        <span>Only some</span>
      </label>
      {!all && (
        <div className="check-grid">
          {screens.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={value.includes(s.id)} onChange={() => {
                  const next = value.includes(s.id) ? value.filter((x) => x !== s.id) : [...value, s.id];
                  if (next.length) onChange(next); // unticking the last one would mean every screen
                }} />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
function When({ f, set, kind }) {
  return (
    <>
      <div className="row-wrap fields-2">
        <label className="field">
          <span>Start</span>
          <input type="datetime-local" value={f.start} onChange={(e) => set({ start: e.target.value })} />
          <span className="muted small">{f.start ? '' : 'Empty: right away'}</span>
        </label>
        <label className="field">
          <span>End</span>
          <input type="datetime-local" value={f.end} min={f.start || undefined} onChange={(e) => set({ end: e.target.value })} />
          <span className="muted small">{f.end ? '' : 'Empty: keeps showing'}</span>
        </label>
      </div>
      {kind === 'video' ? (
        <div className="row-wrap">
          <label className="check">
            <input type="checkbox" checked={f.whole} onChange={(e) => set({ whole: e.target.checked })} />
            <span>Play the whole video</span>
          </label>
          {!f.whole && (
            <label className="field sg-secs">
              <span>Seconds</span>
              <input type="number" min="3" max="86400" value={f.seconds} onChange={(e) => set({ seconds: e.target.value })} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={f.sound} onChange={(e) => set({ sound: e.target.checked })} />
            <span>Play its sound</span>
          </label>
        </div>
      ) : (
        <label className="field sg-secs">
          <span>{kind === 'pdf' ? 'Seconds per page' : kind === 'web' ? 'Seconds on screen' : kind ? 'Seconds on screen' : 'Seconds per picture or page'}</span>
          <input type="number" min="0" max="86400" value={f.seconds} onChange={(e) => set({ seconds: e.target.value })} />
          <span className="muted small">{Number(f.seconds) === 0 && f.seconds !== '' ? 'Stays on: the screen won’t move on from it to anything else until it’s switched off or ends.' : '0 keeps it on screen. Anything that’s the only item on a screen stays on by itself.'}</span>
        </label>
      )}
    </>
  );
}
const body = (f, kind) => ({
  screens: f.screens,
  startAt: fromInput(f.start),
  endAt: fromInput(f.end),
  seconds: kind === 'video' ? (f.whole ? 0 : Number(f.seconds) || 10) : f.seconds === '' || !Number.isFinite(Number(f.seconds)) ? 10 : Math.max(0, Number(f.seconds)),
  ...(kind === 'video' ? { sound: f.sound } : {}),
});

// ---------- add ----------
function AddAsset({ d, act, screen, onClose }) {
  const app = useApp();
  const [tab, setTab] = useState('upload');
  const [f, setF] = useState({ screens: screen === 'all' ? [] : [screen], start: '', end: '', seconds: 10, whole: true, sound: false });
  const set = (p) => setF({ ...f, ...p });
  const [web, setWeb] = useState({ uri: '', name: '' });
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    if (tab === 'plan' && !plans) api('/signage/plan-media').then((r) => setPlans(r.plans), () => setPlans([]));
  }, [tab, plans]);

  const upload = async (files, onProgress) => {
    const b = body(f, null);
    const out = await uploadFiles('/signage/assets', files, { onProgress, extra: { screens: JSON.stringify(b.screens), startAt: b.startAt || '', endAt: b.endAt || '', seconds: String(b.seconds) } });
    act(async () => out, `Added ${files.length === 1 ? files[0].name : `${files.length} files`}${files.some((x) => !/^image\/(png|jpe?g|gif|webp)$/.test(x.type)) ? '. Videos and PDFs take a moment to get ready.' : ''}`);
    onClose();
  };
  const addWeb = async (e) => {
    e.preventDefault();
    if (await act(() => api('/signage/assets/web', { method: 'POST', body: { ...web, ...body({ ...f, seconds: String(f.seconds) === '0' ? 0 : f.seconds || 30 }, 'web') } }), 'Web page added')) onClose();
  };
  const fromPlan = async (m) => {
    if (await act(() => api('/signage/assets/from-media', { method: 'POST', body: { mediaId: m.id, ...body(f, m.kind === 'video' ? 'video' : null) } }), `Added ${m.title}`)) onClose();
  };

  return (
    <Modal title="Add to the screens" onClose={onClose} wide>
      <div className="seg" role="group" aria-label="Add from">
        <button type="button" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>
          Upload
        </button>
        <button type="button" aria-pressed={tab === 'web'} onClick={() => setTab('web')}>
          Web page
        </button>
        {d.plans && (
          <button type="button" aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}>
            From a service plan
          </button>
        )}
      </div>

      <ScreensPick screens={d.screens} value={f.screens} onChange={(screens) => set({ screens })} />
      <When f={f} set={set} kind={tab === 'web' ? 'web' : null} />

      {tab === 'upload' && (
        <>
          <DropZone onFiles={upload} maxMB={d.maxMB} accept={ACCEPT} label="Drop pictures, videos or PDFs here" hint={`Up to ${d.maxMB} MB each. Videos are made into a version every screen can play; PDFs show a page at a time.`} />
          <p className="muted small">PowerPoint, Keynote or Word? Save it as a PDF first (File → Export → PDF).{!d.tools.video && ' This server can’t convert videos yet, so send MP4s.'}</p>
        </>
      )}
      {tab === 'web' && (
        <form className="stack-sm" onSubmit={addWeb}>
          <label className="field">
            <span>Web address</span>
            <input type="url" required inputMode="url" autoCapitalize="off" value={web.uri} onChange={(e) => setWeb({ ...web, uri: e.target.value })} placeholder="https://…" />
          </label>
          <label className="field">
            <span>Name (optional)</span>
            <input maxLength={120} value={web.name} onChange={(e) => setWeb({ ...web, name: e.target.value })} placeholder="e.g. Church calendar" />
          </label>
          <p className="muted small">Some sites don’t allow being shown inside another page and stay blank on a live-link screen. Screens Crew Call sends to Anthias show them full screen.</p>
          <div>
            <button className="btn btn-primary">Add web page</button>
          </div>
        </form>
      )}
      {tab === 'plan' &&
        (!plans ? (
          <div className="loading">Loading…</div>
        ) : !plans.length ? (
          <Empty>No pictures, videos or PDFs on service plans from the last two weeks or the next two months.</Empty>
        ) : (
          <div className="sg-plans">
            {plans.map((p) => (
              <section key={p.eventId}>
                <h3>
                  {p.title} <span className="muted small">{fmtDay(p.date)}</span>
                </h3>
                <div className="sg-plan-media">
                  {p.media.map((m) => (
                    <button key={m.id} type="button" className="sg-pm" onClick={() => fromPlan(m)} title={`Add ${m.title}`}>
                      {m.kind === 'image' ? <img src={m.url} alt="" loading="lazy" /> : <span className="sg-thumb-icon">{m.kind === 'video' ? '🎬' : '📄'}</span>}
                      <span>{m.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))}
      {app.previewing && <p className="muted small">This is a preview, so nothing is saved.</p>}
    </Modal>
  );
}

// ---------- edit ----------
function EditAsset({ d, act, a, onClose }) {
  const [f, setF] = useState({ name: a.name, screens: a.screens, start: toInput(a.startAt), end: toInput(a.endAt), seconds: a.kind === 'video' ? a.seconds || 10 : (a.seconds ?? 10), whole: a.kind === 'video' && !a.seconds, sound: a.sound, enabled: a.enabled });
  const set = (p) => setF({ ...f, ...p });
  const [toPlan, setToPlan] = useState(null);
  const [eventId, setEventId] = useState('');
  useEffect(() => {
    if (toPlan === true) api('/signage/plan-media?all=1').then((r) => setToPlan(r.plans), () => setToPlan([]));
  }, [toPlan]);
  const save = async (e) => {
    e.preventDefault();
    if (await act(() => api(`/signage/assets/${a.id}`, { method: 'PATCH', body: { name: f.name, enabled: f.enabled, ...body(f, a.kind) } }), 'Saved')) onClose();
  };
  const sendToPlan = async () => {
    const r = await act(() => api(`/signage/assets/${a.id}/to-plan`, { method: 'POST', body: { eventId } }));
    if (r?.ok) {
      act(async () => null, `Added to ${r.title} (${fmtDay(r.date)})`);
      setToPlan(null);
    }
  };
  return (
    <Modal title={`Edit ${a.name}`} onClose={onClose} wide>
      <div className="sg-edit-top">
        <Big a={a} />
        <div className="stack-xs small">
          <span>
            {KIND[a.kind]}
            {a.size ? ` · ${fmtSize(a.size)}` : ''}
            {a.kind === 'pdf' ? ` · ${a.pages} page${a.pages === 1 ? '' : 's'}` : ''}
            {a.kind === 'video' && a.videoSeconds ? ` · ${mmss(a.videoSeconds)}` : ''}
          </span>
          {a.uri && (
            <a href={a.uri} target="_blank" rel="noopener noreferrer" className="sg-uri">
              {a.uri}
            </a>
          )}
          {a.from && (
            <span>
              Sent by {a.from.name}
              {a.from.email ? ` (${a.from.email})` : ''}
              {a.from.note ? `: “${a.from.note}”` : ''}
            </span>
          )}
          {a.createdBy && <span>Added by {a.createdBy}</span>}
          {a.file && (
            <a href={`${a.file}${a.file.includes('?') ? '&' : '?'}download=1`} className="link-btn">
              Download
            </a>
          )}
        </div>
      </div>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input required maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <ScreensPick screens={d.screens} value={f.screens} onChange={(screens) => set({ screens })} />
        <When f={f} set={set} kind={a.kind} />
        <label className="check">
          <input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>On</span>
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary">Save</button>
          {d.plans && a.kind !== 'web' && toPlan === null && (
            <button type="button" className="btn btn-ghost" onClick={() => setToPlan(true)}>
              Add to a service plan…
            </button>
          )}
        </div>
      </form>
      {Array.isArray(toPlan) && (
        <div className="stack-sm divider-top">
          {toPlan.length ? (
            <>
              <label className="field">
                <span>Add a copy to this service’s media</span>
                <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  <option value="">Pick a service…</option>
                  {toPlan.map((p) => (
                    <option key={p.eventId} value={p.eventId}>
                      {fmtDay(p.date)} · {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row-wrap">
                <button type="button" className="btn btn-primary btn-sm" disabled={!eventId} onClick={sendToPlan}>
                  Add to the plan
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setToPlan(null)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">No upcoming services in the next two months.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
function Big({ a }) {
  if (a.kind === 'video' && a.processing === 'ready') return <video className="sg-big" src={a.file} controls muted playsInline preload="metadata" />;
  if (a.thumb) return <img className="sg-big" src={a.thumb} alt="" />;
  return <Thumb a={a} size="lg" />;
}

// ---------- waiting for approval ----------
function Waiting({ d, act, list }) {
  if (!list.length)
    return (
      <section className="card">
        <Empty>Nothing waiting. Things people send with an upload link land here for a look before they show.</Empty>
      </section>
    );
  return (
    <div className="stack">
      {list.map((a) => (
        <WaitingCard key={a.id} d={d} act={act} a={a} />
      ))}
    </div>
  );
}
function WaitingCard({ d, act, a }) {
  const [f, setF] = useState({ name: a.name, screens: [], start: toInput(a.startAt), end: toInput(a.endAt), seconds: a.seconds || 10, whole: a.kind === 'video', sound: false });
  const set = (p) => setF({ ...f, ...p });
  return (
    <section className="card sg-wait" aria-label={a.name}>
      <Big a={a} />
      <div className="stack-sm">
        <p className="small">
          <strong>{a.from?.name || 'Someone'}</strong>
          {a.from?.email ? ` (${a.from.email})` : ''} sent this {when(a.createdAt)}
          {a.from?.note ? (
            <>
              : <q>{a.from.note}</q>
            </>
          ) : (
            '.'
          )}
        </p>
        {a.processing !== 'ready' && <p className={`sg-why ${a.processing === 'failed' ? 'sg-why-bad' : ''}`}>{why(a)}</p>}
        <label className="field">
          <span>Name</span>
          <input maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <ScreensPick screens={d.screens} value={f.screens} onChange={(screens) => set({ screens })} />
        <When f={f} set={set} kind={a.kind} />
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" disabled={a.processing === 'working'} onClick={() => act(() => api(`/signage/assets/${a.id}/approve`, { method: 'POST', body: { name: f.name, ...body(f, a.kind) } }), 'Approved: it’s on the screens')}>
            Approve
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => window.confirm(`Turn down “${a.name}”? It’s deleted.`) && act(() => api(`/signage/assets/${a.id}/decline`, { method: 'POST' }), 'Turned down')}>
            Turn down
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------- screens ----------
function Screens({ d, act, now, onMirror }) {
  const [name, setName] = useState('');
  return (
    <div className="stack">
      {d.screens.map((s) => (
        <ScreenCard key={s.id} s={s} act={act} st={playing(now, s.id)} onMirror={onMirror} />
      ))}
      <form
        className="card row-wrap"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api('/signage/screens', { method: 'POST', body: { name } }), `${name} added`)) setName('');
        }}
      >
        <label className="field grow">
          <span>Add a screen</span>
          <input value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} placeholder="e.g. Lobby, Fellowship hall" />
        </label>
        <button className="btn btn-primary self-end">Add screen</button>
      </form>
    </div>
  );
}
function ScreenCard({ s, act, st, onMirror }) {
  const app = useApp();
  const [f, setF] = useState({ name: s.name, url: s.anthias.url, auth: s.anthias.auth, user: s.anthias.user, secret: '', insecure: s.anthias.insecure, seconds: s.seconds, fit: s.fit });
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (p) => setF({ ...f, ...p });
  const patch = (b, msg) => act(() => api(`/signage/screens/${s.id}`, { method: 'PATCH', body: b }), msg);
  const copy = () => navigator.clipboard.writeText(s.link).then(() => app.toast('Screen link copied'), () => app.toast(s.link));
  const saveAnthias = (e) => {
    e.preventDefault();
    patch({ anthias: { url: f.url, auth: f.auth, user: f.user, insecure: f.insecure, ...(f.secret ? { secret: f.secret } : {}) } }, 'Anthias settings saved').then(() => set({ secret: '' }));
  };
  const runTest = async () => {
    setBusy(true);
    setTest(await api(`/signage/screens/${s.id}/test`, { method: 'POST' }).catch((e) => ({ ok: false, error: e.message })));
    setBusy(false);
  };
  const sendNow = async () => {
    setBusy(true);
    const r = await act(() => api(`/signage/screens/${s.id}/sync`, { method: 'POST' }));
    if (r) app.toast(r.ok ? `Sent to Anthias: ${r.total} item${r.total === 1 ? '' : 's'}` : r.error);
    setBusy(false);
  };
  return (
    <section className="card stack sg-screen" aria-label={s.name}>
      <div className="section-head">
        <h2>{s.name}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm(`Remove the screen “${s.name}”? Items only for it are switched off.`) && act(() => api(`/signage/screens/${s.id}`, { method: 'DELETE' }), 'Screen removed')}>
          Remove
        </button>
      </div>
      <div className="sg-live sg-live-one">
        <ScreenStatus s={s} st={st} onMirror={onMirror} long />
      </div>
      <div className="row-wrap fields-3">
        <label className="field">
          <span>Name</span>
          <input value={f.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} onBlur={() => f.name !== s.name && f.name.trim() && patch({ name: f.name })} />
        </label>
        <label className="field">
          <span>Pictures that don’t fit the screen</span>
          <select value={f.fit} onChange={(e) => (set({ fit: e.target.value }), patch({ fit: e.target.value }))}>
            <option value="contain">Show all of it (black bars)</option>
            <option value="cover">Fill the screen (trim edges)</option>
          </select>
        </label>
        <label className="field">
          <span>Default seconds</span>
          <input type="number" min="3" max="600" value={f.seconds} onChange={(e) => set({ seconds: e.target.value })} onBlur={() => Number(f.seconds) !== s.seconds && patch({ seconds: Number(f.seconds) })} />
        </label>
      </div>

      <fieldset className="field">
        <legend>How this screen gets its playlist</legend>
        <label className="check">
          <input type="radio" checked={s.mode === 'link'} onChange={() => patch({ mode: 'link' }, 'This screen uses its live link')} />
          <span>
            <strong>Live link.</strong> Add the link below to Anthias once; it shows whatever is on this screen’s playlist and updates by itself. Works from any network.
          </span>
        </label>
        <label className="check">
          <input type="radio" checked={s.mode === 'anthias'} onChange={() => patch({ mode: 'anthias' }, 'Crew Call will send this screen’s playlist to Anthias')} />
          <span>
            <strong>Crew Call sends to Anthias.</strong> Each item goes into Anthias’s own playlist, using its own player (smoothest for video). Crew Call needs to be on the same network as the Pi.
          </span>
        </label>
      </fieldset>

      {s.mode === 'link' ? (
        <div className="sg-link">
          <Qr value={s.link} size={96} label={`QR code for ${s.name}`} />
          <div className="stack-sm grow">
            <code className="sg-url">{s.link}</code>
            <div className="row-wrap">
              <button type="button" className="btn btn-outline btn-sm" onClick={copy}>
                Copy link
              </button>
              <a className="btn btn-ghost btn-sm" href={s.link} target="_blank" rel="noopener noreferrer">
                Open it
              </a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm('Make a new link? The old one stops working, so update it in Anthias.') && act(() => api(`/signage/screens/${s.id}/new-link`, { method: 'POST' }), 'New link made')}>
                New link
              </button>
            </div>
            <ol className="small sg-steps">
              <li>
                In Anthias, choose <strong>Add Asset</strong> → <strong>URL</strong>, and paste the link.
              </li>
              <li>
                Set the duration to a day (<strong>86400</strong> seconds) and the end date far ahead, then <strong>Save</strong>.
              </li>
              <li>Switch off the other items in Anthias, so this is the only one playing. Everything else is managed here.</li>
            </ol>
          </div>
        </div>
      ) : (
        <form className="stack-sm" onSubmit={saveAnthias}>
          <div className="row-wrap fields-2">
            <label className="field">
              <span>Anthias address</span>
              <input type="url" inputMode="url" autoCapitalize="off" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://192.168.1.50" />
            </label>
            <label className="field">
              <span>Sign-in</span>
              <select value={f.auth} onChange={(e) => set({ auth: e.target.value })}>
                <option value="none">None (fresh Anthias)</option>
                <option value="token">API token (Anthias → Settings → API tokens)</option>
                <option value="basic">User name and password</option>
              </select>
            </label>
          </div>
          {f.auth !== 'none' && (
            <div className="row-wrap fields-2">
              {f.auth === 'basic' && (
                <label className="field">
                  <span>User name</span>
                  <input autoComplete="off" value={f.user} onChange={(e) => set({ user: e.target.value })} />
                </label>
              )}
              <label className="field">
                <span>{f.auth === 'token' ? 'API token' : 'Password'}</span>
                <input type="password" autoComplete="new-password" value={f.secret} onChange={(e) => set({ secret: e.target.value })} placeholder={s.anthias.hasSecret ? 'Saved (type to change)' : ''} />
              </label>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={f.insecure} onChange={(e) => set({ insecure: e.target.checked })} />
            <span>Anthias uses its own certificate (normal for Anthias on the church network)</span>
          </label>
          <div className="row-wrap">
            <button className="btn btn-primary btn-sm">Save</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !s.anthias.url} onClick={runTest}>
              Test connection
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy || !s.anthias.url} onClick={sendNow}>
              Send now
            </button>
          </div>
          {test && <p className={test.ok ? 'sg-ok' : 'sg-why sg-why-bad'}>{test.ok ? `Connected. Anthias has ${test.total} item${test.total === 1 ? '' : 's'}, ${test.ours} from Crew Call.` : test.error}</p>}
          <p className="muted small">
            {s.anthias.lastError ? <span className="sg-why-bad">Last send didn’t work: {s.anthias.lastError}</span> : s.anthias.lastSyncAt ? `Last sent ${when(s.anthias.lastSyncAt)}: ${s.anthias.sent} item${s.anthias.sent === 1 ? '' : 's'}.` : 'Not sent yet.'} Changes go to Anthias by themselves a few seconds after you make them, and every 10 minutes. Crew Call only changes items it added; anything added in Anthias directly is left alone.
          </p>
        </form>
      )}
    </section>
  );
}

// ---------- upload links ----------
const LASTS = [
  ['off', 'Until I turn it off'],
  ['4h', '4 hours'],
  ['1d', '1 day'],
  ['7d', '1 week'],
  ['30d', '30 days'],
];
function Links({ d, act }) {
  const app = useApp();
  const [f, setF] = useState({ label: '', lasts: 'off' });
  const [qr, setQr] = useState(null);
  const copy = (l) => navigator.clipboard.writeText(l.url).then(() => app.toast('Upload link copied'), () => app.toast(l.url));
  return (
    <div className="stack">
      <form
        className="card stack-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(() => api('/signage/links', { method: 'POST', body: f }), 'Upload link made')) setF({ label: '', lasts: 'off' });
        }}
      >
        <h2>Make an upload link</h2>
        <p className="muted small">Send it to anyone (by WhatsApp, email or a QR code in the bulletin). They can send pictures, videos and PDFs without an account; everything waits under Waiting until someone approves it.</p>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>What it’s for (optional; they see it)</span>
            <input maxLength={80} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Youth group events" />
          </label>
          <label className="field">
            <span>Works</span>
            <select value={f.lasts} onChange={(e) => setF({ ...f, lasts: e.target.value })}>
              {LASTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <button className="btn btn-primary">Make link</button>
        </div>
      </form>
      {d.links.length > 0 && (
        <section className="card stack-sm" aria-label="Upload links">
          <h2>Upload links</h2>
          <ul className="sg-links">
            {d.links.map((l) => {
              const state = !l.on ? 'Off' : l.expired ? 'Expired' : l.expiresAt ? `Until ${when(l.expiresAt)}` : 'On until turned off';
              return (
                <li key={l.id} className={!l.on || l.expired ? 'sg-link-off' : ''}>
                  <div className="grow stack-xs">
                    <strong>{l.label || 'Upload link'}</strong>
                    <span className="muted small">
                      {state} · used {l.uses} time{l.uses === 1 ? '' : 's'}
                      {l.createdBy ? ` · made by ${l.createdBy}` : ''}
                    </span>
                  </div>
                  <div className="row-wrap">
                    {l.on && !l.expired && (
                      <>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(l)}>
                          Copy
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQr(l)}>
                          QR code
                        </button>
                      </>
                    )}
                    {!l.expired && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/signage/links/${l.id}`, { method: 'PATCH', body: { on: !l.on } }), l.on ? 'Link turned off' : 'Link turned on')}>
                        {l.on ? 'Turn off' : 'Turn on'}
                      </button>
                    )}
                    <button type="button" className="icon-btn" aria-label="Delete link" onClick={() => window.confirm('Delete this link? It stops working.') && act(() => api(`/signage/links/${l.id}`, { method: 'DELETE' }), 'Link deleted')}>
                      🗑
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {qr && (
        <Modal title={qr.label || 'Upload link'} onClose={() => setQr(null)}>
          <div className="sg-qr">
            <Qr value={qr.url} size={220} label="QR code for the upload link" />
            <code className="sg-url">{qr.url}</code>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- preview ----------
function Preview({ d, screen, now, onClose }) {
  const [p, setP] = useState(null);
  const [cur, setCur] = useState(null);
  const sid = screen === 'all' ? '' : screen;
  useEffect(() => {
    const load = () => api(`/signage/preview${sid ? `?screen=${sid}` : ''}`, { background: true }).then((x) => setP((old) => (old?.v === x.v ? old : x)), () => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [sid]);
  const sc = sid ? d.screens.find((s) => s.id === sid) : null;
  const st = sid ? playing(now, sid) : null;
  // A live-link screen that's on: show what it's showing, in step with it
  const follow = sc?.mode === 'link' ? st?.follow : null;
  return (
    <Modal title={follow ? `Live: ${sc.name}` : `Preview: ${sc?.name || 'All screens'}`} onClose={onClose} wide>
      {sc && (
        <div className="sg-live sg-live-one">
          <ScreenStatus s={sc} st={st} long />
        </div>
      )}
      <div className="sg-stage">
        {p && <Player items={p.items} fit={p.fit} onItem={setCur} follow={follow} empty={<div className="sp-msg">Nothing showing</div>} />}
        {follow && <span className="sg-live-tag">● LIVE</span>}
      </div>
      {p && (
        <ol className="sg-prev-list small">
          {p.items.map((i) => (
            <li key={i.id} className={cur?.id === i.id ? 'sg-prev-on' : ''}>
              {i.name} <span className="muted">· {i.kind === 'video' && !i.seconds ? 'whole video' : i.seconds === 0 ? 'stays on' : `${i.seconds}s`}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        {follow
          ? `This follows what ${sc.name} is showing right now; it can be a second or two behind. Videos play without sound here.`
          : sc?.mode === 'anthias'
            ? 'Anthias plays this screen itself, so this shows its playlist from the start, not the item that’s on right now. Videos play without sound here.'
            : sc
              ? `${sc.name} isn’t online, so this plays its playlist from the start. Videos play without sound here.`
              : 'What the screens would show, from the start. Pick a screen to watch it live. Videos play without sound here.'}
      </p>
    </Modal>
  );
}
