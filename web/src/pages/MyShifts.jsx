import { useCallback, useEffect, useState } from 'react';
import { api, dayNum, dowShort, fmtDay, fmtTime, TYPE_LABEL, describeRule } from '../lib.js';
import { Empty, Icon, StatusChip, useApp } from '../ui.jsx';
import { Notices, noticesFor } from '../notices.jsx';

export default function MyShifts() {
  const app = useApp();
  const { me, can, posLabel } = app;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api('/me/overview'));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      if (msg) app.toast(msg);
      await load();
      return true;
    } catch (e) {
      app.toast(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pickUp = (s) =>
    can.edit
      ? act(() => api(`/events/${s.id}/assign/${s.position}`, { method: 'PUT', body: { userId: me.id } }), `You’re on ${posLabel(s.position)} · ${s.title}`)
      : act(() => api('/requests', { method: 'POST', body: { type: 'pickup', eventId: s.id, position: s.position } }), 'Request sent to your team leaders');

  const toggleAvail = (ev) =>
    act(() => api(`/events/${ev.id}/unavailable`, { method: 'PUT', body: { unavailable: !ev.unavailable } }), ev.unavailable ? 'Marked available' : 'Marked unavailable');

  const confirm = (sh, yes = true) =>
    act(() => api('/me/confirm', { method: 'POST', body: { eventId: sh.id, slot: sh.slot, confirmed: yes } }), yes ? 'Confirmed — thanks!' : 'Marked not confirmed');

  const cancelReq = (r) => act(() => api(`/requests/${r.id}/cancel`, { method: 'POST' }), 'Request cancelled');

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return <div className="loading-inline">Loading…</div>;

  const webcal = me.calUrl.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  const isLocal = /\/\/(localhost|127\.|192\.168\.|10\.)/.test(me.calUrl);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>My shifts</h1>
          <div className="muted">Trained on {me.positions.map(posLabel).join(', ') || 'nothing yet — ask a team leader'}</div>
        </div>
      </div>
      <div className="split">
        <div className="stack-lg main-col">
          <section className="card stack" aria-label="Upcoming shifts">
            <h2>Upcoming</h2>
            {data.shifts.length === 0 && <Empty>You’re not on the schedule yet. Pick up an open shift below.</Empty>}
            {data.shifts.some((s) => !s.confirmed) && (
              <div className="warn-box">Please confirm each shift so your leaders know you’ll be there.</div>
            )}
            {data.shifts.map((s) => (
              <div className={`shift ${s.confirmed ? '' : 'shift-unconf'}`} key={s.id + s.slot}>
                <div className="datebox">
                  <span>{dowShort(s.date)}</span>
                  <strong className="mono">{dayNum(s.date)}</strong>
                </div>
                <div className="grow stack-sm">
                  <Notices items={noticesFor(app, s.date, s.notes)} compact />
                  <div className="row-wrap tight">
                    {s.kind === 'soundcheck' && <span className="chip chip-check">Sound check</span>}
                    {s.shadow && <span className="chip chip-check">Shadowing</span>}
                    {s.confirmed ? <span className="chip chip-approved">✓ Confirmed</span> : <span className="chip chip-pending">Not confirmed</span>}
                  </div>
                  <div className="strong">
                    {posLabel(s.position)} · {s.title}
                  </div>
                  {s.away && <div className="small danger">You marked yourself away or unavailable for this — request a drop or swap.</div>}
                  {s.groups?.length > 0 && (
                    <div className="small muted">With {s.groups.map((id) => app.group(id)?.name).filter(Boolean).join(', ')}</div>
                  )}
                  <div className="mono small muted">
                    {fmtDay(s.date)} · {fmtTime(s.start)} · call {fmtTime(s.call)}
                  </div>
                  {s.pending && <span className="chip chip-pending self-start">{TYPE_LABEL[s.pending]} requested — waiting on a leader</span>}
                  <div className="row-wrap">
                    {!s.confirmed ? (
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirm(s)}>
                        Confirm
                      </button>
                    ) : (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => confirm(s, false)}>
                        Undo confirm
                      </button>
                    )}
                    {!s.pending && !s.shadow && (
                      <>
                        <button type="button" className="btn btn-outline" onClick={() => setDraft({ type: 'swap', shift: s })}>Swap</button>
                        <button type="button" className="btn btn-outline" onClick={() => setDraft({ type: 'transfer', shift: s })}>Transfer</button>
                        <button type="button" className="btn btn-ghost" onClick={() => setDraft({ type: 'drop', shift: s })}>Drop</button>
                      </>
                    )}
                    <button type="button" className="btn btn-soft" onClick={() => { app.setResFilter(s.position); app.goTab('resources'); }}>
                      <Icon name="doc" size={16} /> Quick review
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>

          {draft && (
            <RequestForm
              key={draft.type + draft.shift.id + draft.shift.position}
              draft={draft}
              onCancel={() => setDraft(null)}
              onSent={() => {
                setDraft(null);
                app.toast('Request sent to your team leaders');
                load();
              }}
            />
          )}

          <section className="card stack" aria-label="Open shifts">
            <div>
              <h2>Open shifts you can pick up</h2>
              <p className="muted small">Only spots you’re trained for, on services you haven’t marked unavailable.</p>
            </div>
            {data.pickups.length === 0 && <Empty>Nothing open for your positions right now.</Empty>}
            {data.pickups.map((s) => (
              <div className="pickup" key={s.id + s.position}>
                <div className="grow">
                  <div className="strong">
                    {posLabel(s.position)} · {s.title}
                  </div>
                  <div className="mono small muted">
                    {fmtDay(s.date)} · {fmtTime(s.start)}
                  </div>
                </div>
                {s.pending ? (
                  <span className="chip chip-pending">Requested</span>
                ) : (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => pickUp(s)}>
                    {can.edit ? 'Take it' : 'Request it'}
                  </button>
                )}
              </div>
            ))}
          </section>

          <Availability data={data} busy={busy} act={act} toggleAvail={toggleAvail} />

          {data.requests.length > 0 && (
            <section className="card stack" aria-label="Your requests">
              <h2>Your requests</h2>
              <ul className="req-mini">
                {data.requests.map((r) => (
                  <li key={r.id}>
                    <span className="grow">
                      <strong>{TYPE_LABEL[r.type]}</strong>{' '}
                      <span className="muted">
                        · {posLabel(r.position)} · {r.event ? `${r.event.title}, ${fmtDay(r.event.date)}` : 'removed service'}
                      </span>
                      {r.reason && <span className="small danger">{r.reason}</span>}
                    </span>
                    <StatusChip status={r.status} />
                    {r.status === 'pending' && (
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => cancelReq(r)}>
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="stack-lg side-col">
          <section className="card stack" aria-label="Calendar feed">
            <div className="row">
              <Icon name="cal" size={22} />
              <h2>Your calendar feed</h2>
            </div>
            <p className="muted small">
              Subscribe once. Shifts you’re given, swap or pick up appear on their own, and dropped shifts disappear. Apple Calendar can refresh every few minutes; Google checks subscribed calendars less often, sometimes only every several hours.
            </p>
            <div className="code-box mono">{me.calUrl}</div>
            <div className={`row-wrap ${me.previewing ? 'preview-off' : ''}`} aria-disabled={me.previewing || undefined}>
              <a className="btn btn-outline" href={webcal}>Apple Calendar</a>
              <a className="btn btn-outline" href={google} target="_blank" rel="noopener noreferrer">Google Calendar</a>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(me.calUrl);
                    app.toast('Feed link copied');
                  } catch {
                    app.toast('Couldn’t copy — select the link and copy it');
                  }
                }}
              >
                <Icon name="copy" size={16} /> Copy link
              </button>
            </div>
            {isLocal && <p className="small danger">This address only works on your network. Set PUBLIC_URL to your public https address so phones and Google can reach the feed.</p>}
            <button
              type="button"
              className="link-btn small self-start"
              onClick={() => {
                if (window.confirm('Make a new private link? The old one will stop working, so you’ll need to subscribe again.'))
                  act(() => api('/account/calendar/reset', { method: 'POST' }).then(app.reload), 'New calendar link ready');
              }}
            >
              Shared your link by mistake? Make a new one
            </button>
          </section>

          <section className="card card-dark stack" aria-label="Need help">
            <h2>Need help before your shift?</h2>
            <p className="small">Training links and your team leaders are one tap away.</p>
            <button type="button" className="btn btn-accent self-start" onClick={() => { app.setResFilter('all'); app.goTab('resources'); }}>
              Resources &amp; contacts
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function RequestForm({ draft, onCancel, onSent }) {
  const { posLabel } = useApp();
  const { type, shift } = draft;
  const [options, setOptions] = useState(type === 'drop' ? [] : null);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (type === 'drop') return;
    api(`/requests/options?type=${type}&eventId=${shift.id}&position=${shift.position}`).then(setOptions, (e) => setError(e.message));
  }, [type, shift.id, shift.position]);

  const titles = { swap: 'Request a swap', transfer: 'Transfer this shift', drop: 'Ask to drop this shift' };
  const needsTarget = type !== 'drop';

  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { type, eventId: shift.id, position: shift.position, note };
      if (type === 'transfer') body.targetUserId = target;
      if (type === 'swap') body.targetEventId = target;
      await api('/requests', { method: 'POST', body });
      onSent();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <section className="card card-strong stack" aria-label={titles[type]}>
      <div>
        <h2>{titles[type]}</h2>
        <div className="muted small">
          {posLabel(shift.position)} · {shift.title} · {fmtDay(shift.date)} · {fmtTime(shift.start)}
        </div>
      </div>
      <form className="stack" onSubmit={send}>
        {needsTarget && (
          <label className="field">
            <span>{type === 'transfer' ? 'Give it to' : 'Trade for'}</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} required disabled={!options}>
              <option value="">{options ? 'Choose…' : 'Loading…'}</option>
              {(options || []).map((o) =>
                type === 'transfer' ? (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ) : (
                  <option key={o.eventId} value={o.eventId}>
                    {o.title} · {fmtDay(o.date)} ({o.userName})
                  </option>
                )
              )}
            </select>
          </label>
        )}
        {needsTarget && options && options.length === 0 && (
          <p className="small danger">
            {type === 'transfer'
              ? `No one else trained on ${posLabel(shift.position)} is free for this service. Try Drop, or message a leader.`
              : `No one else is scheduled on ${posLabel(shift.position)} for a service you could trade into.`}
          </p>
        )}
        <label className="field">
          <span>Note for your team leader (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Out of town that weekend" maxLength={300} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy || (needsTarget && !target)}>
            Send request
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function Availability({ data, busy, act, toggleAvail }) {
  const { posLabel, me } = useApp();
  const [f, setF] = useState({ from: '', to: '', note: '' });
  const [limit, setLimit] = useState(String(data.maxPerMonth || ''));

  const addAway = (e) => {
    e.preventDefault();
    act(() => api('/me/blackouts', { method: 'POST', body: { ...f, to: f.to || f.from } }), 'Away dates added — leaders won’t schedule you then').then((done) => done && setF({ from: '', to: '', note: '' }));
  };
  const saveLimit = () => act(() => api('/me/limit', { method: 'PUT', body: { maxPerMonth: Number(limit) || 0 } }), Number(limit) ? `Limit set: ${limit} a month` : 'No monthly limit');

  return (
    <section className="card stack" aria-label="Availability">
      <div className="section-head">
        <div>
          <h2>Availability</h2>
          <p className="muted small">
            Leaders and auto-fill won’t schedule you when you’re away or over your limit.
            {data.availabilityUpdatedAt ? ` Last updated ${new Date(data.availabilityUpdatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api('/me/availability/ok', { method: 'POST' }), 'Thanks — marked up to date')}>
          Nothing’s changed
        </button>
      </div>

      {me.regulars?.length > 0 && (
        <div className="stack-sm">
          <h3>Your regular schedule</h3>
          <ul className="req-mini">
            {me.regulars.map((r) => {
              const d = describeRule(r, posLabel);
              return (
                <li key={r.id}>
                  <span className="grow">
                    <strong>{d.week}</strong>
                    <span className="small muted">
                      {d.svc} · {d.pos.replace('their', 'your')}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">You’re placed on these automatically. Can’t make one? Add away dates below so you’re skipped that weekend.</p>
        </div>
      )}

      <div className="stack-sm">
        <h3>Away dates</h3>
        {data.blackouts.length === 0 && <p className="muted small">None coming up.</p>}
        <ul className="req-mini">
          {data.blackouts.map((b) => (
            <li key={b.id}>
              <span className="grow">
                <strong>
                  {fmtDay(b.from)}
                  {b.to !== b.from ? ` – ${fmtDay(b.to)}` : ''}
                </strong>
                {b.note && <span className="muted small">{b.note}</span>}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api(`/me/blackouts/${b.id}`, { method: 'DELETE' }), 'Removed')}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form className="row-wrap fields-4" onSubmit={addAway}>
          <label className="field">
            <span>Away from</span>
            <input type="date" required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to && f.to < e.target.value ? e.target.value : f.to })} />
          </label>
          <label className="field">
            <span>Until (incl.)</span>
            <input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </label>
          <label className="field">
            <span>Note (optional)</span>
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Family trip" maxLength={120} />
          </label>
          <button className="btn btn-outline self-end" disabled={busy}>
            Add
          </button>
        </form>
      </div>

      <div className="row-wrap divider-top">
        <label className="field field-row">
          <span className="small">Most shifts I can do a month</span>
          <input className="key-input" type="number" min="0" max="31" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Any" />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy || String(data.maxPerMonth || '') === limit} onClick={saveLimit}>
          Save
        </button>
      </div>

      <div className="stack-sm divider-top">
        <h3>Specific services</h3>
        {data.availability.length === 0 && <Empty>No services are posted for the next eight weeks.</Empty>}
        <ul className="avail-list">
          {data.availability.map((ev) => (
            <li key={ev.id}>
              <span className="grow">
                <strong>{ev.title}</strong>
                <span className="mono small muted">
                  {fmtDay(ev.date)} · {fmtTime(ev.start)}
                </span>
                {ev.onPosition && <span className="small blue">You’re on {posLabel(ev.onPosition)}</span>}
              </span>
              {ev.away ? (
                <span className="chip chip-cancelled">Away</span>
              ) : (
                <label className="check">
                  <input type="checkbox" checked={ev.unavailable} disabled={busy} onChange={() => toggleAvail(ev)} />
                  <span>Can’t make it</span>
                </label>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
