// Church Admin: My calendar — meetings I'm invited to (with "will you be there?"), my action items
// and milestones, my committees and offices, and the calendar feed.
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtDay, todayISO } from '../lib.js';
import { Empty, useApp } from '../ui.jsx';
import { CalendarFeedCard, committeeName, EventDetail } from '../office.jsx';
import { EventRow } from './OfficeSchedule.jsx';

export default function OfficeMine() {
  const app = useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api('/office/mine').then(setD, (e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const tick = async (a) => {
    try {
      await api(`/office/actions/${a.id}`, { method: 'PATCH', body: { done: true } });
      app.toast('Marked done');
      load();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const rsvp = async (e, status) => {
    try {
      await api(`/office/events/${e.id}/rsvp`, { method: 'PUT', body: { status } });
      load();
    } catch (err) {
      app.toast(err.message);
    }
  };
  const today = todayISO(); // the local date (toISOString would be tomorrow by evening)
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>My calendar</h1>
          <div className="muted">Your meetings for the next three months and what’s on your plate.</div>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!d && !error && <div className="loading-inline">Loading…</div>}
      {d && (
        <div className="split">
          <div className="main-col stack-lg">
            <section className="card stack" aria-label="My action items">
              <h2>My action items ({d.actions.length})</h2>
              {d.actions.length === 0 && <p className="muted">Nothing assigned to you.</p>}
              {d.actions.map((a) => (
                <div key={a.id} className="row-wrap spread oc-action">
                  <span className="stack-xs">
                    <strong>{a.title}</strong>
                    <span className={`small ${a.due && a.due < today ? 'danger' : 'muted'}`}>{a.due ? `${a.due < today ? 'Overdue — was due' : 'Due'} ${fmtDay(a.due)}` : 'No due date'}</span>
                    {a.notes && <span className="small">{a.notes}</span>}
                  </span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => tick(a)}>
                    Done
                  </button>
                </div>
              ))}
              {d.milestones.length > 0 && (
                <>
                  <h3>My milestones</h3>
                  {d.milestones.map((m) => (
                    <div key={m.id} className="stack-xs">
                      <strong>{m.title}</strong>
                      <span className="muted small">
                        {m.goal.title}
                        {m.due ? ` · due ${fmtDate(m.due)}` : ''}
                      </span>
                    </div>
                  ))}
                  <p className="muted small">Tick milestones off on Planning → Goals.</p>
                </>
              )}
            </section>

            <section className="stack" aria-label="My meetings">
              <h2>My meetings</h2>
              {d.events.length === 0 && <Empty>No meetings for you in the next three months.</Empty>}
              {d.events.map((e) => (
                <div key={e.id} className="oc-mine-row">
                  <div className="small muted oc-mine-date">{fmtDay(e.date)}</div>
                  <EventRow e={e} onOpen={() => setOpen(e.id)} />
                  <div className="row-wrap tight oc-rsvp" role="group" aria-label={`Will you be at ${e.title}?`}>
                    {[
                      ['yes', 'Coming'],
                      ['maybe', 'Maybe'],
                      ['no', 'Can’t'],
                    ].map(([k, l]) => (
                      <button key={k} type="button" className={`btn btn-sm ${e.myRsvp === k ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={e.myRsvp === k} onClick={() => rsvp(e, e.myRsvp === k ? '' : k)}>
                        {l}
                      </button>
                    ))}
                    {e.callLink && e.date === today && (
                      <>
                        <a className="btn btn-sm btn-green" href={e.callLink} target="_blank" rel="noopener noreferrer">
                          <span aria-hidden="true">📞</span> Join the call
                        </a>
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => app.openMeeting(e.id)}>
                          Open the meeting
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </section>
          </div>
          <div className="side-col stack-lg">
            <section className="card stack-sm" aria-label="My committees">
              <h2>My committees</h2>
              {d.committees.length ? (
                <ul className="plain-list">
                  {d.committees.map((k) => (
                    <li key={k}>{committeeName(app, k)}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">You’re not on a committee yet{app.me.head ? ', but as head leader you see everything' : ''}.</p>
              )}
              {d.offices.length > 0 && (
                <>
                  <h3>Offices</h3>
                  <ul className="plain-list">
                    {d.offices.map((o, i) => (
                      <li key={i}>
                        {o.role}
                        {o.committee ? ` · ${committeeName(app, o.committee)}` : ''}
                        {o.termEnds ? <span className="muted small"> · term ends {fmtDate(o.termEnds)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <CalendarFeedCard />
          </div>
        </div>
      )}
      {open && <EventDetail id={open} onClose={() => setOpen(null)} onChanged={load} onOpenMeeting={(id) => (setOpen(null), app.openMeeting(id))} />}
    </div>
  );
}
