// Church Admin: their calendar — board and business meetings, committees, deadlines, church
// events. Month, week or list view; each person sees their committees' items.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, api, dayNum, fmtDate, fmtTime, parseDay, todayISO } from '../lib.js';
import { Empty, Icon, useApp } from '../ui.jsx';
import { CommitteeChips, EventDetail, EventModal, TYPES, TypeChip, whenText } from '../office.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sab'];
const monthStart = (d) => `${d.slice(0, 7)}-01`;
function addMonths(d, n) {
  const x = parseDay(monthStart(d));
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
}
const weekStart = (d) => addDays(d, -parseDay(d).getUTCDay());

export default function OfficeSchedule() {
  const app = useApp();
  const { can } = app;
  const [view, setView] = useState(() => (window.matchMedia?.('(max-width: 700px)').matches ? 'list' : 'month'));
  const [at, setAt] = useState(todayISO());
  const [events, setEvents] = useState(null);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  const range = useMemo(() => {
    if (view === 'month') {
      const first = monthStart(at);
      const from = weekStart(first);
      return { from, to: addDays(from, 41), label: `${MONTHS[parseDay(first).getUTCMonth()]} ${first.slice(0, 4)}` };
    }
    if (view === 'week') {
      const from = weekStart(at);
      return { from, to: addDays(from, 6), label: `${fmtDate(from)} – ${fmtDate(addDays(from, 6))}` };
    }
    return { from: at, to: addDays(at, 90), label: `From ${fmtDate(at)}` };
  }, [view, at]);

  const load = useCallback(() => {
    api(`/office/events?from=${range.from}&to=${range.to}`).then(setEvents, (e) => setError(e.message));
  }, [range.from, range.to]);
  useEffect(() => {
    setEvents(null);
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (!events) return [];
    if (filter === 'all') return events;
    if (filter === 'mine') return events.filter((e) => !e.committees.length || e.committees.some((k) => (app.me.committees || []).includes(k)));
    if (filter === 'shared') return events.filter((e) => e.visibility === 'everyone');
    return events.filter((e) => e.committees.includes(filter) || e.sharedWith.includes(filter));
  }, [events, filter, app.me.committees]);
  const byDay = useMemo(() => {
    const m = {};
    for (const e of shown) (m[e.date] ||= []).push(e);
    return m;
  }, [shown]);

  const step = (n) => setAt(view === 'month' ? addMonths(at, n) : view === 'week' ? addDays(at, 7 * n) : addDays(at, 30 * n));
  const today = todayISO();

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <div className="muted">{app.team.name}: meetings, deadlines and church events. You see your committees’ items and anything shared with them.</div>
        </div>
        {can.edit && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding({ date: at < today ? today : at })}>
            <Icon name="plus" /> Add
          </button>
        )}
      </div>

      <div className="row-wrap spread oc-toolbar">
        <div className="row-wrap tight">
          <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => step(-1)}>
            ‹
          </button>
          <strong className="oc-range">{range.label}</strong>
          <button type="button" className="icon-btn" aria-label="Later" onClick={() => step(1)}>
            ›
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAt(today)}>
            Today
          </button>
        </div>
        <div className="row-wrap tight">
          <div className="seg" role="group" aria-label="View">
            {[
              ['month', 'Month'],
              ['week', 'Week'],
              ['list', 'List'],
            ].map(([k, l]) => (
              <button key={k} type="button" className={view === k ? 'seg-on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>
                {l}
              </button>
            ))}
          </div>
          <label className="field field-inline">
            <span className="sr-only">Show</span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">Everything I can see</option>
              <option value="mine">My committees</option>
              <option value="shared">Shared with every team</option>
              {(app.committees || []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!events && !error && <div className="loading-inline">Loading…</div>}

      {events && view === 'month' && (
        <div className="oc-month" role="grid" aria-label={range.label}>
          {DOW.map((d) => (
            <div key={d} className="oc-dow" role="columnheader">
              {d}
            </div>
          ))}
          {Array.from({ length: 42 }, (_, i) => addDays(range.from, i)).map((d) => {
            const list = byDay[d] || [];
            const other = d.slice(0, 7) !== monthStart(at).slice(0, 7);
            return (
              <div key={d} className={`oc-day ${other ? 'oc-other' : ''} ${d === today ? 'oc-today' : ''}`} role="gridcell">
                <button type="button" className="oc-daynum" onClick={() => (can.edit ? setAdding({ date: d }) : null)} aria-label={can.edit ? `Add on ${fmtDate(d)}` : fmtDate(d)} disabled={!can.edit}>
                  {dayNum(d)}
                </button>
                {list.slice(0, 4).map((e) => (
                  <button key={e.id} type="button" className={`oc-pill oc-${TYPES[e.type]?.color || 'gray'}`} onClick={() => setOpen(e.id)} title={`${e.title} · ${whenText(e)}`}>
                    {!e.allDay && e.start && <span className="oc-time">{fmtTime(e.start).replace(':00', '').replace(' ', '').toLowerCase()}</span>} {e.title}
                  </button>
                ))}
                {list.length > 4 && (
                  <button type="button" className="link-btn small" onClick={() => (setView('week'), setAt(d))}>
                    +{list.length - 4} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {events && view !== 'month' && (
        <div className="stack">
          {(view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : Object.keys(byDay).sort()).map((d) => {
            const list = byDay[d] || [];
            if (view === 'list' && !list.length) return null;
            return (
              <section key={d} className={`oc-daylist ${d === today ? 'oc-today' : ''}`} aria-label={fmtDate(d)}>
                <h2 className="oc-dayhead">
                  {DOW[parseDay(d).getUTCDay()]} {fmtDate(d)}
                  {d === today && <span className="chip chip-cold">Today</span>}
                </h2>
                {list.length === 0 && <p className="muted small">Nothing scheduled.</p>}
                {list.map((e) => (
                  <EventRow key={e.id} e={e} onOpen={() => setOpen(e.id)} />
                ))}
              </section>
            );
          })}
          {view === 'list' && shown.length === 0 && <Empty>Nothing in the next three months{filter !== 'all' ? ' for this filter' : ''}.</Empty>}
        </div>
      )}

      {adding && (
        <EventModal
          defaults={adding}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            load();
          }}
        />
      )}
      {open && <EventDetail id={open} onClose={() => setOpen(null)} onChanged={load} onOpenMeeting={(id) => (setOpen(null), app.openMeeting(id))} />}
    </div>
  );
}

export function EventRow({ e, onOpen }) {
  return (
    <button type="button" className={`oc-row oc-edge-${TYPES[e.type]?.color || 'gray'}`} onClick={onOpen}>
      <span className="oc-row-time">{e.allDay || !e.start ? 'All day' : `${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}`}</span>
      <span className="oc-row-main">
        <span className="strong">{e.title}</span>
        <span className="row-wrap tight">
          <TypeChip type={e.type} />
          <CommitteeChips keys={e.committees} shared={e.sharedWith} />
          {e.visibility === 'everyone' && <span className="chip oc oc-teal">Every team</span>}
          {e.repeat && <span className="muted small">↻ {e.repeat}</span>}
        </span>
        {(e.room || e.myRsvp) && (
          <span className="muted small">
            {e.room}
            {e.room && e.myRsvp ? ' · ' : ''}
            {e.myRsvp ? `You: ${{ yes: 'coming', no: 'can’t make it', maybe: 'maybe' }[e.myRsvp]}` : ''}
          </span>
        )}
      </span>
    </button>
  );
}
