// Shared pieces for the Church Admin side: item types and colors, committee pickers, the
// add/change dialog for calendar items (repeats, committees, sharing, rooms, Needs AV), and the
// detail view with RSVPs and the bulletin request.
import { useEffect, useMemo, useState } from 'react';
import { addDays, api, fmtDate, fmtDay, fmtTime, todayISO } from './lib.js';
import { Icon, Modal, useApp } from './ui.jsx';

export const TYPES = {
  board: { label: 'Board meeting', color: 'blue' },
  business: { label: 'Business meeting', color: 'purple' },
  committee: { label: 'Committee meeting', color: 'green' },
  deadline: { label: 'Deadline', color: 'red' },
  event: { label: 'Church event', color: 'orange' },
  other: { label: 'Other', color: 'gray' },
};
export const MEETING_TYPES = ['board', 'business', 'committee'];
export const COMMITTEE_COLORS = ['blue', 'green', 'purple', 'orange', 'red', 'yellow', 'teal', 'gray'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sabbath'];
const NTH = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', '-1': 'last' };

export function TypeChip({ type }) {
  const t = TYPES[type] || TYPES.other;
  return <span className={`chip oc oc-${t.color}`}>{t.label}</span>;
}
export function committeeName(app, key) {
  return (app.committees || []).find((c) => c.key === key)?.name || key;
}
export function CommitteeChips({ keys = [], shared = [] }) {
  const app = useApp();
  if (!keys.length && !shared.length) return <span className="chip oc oc-gray">Whole team</span>;
  return (
    <>
      {keys.map((k) => {
        const c = (app.committees || []).find((x) => x.key === k);
        return (
          <span key={k} className={`chip oc oc-${c?.color || 'gray'}`}>
            {c?.name || k}
          </span>
        );
      })}
      {shared.map((k) => (
        <span key={`s${k}`} className="chip oc oc-gray" title="Shared with this committee to read">
          ↳ {committeeName(app, k)}
        </span>
      ))}
    </>
  );
}
export function whenText(e) {
  if (e.allDay || !e.start) return `${fmtDay(e.date)} · all day`;
  return `${fmtDay(e.date)} · ${fmtTime(e.start)}${e.end ? `–${fmtTime(e.end)}` : ''}`;
}
export const isHead = (app) => !!app.me.head;
export const myCommittees = (app) => app.me.committees || [];

// Checkboxes for committees. own: only the ones they sit on (the head and admin can pick any).
export function CommitteePicker({ value, onChange, legend, hint, own, exclude = [] }) {
  const app = useApp();
  const list = (app.committees || []).filter((c) => !exclude.includes(c.key) && (!own || isHead(app) || myCommittees(app).includes(c.key)));
  if (!list.length) return null;
  const toggle = (k) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      <div className="check-grid">
        {list.map((c) => (
          <label key={c.key} className="check">
            <input type="checkbox" checked={value.includes(c.key)} onChange={() => toggle(c.key)} />
            <span>{c.name}</span>
          </label>
        ))}
      </div>
      {hint && <p className="muted small">{hint}</p>}
    </fieldset>
  );
}

// ---------- add / change a calendar item ----------
function repeatOptions(date) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay();
  const nth = Math.ceil(d.getUTCDate() / 7);
  const lastWeek = d.getUTCDate() + 7 > new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return [
    { value: '', label: 'Doesn’t repeat' },
    { value: 'weekly', label: `Every week on ${WEEKDAYS[wd]}` },
    ...(nth <= 4 ? [{ value: 'monthly-nth', label: `Monthly on the ${NTH[nth]} ${WEEKDAYS[wd]}`, nth, weekday: wd }] : []),
    ...(lastWeek ? [{ value: 'monthly-last', label: `Monthly on the last ${WEEKDAYS[wd]}`, nth: -1, weekday: wd }] : []),
    { value: 'monthly-day', label: `Monthly on day ${d.getUTCDate()}` },
    { value: 'yearly', label: `Every year on ${fmtDate(date).replace(/, \d{4}$/, '')}` },
  ];
}

