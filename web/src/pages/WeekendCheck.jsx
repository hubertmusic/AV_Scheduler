import { useCallback, useEffect, useState } from 'react';
import { addDays, api, firstName, fmtDay, fmtTime, fridayOf, prettyPhone, todayISO, waLink, weekendLabel } from '../lib.js';
import { Avatar, Empty, Icon, useApp } from '../ui.jsx';
import { AutoFillModal } from './AutoFill.jsx';
import { buildFromTemplate } from '../template.js';
import { AnnouncementsModal, canAnnounce, Notices, noticesFor } from '../notices.jsx';

export default function WeekendCheck() {
  const app = useApp();
  const { can, posLabel, weekend: fri, setWeekend: setFri } = app;
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [autofill, setAutofill] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setD(await api(`/weekend/check?friday=${fri}`));
    } catch (e) {
      setError(e.message);
    }
  }, [fri]);
  useEffect(() => {
    setD(null);
    load();
  }, [load]);

  const where = (x) => `${x.shadow ? `${posLabel(x.position)} (shadow)` : posLabel(x.position)} · ${x.event.title}`;
  const appUrl = window.location.origin;

  const copyLast = async () => {
    setBusy(true);
    try {
      const r = await api('/weekend/copy', { method: 'POST', body: { friday: fri } });
      app.toast(`Copied last weekend: ${r.created} service${r.created === 1 ? '' : 's'} added, ${r.copied} people placed${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
      await load();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const build = async () => {
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

  const nudgeAll = () => {
    const people = [...new Map(d.unconfirmed.map((x) => [x.person.id, x.person])).values()];
    app.openWa({
      title: 'Ask people to confirm',
      text: `Hi! Quick check for ${weekendLabel(fri)}: please tap Confirm on your shift in Crew Call so we know you’re set.\n\n${appUrl}/#mine\n\nCan’t make it? Request a swap there too. Thanks!`,
      recipients: people,
      groupLink: '',
    });
  };
  const askAvailability = () =>
    app.openWa({
      title: 'Ask for availability',
      text: `Hi! We’re planning the next few weeks. Please open Crew Call → My shifts and add any dates you’ll be away (or tap “Nothing’s changed”):\n\n${appUrl}/#mine\n\nThanks!`,
      recipients: d.availability.stale,
      groupLink: undefined,
    });

  const remind = async (x) => {
    if (!x.person.phone) return;
    const mine = d.reminders.filter((r) => r.person.id === x.person.id);
    const lines = mine.map((r) => `• ${where(r)} — ${fmtDay(r.event.date)}, call ${fmtTime(r.event.call)}`);
    const text = `Hi ${firstName(x.person.name)}, reminder for this weekend:\n${lines.join('\n')}\n\n${mine.some((r) => !r.confirmed) ? `Please tap Confirm: ${appUrl}/#mine\n` : ''}Quick review before your shift: ${appUrl}/#resources`;
    window.open(waLink(x.person.phone, text), '_blank', 'noopener');
    await api('/weekend/reminded', { method: 'POST', body: { ids: mine.map((r) => r.id) } }).catch(() => {});
    load();
  };
  const undoRemind = async (x) => {
    const ids = d.reminders.filter((r) => r.person.id === x.person.id).map((r) => r.id);
    await api('/weekend/reminded', { method: 'POST', body: { ids, undo: true } }).catch(() => {});
    load();
  };

  const people = d ? [...new Map(d.reminders.map((r) => [r.person.id, r])).values()] : [];
  const todo = d ? d.open.length + d.unconfirmed.length + d.flags.length + d.plansMissing.length + d.pendingRequests.length + d.pendingUploads.length : 0;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Weekend check</h1>
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
        {d && d.events.length > 0 && (
          <div className={`ready ${todo ? 'ready-no' : 'ready-yes'}`} role="status">
            {todo ? `${todo} thing${todo === 1 ? '' : 's'} to sort out` : 'Ready for the weekend'}
          </div>
        )}
      </div>

      <Notices items={noticesFor(app, fri)} onEdit={canAnnounce(app) ? () => setAnnouncing(true) : null} />
      {announcing && <AnnouncementsModal friday={fri} onClose={() => setAnnouncing(false)} />}

      {error && <div className="error" role="alert">{error}</div>}
      {!d && !error && <div className="loading-inline">Loading…</div>}

      {d && d.events.length === 0 && (
        <div className="card stack">
          <h2>Nothing scheduled for {weekendLabel(fri)}</h2>
          {can.edit ? (
            <div className="row-wrap">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={copyLast}>
                Copy last weekend
              </button>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={build}>
                Build from template
              </button>
            </div>
          ) : (
            <p className="muted">A leader who edits the schedule needs to set it up.</p>
          )}
        </div>
      )}

      {d && d.events.length > 0 && (
        <div className="check-grid-cards">
          <CheckCard title="Open spots" count={d.open.length} done="Every spot is filled.">
            <ul className="check-list">
              {d.open.map((x) => (
                <li key={x.event.id + x.position}>
                  <strong>{posLabel(x.position)}</strong> · {x.event.title} <span className="muted small">{fmtDay(x.event.date)}</span>
                </li>
              ))}
            </ul>
            {can.edit && d.open.length > 0 && (
              <div className="row-wrap">
                <button type="button" className="btn btn-primary" onClick={() => setAutofill(true)}>
                  Auto-fill
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => app.goTab('schedule')}>
                  Open schedule
                </button>
              </div>
            )}
          </CheckCard>

          <CheckCard title="Not confirmed yet" count={d.unconfirmed.length} done="Everyone has confirmed.">
            <ul className="check-list">
              {d.unconfirmed.map((x) => (
                <li key={x.id}>
                  <strong>{x.person.name}</strong> · {where(x)} <span className="muted small">{fmtDay(x.event.date)}</span>
                </li>
              ))}
            </ul>
            {can.message && d.unconfirmed.length > 0 && (
              <button type="button" className="btn btn-green self-start" onClick={nudgeAll}>
                <Icon name="chat" size={16} /> Ask them to confirm
              </button>
            )}
          </CheckCard>

          <CheckCard title="Needs attention" count={d.flags.length} done="No one is double-booked or away.">
            <ul className="check-list">
              {d.flags.map((x) => (
                <li key={x.id}>
                  <strong>{x.person.name}</strong> · {where(x)} — <span className="danger">{x.flag}</span>
                </li>
              ))}
            </ul>
          </CheckCard>

          <CheckCard title="Service plans" count={d.plansMissing.length} done="Every service has songs, notes and Bible texts.">
            <ul className="check-list">
              {d.plansMissing.map((x) => (
                <li key={x.event.id}>
                  <strong>{x.event.title}</strong> needs {x.missing.join(', ')}
                </li>
              ))}
            </ul>
            {d.plansMissing.length > 0 && (
              <button type="button" className="btn btn-ghost self-start" onClick={() => app.goTab('plans')}>
                Open service plans
              </button>
            )}
          </CheckCard>

          <CheckCard title="Waiting on approval" count={d.pendingRequests.length + d.pendingUploads.length} done="Nothing waiting.">
            <ul className="check-list">
              {d.pendingRequests.map((r) => (
                <li key={r.id}>
                  {r.from}’s {r.type} request
                </li>
              ))}
              {d.pendingUploads.map((u) => (
                <li key={u.event.id}>
                  {u.count} guest upload{u.count === 1 ? '' : 's'} for {u.event.title}
                </li>
              ))}
            </ul>
            <div className="row-wrap">
              {d.pendingRequests.length > 0 && can.approve && (
                <button type="button" className="btn btn-ghost" onClick={() => app.goTab('requests')}>
                  Requests
                </button>
              )}
              {d.pendingUploads.length > 0 && can.plans && (
                <button type="button" className="btn btn-ghost" onClick={() => app.goTab('plans')}>
                  Guest uploads
                </button>
              )}
            </div>
          </CheckCard>

          <CheckCard title="Availability" count={d.availability.stale.length} done="Everyone updated in the last 30 days." note={`${d.availability.total - d.availability.stale.length} of ${d.availability.total} up to date`}>
            <p className="small muted">Not updated in 30 days:</p>
            <p className="small">{d.availability.stale.map((p) => p.name).join(', ')}</p>
            {can.message && d.availability.stale.length > 0 && (
              <button type="button" className="btn btn-green self-start" onClick={askAvailability}>
                <Icon name="chat" size={16} /> Ask them to update
              </button>
            )}
          </CheckCard>
        </div>
      )}

      {d && d.events.length > 0 && (
        <section className="card stack" aria-label="Reminders">
          <div className="section-head">
            <div>
              <h2>Reminders</h2>
              <p className="muted small">
                {d.email.configured && d.email.on
                  ? `Email reminders go out automatically ${d.email.days} day${d.email.days === 1 ? '' : 's'} before each shift.`
                  : d.email.configured
                    ? 'Email reminders are turned off in Settings.'
                    : 'Email reminders aren’t set up yet (see Settings). Use WhatsApp below.'}{' '}
                WhatsApp: tap a person to open a chat with their shifts filled in; it’s ticked off here.
              </p>
            </div>
            <span className="muted small">
              {people.filter((p) => p.waReminded).length} of {people.length} messaged
            </span>
          </div>
          {people.length === 0 && <Empty>No one is placed this weekend yet.</Empty>}
          <ul className="remind-list">
            {people.map((x) => {
              const mine = d.reminders.filter((r) => r.person.id === x.person.id);
              const sent = mine.every((r) => r.waReminded);
              const emailed = mine.every((r) => r.emailed);
              return (
                <li key={x.person.id} className={sent ? 'remind-done' : ''}>
                  <Avatar name={x.person.name} size={32} tone="light" />
                  <span className="grow col">
                    <strong>{x.person.name}</strong>
                    <span className="muted small">
                      {mine.map((r) => where(r)).join(' · ')}
                      {emailed ? ' · emailed' : ''}
                      {mine.every((r) => r.confirmed) ? ' · confirmed' : ''}
                    </span>
                  </span>
                  {sent ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => undoRemind(x)}>
                      ✓ Sent · undo
                    </button>
                  ) : x.person.phone && can.message ? (
                    <button type="button" className="btn btn-green btn-sm" onClick={() => remind(x)} title={prettyPhone(x.person.phone)}>
                      WhatsApp
                    </button>
                  ) : (
                    <span className="muted small">{x.person.phone ? '' : 'No phone'}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {d && d.events.length > 0 && (
        <section className="card stack" aria-label="Run sheets">
          <h2>Run sheets</h2>
          <p className="muted small">One page per service for the booth: crew, call times, songs, Bible texts and the pastor’s notes. Print it or open it on a phone.</p>
          <div className="row-wrap">
            {d.events.map((e) => (
              <a key={e.id} className="btn btn-outline" href={`/runsheet/${e.id}`} target="_blank" rel="noopener noreferrer">
                <Icon name="doc" size={16} /> {e.title} · {fmtDay(e.date).split(',')[0]}
              </a>
            ))}
          </div>
          {can.edit && (
            <div className="row-wrap divider-top">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={copyLast}>
                Copy last weekend’s crew into empty spots
              </button>
            </div>
          )}
        </section>
      )}

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
    </div>
  );
}

function CheckCard({ title, count, done, note, children }) {
  return (
    <section className={`card stack-sm check-card ${count ? 'check-todo' : 'check-ok'}`} aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className={`chip ${count ? 'chip-pending' : 'chip-approved'}`}>{count ? count : '✓'}</span>
      </div>
      {note && <span className="muted small">{note}</span>}
      {count ? children : <p className="good small strong">{done}</p>}
    </section>
  );
}


