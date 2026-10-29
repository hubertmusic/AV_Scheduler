import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, addMinutes, api, firstName, fmtDay, fmtTime, fridayOf, todayISO, weekendLabel } from '../lib.js';
import { Avatar, Empty, Icon, Modal, useApp } from '../ui.jsx';
import { groupRecipients, soundcheckText } from '../outreach.js';
import { AutoFillModal } from './AutoFill.jsx';
import { buildFromTemplate } from '../template.js';
import { AnnouncementsModal, canAnnounce, Notices, noticesFor } from '../notices.jsx';

const SH = '+shadow';

export default function Schedule() {
  const app = useApp();
  const { can, positions, people, posLabel, person, me } = app;
  const { weekend: fri, setWeekend: setFri } = app;
  const [autofill, setAutofill] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState(null); // { eventId, pos }
  const [autoNext, setAutoNext] = useState(true);
  const [editing, setEditing] = useState(null);
  const [checkFor, setCheckFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [skips, setSkips] = useState([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [evs, sk] = await Promise.all([api(`/events?from=${fri}&to=${addDays(fri, 2)}`), api(`/events/skips?from=${fri}&to=${addDays(fri, 2)}`).catch(() => [])]);
      setEvents(evs);
      setSkips(sk);
    } catch (e) {
      setError(e.message);
    }
  }, [fri]);

  const bringBack = async (k) => {
    setBusy(true);
    try {
      await api(`/events/skips/${k.id}/restore`, { method: 'POST' });
      app.toast(`${k.title} is back on ${fmtDay(k.date).split(',')[0]}`);
      await load();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  // "We're not meeting this weekend": takes every service off. Template services are
  // remembered as skipped, so Sync won't bring them back; Bring back undoes it.
  const skipWeekend = async () => {
    const placed = events.reduce((n, e) => n + Object.keys(e.assignments || {}).length, 0);
    if (!window.confirm(`Take every service off the weekend of ${weekendLabel(fri)}?${placed ? `\n\n${placed} placed ${placed === 1 ? 'person' : 'people'} will be cleared.` : ''}\n\nSync with template won’t put them back. You can bring each one back from this page.`)) return;
    setBusy(true);
    try {
      const order = [...events].sort((a, b) => (b.kind === 'soundcheck') - (a.kind === 'soundcheck'));
      for (const e of order) await api(`/events/${e.id}`, { method: 'DELETE' }).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
      app.toast(`No services the weekend of ${weekendLabel(fri)}`);
      await load();
    } catch (e) {
      app.toast(e.message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setEvents(null);
    setSel(null);
    load();
  }, [load]);

  // Only show columns some service this weekend needs (or all, if nothing is planned yet).
  const cols = useMemo(() => {
    if (!events?.length) return positions;
    const used = new Set(events.flatMap((e) => e.needs));
    return positions.filter((p) => used.has(p.key));
  }, [events, positions]);

  const openKeys = useMemo(() => {
    const out = [];
    for (const e of events || []) for (const p of positions) if (e.needs.includes(p.key) && !e.assignments[p.key]) out.push({ eventId: e.id, pos: p.key });
    return out;
  }, [events, positions]);

  const stats = useMemo(() => {
    let needed = 0, filled = 0;
    const flags = [];
    for (const e of events || []) {
      const counts = {};
      for (const uid of Object.values(e.assignments)) counts[uid] = (counts[uid] || 0) + 1;
      for (const k of e.needs) {
        needed++;
        const uid = e.assignments[k];
        if (!uid) continue;
        filled++;
        const p = person(uid);
        const flag = counts[uid] > 1 ? 'Double-booked' : e.away.includes(uid) ? 'Away that day' : e.unavailable.includes(uid) ? 'Marked unavailable' : p && !p.active ? 'Deactivated' : '';
        if (flag) flags.push({ eventId: e.id, pos: k, flag, name: p?.name || 'Unknown', where: `${posLabel(k)}, ${e.title}` });
      }
    }
    return { needed, filled, flags };
  }, [events, person, posLabel]);

  const flagFor = (eventId, pos) => stats.flags.find((f) => f.eventId === eventId && f.pos === pos)?.flag || '';

  const patchLocal = (eventId, pos, userId) =>
    setEvents((list) =>
      list.map((e) => {
        if (e.id !== eventId) return e;
        const assignments = { ...e.assignments };
        const confirmed = { ...e.confirmed };
        if (userId) assignments[pos] = userId;
        else delete assignments[pos];
        delete confirmed[pos];
        return { ...e, assignments, confirmed };
      })
    );

  const place = async (eventId, pos, userId) => {
    setBusy(true);
    try {
      await api(`/events/${eventId}/assign/${pos}`, { method: 'PUT', body: { userId } });
      patchLocal(eventId, pos, userId);
      const ev = events.find((e) => e.id === eventId);
      const label = pos.endsWith(SH) ? `${posLabel(pos.slice(0, -SH.length))} (shadow)` : posLabel(pos);
      if (userId) {
        app.toast(`Placed ${person(userId)?.name} on ${label} · ${ev.title}`);
        if (autoNext && !pos.endsWith(SH)) {
          const keys = openKeys.filter((k) => !(k.eventId === eventId && k.pos === pos));
          const i = openKeys.findIndex((k) => k.eventId === eventId && k.pos === pos);
          const next = keys.length ? keys[Math.max(0, i) % keys.length] : null;
          setSel(next);
        }
      } else {
        app.toast('Removed. The spot is open.');
      }
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const buildWeekend = async () => {
    setBusy(true);
    try {
      await buildFromTemplate(app, fri);
      await load();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const copyLast = async () => {
    setBusy(true);
    try {
      const r = await api('/weekend/copy', { method: 'POST', body: { friday: fri } });
      const skipped = r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped.slice(0, 3).map((x) => `${x.name} (${x.reason})`).join(', ')}${r.skipped.length > 3 ? '…' : ''}` : '';
      app.toast(`Copied last weekend — ${r.created} service${r.created === 1 ? '' : 's'} added, ${r.copied} people placed.${skipped}`);
      await load();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const crewOf = (e) =>
    Object.keys(e.assignments)
      .filter((k) => e.needs.includes(k.replace(SH, '')))
      .map((k) => e.assignments[k])
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((id) => person(id))
      .filter((p) => p && p.id !== me.id);

  const lineup = () => {
    const lines = [`${app.settings.orgName} — AV lineup for ${weekendLabel(fri)}`, ''];
    for (const e of events) {
      lines.push(`${fmtDay(e.date)} · ${e.title} ${fmtTime(e.start)} (call ${fmtTime(e.call)})`);
      for (const k of e.needs) lines.push(`  ${posLabel(k)}: ${e.assignments[k] ? person(e.assignments[k])?.name : 'OPEN'}`);
      lines.push('');
    }
    lines.push(`Need to swap or drop? Open My shifts in Crew Call: ${window.location.origin}`);
    const everyone = [...new Map(events.flatMap(crewOf).map((p) => [p.id, p])).values()];
    app.openWa({ title: 'Send the weekend lineup', text: lines.join('\n'), recipients: everyone });
  };

  const remindRow = (e) => {
    const crew = crewOf(e);
    const groups = e.groups.map((id) => app.group(id)).filter(Boolean);
    if (e.kind === 'soundcheck') {
      const forEvent = events.find((x) => x.id === e.forEvent);
      app.openWa({
        title: `Message everyone on ${e.title}`,
        text: soundcheckText({ event: e, forEvent, groups, orgName: app.settings.orgName, fromName: app.me.name }),
        recipients: [...groupRecipients(groups), ...crew],
        groupLink: '',
      });
      return;
    }
    const text = `Reminder: ${e.title}, ${fmtDay(e.date)} at ${fmtTime(e.start)}. Call time is ${fmtTime(e.call)}.\n\nCrew: ${
      e.needs.map((k) => `${posLabel(k)} – ${e.assignments[k] ? firstName(person(e.assignments[k])?.name) : 'OPEN'}`).join(', ')
    }\n\nCan’t make it? Request a swap in Crew Call.`;
    app.openWa({ title: `Message the ${e.title} crew`, text, recipients: [...crew, ...groupRecipients(groups)] });
  };

  const selEvent = sel && events?.find((e) => e.id === sel.eventId);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Weekend schedule</h1>
          <div className="week-nav">
            <button type="button" className="icon-btn" aria-label="Previous weekend" onClick={() => setFri(addDays(fri, -7))}>
              <Icon name="chevL" />
            </button>
            <div className="week-label">
              <span className="muted small">Weekend of</span>
              <strong className="mono">{weekendLabel(fri)}</strong>
            </div>
            <button type="button" className="icon-btn" aria-label="Next weekend" onClick={() => setFri(addDays(fri, 7))}>
              <Icon name="chevR" />
            </button>
            {fri !== fridayOf(todayISO()) && (
              <button type="button" className="btn btn-ghost" onClick={() => setFri(fridayOf(todayISO()))}>
                This weekend
              </button>
            )}
          </div>
        </div>
        <div className="row-wrap">
          {events?.length > 0 && (
            <div className="meter" aria-label={`${stats.filled} of ${stats.needed} spots filled`}>
              <div className="meter-track">
                <div className={`meter-fill ${stats.filled === stats.needed ? 'meter-done' : ''}`} style={{ width: `${stats.needed ? (stats.filled / stats.needed) * 100 : 0}%` }} />
              </div>
              <span className="mono">
                {stats.filled} of {stats.needed} filled
              </span>
            </div>
          )}
          {can.edit && events?.length > 0 && (
            <>
              <button type="button" className="btn btn-outline" onClick={() => setEditing({ date: fri, title: '', start: '19:00', call: '18:15', end: '20:30', needs: [], notes: '' })}>
                <Icon name="plus" /> Add service
              </button>
              <button type="button" className="btn btn-ghost" onClick={buildWeekend} disabled={busy} title="Adds missing template services and offers to update ones that changed">
                Sync with template
              </button>
              <button type="button" className="btn btn-ghost" onClick={skipWeekend} disabled={busy} title="We’re not meeting this weekend">
                No services this weekend
              </button>
              {openKeys.length > 0 && (
                <button type="button" className="btn btn-primary" onClick={() => setAutofill(true)}>
                  Auto-fill {openKeys.length} open
                </button>
              )}
            </>
          )}
          {can.message && events?.length > 0 && (
            <button type="button" className="btn btn-outline" onClick={lineup}>
              <Icon name="chat" /> Send lineup
            </button>
          )}
        </div>
      </div>

      <Notices items={noticesFor(app, fri)} onEdit={canAnnounce(app) ? () => setAnnouncing(true) : null} />

      {can.edit && skips.length > 0 && (
        <div className="skip-strip" role="group" aria-label="Services left out this weekend">
          <span className="label-sm">Not happening this weekend:</span>
          {skips.map((k) => (
            <span key={k.id} className="skip-chip">
              <span className="skip-name">
                {k.title} · {fmtDay(k.date).split(',')[0]}
              </span>
              <button type="button" className="link-btn small" disabled={busy} onClick={() => bringBack(k)}>
                Bring back
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}
      {!events && !error && <div className="loading-inline">Loading…</div>}

      {events && events.length === 0 && (
        <div className="card stack">
          <h2>Nothing scheduled for {weekendLabel(fri)} yet</h2>
          {can.edit ? (
            <>
              <p className="muted">
                {skips.length
                  ? 'Every service is off this weekend. Bring one back above, or add a one-off service.'
                  : `Build the weekend from your template (${app.settings.weekendTemplate.filter((t) => !t.off).map((t) => t.title).join(', ') || 'set it up in Settings'}), or add a one-off service.`}
              </p>
              <div className="row-wrap">
                <button type="button" className="btn btn-primary" onClick={buildWeekend} disabled={busy || !app.settings.weekendTemplate.some((t) => !t.off)}>
                  Build this weekend
                </button>
                <button type="button" className="btn btn-outline" onClick={copyLast} disabled={busy}>
                  Copy last weekend
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setEditing({ date: fri, title: '', start: '19:00', call: '18:15', end: '20:30', needs: [], notes: '' })}>
                  Add a service
                </button>
              </div>
            </>
          ) : (
            <p className="muted">{skips.length ? 'No services are scheduled this weekend.' : 'Your team leaders haven’t posted this weekend yet.'}</p>
          )}
        </div>
      )}

      {events && events.length > 0 && (
        <div className="split">
          <section className="card grid-card" aria-label="Schedule grid">
            <div className="grid-scroll">
              <div className="sched" style={{ '--cols': cols.length }}>
                <div className="sched-row sched-head">
                  <div>Service</div>
                  {cols.map((p) => (
                    <div key={p.key}>{p.label}</div>
                  ))}
                </div>
                {events.map((e) => (
                  <div className={`sched-row ${e.kind === 'soundcheck' ? 'sched-row-check' : ''}`} key={e.id}>
                    <div className="sched-service">
                      <div className="grow stack-xs">
                        <div className="muted small strong">{fmtDay(e.date)}</div>
                        {e.kind === 'soundcheck' && <span className="chip chip-check self-start">Sound check</span>}
                        <div className="strong">{e.title}</div>
                        <div className="mono small muted nowrap">{fmtTime(e.start)}</div>
                        <div className="mono small muted nowrap">call {fmtTime(e.call)}</div>
                        {e.notes && (
                          <div className="sched-note" title={e.notes}>
                            ⚠ {e.notes}
                          </div>
                        )}
                        {e.groups.length > 0 && (
                          <div className="row-wrap tight">
                            {e.groups.map((gid) => app.group(gid)).filter(Boolean).map((g) => (
                              <span key={g.id} className="group-chip">{g.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="sched-actions">
                        {can.message && (
                          <button type="button" className="icon-btn" aria-label={`Message everyone on ${e.title}`} onClick={() => remindRow(e)}>
                            <Icon name="chat" />
                          </button>
                        )}
                        {can.edit && (
                          <button type="button" className="icon-btn" aria-label={`Edit ${e.title}`} onClick={() => setEditing(e)}>
                            <Icon name="edit" />
                          </button>
                        )}
                        {can.edit && e.kind !== 'soundcheck' && (
                          <button type="button" className="icon-btn" aria-label={`Add a sound check for ${e.title}`} title="Add sound check" onClick={() => setCheckFor(e)}>
                            <Icon name="mic" />
                          </button>
                        )}
                        <a className="icon-btn" href={`/runsheet/${e.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Run sheet for ${e.title}`} title="Run sheet">
                          <Icon name="doc" />
                        </a>
                      </div>
                    </div>
                    {cols.map((p) => {
                      if (!e.needs.includes(p.key)) return <div key={p.key} className="cell cell-na">Not needed</div>;
                      const uid = e.assignments[p.key];
                      const who = uid ? person(uid) : null;
                      const flag = flagFor(e.id, p.key);
                      const mine = uid === me.id;
                      const selected = sel?.eventId === e.id && sel?.pos === p.key;
                      const cls = `cell ${uid ? (mine ? 'cell-mine' : 'cell-filled') : 'cell-open'} ${flag ? 'cell-flag' : ''} ${selected ? 'cell-sel' : ''}`;
                      const inner = (
                        <>
                          {who ? (
                            <span className="cell-who">
                              <Avatar name={who.name} size={26} tone={mine ? 'blue' : 'dark'} />
                              <span className="ellipsis">{who.name}</span>
                            </span>
                          ) : uid ? (
                            <span>Unknown</span>
                          ) : (
                            <span className="strong">{can.edit ? '+ Assign' : 'Open spot'}</span>
                          )}
                          {flag && <span className="cell-warn">⚠ {flag}</span>}
                          {who && <span className={`cell-conf ${e.confirmed[p.key] ? 'good' : 'muted'}`}>{e.confirmed[p.key] ? '✓ Confirmed' : 'Not confirmed'}</span>}
                          {mine && !can.edit && <span className="cell-you">You</span>}
                          {e.assignments[p.key + SH] && <span className="cell-shadow">+ {person(e.assignments[p.key + SH])?.name || 'trainee'} shadowing</span>}
                        </>
                      );
                      return can.edit ? (
                        <button
                          key={p.key}
                          type="button"
                          className={cls}
                          aria-pressed={selected}
                          aria-label={`${p.label}, ${e.title} ${fmtDay(e.date)}: ${who ? who.name : 'open'}`}
                          onClick={() => setSel({ eventId: e.id, pos: p.key })}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div key={p.key} className={cls}>
                          {inner}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="legend">
              <span>Dashed orange = open spot</span>
              <span>Blue = you</span>
              <span>⚠ = needs attention</span>
            </div>
          </section>

          <aside className="card side" aria-label="Placement panel">
            {can.edit && selEvent ? (
              <PlacePanel
                event={selEvent}
                pos={sel.pos}
                events={events}
                busy={busy}
                autoNext={autoNext}
                setAutoNext={setAutoNext}
                onPlace={(uid, slot) => place(selEvent.id, slot || sel.pos, uid)}
                onClose={() => setSel(null)}
              />
            ) : can.edit ? (
              <div className="stack">
                <div>
                  <h2>Open spots</h2>
                  <p className="muted small">Pick one to see who’s trained and free, or click any cell.</p>
                </div>
                {openKeys.length === 0 && <div className="ok-box">Every spot this weekend is filled.</div>}
                {openKeys.map((k) => {
                  const e = events.find((x) => x.id === k.eventId);
                  return (
                    <button key={k.eventId + k.pos} type="button" className="open-btn" onClick={() => setSel(k)}>
                      <span className="strong accent-ink">{posLabel(k.pos)}</span>
                      <span className="muted small">
                        {e.title} · {fmtDay(e.date)} · {fmtTime(e.start)}
                      </span>
                    </button>
                  );
                })}
                {stats.flags.length > 0 && (
                  <div className="stack-sm divider-top">
                    <div className="label-sm danger">Needs attention</div>
                    {stats.flags.map((f) => (
                      <button key={f.eventId + f.pos} type="button" className="flag-btn" onClick={() => setSel({ eventId: f.eventId, pos: f.pos })}>
                        <strong>{f.name}</strong> <span className="muted small">· {f.flag} · {f.where}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="stack">
                <h2>You’re viewing the schedule</h2>
                <p className="muted">Your spots are in blue. To swap, transfer or drop a shift, or pick up an open one, use My shifts.</p>
                <button type="button" className="btn btn-primary" onClick={() => app.goTab('mine')}>
                  Go to My shifts
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {announcing && <AnnouncementsModal friday={fri} onClose={() => setAnnouncing(false)} />}
      {autofill && (
        <AutoFillModal
          friday={fri}
          onClose={() => setAutofill(false)}
          onDone={() => {
            setAutofill(false);
            load();
          }}
        />
      )}
      {checkFor && (
        <SoundCheckModal
          service={checkFor}
          onClose={() => setCheckFor(null)}
          onSaved={(msg) => {
            setCheckFor(null);
            app.toast(msg);
            load();
          }}
        />
      )}
      {editing && (
        <EventModal
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            app.toast(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

function PlacePanel({ event, pos, events, busy, autoNext, setAutoNext, onPlace, onClose }) {
  const app = useApp();
  const { people, posLabel, person, can } = app;
  const curId = event.assignments[pos];
  const cur = curId ? person(curId) : null;

  const shadowId = event.assignments[pos + SH];
  const shadow = shadowId ? person(shadowId) : null;

  const statusFor = (p, slot) => {
    const unav = event.unavailable.includes(p.id);
    const away = event.away.includes(p.id);
    const other = Object.entries(event.assignments).find(([k, v]) => v === p.id && k !== slot)?.[0];
    if (away) return ['Away that day', 4, true];
    if (unav) return ['Marked unavailable for this service', 3, true];
    if (other) return [`Already on ${other.endsWith(SH) ? `${posLabel(other.slice(0, -SH.length))} (shadow)` : posLabel(other)} this service`, 2, true];
    return null;
  };
  const trainees = people
    .filter((p) => p.active && (p.trainee || []).includes(pos) && p.id !== shadowId)
    .map((p) => ({ p, st: statusFor(p, pos + SH) }));

  const cands = people
    .filter((p) => p.active && p.positions.includes(pos) && p.id !== curId)
    .map((p) => {
      const st = statusFor(p, pos);
      const load = events.reduce((n, e) => n + Object.entries(e.assignments).filter(([k, v]) => v === p.id && !k.endsWith(SH)).length, 0);
      let status, rank, warn = false;
      if (st) [status, rank, warn] = st;
      else [status, rank] = [`Free · ${load} shift${load === 1 ? '' : 's'} this weekend`, load ? 1 : 0];
      return { p, status, rank, warn, load };
    })
    .sort((a, b) => a.rank - b.rank || a.load - b.load || a.p.name.localeCompare(b.p.name));

  const remind = () =>
    app.openWa({
      title: `Remind ${cur.name}`,
      text: `Hi ${firstName(cur.name)}, reminder: you’re on ${posLabel(pos)} for ${event.title}, ${fmtDay(event.date)}. Call time is ${fmtTime(event.call)}. Thanks!`,
      recipients: [cur],
    });

  return (
    <div className="stack">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Place someone</div>
          <h2>{posLabel(pos)}</h2>
          <div className="muted small">
            {event.title} · {fmtDay(event.date)} · {fmtTime(event.start)}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel">
          <Icon name="close" size={16} />
        </button>
      </div>
      {curId && (
        <div className="current-box">
          <div className="muted small">Currently placed</div>
          <div className="row">
            <Avatar name={cur?.name || '?'} size={32} />
            <strong>{cur?.name || 'Unknown person'}</strong>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn btn-outline" onClick={() => onPlace(null)} disabled={busy}>
              Remove
            </button>
            {can.message && cur && (
              <button type="button" className="btn btn-ghost" onClick={remind}>
                Remind on WhatsApp
              </button>
            )}
          </div>
        </div>
      )}
      <div className="label-sm">Trained on {posLabel(pos)}</div>
      {cands.length === 0 && <Empty>No one else is trained for {posLabel(pos)}. Add it to people’s positions on Team &amp; roles.</Empty>}
      <ul className="cand-list">
        {cands.map(({ p, status, warn }) => (
          <li key={p.id}>
            <Avatar name={p.name} size={32} tone="light" />
            <span className="grow">
              <strong>{p.name}</strong>
              <span className={`small ${warn ? 'danger' : 'good'}`}>{status}</span>
            </span>
            <button type="button" className={`btn ${warn ? 'btn-outline' : 'btn-primary'}`} disabled={busy} onClick={() => onPlace(p.id)}>
              {warn ? 'Place anyway' : curId ? 'Replace' : 'Place'}
            </button>
          </li>
        ))}
      </ul>
      <label className="check">
        <input type="checkbox" checked={autoNext} onChange={() => setAutoNext(!autoNext)} />
        <span>Jump to the next open spot after placing someone</span>
      </label>
      {(shadow || trainees.length > 0) && (
        <div className="stack-sm divider-top">
          <div className="label-sm">Trainee shadowing {posLabel(pos)}</div>
          {shadow ? (
            <div className="row-wrap">
              <Avatar name={shadow.name} size={28} tone="light" />
              <strong className="grow">{shadow.name}</strong>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onPlace(null, pos + SH)}>
                Remove
              </button>
            </div>
          ) : (
            <ul className="cand-list">
              {trainees.map(({ p, st }) => (
                <li key={p.id}>
                  <Avatar name={p.name} size={28} tone="light" />
                  <span className="grow">
                    <strong>{p.name}</strong>
                    <span className={`small ${st ? 'danger' : 'muted'}`}>{st ? st[0] : 'Learning this position'}</span>
                  </span>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => onPlace(p.id, pos + SH)}>
                    Shadow
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function GroupPicker({ selected, onToggle }) {
  const app = useApp();
  if (!app.groups.length)
    return (
      <p className="muted small">
        Outside groups (praise team, choir, guest musicians) can be added on the Groups page{app.can.groups ? '' : ' by a leader'} and then attached here.
      </p>
    );
  return (
    <fieldset className="fieldset">
      <legend>Outside groups taking part</legend>
      <div className="check-grid">
        {app.groups.map((g) => (
          <label key={g.id} className="check">
            <input type="checkbox" checked={selected.includes(g.id)} onChange={() => onToggle(g.id)} />
            <span>{g.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SoundCheckModal({ service, onClose, onSaved }) {
  const app = useApp();
  const start = addMinutes(service.call, -45);
  const [f, setF] = useState({
    title: `Sound check · ${service.title}`,
    date: service.date,
    call: addMinutes(start, -15),
    start,
    end: service.call,
    needs: service.needs.filter((k) => k === 'foh' || k === 'stream'),
    groups: service.groups || [],
    copyCrew: true,
    notes: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k) => setF({ ...f, needs: f.needs.includes(k) ? f.needs.filter((x) => x !== k) : [...f.needs, k] });
  const toggleGroup = (id) => setF({ ...f, groups: f.groups.includes(id) ? f.groups.filter((x) => x !== id) : [...f.groups, id] });
  const copyable = f.needs.filter((k) => service.assignments[k]).length;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = await api(`/events/${service.id}/soundcheck`, { method: 'POST', body: f });
      onSaved(`Sound check added${out.copied ? ` with ${out.copied} crew from ${service.title}` : ''}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`Sound check for ${service.title}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p className="muted small">
          {service.title} is {fmtDay(service.date)} at {fmtTime(service.start)}, crew call {fmtTime(service.call)}.
        </p>
        <label className="field">
          <span>Name</span>
          <input required value={f.title} onChange={set('title')} />
        </label>
        <div className="row-wrap fields-4">
          <label className="field">
            <span>Date</span>
            <input type="date" required value={f.date} onChange={set('date')} />
          </label>
          <label className="field">
            <span>AV crew call</span>
            <input type="time" required value={f.call} onChange={set('call')} />
          </label>
          <label className="field">
            <span>Sound check starts</span>
            <input type="time" required value={f.start} onChange={set('start')} />
          </label>
          <label className="field">
            <span>Ends</span>
            <input type="time" required value={f.end} onChange={set('end')} />
          </label>
        </div>
        <fieldset className="fieldset">
          <legend>AV positions needed</legend>
          <div className="check-grid">
            {app.positions.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={f.needs.includes(p.key)} onChange={() => toggle(p.key)} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <GroupPicker selected={f.groups} onToggle={toggleGroup} />
        <label className="check">
          <input type="checkbox" checked={f.copyCrew} onChange={() => setF({ ...f, copyCrew: !f.copyCrew })} />
          <span>Place the same crew as {service.title} ({copyable} {copyable === 1 ? 'person' : 'people'} on these positions)</span>
        </label>
        <label className="field">
          <span>Notes (input list, stage plot, tracks…)</span>
          <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="e.g. 4 vocal mics, DI for keys, click to drummer" />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            Add sound check
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EventModal({ event, onClose, onSaved }) {
  const app = useApp();
  const isNew = !event.id;
  const [f, setF] = useState({
    date: event.date,
    title: event.title,
    start: event.start,
    call: event.call,
    end: event.end,
    needs: event.needs,
    notes: event.notes || '',
    kind: event.kind || 'service',
    groups: event.groups || [],
  });
  const toggleGroup = (id) => setF({ ...f, groups: f.groups.includes(id) ? f.groups.filter((x) => x !== id) : [...f.groups, id] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k) => setF({ ...f, needs: f.needs.includes(k) ? f.needs.filter((x) => x !== k) : [...f.needs, k] });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isNew) await api('/events', { method: 'POST', body: f });
      else await api(`/events/${event.id}`, { method: 'PATCH', body: f });
      onSaved(isNew ? `Added ${f.title}` : `Saved ${f.title}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    const fromTemplate = !event.manual && app.settings.weekendTemplate.some((t) => !t.off && t.title === event.title && addDays(fridayOf(event.date), t.day) === event.date);
    const msg = fromTemplate
      ? `Take ${event.title} off ${fmtDay(event.date)} only? Everyone placed on it will be cleared.\n\nIt stays in your template for other weekends, and Sync won’t put it back here. (To stop it every week, turn it off in Settings → Weekend template.)`
      : `Remove ${event.title} on ${fmtDay(event.date)}? Everyone placed on it will be cleared.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}`, { method: 'DELETE' });
      onSaved(`Removed ${event.title}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add to the schedule' : `Edit ${event.title}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <fieldset className="fieldset">
          <legend>Type</legend>
          <div className="row-wrap">
            <label className="check">
              <input type="radio" name="kind" checked={f.kind === 'service'} onChange={() => setF({ ...f, kind: 'service' })} />
              <span>Service or event</span>
            </label>
            <label className="check">
              <input type="radio" name="kind" checked={f.kind === 'soundcheck'} onChange={() => setF({ ...f, kind: 'soundcheck' })} />
              <span>Sound check / rehearsal</span>
            </label>
          </div>
        </fieldset>
        <label className="field">
          <span>Name</span>
          <input required value={f.title} onChange={set('title')} placeholder={f.kind === 'soundcheck' ? 'e.g. Choir sound check' : 'e.g. Youth Vespers'} />
        </label>
        <div className="row-wrap fields-4">
          <label className="field">
            <span>Date</span>
            <input type="date" required value={f.date} onChange={set('date')} />
          </label>
          <label className="field">
            <span>Call time</span>
            <input type="time" required value={f.call} onChange={set('call')} />
          </label>
          <label className="field">
            <span>Starts</span>
            <input type="time" required value={f.start} onChange={set('start')} />
          </label>
          <label className="field">
            <span>Ends</span>
            <input type="time" required value={f.end} onChange={set('end')} />
          </label>
        </div>
        <fieldset className="fieldset">
          <legend>Positions needed</legend>
          <div className="check-grid">
            {app.positions.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={f.needs.includes(p.key)} onChange={() => toggle(p.key)} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          {!isNew && <p className="muted small">Unticking a position clears whoever was placed on it.</p>}
        </fieldset>
        <GroupPicker selected={f.groups} onToggle={toggleGroup} />
        <label className="field">
          <span>Important note for this shift (shows at the top of the shift, in calendars and reminders)</span>
          <textarea rows={2} value={f.notes} onChange={set('notes')} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap spread">
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy}>
              {isNew ? 'Add service' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {!isNew && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              Remove service
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
