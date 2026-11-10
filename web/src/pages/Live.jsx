// Live run-of-show (extra feature): the booth view that follows the order of service during the
// service, and the stage clock for a screen the speaker can see.
import { useCallback, useEffect, useRef, useState } from 'react';
import { addMinutes, api, fmtTime } from '../lib.js';
import { Icon, useApp } from '../ui.jsx';

const mmss = (sec) => {
  const s = Math.max(0, Math.round(Math.abs(sec)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// Keeps a ticking "now" that follows the server's clock, so every screen counts the same
function useServerNow(serverNow) {
  const offset = useRef(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (serverNow) offset.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  return new Date(Date.now() + offset.current);
}

// Where the service stands: the current line, time on it, planned length, and how far ahead or behind
export function liveState(order, live, start, now) {
  if (!live) return null;
  const i = live.index;
  const cur = order[i];
  const planned = (Number(cur?.minutes) || 0) * 60;
  const onItem = (now - new Date(live.itemAt)) / 1000;
  // Planned start of this line from the service start time, vs when it really started
  let t = start || '00:00';
  for (let k = 0; k < i; k++) if (order[k].kind !== 'heading') t = addMinutes(t, Number(order[k].minutes) || 0);
  const day = new Date(live.itemAt);
  const [h, m] = t.split(':').map(Number);
  const plannedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  const drift = (new Date(live.itemAt) - plannedAt) / 60000 + (planned && onItem > planned ? (onItem - planned) / 60 : 0);
  let nextIdx = -1;
  for (let k = i + 1; k < order.length; k++)
    if (order[k].kind !== 'heading') {
      nextIdx = k;
      break;
    }
  return { i, cur, planned, onItem, left: planned ? planned - onItem : null, drift: Math.round(drift), next: nextIdx >= 0 ? order[nextIdx] : null, ended: !!live.endedAt };
}

export function LiveView({ eventId, onClose }) {
  const app = useApp();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(null);
  const now = useServerNow(d?.now);

  const load = useCallback(async () => {
    try {
      setD(await api(`/plans/${eventId}/live`, { background: true }));
    } catch (e) {
      app.toast(e.message);
    }
  }, [eventId, app]);
  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!app.settings.features?.checklists) return;
    const get = () => api(`/checklists/${eventId}`, { background: true }).then(setReady, () => {});
    get();
    const t = setInterval(get, 15000);
    return () => clearInterval(t);
  }, [eventId, app.settings.features?.checklists]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const act = async (action, index) => {
    setBusy(true);
    try {
      setD(await api(`/plans/${eventId}/live`, { method: 'POST', body: { action, index } }));
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };

  if (!d) return <div className="live-overlay"><div className="loading-inline">Loading…</div></div>;
  const s = liveState(d.order, d.live, d.event.start, now);
  const stageUrl = `${window.location.origin}/stage/${d.stageToken}`;
  const playable = d.order.filter((x) => x.kind !== 'heading').length;

  return (
    <div className="live-overlay" role="dialog" aria-modal="true" aria-label="Live run-of-show">
      <div className="live-top">
        <div>
          <div className="eyebrow">Live run-of-show</div>
          <strong>{d.event.title}</strong> <span className="muted small">· starts {fmtTime(d.event.start)}</span>
        </div>
        <div className="live-clock" aria-label="Time now">
          {clock(now)}
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>

      {playable === 0 ? (
        <p className="muted">Add items to the order of service first.</p>
      ) : !s ? (
        <div className="live-start">
          <p className="muted">When the service starts, press Start. Then press Next as each part begins; everyone with this open sees it move.</p>
          <button type="button" className="btn btn-primary live-big" disabled={busy} onClick={() => act('start')}>
            Start
          </button>
        </div>
      ) : (
        <>
          <div className={`live-now${s.ended ? ' live-ended' : ''}`}>
            <div className="small muted">{s.ended ? 'Finished' : 'Now'}</div>
            <div className="live-title">{s.ended ? 'Service finished' : s.cur?.title}</div>
            {!s.ended && s.cur?.who && <div className="muted">{s.cur.who}</div>}
            {!s.ended && (
              <div className="live-nums">
                <span>
                  <strong className="mono">{mmss(s.onItem)}</strong> on this
                </span>
                {s.left !== null && (
                  <span className={s.left < 0 ? 'danger' : s.left < 60 ? 'warn-text' : ''}>
                    <strong className="mono">{s.left < 0 ? `+${mmss(s.left)}` : mmss(s.left)}</strong> {s.left < 0 ? 'over' : 'left'}
                  </span>
                )}
                <span className={`chip ${s.drift > 2 ? 'chip-pending' : 'chip-approved'}`}>{s.drift > 0 ? `${s.drift} min behind` : s.drift < 0 ? `${-s.drift} min ahead` : 'On time'}</span>
              </div>
            )}
            {!s.ended && s.cur?.notes && <div className="live-cue">Cue: {s.cur.notes}</div>}
            {!s.ended && <div className="small muted">Next: {s.next ? s.next.title : 'end of service'}</div>}
          </div>
          <div className="live-buttons">
            <button type="button" className="btn btn-outline live-big" disabled={busy || s.ended} onClick={() => act('prev')}>
              ‹ Back
            </button>
            <button type="button" className="btn btn-primary live-big live-next" disabled={busy || s.ended} onClick={() => act('next')}>
              {s.next ? 'Next ›' : 'Finish'}
            </button>
          </div>
        </>
      )}

      {d.order.length > 0 && (
        <ol className="live-list">
          {d.order.map((x, i) => {
            const logged = d.live?.log?.filter((l) => l.index === i).pop();
            return x.kind === 'heading' ? (
              <li key={x.id} className="live-heading">
                {x.title}
              </li>
            ) : (
              <li key={x.id} className={s && s.i === i && !s.ended ? 'live-cur' : logged ? 'live-done' : ''}>
                <button type="button" disabled={busy || !d.live} onClick={() => act('goto', i)} title={d.live ? 'Jump here' : ''}>
                  <span className="grow">
                    {x.title}
                    {x.who && <span className="muted small"> · {x.who}</span>}
                  </span>
                  <span className="small muted mono">{logged ? clock(new Date(logged.at)) : x.minutes ? `${x.minutes} min` : ''}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {ready && ready.positions.length > 0 && (
        <div className="live-ready">
          <span className="small muted">Crew ready:</span>
          {ready.positions.map((p) => (
            <span key={p.key} className={`chip ${p.done === p.items.length ? 'chip-approved' : 'chip-pending'}`}>
              {p.label} {p.done}/{p.items.length}
            </span>
          ))}
        </div>
      )}

      <div className="live-foot row-wrap">
        <span className="small muted">Stage screen for the speaker:</span>
        <a className="btn btn-outline btn-sm" href={stageUrl} target="_blank" rel="noopener noreferrer">
          Open stage clock
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(stageUrl).then(() => app.toast('Stage clock link copied'), () => app.toast(stageUrl))}>
          Copy link
        </button>
        {d.live && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('reset')}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// /stage/<rundown token>: a big countdown for a screen on stage (no sign-in)
export function StagePage({ token }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const now = useServerNow(d?.now);
  useEffect(() => {
    document.title = 'Stage clock';
    const get = () => api(`/public/live/${token}`).then(setD, (e) => setError(e.message));
    get();
    const t = setInterval(get, 2000);
    return () => clearInterval(t);
  }, [token]);
  if (error) return <div className="stage stage-msg">{error}</div>;
  if (!d) return <div className="stage stage-msg">Loading…</div>;
  const s = liveState(d.order, d.live, d.event.start, now);
  return (
    <div className="stage">
      <div className="stage-top">
        <span>{d.event.title}</span>
        <span className="stage-clock">{clock(now)}</span>
      </div>
      {!s ? (
        <div className="stage-main">
          <div className="stage-title">Starts at {fmtTime(d.event.start)}</div>
        </div>
      ) : s.ended ? (
        <div className="stage-main">
          <div className="stage-title">Service finished</div>
        </div>
      ) : (
        <div className="stage-main">
          <div className="stage-title">{s.cur?.title}</div>
          {s.left !== null ? (
            <div className={`stage-count${s.left < 0 ? ' stage-over' : s.left < 120 ? ' stage-soon' : ''}`}>{s.left < 0 ? `+${mmss(s.left)}` : mmss(s.left)}</div>
          ) : (
            <div className="stage-count stage-plain">{mmss(s.onItem)}</div>
          )}
          <div className="stage-next">Next: {s.next ? s.next.title : 'end of service'}</div>
        </div>
      )}
    </div>
  );
}
