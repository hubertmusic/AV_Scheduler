// The room request link (/reserve/<token>): anyone can ask the church for a room or an event without
// an account. What they send goes on the next board meeting's agenda, and they get an email back
// when it's decided. It only ever shows the church's name and its room names.
import { useEffect, useRef, useState } from 'react';
import { api, fmtDay } from '../lib.js';
import { DateInput } from '../dateInput.jsx';

const BLANK = { name: '', email: '', phone: '', title: '', date: '', start: '', end: '', room: '', other: '', people: '', needsAv: false, notes: '', website: '' };

export default function Reserve({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(null);
  const [taken, setTaken] = useState(false);
  const top = useRef(null);
  useEffect(() => {
    api(`/reserve/${token}`).then(setInfo, (e) => setError(e.message));
  }, [token]);
  useEffect(() => {
    if (info?.church) document.title = `Request a room · ${info.church}`;
  }, [info]);

  const room = f.room === '__other' ? f.other.trim() : f.room;
  // Gently say if that room looks taken then (no details)
  useEffect(() => {
    if (!f.date || !room) return setTaken(false);
    const t = setTimeout(() => {
      const q = new URLSearchParams({ date: f.date, room, start: f.start, end: f.end });
      api(`/reserve/${token}/check?${q}`).then((r) => setTaken(!!r?.taken), () => setTaken(false));
    }, 400);
    return () => clearTimeout(t);
  }, [token, f.date, f.start, f.end, room]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const r = await api(`/reserve/${token}`, { method: 'POST', body: { ...f, room, people: Number(f.people) || 0 } });
      setSent({ ...r, name: f.name, email: f.email, title: f.title });
      top.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      if (err.status === 410) setError(err.message);
      else setFormError(err.message);
    }
    setBusy(false);
  };

  if (error)
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand name={info?.church} />
          <h1>Link not available</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  if (!info) return <div className="loading">Loading…</div>;

  return (
    <div className="guest-wrap rs-wrap" ref={top}>
      <Brand name={info.church} />
      {sent ? (
        <section className="card stack rs-done" aria-live="polite">
          <div className="rs-check" aria-hidden="true">✓</div>
          <h1>Thanks, {sent.name.split(' ')[0]}. Your request is in.</h1>
          <p>
            {sent.meetingDate ? (
              <>
                The church board will look at <strong>{sent.title}</strong> when it meets on <strong>{fmtDay(sent.meetingDate)}</strong>.
              </>
            ) : (
              <>
                The church board will look at <strong>{sent.title}</strong> at its next meeting.
              </>
            )}{' '}
            We’ll email you at <strong>{sent.email}</strong> as soon as it’s decided.
          </p>
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => (setF({ ...BLANK, name: f.name, email: f.email, phone: f.phone }), setSent(null))}>
              Ask for something else
            </button>
          </div>
        </section>
      ) : (
        <form className="card stack" onSubmit={send}>
          <div className="stack-xs">
            <h1>Request a room or church event</h1>
            <p className="muted">Fill this in and it goes to the church board for its next meeting. You’ll hear back by email.</p>
          </div>

          <fieldset className="fieldset">
            <legend>About you</legend>
            <label className="field">
              <span>Your name</span>
              <input required maxLength={80} autoComplete="name" value={f.name} onChange={set('name')} />
            </label>
            <div className="row-wrap fields-2">
              <label className="field">
                <span>Email</span>
                <input required type="email" maxLength={120} autoComplete="email" value={f.email} onChange={set('email')} />
              </label>
              <label className="field">
                <span>Phone (optional)</span>
                <input type="tel" maxLength={40} autoComplete="tel" value={f.phone} onChange={set('phone')} />
              </label>
            </div>
          </fieldset>

          <fieldset className="fieldset">
            <legend>What you need</legend>
            <label className="field">
              <span>What’s it for?</span>
              <input required maxLength={120} value={f.title} onChange={set('title')} placeholder="e.g. Baby shower, Bible study, choir practice" />
            </label>
            <div className="row-wrap fields-3">
              <label className="field">
                <span>Date</span>
                <DateInput required type="date" min={info.today} value={f.date} onChange={set('date')} />
              </label>
              <label className="field">
                <span>From</span>
                <DateInput type="time" value={f.start} onChange={set('start')} />
              </label>
              <label className="field">
                <span>To</span>
                <DateInput type="time" value={f.end} onChange={set('end')} disabled={!f.start} />
              </label>
            </div>
            {!f.start && <p className="muted small rs-hint">Leave the times empty for all day.</p>}
            <div className="row-wrap fields-2">
              <label className="field">
                <span>Room</span>
                <select value={f.room} onChange={set('room')}>
                  <option value="">Not sure yet</option>
                  {info.rooms.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                  <option value="__other">Somewhere else…</option>
                </select>
              </label>
              <label className="field">
                <span>About how many people?</span>
                <input type="number" inputMode="numeric" min="0" max="5000" value={f.people} onChange={set('people')} />
              </label>
            </div>
            {f.room === '__other' && (
              <label className="field">
                <span>Where?</span>
                <input maxLength={80} value={f.other} onChange={set('other')} placeholder="e.g. the church lawn" />
              </label>
            )}
            {taken && (
              <p className="warn-box small" role="status">
                That room may already be booked then. You can still send your request; the board will let you know, or pick another time.
              </p>
            )}
            <label className="check">
              <input type="checkbox" checked={f.needsAv} onChange={set('needsAv')} />
              <span>We’ll need AV help (sound, projector or livestream)</span>
            </label>
            <label className="field">
              <span>Anything else the board should know? (optional)</span>
              <textarea rows={3} maxLength={1500} value={f.notes} onChange={set('notes')} placeholder="Setup, kitchen use, food, who’s responsible…" />
            </label>
          </fieldset>

          {/* People never see this; bots fill it in */}
          <label className="rs-hp" aria-hidden="true">
            Website
            <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
          </label>

          {formError && (
            <div className="error" role="alert">
              {formError}
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
          <p className="muted small">Your name and contact details go only to the church board, so they can reply.</p>
        </form>
      )}
    </div>
  );
}

function Brand({ name }) {
  return (
    <div className="brand brand-dark">
      <img src="/icon.svg" width="32" height="32" alt="" />
      <span>{name || 'Crew Call'}</span>
    </div>
  );
}
