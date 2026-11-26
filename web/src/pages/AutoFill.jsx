import { useEffect, useState } from 'react';
import { addDays, api, fmtDay, fmtTime, weekendLabel } from '../lib.js';
import { Avatar, Empty, Modal, useApp } from '../ui.jsx';

// Preview of who auto-fill would place. Nothing changes until "Place N people".
export function AutoFillModal({ friday, onClose, onDone }) {
  const app = useApp();
  const [data, setData] = useState(null);
  const [events, setEvents] = useState([]);
  const [skip, setSkip] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api(`/weekend/autofill?friday=${friday}`), api(`/events?from=${friday}&to=${addDays(friday, 2)}`).catch(() => [])])
      .then(([d, ev]) => {
        setData(d);
        setEvents(ev);
      })
      .catch((e) => setError(e.message));
  }, [friday]);

  const evById = Object.fromEntries(events.map((e) => [e.id, e]));
  const key = (p) => `${p.eventId}|${p.position}`;
  const picks = (data?.proposals || []).filter((p) => !skip[key(p)]);

  const apply = async () => {
    setBusy(true);
    try {
      const out = await api('/weekend/autofill', { method: 'POST', body: { friday, picks } });
      app.toast(`Placed ${out.applied} ${out.applied === 1 ? 'person' : 'people'}${out.skipped ? ` (${out.skipped} spot${out.skipped === 1 ? ' was' : 's were'} already taken)` : ''}`);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const groups = [];
  for (const p of data?.proposals || []) {
    let g = groups.find((x) => x.eventId === p.eventId);
    if (!g) groups.push((g = { eventId: p.eventId, items: [] }));
    g.items.push(p);
  }

  return (
    <Modal title={`Auto-fill ${weekendLabel(friday)}`} onClose={onClose} wide>
      {!data && !error && <div className="loading-inline">Working it out…</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {data && (
        <div className="stack">
          <p className="muted small">
            Only people trained for the spot, free that day and under their monthly limit. Shifts are spread so nobody gets doubled up while others sit out. Untick anyone you don’t want, then place them. Nobody is messaged.
          </p>
          {data.proposals.length === 0 && <Empty>{data.unfilled.length ? 'No one is available for the open spots.' : 'Every spot this weekend is already filled.'}</Empty>}
          <div className="af-list">
            {groups.map((g) => {
              const e = evById[g.eventId];
              return (
                <div key={g.eventId} className="stack-sm">
                  <div className="label-sm">
                    {e ? `${e.title} · ${fmtDay(e.date)} · ${fmtTime(e.start)}` : 'Service'}
                  </div>
                  {g.items.map((p) => (
                    <label key={key(p)} className="af-row">
                      <input type="checkbox" checked={!skip[key(p)]} onChange={() => setSkip({ ...skip, [key(p)]: !skip[key(p)] })} />
                      <span className="af-pos">{app.posLabel(p.position)}</span>
                      <Avatar name={p.userName} size={28} tone="light" />
                      <span className="grow col">
                        <strong>
                          {p.userName} {p.regular && <span className="chip chip-regular">Regular</span>}
                        </strong>
                        <span className="muted small">{p.reason}</span>
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          {data.regularNotes?.length > 0 && (
            <div className="warn-box">
              <strong>Regulars who couldn’t be placed:</strong>
              <ul className="plain-list">
                {data.regularNotes.map((n, i) => (
                  <li key={i}>
                    {n.name} ({n.rule}) — {n.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.unfilled.length > 0 && (
            <div className="warn-box">
              <strong>Still open after auto-fill:</strong>
              <ul className="plain-list">
                {data.unfilled.map((u) => {
                  const e = evById[u.eventId];
                  return (
                    <li key={u.eventId + u.position}>
                      {app.posLabel(u.position)} · {e?.title} — {u.why}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" disabled={busy || !picks.length} onClick={apply}>
              Place {picks.length} {picks.length === 1 ? 'person' : 'people'}
            </button>
            {data.proposals.some((p) => p.regular) && data.proposals.some((p) => !p.regular) && (
              <button type="button" className="btn btn-ghost" onClick={() => setSkip(Object.fromEntries(data.proposals.filter((p) => !p.regular).map((p) => [key(p), true])))}>
                Regulars only
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