export function EventModal({ event, defaults = {}, onClose, onSaved }) {
  const app = useApp();
  const isNew = !event;
  const rooms = app.office?.rooms || [];
  const start = event || { type: 'committee', title: '', date: todayISO(), start: '19:00', end: '20:00', allDay: false, room: '', notes: '', visibility: 'office', committees: isHead(app) ? [] : myCommittees(app).slice(0, 1), sharedWith: [], attendees: [], needsAv: false, avNote: '', ...defaults };
  const [f, setF] = useState({ ...start, attendees: (start.attendees || []).map((a) => ({ user: a.id || a.user, role: a.role || '' })) });
  const [repeat, setRepeat] = useState({ kind: '', interval: 1, until: '' });
  const [scope, setScope] = useState('one');
  const [inviteSome, setInviteSome] = useState((start.attendees || []).length > 0);
  const [conflicts, setConflicts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const reps = useMemo(() => repeatOptions(f.date || todayISO()), [f.date]);

  // What else uses the room then
  useEffect(() => {
    if (!f.room || !f.date) return setConflicts([]);
    const t = setTimeout(() => {
      const q = new URLSearchParams({ date: f.date, room: f.room, ...(f.allDay ? {} : { start: f.start || '', end: f.end || '' }), ...(event ? { except: event.id } : {}) });
      api(`/office/rooms/check?${q}`).then((r) => setConflicts(r.conflicts), () => setConflicts([]));
    }, 300);
    return () => clearTimeout(t);
  }, [f.room, f.date, f.start, f.end, f.allDay, event]);

  const members = app.people.filter((p) => p.active);
  const toggleInvite = (id) => setF({ ...f, attendees: f.attendees.some((a) => a.user === id) ? f.attendees.filter((a) => a.user !== id) : [...f.attendees, { user: id, role: '' }] });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, attendees: inviteSome ? f.attendees : [] };
      delete body.id;
      let out;
      if (isNew) {
        const opt = reps.find((r) => r.value === repeat.kind);
        if (repeat.kind) body.repeat = { freq: repeat.kind === 'monthly-last' ? 'monthly-nth' : repeat.kind, interval: Number(repeat.interval) || 1, until: repeat.until, nth: opt?.nth, weekday: opt?.weekday };
        out = await api('/office/events', { method: 'POST', body });
      } else out = await api(`/office/events/${event.id}?scope=${scope}`, { method: 'PATCH', body });
      app.toast(isNew ? (repeat.kind ? 'Added, with its repeats' : 'Added') : 'Saved');
      onSaved(out);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    const many = event.series && scope === 'future';
    if (!window.confirm(many ? `Remove “${event.title}” on ${fmtDay(event.date)} and every later date?` : `Remove “${event.title}” on ${fmtDay(event.date)}?`)) return;
    setBusy(true);
    try {
      await api(`/office/events/${event.id}?scope=${many ? 'future' : 'one'}`, { method: 'DELETE' });
      app.toast('Removed');
      onSaved(null);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add to the calendar' : `Change “${event.title}”`} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Name</span>
            <input required maxLength={120} value={f.title} onChange={set('title')} placeholder="e.g. Church board" />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={f.type} onChange={set('type')}>
              {Object.entries(TYPES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row-wrap fields-4">
          <label className="field">
            <span>Date</span>
            <input type="date" required value={f.date} onChange={set('date')} disabled={!isNew && event.series && scope === 'future'} />
          </label>
          {!f.allDay && (
            <>
              <label className="field">
                <span>Starts</span>
                <input type="time" required value={f.start} onChange={set('start')} />
              </label>
              <label className="field">
                <span>Ends</span>
                <input type="time" value={f.end} onChange={set('end')} />
              </label>
            </>
          )}
          <label className="check self-end">
            <input type="checkbox" checked={f.allDay} onChange={set('allDay')} />
            <span>All day</span>
          </label>
        </div>

        {isNew ? (
          <div className="row-wrap fields-3">
            <label className="field">
              <span>Repeats</span>
              <select value={repeat.kind} onChange={(e) => setRepeat({ ...repeat, kind: e.target.value })}>
                {reps.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            {repeat.kind && (
              <>
                <label className="field">
                  <span>Every</span>
                  <select value={repeat.interval} onChange={(e) => setRepeat({ ...repeat, interval: e.target.value })}>
                    {[1, 2, 3, 4, 6, 12].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'time' : `${n} ${repeat.kind === 'weekly' ? 'weeks' : repeat.kind === 'yearly' ? 'years' : 'months'}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Until (optional)</span>
                  <input type="date" value={repeat.until} min={f.date} onChange={(e) => setRepeat({ ...repeat, until: e.target.value })} />
                </label>
              </>
            )}
          </div>
        ) : (
          event.series && (
            <fieldset className="field">
              <legend>{event.repeat || 'This repeats'}. Change…</legend>
              <div className="row-wrap">
                <label className="check">
                  <input type="radio" name="scope" checked={scope === 'one'} onChange={() => setScope('one')} />
                  <span>Only {fmtDay(event.date)}</span>
                </label>
                <label className="check">
                  <input type="radio" name="scope" checked={scope === 'future'} onChange={() => setScope('future')} />
                  <span>This and every later date</span>
                </label>
              </div>
            </fieldset>
          )
        )}

        <div className="row-wrap fields-2">
          <label className="field">
            <span>Room</span>
            <input list="office-rooms" value={f.room} onChange={set('room')} placeholder="e.g. Board room" maxLength={80} />
            <datalist id="office-rooms">
              {rooms.map((r) => (
                <option key={r.name} value={r.name} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Notes</span>
            <input value={f.notes} onChange={set('notes')} maxLength={2000} placeholder="Anything people should know" />
          </label>
        </div>
        {conflicts.length > 0 && (
          <div className="warn-box small" role="status">
            <strong>{f.room} is busy that day:</strong> {conflicts.map((c) => `${c.what} ${c.allDay || !c.start ? '(all day)' : `${fmtTime(c.start)}–${fmtTime(c.end)}`}`).join(' · ')}
          </div>
        )}

        <CommitteePicker
          own
          value={f.committees}
          onChange={(v) => setF({ ...f, committees: v, sharedWith: f.sharedWith.filter((k) => !v.includes(k)) })}
          legend="Whose is it?"
          hint={f.committees.length ? `Only ${f.committees.length > 1 ? 'these committees' : 'this committee'} (and the head leader) can see it. Tick more than one for a joint meeting.` : 'Nothing ticked: everyone on Church Admin can see it.'}
        />
        {f.committees.length > 0 && (
          <CommitteePicker value={f.sharedWith} onChange={(v) => setF({ ...f, sharedWith: v })} exclude={f.committees} legend="Pass it down: let other committees see it (read only)" />
        )}
        <label className="check check-top">
          <input type="checkbox" checked={f.visibility === 'everyone'} onChange={(e) => setF({ ...f, visibility: e.target.checked ? 'everyone' : 'office' })} />
          <span>
            <strong>Share with every team</strong>
            <span className="muted small block">The AV and Praise teams see it on their schedule and in their calendars. Leave it off for board and committee business.</span>
          </span>
        </label>

        <label className="check check-top">
          <input type="checkbox" checked={inviteSome} onChange={(e) => setInviteSome(e.target.checked)} />
          <span>
            <strong>Only invite certain people</strong>
            <span className="muted small block">Otherwise everyone it’s for is invited and can say whether they’ll be there.</span>
          </span>
        </label>
        {inviteSome && (
          <div className="invite-list">
            {members.map((p) => {
              const a = f.attendees.find((x) => x.user === p.id);
              return (
                <div key={p.id} className="row-wrap tight">
                  <label className="check grow">
                    <input type="checkbox" checked={!!a} onChange={() => toggleInvite(p.id)} />
                    <span>{p.name}</span>
                  </label>
                  {a && <input aria-label={`${p.name}’s role`} className="input-sm" placeholder="Role (e.g. Chair)" value={a.role} maxLength={40} onChange={(e) => setF({ ...f, attendees: f.attendees.map((x) => (x.user === p.id ? { ...x, role: e.target.value } : x)) })} />}
                </div>
              );
            })}
          </div>
        )}

        {!f.allDay && (
          <label className="check check-top">
            <input type="checkbox" checked={f.needsAv} onChange={set('needsAv')} />
            <span>
              <strong>Needs AV</strong>
              <span className="muted small block">Puts it on the AV team’s schedule (crew arrive 30 minutes early) so they can staff it. It follows any change you make here.</span>
            </span>
          </label>
        )}
        {f.needsAv && !f.allDay && (
          <label className="field">
            <span>What do you need from AV?</span>
            <input value={f.avNote} onChange={set('avNote')} maxLength={300} placeholder="e.g. Two handheld mics and the projector" />
          </label>
        )}

        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap spread">
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy}>
              {isNew ? 'Add' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {!isNew && (
            <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
              {event.series && scope === 'future' ? 'Remove this and later dates' : 'Remove'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------- one item: details, RSVP, bulletin, link to the meeting ----------
export function EventDetail({ id, onClose, onChanged, onOpenMeeting }) {
  const app = useApp();
  const [ev, setEv] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const load = () => api(`/office/events/${id}`).then(setEv, (e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (editing)
    return (
      <EventModal
        event={ev}
        onClose={() => setEditing(false)}
        onSaved={(out) => {
          onChanged?.();
          if (!out) return onClose();
          setEditing(false);
          setEv(out);
        }}
      />
    );
  const rsvp = async (status) => {
    try {
      await api(`/office/events/${id}/rsvp`, { method: 'PUT', body: { status } });
      await load();
      onChanged?.();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const going = ev?.audience.filter((a) => a.rsvp === 'yes').length || 0;
  const meeting = ev && (MEETING_TYPES.includes(ev.type) || ev.agenda.length || ev.minutes);
  const invited = ev?.audience.some((a) => a.id === app.me.id && a.invited);
  return (
    <Modal title={ev ? ev.title : 'Loading…'} onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      {ev && (
        <div className="stack">
          <div className="row-wrap tight">
            <TypeChip type={ev.type} />
            <CommitteeChips keys={ev.committees} shared={ev.sharedWith} />
            {ev.visibility === 'everyone' && <span className="chip oc oc-teal">Shared with every team</span>}
            {ev.needsAv && <span className="chip oc oc-orange">AV asked</span>}
          </div>
          <div>
            <div className="strong">{whenText(ev)}</div>
            {ev.room && <div className="muted">{ev.room}</div>}
            {ev.repeat && <div className="muted small">Repeats: {ev.repeat}</div>}
          </div>
          {ev.notes && <p className="pre-wrap">{ev.notes}</p>}
          {ev.needsAv && ev.avNote && <p className="small">For AV: {ev.avNote}</p>}

          {invited && (
            <div className="stack-sm">
              <strong>Will you be there?</strong>
              <div className="row-wrap" role="group" aria-label="Will you be there?">
                {[
                  ['yes', 'Yes'],
                  ['maybe', 'Maybe'],
                  ['no', 'Can’t make it'],
                ].map(([k, label]) => (
                  <button key={k} type="button" className={`btn ${ev.myRsvp === k ? 'btn-primary' : 'btn-outline'}`} aria-pressed={ev.myRsvp === k} onClick={() => rsvp(ev.myRsvp === k ? '' : k)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {ev.audience.length > 0 && (
            <details>
              <summary>
                Who’s invited ({ev.audience.filter((a) => a.invited).length}) · {going} coming
                {ev.quorum > 0 && (
                  <span className={going >= ev.quorum ? 'ok-text' : 'danger'}>
                    {' '}
                    · quorum {ev.quorum} {going >= ev.quorum ? '✓' : 'not yet'}
                  </span>
                )}
              </summary>
              <ul className="plain-list small">
                {ev.audience
                  .filter((a) => a.invited)
                  .map((a) => (
                    <li key={a.id}>
                      {a.name}
                      {ev.attendees.find((x) => x.id === a.id)?.role ? ` · ${ev.attendees.find((x) => x.id === a.id).role}` : ''} — <span className="muted">{{ yes: 'coming', no: 'can’t make it', maybe: 'maybe' }[a.rsvp] || 'no answer'}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}

          {ev.canEdit && ev.visibility === 'everyone' && <BulletinRequest ev={ev} onSaved={setEv} />}

          <div className="row-wrap">
            {meeting && (
              <button type="button" className="btn btn-primary" onClick={() => onOpenMeeting?.(ev.id)}>
                <Icon name="doc" size={16} /> Agenda &amp; minutes
              </button>
            )}
            {ev.canEdit && (
              <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}>
                <Icon name="edit" size={16} /> Change
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function BulletinRequest({ ev, onSaved }) {
  const app = useApp();
  const [services, setServices] = useState(null);
  const [f, setF] = useState({ service: ev.bulletin?.service || '', text: ev.bulletin?.text || '' });
  useEffect(() => {
    api('/office/services').then(setServices, () => setServices([]));
  }, []);
  const status = ev.bulletin?.status;
  const send = async (body) => {
    try {
      onSaved(await api(`/office/events/${ev.id}/bulletin`, { method: 'PUT', body }));
      app.toast(body.service ? 'Sent to the service plan leaders' : 'Taken back');
    } catch (e) {
      app.toast(e.message);
    }
  };
  return (
    <details className="card-sunk stack-sm" open={!!status}>
      <summary>
        <strong>Announce it in a service bulletin</strong>
        {status && <span className="muted small"> · {{ pending: 'waiting for the plan leaders', added: 'added to the bulletin', declined: 'declined' }[status]}</span>}
      </summary>
      {status === 'pending' || status === 'added' ? (
        <div className="stack-sm">
          <p className="small">{ev.bulletin.text || 'The name, date, time and room.'}</p>
          {status === 'pending' && (
            <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => send({ service: '' })}>
              Take it back
            </button>
          )}
        </div>
      ) : (
        <div className="stack-sm">
          <label className="field">
            <span>Which service?</span>
            <select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>
              <option value="">Pick a service…</option>
              {(services || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {fmtDay(s.date)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Announcement (optional)</span>
            <textarea rows={2} maxLength={1000} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder={`${ev.title} — ${fmtDay(ev.date)}${ev.start ? `, ${fmtTime(ev.start)}` : ''}${ev.room ? `, ${ev.room}` : ''}`} />
          </label>
          <button type="button" className="btn btn-outline btn-sm self-start" disabled={!f.service} onClick={() => send(f)}>
            Send to the plan leaders
          </button>
        </div>
      )}
    </details>
  );
}

// ---------- the calendar feed card ----------
export function CalendarFeedCard() {
  const app = useApp();
  const { me } = app;
  const webcal = me.calUrl.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  return (
    <section className="card stack" aria-label="Calendar feed">
      <div className="row">
        <Icon name="cal" size={22} />
        <h2>Your calendar feed</h2>
      </div>
      <p className="muted small">Subscribe once. Your committees’ meetings come with reminders; deadlines and church events show too. Shifts on any other team you’re on are in the same feed.</p>
      <div className="code-box mono">{me.calUrl}</div>
      <div className={`row-wrap ${me.previewing ? 'preview-off' : ''}`}>
        <a className="btn btn-outline" href={webcal}>
          Apple Calendar
        </a>
        <a className="btn btn-outline" href={google} target="_blank" rel="noopener noreferrer">
          Google Calendar
        </a>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigator.clipboard.writeText(me.calUrl).then(() => app.toast('Feed link copied'), () => app.toast('Select the link and copy it'))}
        >
          <Icon name="copy" size={16} /> Copy link
        </button>
      </div>
    </section>
  );
}

// "Dec 8" style label for a range header
export function rangeLabel(from, to) {
  if (from === to) return fmtDay(from);
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}
export { addDays };

// ---------- for the AV and Praise side ----------
// Church events Church Admin shared with every team, around the weekend shown, and a way to ask
// Church Admin for an event or a room.
export function ChurchEvents({ from, to }) {
  const [list, setList] = useState(null);
  const [asking, setAsking] = useState(false);
  const [mine, setMine] = useState([]);
  useEffect(() => {
    api(`/office/shared?from=${from}&to=${to}`).then(setList, () => setList([]));
    api('/office/requests/mine').then(setMine, () => setMine([]));
  }, [from, to]);
  const waiting = mine.filter((r) => r.status === 'pending').length;
  return (
    <section className="church-strip" aria-label="Church events">
      <div className="row-wrap spread">
        <strong className="small">
          <Icon name="cal" size={16} /> Church events
        </strong>
        <span className="row-wrap tight">
          {waiting > 0 && <span className="muted small">{waiting} request{waiting === 1 ? '' : 's'} waiting</span>}
          <button type="button" className="link-btn small" onClick={() => setAsking(true)}>
            Ask Church Admin for an event or room
          </button>
        </span>
      </div>
      {list && list.length === 0 && <span className="muted small">Nothing shared for these days.</span>}
      {list?.map((e) => (
        <div key={e.id} className="small church-item">
          <span className={`ov-dot oc-${TYPES[e.type]?.color || 'gray'}`} aria-hidden="true" /> <strong>{e.title}</strong> · {whenText(e)}
          {e.room ? ` · ${e.room}` : ''}
        </div>
      ))}
      {asking && <RequestEventModal mine={mine} onClose={() => setAsking(false)} onSent={(r) => (setMine([r, ...mine]), setAsking(false))} />}
    </section>
  );
}

export function RequestEventModal({ mine = [], onClose, onSent }) {
  const app = useApp();
  const [f, setF] = useState({ title: '', date: addDays(todayISO(), 7), start: '', end: '', room: '', people: '', notes: '', needsAv: false });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const send = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/office/requests', { method: 'POST', body: { ...f, people: Number(f.people) || 0 } });
      app.toast(r.meetingDate ? `Sent. The church board will look at it on ${fmtDate(r.meetingDate)}.` : 'Sent. The church board will look at it at its next meeting.');
      onSent(r);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title="Ask for a church event or room" onClose={onClose}>
      <form className="stack" onSubmit={send}>
        <p className="muted small">It goes on the agenda for the next church board meeting. You’ll see the answer here and get an email.</p>
        <label className="field">
          <span>What is it?</span>
          <input required maxLength={120} value={f.title} onChange={set('title')} placeholder="e.g. Youth movie night" />
        </label>
        <div className="row-wrap fields-3">
          <label className="field">
            <span>Date</span>
            <input type="date" required min={todayISO()} value={f.date} onChange={set('date')} />
          </label>
          <label className="field">
            <span>From</span>
            <input type="time" value={f.start} onChange={set('start')} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="time" value={f.end} onChange={set('end')} />
          </label>
        </div>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Room (optional)</span>
            <input value={f.room} maxLength={80} onChange={set('room')} placeholder="e.g. Fellowship hall" />
          </label>
          <label className="field">
            <span>About how many people?</span>
            <input type="number" inputMode="numeric" min="0" max="5000" value={f.people} onChange={set('people')} />
          </label>
        </div>
        <label className="field">
          <span>Anything else</span>
          <textarea rows={3} maxLength={1000} value={f.notes} onChange={set('notes')} />
        </label>
        {f.start && (
          <label className="check">
            <input type="checkbox" checked={f.needsAv} onChange={set('needsAv')} />
            <span>It needs AV (sound, projector, livestream)</span>
          </label>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary self-start">Send request</button>
        {mine.length > 0 && (
          <details>
            <summary className="small">Your requests ({mine.length})</summary>
            <ul className="plain-list small">
              {mine.map((r) => (
                <li key={r.id}>
                  {r.title} · {fmtDate(r.date)} — {{ pending: 'waiting', approved: 'approved', declined: 'declined' }[r.status]}
                  {r.reply ? `: “${r.reply}”` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </form>
    </Modal>
  );
}
