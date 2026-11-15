// Church Admin: the agenda overview — from one week to three years. Week and month list every
// meeting, deadline and event; quarter and year show the key ones with goals and milestones;
// three years is a timeline of the long-range goals. "Needs attention" sits on top at every zoom.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, api, fmtDate, fmtDay, parseDay, todayISO } from '../lib.js';
import { Empty, Icon, useApp } from '../ui.jsx';
import { EventDetail, TYPES } from '../office.jsx';
import { EventRow } from './OfficeSchedule.jsx';

const ZOOMS = [
  ['week', 'Week'],
  ['month', 'Month'],
  ['quarter', 'Quarter'],
  ['year', 'Year'],
  ['3y', '3 years'],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS = { 'not-started': 'Not started', 'on-track': 'On track', behind: 'Behind', done: 'Done' };

function shift(date, zoom, n) {
  const d = parseDay(date);
  if (zoom === 'week') return addDays(date, 7 * n);
  if (zoom === 'month') d.setUTCMonth(d.getUTCMonth() + n);
  else if (zoom === 'quarter') d.setUTCMonth(d.getUTCMonth() + 3 * n);
  else if (zoom === 'year') d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCFullYear(d.getUTCFullYear() + 3 * n);
  return d.toISOString().slice(0, 10);
}
function title(d, zoom) {
  if (!d) return '';
  const y = d.from.slice(0, 4);
  const m = parseDay(d.from).getUTCMonth();
  if (zoom === 'week') return `Week of ${fmtDate(d.from)}`;
  if (zoom === 'month') return `${MONTHS[m]} ${y}`;
  if (zoom === 'quarter') return `Q${Math.floor(m / 3) + 1} ${y} · ${MONTHS[m]}–${MONTHS[m + 2]}`;
  if (zoom === 'year') return y;
  return `${y}–${d.to.slice(0, 4)}`;
}

export default function OfficeOverview() {
  const app = useApp();
  const [zoom, setZoom] = useState('month');
  const [at, setAt] = useState(todayISO());
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    api(`/office/overview?zoom=${zoom}&date=${at}`).then(setD, (e) => setError(e.message));
  }, [zoom, at]);
  useEffect(() => {
    setD(null);
    load();
  }, [load]);

  const att = d?.attention;
  const attCount = att ? att.overdue.length + att.noAgenda.length + att.unapproved.length + att.behind.length + att.terms.length : 0;

  return (
    <div className="stack-lg ov-page">
      <div className="page-head">
        <div>
          <h1>Agenda overview</h1>
          <div className="muted">Look as close as a week or as far as three years of goals.</div>
        </div>
        <button type="button" className="btn btn-outline no-print" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="row-wrap spread no-print">
        <div className="seg" role="group" aria-label="How far to look">
          {ZOOMS.map(([k, l]) => (
            <button key={k} type="button" className={zoom === k ? 'seg-on' : ''} aria-pressed={zoom === k} onClick={() => setZoom(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="row-wrap tight">
          <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => setAt(shift(at, zoom, -1))}>
            ‹
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAt(todayISO())}>
            Today
          </button>
          <button type="button" className="icon-btn" aria-label="Later" onClick={() => setAt(shift(at, zoom, 1))}>
            ›
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!d && !error && <div className="loading-inline">Loading…</div>}
      {d && (
        <>
          <h2 className="ov-title">{title(d, zoom)}</h2>

          {attCount > 0 && (
            <section className="card card-strong stack-sm ov-attention" aria-label="Needs attention">
              <h2>Needs attention ({attCount})</h2>
              <ul className="ov-att">
                {att.overdue.map((a) => (
                  <li key={`o${a.id}`}>
                    <span className="chip oc oc-red">Overdue</span> {a.title}
                    {a.owner ? ` · ${a.owner}` : ''} <span className="muted small">(due {fmtDay(a.due)})</span>
                  </li>
                ))}
                {att.noAgenda.map((x) => (
                  <li key={`a${x.id}`}>
                    <span className="chip oc oc-orange">No agenda</span>{' '}
                    <button type="button" className="link-btn" onClick={() => app.openMeeting(x.id)}>
                      {x.title}
                    </button>{' '}
                    <span className="muted small">{fmtDay(x.date)}</span>
                  </li>
                ))}
                {att.unapproved.map((x) => (
                  <li key={`m${x.id}`}>
                    <span className="chip oc oc-yellow">Minutes to approve</span>{' '}
                    <button type="button" className="link-btn" onClick={() => app.openMeeting(x.id)}>
                      {x.title}
                    </button>{' '}
                    <span className="muted small">{fmtDay(x.date)}</span>
                  </li>
                ))}
                {att.behind.map((g) => (
                  <li key={`g${g.id}`}>
                    <span className="chip oc oc-red">Goal behind</span> {g.title}
                    {g.due ? <span className="muted small"> (due {fmtDate(g.due)})</span> : null}
                  </li>
                ))}
                {att.terms.map((t, i) => (
                  <li key={`t${i}`}>
                    <span className="chip oc oc-purple">{t.past ? 'Term ended' : 'Term ending'}</span> {t.person}, {t.role}
                    {t.committee ? ` of the ${t.committee}` : ''} <span className="muted small">({fmtDate(t.termEnds)})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="ov-counts">
            <div className="ov-count">
              <strong>{d.counts.meetings}</strong>
              <span>meetings</span>
            </div>
            <div className="ov-count">
              <strong>{d.counts.deadlines}</strong>
              <span>deadlines</span>
            </div>
            <div className="ov-count">
              <strong>{d.counts.events}</strong>
              <span>church events</span>
            </div>
            <div className="ov-count">
              <strong>{d.goals.length}</strong>
              <span>goals in view</span>
            </div>
          </div>

          {zoom === '3y' ? <Timeline d={d} /> : zoom === 'quarter' || zoom === 'year' ? <ByMonth d={d} onOpen={setOpen} /> : <ByDay d={d} onOpen={setOpen} />}
          {zoom !== '3y' && d.goals.length > 0 && <GoalList goals={d.goals} />}
        </>
      )}
      {open && <EventDetail id={open} onClose={() => setOpen(null)} onChanged={load} onOpenMeeting={(id) => (setOpen(null), app.openMeeting(id))} />}
    </div>
  );
}

function ByDay({ d, onOpen }) {
  const days = useMemo(() => {
    const m = {};
    for (const e of d.events) (m[e.date] ||= []).push(e);
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [d]);
  if (!days.length) return <Empty>Nothing on the calendar for this {d.zoom}.</Empty>;
  return (
    <div className="stack">
      {days.map(([date, list]) => (
        <section key={date} className={`oc-daylist ${date === d.today ? 'oc-today' : ''}`}>
          <h3 className="oc-dayhead">{fmtDay(date)}</h3>
          {list.map((e) => (
            <EventRow key={e.id} e={e} onOpen={() => onOpen(e.id)} />
          ))}
        </section>
      ))}
    </div>
  );
}

function ByMonth({ d, onOpen }) {
  const months = useMemo(() => {
    const out = [];
    let m = d.from.slice(0, 7);
    while (`${m}-01` <= d.to) {
      out.push(m);
      const x = parseDay(`${m}-01`);
      x.setUTCMonth(x.getUTCMonth() + 1);
      m = x.toISOString().slice(0, 7);
    }
    return out;
  }, [d]);
  return (
    <div className="ov-months">
      {months.map((m) => {
        const list = d.events.filter((e) => e.date.startsWith(m));
        const ms = d.goals.flatMap((g) => g.milestonesInRange.filter((x) => x.due.startsWith(m)).map((x) => ({ ...x, goal: g.title })));
        return (
          <section key={m} className="card stack-sm ov-month" aria-label={MONTHS[Number(m.slice(5)) - 1]}>
            <h3>{MONTHS[Number(m.slice(5)) - 1]}</h3>
            {list.length === 0 && ms.length === 0 && <p className="muted small">Nothing major.</p>}
            <ul className="ov-mlist">
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" className="link-btn" onClick={() => onOpen(e.id)}>
                    <span className={`ov-dot oc-${TYPES[e.type]?.color || 'gray'}`} aria-hidden="true" />
                    <span className="ov-mdate">{Number(e.date.slice(8))}</span> {e.title}
                  </button>
                </li>
              ))}
              {ms.map((x) => (
                <li key={x.id} className={x.done ? 'ov-done' : ''}>
                  <span className="ov-dot ov-ms" aria-hidden="true" />
                  <span className="ov-mdate">{Number(x.due.slice(8))}</span> {x.title} <span className="muted small">· {x.goal}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function GoalList({ goals }) {
  return (
    <section className="card stack" aria-label="Goals">
      <h2>Goals</h2>
      {goals.map((g) => (
        <div key={g.id} className="stack-xs">
          <div className="row-wrap spread">
            <strong>{g.title}</strong>
            <span className={`chip oc oc-${g.status === 'behind' ? 'red' : g.status === 'done' ? 'green' : g.status === 'on-track' ? 'blue' : 'gray'}`}>{STATUS[g.status]}</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={g.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.title} progress`}>
            <span style={{ width: `${g.progress}%` }} />
          </div>
          <span className="muted small">
            {g.progress}% · {g.milestones.filter((m) => m.done).length} of {g.milestones.length} milestones
            {g.due ? ` · due ${fmtDate(g.due)}` : ''}
            {g.owner ? ` · ${g.owner.name}` : ''}
          </span>
        </div>
      ))}
    </section>
  );
}

// Three years: each goal as a bar from its start (or the window's start) to its due date
function Timeline({ d }) {
  const y0 = Number(d.from.slice(0, 4));
  const years = [y0, y0 + 1, y0 + 2];
  const span = parseDay(d.to) - parseDay(d.from);
  const pos = (date) => Math.max(0, Math.min(100, ((parseDay(date) - parseDay(d.from)) / span) * 100));
  const todayPos = d.today >= d.from && d.today <= d.to ? pos(d.today) : null;
  if (!d.goals.length && !d.events.length) return <Empty>No goals or major dates in these three years yet. Add goals on Planning.</Empty>;
  return (
    <section className="card stack ov-timeline" aria-label="Three-year timeline">
      <div className="tl-years" aria-hidden="true">
        {years.map((y) => (
          <span key={y}>{y}</span>
        ))}
      </div>
      <div className="tl-rows">
        {todayPos !== null && <span className="tl-today" style={{ left: `calc(34% + ${(todayPos * 0.66).toFixed(2)}%)` }} title="Today" />}
        {d.goals.map((g) => {
          const a = pos(g.start && g.start > d.from ? g.start : d.from);
          const b = pos(g.due || d.to);
          return (
            <div key={g.id} className="tl-row">
              <div className="tl-label">
                <strong>{g.title}</strong>
                <span className="muted small">
                  {g.progress}%{g.due ? ` · due ${fmtDate(g.due)}` : ''}
                </span>
              </div>
              <div className="tl-track">
                <span className={`tl-bar tl-${g.status}`} style={{ left: `${a}%`, width: `${Math.max(1.5, b - a)}%` }}>
                  <span className="tl-fill" style={{ width: `${g.progress}%` }} />
                </span>
                {g.milestones
                  .filter((m) => m.due && m.due >= d.from && m.due <= d.to)
                  .map((m) => (
                    <span key={m.id} className={`tl-ms ${m.done ? 'tl-ms-done' : ''}`} style={{ left: `${pos(m.due)}%` }} title={`${m.title} · ${fmtDate(m.due)}${m.done ? ' · done' : ''}`} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {d.events.length > 0 && (
        <details>
          <summary>
            <Icon name="cal" size={16} /> Major dates ({d.events.length})
          </summary>
          <ul className="ov-mlist">
            {d.events.map((e) => (
              <li key={e.id}>
                <span className={`ov-dot oc-${TYPES[e.type]?.color || 'gray'}`} aria-hidden="true" /> {fmtDate(e.date)} · {e.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
