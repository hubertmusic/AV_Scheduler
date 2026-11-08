// The admin's month planner: who's available across the month, where spare people can go, a Lead
// on every service, and a draft of placements. Nothing reaches the schedule (or anyone's phone)
// until Apply.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, fmtDay, fmtTime, todayISO } from '../lib.js';
import { Empty, useApp } from '../ui.jsx';

const SHADOW = '+shadow';
const isShadow = (k) => k.endsWith(SHADOW);
const baseOf = (k) => (isShadow(k) ? k.slice(0, -SHADOW.length) : k);
const keyOf = (eid, pos) => `${eid}|${pos}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
function shiftMonth(m, n) {
  let y = Number(m.slice(0, 4));
  let mo = Number(m.slice(5, 7)) - 1 + n;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  return `${y}-${String(mo + 1).padStart(2, '0')}`;
}

export default function MonthPlanner() {
  const app = useApp();
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [d, setD] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(null); // auto-fill results
  const [skipped, setSkipped] = useState([]);
  const [focus, setFocus] = useState(null); // person id

  const load = useCallback(async () => {
    setD(null);
    setNotes(null);
    setFocus(null);
    try {
      const r = await api(`/planner/month?month=${month}`);
      setD(r);
      setDraft(Object.fromEntries(r.assignments.map((a) => [keyOf(a.eventId, a.position), a.userId])));
    } catch (e) {
      app.toast(e.message);
    }
  }, [month, app]);
  useEffect(() => {
    load();
  }, [load]);

  const m = useMemo(() => {
    if (!d) return null;
    const saved = Object.fromEntries(d.assignments.map((a) => [keyOf(a.eventId, a.position), a.userId]));
    const person = Object.fromEntries(d.people.map((p) => [p.id, p]));
    const off = Object.fromEntries(Object.entries(d.unavailable).map(([k, v]) => [k, new Set(v)]));
    const posLabel = Object.fromEntries(d.positions.map((p) => [p.key, p.label]));
    const learners = new Set(d.people.flatMap((p) => p.trainee));
    const rowsFor = (e) => e.needs.flatMap((k) => [k, ...(learners.has(k) || Object.keys(draft).includes(keyOf(e.id, k + SHADOW)) ? [k + SHADOW] : [])]);
    const allRows = [...new Set(d.events.flatMap(rowsFor))].sort((a, b) => {
      const order = d.positions.map((p) => p.key);
      return order.indexOf(baseOf(a)) - order.indexOf(baseOf(b)) || (isShadow(a) ? 1 : 0) - (isShadow(b) ? 1 : 0);
    });
    const count = {};
    const onEvent = {};
    for (const [k, uid] of Object.entries(draft)) {
      if (!uid) continue;
      const [eid, pos] = k.split('|');
      (onEvent[eid] ||= new Set()).add(uid);
      if (!isShadow(pos)) count[uid] = (count[uid] || 0) + 1;
    }
    const events = d.events.map((e) => {
      const main = e.needs.map((k) => draft[keyOf(e.id, k)]);
      const open = main.filter((x) => !x).length;
      const lead = e.needs.some((k) => person[draft[keyOf(e.id, k)]]?.leads.includes(k));
      return { ...e, open, lead, rows: new Set(rowsFor(e)) };
    });
    const canServe = (p, e) => !off[e.id]?.has(p.id) && e.needs.some((k) => p.positions.includes(k));
    const people = d.people
      .map((p) => {
        const avail = d.events.filter((e) => canServe(p, e)).length;
        const learnAvail = d.events.filter((e) => !off[e.id]?.has(p.id) && e.needs.some((k) => p.trainee.includes(k))).length;
        const n = count[p.id] || 0;
        const freeServices = d.events.filter((e) => canServe(p, e) && !onEvent[e.id]?.has(p.id)).length;
        const room = p.maxPerMonth ? Math.max(0, Math.min(p.maxPerMonth - n, freeServices)) : freeServices;
        let status;
        if (!p.positions.length && p.trainee.length) status = { tone: 'learn', text: learnAvail ? `Learning: can shadow on ${learnAvail}` : 'Learning: not available' };
        else if (!avail) status = { tone: 'off', text: 'Not available this month' };
        else if (p.maxPerMonth && n > p.maxPerMonth) status = { tone: 'over', text: `Over their limit by ${n - p.maxPerMonth}` };
        else if (p.maxPerMonth && n === p.maxPerMonth) status = { tone: 'full', text: 'At their monthly limit' };
        else if (room > 0) status = { tone: 'room', text: `Room for ${room} more` };
        else status = { tone: 'full', text: 'On every service they can do' };
        return { ...p, avail, n, room, status };
      })
      .sort((a, b) => b.room - a.room || a.name.localeCompare(b.name));
    const changes = Object.keys({ ...saved, ...draft })
      .filter((k) => (saved[k] || null) !== (draft[k] || null))
      .map((k) => {
        const [eventId, position] = k.split('|');
        return { eventId, position, userId: draft[k] || null };
      });
    return {
      saved,
      person,
      off,
      posLabel,
      allRows,
      events,
      people,
      count,
      onEvent,
      changes,
      open: events.reduce((t, e) => t + e.open, 0),
      noLead: events.filter((e) => e.kind !== 'soundcheck' && e.needs.length && !e.lead).length,
      roomy: people.filter((p) => p.status.tone === 'room').length,
    };
  }, [d, draft]);

  const place = (eid, pos, uid) => setDraft((cur) => ({ ...cur, [keyOf(eid, pos)]: uid || null }));

  const autofill = async () => {
    setBusy(true);
    try {
      const list = Object.entries(draft)
        .filter(([, uid]) => uid)
        .map(([k, userId]) => {
          const [eventId, position] = k.split('|');
          return { eventId, position, userId };
        });
      const r = await api('/planner/autofill', { method: 'POST', body: { month, draft: list } });
      setDraft((cur) => ({ ...cur, ...Object.fromEntries(r.proposals.map((p) => [keyOf(p.eventId, p.position), p.userId])) }));
      setNotes(r);
      app.toast(r.proposals.length ? `Suggested ${r.proposals.length} placement${r.proposals.length === 1 ? '' : 's'} — review, then Apply` : 'No open spots could be filled');
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };

  const applyAll = async () => {
    setBusy(true);
    setSkipped([]);
    try {
      const r = await api('/planner/apply', { method: 'POST', body: { changes: m.changes } });
      app.toast(`Applied ${r.applied} change${r.applied === 1 ? '' : 's'} to the schedule`);
      setSkipped(r.skipped);
      await load();
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };

  const dirty = m?.changes.length > 0;
  const evName = (eid) => {
    const e = d.events.find((x) => x.id === eid);
    return e ? `${e.title}, ${fmtDay(e.date)}` : 'a service';
  };

  return (
    <div className="stack-lg">
      <div className="mp-bar">
        <div className="week-nav">
          <button type="button" className="icon-btn" aria-label="Previous month" disabled={dirty || busy} title={dirty ? 'Apply or undo your changes first' : ''} onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <strong className="mp-month">{monthLabel(month)}</strong>
          <button type="button" className="icon-btn" aria-label="Next month" disabled={dirty || busy} title={dirty ? 'Apply or undo your changes first' : ''} onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </div>
        <div className="row-wrap">
          <button type="button" className="btn btn-outline" disabled={!d || busy || !m?.open} onClick={autofill}>
            Fill open spots (draft)
          </button>
          {dirty && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft({ ...m.saved })}>
              Undo all
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={applyAll}>
            {dirty ? `Apply ${m.changes.length} change${m.changes.length === 1 ? '' : 's'}` : 'No changes'}
          </button>
        </div>
      </div>

      {!d && <div className="loading-inline">Loading…</div>}
      {d && d.events.length === 0 && <Empty>Nothing is scheduled in {monthLabel(month)} yet. Build the weekends on the Schedule tab first.</Empty>}

      {d && d.events.length > 0 && (
        <>
          <div className="mp-tiles">
            <Tile n={m.open} label={`open spot${m.open === 1 ? '' : 's'}`} tone={m.open ? 'warn' : 'ok'} />
            <Tile n={m.noLead} label={`service${m.noLead === 1 ? '' : 's'} without a Lead`} tone={m.noLead ? 'warn' : 'ok'} />
            <Tile n={m.roomy} label={`${m.roomy === 1 ? 'person' : 'people'} with room for more`} tone="info" />
            <Tile n={m.changes.length} label="draft changes, not applied" tone={dirty ? 'draft' : 'ok'} />
          </div>
          {dirty && <p className="small muted">This is a draft. Nobody sees these changes, and nothing is sent, until you press Apply.</p>}
          {skipped.length > 0 && (
            <div className="warn-box" role="alert">
              Some changes weren’t applied: {skipped.map((s) => `${m.posLabel[baseOf(s.position)] || s.position} on ${evName(s.eventId)} — ${s.why}`).join(' · ')}
            </div>
          )}
          {notes && (notes.unfilled.length > 0 || notes.weekdaySkipped > 0 || notes.regularNotes.length > 0) && (
            <div className="card stack-sm mp-notes">
              {notes.unfilled.map((u, i) => (
                <div key={i} className="small">
                  <strong>Still open:</strong> {m.posLabel[u.position] || u.position} on {evName(u.eventId)}. {u.why}
                </div>
              ))}
              {notes.regularNotes.map((r, i) => (
                <div key={`r${i}`} className="small muted">
                  {r.name} ({r.rule}): {r.why}
                </div>
              ))}
              {notes.weekdaySkipped > 0 && <div className="small muted">Weekday services ({notes.weekdaySkipped}) aren’t auto-filled; place people there by hand.</div>}
            </div>
          )}

          <section className="card stack" aria-label="Month board">
            <div className="section-head">
              <div>
                <h3>Month board</h3>
                <p className="small muted">Pick who goes where. Changed spots are blue; red means that person marked themselves unavailable.</p>
              </div>
            </div>
            <div className="mp-scroll">
              <table className="mp-table">
                <thead>
                  <tr>
                    <th scope="col" className="mp-corner">
                      Position
                    </th>
                    {m.events.map((e) => (
                      <th key={e.id} scope="col" className="mp-ev">
                        <span className="small muted">
                          {fmtDay(e.date)} · {fmtTime(e.start)}
                        </span>
                        <strong>{e.title}</strong>
                        <span className="mp-ev-flags">
                          {e.open > 0 ? <span className="chip chip-pending">{e.open} open</span> : <span className="chip chip-approved">Full</span>}
                          {e.kind !== 'soundcheck' && e.needs.length > 0 && (e.lead ? <span className="chip chip-approved">Lead ✓</span> : <span className="chip chip-pending">No Lead</span>)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.allRows.map((row) => (
                    <tr key={row} className={isShadow(row) ? 'mp-shadow-row' : ''}>
                      <th scope="row">{isShadow(row) ? `↳ ${m.posLabel[baseOf(row)] || baseOf(row)} shadow` : m.posLabel[row] || row}</th>
                      {m.events.map((e) => (
                        <td key={e.id}>{e.rows.has(row) ? <SlotSelect e={e} pos={row} m={m} draft={draft} focus={focus} onPick={(uid) => place(e.id, row, uid)} /> : <span className="mp-na">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card stack" aria-label="People this month">
            <div>
              <h3>People this month</h3>
              <p className="small muted">Who has room, who’s at their limit, and who isn’t available. Select someone to see the open spots they could fill.</p>
            </div>
            <div className="mp-people">
              {m.people.map((p) => (
                <div key={p.id} className={`mp-person ${focus === p.id ? 'mp-person-on' : ''}`}>
                  <button type="button" className="mp-person-btn" aria-expanded={focus === p.id} onClick={() => setFocus(focus === p.id ? null : p.id)}>
                    <span className="mp-person-name">
                      <strong>{p.name}</strong>
                      <Levels p={p} label={(k) => m.posLabel[k] || k} />
                    </span>
                    <span className="mp-person-nums small">
                      {p.n} scheduled{p.maxPerMonth ? ` of ${p.maxPerMonth} max` : ''} · available for {p.avail} of {d.events.length}
                    </span>
                    <span className={`mp-status mp-${p.status.tone}`}>{p.status.text}</span>
                  </button>
                  {focus === p.id && <WhereTheyFit p={p} m={m} draft={draft} onPlace={place} />}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ n, label, tone }) {
  return (
    <div className={`mp-tile mp-tile-${tone}`}>
      <strong>{n}</strong>
      <span className="small">{label}</span>
    </div>
  );
}

function Levels({ p, label }) {
  const chips = [...p.leads.map((k) => ['lead', `${label(k)}: Lead`]), ...p.positions.filter((k) => !p.leads.includes(k)).map((k) => ['cap', label(k)]), ...p.trainee.map((k) => ['learn', `${label(k)}: learning`])];
  if (!chips.length) return <span className="small muted">No positions yet</span>;
  return (
    <span className="mp-levels">
      {chips.map(([tone, text]) => (
        <span key={text} className={`mp-lvl mp-lvl-${tone}`}>
          {text}
        </span>
      ))}
    </span>
  );
}

function SlotSelect({ e, pos, m, draft, focus, onPick }) {
  const base = baseOf(pos);
  const shadow = isShadow(pos);
  const k = keyOf(e.id, pos);
  const uid = draft[k] || '';
  const changed = (m.saved[k] || '') !== uid;
  const off = m.off[e.id] || new Set();
  const others = m.onEvent[e.id] || new Set();
  const fits = (p) => (shadow ? p.trainee.includes(base) || p.positions.includes(base) : p.positions.includes(base));
  const list = Object.values(m.person).filter((p) => fits(p) || p.id === uid);
  const levelOf = (p) => (shadow ? (p.trainee.includes(base) ? 'learning' : '') : p.leads.includes(base) ? 'Lead' : '');
  const tag = (p) => {
    const bits = [levelOf(p), `${m.count[p.id] || 0}${p.maxPerMonth ? `/${p.maxPerMonth}` : ''} this month`].filter(Boolean);
    return `${p.name} · ${bits.join(' · ')}`;
  };
  const free = list.filter((p) => p.id === uid || (!off.has(p.id) && !others.has(p.id)));
  const busyHere = list.filter((p) => p.id !== uid && !off.has(p.id) && others.has(p.id));
  const away = list.filter((p) => p.id !== uid && off.has(p.id));
  const sorted = (arr) => [...arr].sort((a, b) => (m.count[a.id] || 0) - (m.count[b.id] || 0) || a.name.localeCompare(b.name));
  const lead = uid && !shadow && m.person[uid]?.leads.includes(base);
  const unavailable = uid && off.has(uid);
  const focusFits = focus && !uid && free.some((p) => p.id === focus);
  return (
    <div className={`mp-slot${changed ? ' mp-changed' : ''}${!uid && !shadow ? ' mp-open' : ''}${unavailable ? ' mp-unavail' : ''}${focusFits ? ' mp-focus' : ''}`}>
      <select aria-label={`${shadow ? `${base} shadow` : base} on ${e.title}, ${e.date}`} value={uid} onChange={(ev) => onPick(ev.target.value)}>
        <option value="">{shadow ? '— No shadow —' : '— Open —'}</option>
        <optgroup label="Available">
          {sorted(free).map((p) => (
            <option key={p.id} value={p.id}>
              {tag(p)}
            </option>
          ))}
        </optgroup>
        {busyHere.length > 0 && (
          <optgroup label="Already on this service">
            {sorted(busyHere).map((p) => (
              <option key={p.id} value={p.id} disabled>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        {away.length > 0 && (
          <optgroup label="Marked unavailable">
            {sorted(away).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (unavailable)
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {(lead || unavailable) && <span className={`mp-slot-tag ${unavailable ? 'danger' : ''}`}>{unavailable ? 'Unavailable' : 'Lead'}</span>}
    </div>
  );
}

// Open spots (and shadow spots) a person could take this month
function WhereTheyFit({ p, m, draft, onPlace }) {
  const spots = [];
  for (const e of m.events) {
    if (m.off[e.id]?.has(p.id) || m.onEvent[e.id]?.has(p.id)) continue;
    for (const k of e.needs) {
      if (p.positions.includes(k) && !draft[keyOf(e.id, k)]) spots.push({ e, pos: k, shadow: false });
      if (p.trainee.includes(k) && !draft[keyOf(e.id, k + SHADOW)]) spots.push({ e, pos: k + SHADOW, shadow: true });
    }
  }
  const atLimit = p.maxPerMonth && p.n >= p.maxPerMonth;
  if (!spots.length) return <p className="small muted mp-fit">No open spots they can take this month.</p>;
  return (
    <div className="mp-fit stack-xs">
      {atLimit && <p className="small danger">They’re at their monthly limit, so only add more if they’ve agreed.</p>}
      {spots.map(({ e, pos, shadow }) => (
        <div key={keyOf(e.id, pos)} className="mp-fit-row">
          <span className="small">
            <strong>{m.posLabel[baseOf(pos)] || baseOf(pos)}</strong>
            {shadow ? ' (shadow)' : ''} · {e.title}, {fmtDay(e.date)} {fmtTime(e.start)}
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onPlace(e.id, pos, p.id)}>
            Place
          </button>
        </div>
      ))}
    </div>
  );
}
