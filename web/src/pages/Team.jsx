import { useEffect, useMemo, useRef, useState } from 'react';
import { api, describeRule, firstName, fmtDay, fridayOf, prettyPhone, roleLabel, todayISO, WEEK_OPTIONS } from '../lib.js';
import { Avatar, Icon, Modal, useApp } from '../ui.jsx';

const PERMS = [
  { id: 'edit', label: 'Edit the schedule', help: 'Place, move and remove people; add and edit services.' },
  { id: 'approve', label: 'Approve shift requests', help: 'Approve or deny swaps, transfers, pick-ups and drops.' },
  { id: 'message', label: 'Message the crew', help: 'Send lineups and reminders on WhatsApp; see crew phone numbers.' },
  { id: 'resources', label: 'Manage training links', help: 'Add, edit and remove quick-review resources.' },
  { id: 'people', label: 'Manage crew & positions', help: 'Invite crew, set who is trained on what, deactivate crew.' },
  { id: 'plans', label: 'Edit service plans', help: 'Write sermon notes and Bible texts, manage songs and ProPresenter files, upload media, invite guests and approve what they send.' },
  { id: 'groups', label: 'Manage outside groups', help: 'Add and edit groups like the praise team or choir, with their contacts and WhatsApp group links.' },
];

export default function Team() {
  const app = useApp();
  const { people, me, positions, posLabel } = app;
  const [selId, setSelId] = useState(people[0]?.id);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const sel = people.find((p) => p.id === selId) || people[0];
  const [load, setLoad] = useState({});
  useEffect(() => {
    api('/people/load').then(setLoad, () => {});
  }, [people]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.positions.some((k) => posLabel(k).toLowerCase().includes(q)));
  }, [people, filter, posLabel]);

  const counts = { all: people.filter((p) => p.active).length, leaders: people.filter((p) => p.active && p.role !== 'crew').length };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Team &amp; roles</h1>
          <div className="muted">
            {counts.all} active · {counts.leaders} leader{counts.leaders === 1 ? '' : 's'} (including admin)
          </div>
        </div>
        <div className="row-wrap">
          <label className="field field-inline">
            <span className="sr-only">Search people</span>
            <input type="search" placeholder="Search name or position" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Add person
          </button>
        </div>
      </div>
      <div className="split">
        <section className="card people-list main-col" aria-label="People">
          {shown.map((p) => (
            <button key={p.id} type="button" className={`person-row ${p.id === sel?.id ? 'person-on' : ''} ${p.active ? '' : 'person-off'}`} aria-pressed={p.id === sel?.id} onClick={() => setSelId(p.id)}>
              <Avatar name={p.name} size={36} />
              <span className="grow col">
                <strong>{p.name}</strong>
                <span className="muted small">{p.positions.map(posLabel).join(', ') || 'No positions yet'}</span>
                {p.active && (
                  <span className="small load-line">
                    {load[p.id]?.past90 || 0} in last 90 days · {load[p.id]?.upcoming || 0} coming up
                    {load[p.id]?.last ? ` · last ${fmtDay(load[p.id].last).split(', ')[1]}` : ''}
                    {p.maxPerMonth ? ` · max ${p.maxPerMonth}/mo` : ''}
                  </span>
                )}
                {p.active && p.regulars?.length > 0 && (
                  <span className="small regular-line">Regular: {p.regulars.map((r) => describeRule(r, posLabel).week.replace(' of the month', '')).join(', ')}</span>
                )}
              </span>
              {p.invited && p.active && <span className="chip chip-pending">Invite pending</span>}
              {!p.active && <span className="chip chip-cancelled">Inactive</span>}
              <span className={`chip role-${p.role}`}>{roleLabel(p)}</span>
            </button>
          ))}
        </section>
        {sel && <PersonPanel key={sel.id + JSON.stringify(sel)} person={sel} me={me} positions={positions} />}
      </div>
      {adding && <AddPerson onClose={() => setAdding(false)} />}
    </div>
  );
}

function PersonPanel({ person, me, positions }) {
  const app = useApp();
  const isAdmin = me.role === 'admin';
  const editable = isAdmin || person.role === 'crew' || person.id === me.id;
  const [f, setF] = useState({
    name: person.name,
    email: person.email || '',
    phone: prettyPhone(person.phone || ''),
    positions: person.positions,
    trainee: person.trainee || [],
    maxPerMonth: person.maxPerMonth ? String(person.maxPerMonth) : '',
    role: person.role,
    leaderTitle: person.leaderTitle || '',
    perms: { ...(person.perms || {}) },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(null);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const togglePos = (k) => setF({ ...f, positions: f.positions.includes(k) ? f.positions.filter((x) => x !== k) : [...f.positions, k] });
  const toggleTrainee = (k) => setF({ ...f, trainee: f.trainee.includes(k) ? f.trainee.filter((x) => x !== k) : [...f.trainee, k] });
  const togglePerm = (k) => setF({ ...f, perms: { ...f.perms, [k]: !f.perms[k] } });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { name: f.name, phone: f.phone, positions: f.positions, trainee: f.trainee, maxPerMonth: Number(f.maxPerMonth) || 0 };
      if (f.email && f.email !== person.email) body.email = f.email;
      if (isAdmin && person.role !== 'admin') {
        body.role = f.role;
        body.leaderTitle = f.leaderTitle;
        if (f.role === 'leader' && person.role === 'leader') body.perms = f.perms;
      }
      await api(`/people/${person.id}`, { method: 'PATCH', body });
      app.toast(f.role === 'leader' && person.role !== 'leader' ? `${person.name} is now a team leader — set their privileges below` : 'Saved');
      await app.reload();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const setActive = async (active) => {
    if (!active && !window.confirm(`Deactivate ${person.name}? They’ll be signed out and removed from their upcoming shifts.`)) return;
    setBusy(true);
    try {
      await api(`/people/${person.id}`, { method: 'PATCH', body: { active } });
      app.toast(active ? `${person.name} is active again` : `${person.name} was deactivated`);
      await app.reload();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const newLink = async () => {
    setBusy(true);
    try {
      setInvite(await api(`/people/${person.id}/invite`, { method: 'POST' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const isSelfAdmin = person.role === 'admin';
  const canInvite = person.active && (person.invited || isAdmin) && !(isSelfAdmin && person.id !== me.id);

  return (
    <aside className="card side stack" aria-label={`${person.name} settings`}>
      <div className="row">
        <Avatar name={person.name} size={44} />
        <div>
          <h2>{person.name}</h2>
          <div className="muted small">
            {roleLabel(person)}
            {person.phone ? ` · ${prettyPhone(person.phone)}` : ''}
          </div>
        </div>
      </div>

      {!editable && <p className="muted small">Only the admin can change team leaders.</p>}

      {editable && (
        <>
          <div className="row-wrap fields-2">
            <label className="field">
              <span>Name</span>
              <input value={f.name} onChange={set('name')} />
            </label>
            <label className="field">
              <span>Mobile (WhatsApp)</span>
              <input type="tel" value={f.phone} onChange={set('phone')} placeholder="(423) 555-0100" />
            </label>
          </div>
          {person.email !== undefined && (
            <label className="field">
              <span>Email (sign-in)</span>
              <input type="email" value={f.email} onChange={set('email')} />
            </label>
          )}
          <fieldset className="fieldset">
            <legend>Trained positions</legend>
            <div className="check-grid">
              {positions.map((p) => (
                <label key={p.key} className="check">
                  <input type="checkbox" checked={f.positions.includes(p.key)} onChange={() => togglePos(p.key)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="fieldset">
            <legend>Learning (can shadow)</legend>
            <div className="check-grid">
              {positions
                .filter((p) => !f.positions.includes(p.key))
                .map((p) => (
                  <label key={p.key} className="check">
                    <input type="checkbox" checked={f.trainee.includes(p.key)} onChange={() => toggleTrainee(p.key)} />
                    <span>{p.label}</span>
                  </label>
                ))}
            </div>
            <p className="muted small">Trainees can be added as a shadow next to the person on that position.</p>
          </fieldset>
          <label className="field field-row">
            <span className="small">Most shifts a month</span>
            <input className="key-input" type="number" min="0" max="31" value={f.maxPerMonth} onChange={set('maxPerMonth')} placeholder="Any" />
            <span className="muted small">
              {person.availabilityUpdatedAt ? `Availability updated ${new Date(person.availabilityUpdatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Availability never updated'}
            </span>
          </label>
        </>
      )}

      {isAdmin && person.role !== 'admin' && (
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Role</span>
            <select value={f.role} onChange={set('role')}>
              <option value="crew">Crew member</option>
              <option value="leader">Team leader</option>
            </select>
          </label>
          {f.role === 'leader' && (
            <label className="field">
              <span>Leader title (shown to crew)</span>
              <input value={f.leaderTitle} onChange={set('leaderTitle')} placeholder="e.g. Audio lead" />
            </label>
          )}
        </div>
      )}

      {person.role === 'leader' && f.role === 'leader' && (
        <fieldset className="fieldset fieldset-strong">
          <legend>Leader privileges</legend>
          {PERMS.map((p) => (
            <label key={p.id} className="check check-top">
              <input type="checkbox" checked={!!f.perms[p.id]} disabled={!isAdmin} onChange={() => togglePerm(p.id)} />
              <span className="col">
                <strong>{p.label}</strong>
                <span className="muted small">{p.help}</span>
              </span>
            </label>
          ))}
          {!isAdmin && <p className="muted small">Only the admin can change privileges.</p>}
        </fieldset>
      )}
      {person.role === 'admin' && <p className="muted small">The admin always has every privilege.</p>}

      {error && <div className="error" role="alert">{error}</div>}
      {editable && (
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            Save changes
          </button>
          {canInvite && (
            <button type="button" className="btn btn-outline" onClick={newLink} disabled={busy}>
              {person.invited ? 'New invite link' : 'Password reset link'}
            </button>
          )}
          {person.id !== me.id && person.role !== 'admin' && (
            <button type="button" className={`btn ${person.active ? 'btn-danger' : 'btn-ghost'}`} onClick={() => setActive(!person.active)} disabled={busy}>
              {person.active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
        </div>
      )}
      {invite && <InviteLink person={{ ...person, name: f.name, phone: f.phone }} url={invite.inviteUrl} reset={invite.reset} />}
      {editable && person.active && person.regulars && <Regulars person={person} />}
    </aside>
  );
}

function InviteLink({ person, url, reset }) {
  const app = useApp();
  const text = reset
    ? `Hi ${firstName(person.name)}, here’s a link to set a new Crew Call password (works for 14 days): ${url}`
    : `Hi ${firstName(person.name)}, you’ve been added to ${app.settings.orgName} on Crew Call — that’s where you’ll see your AV shifts, swap them and find training links. Set your password here (works for 14 days): ${url}`;
  return (
    <div className="current-box stack-sm">
      <div className="label-sm">{reset ? 'Password reset link' : 'Invite link'}</div>
      <div className="code-box mono">{url}</div>
      <div className="row-wrap">
        <button type="button" className="btn btn-green" onClick={() => app.openWa({ title: `Send to ${person.name}`, text, recipients: [person], groupLink: '' })}>
          Send on WhatsApp
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigator.clipboard.writeText(url).then(() => app.toast('Link copied'), () => app.toast('Select the link and copy it'))}
        >
          Copy link
        </button>
      </div>
    </div>
  );
}

function AddPerson({ onClose }) {
  const app = useApp();
  const [f, setF] = useState({ name: '', email: '', phone: '', positions: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const togglePos = (k) => setF({ ...f, positions: f.positions.includes(k) ? f.positions.filter((x) => x !== k) : [...f.positions, k] });

  // Refresh the team list once the dialog closes, if anyone was added.
  const added = useRef(false);
  const reload = useRef(app.reload);
  useEffect(() => () => added.current && reload.current(), []);
  useEffect(() => {
    if (done) added.current = true;
  }, [done]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDone(await api('/people', { method: 'POST', body: f }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={done ? `${done.person.name} was added` : 'Add a person'} onClose={onClose}>
      {done ? (
        <div className="stack">
          <p className="muted">Send them this link to set their password. They’ll show up on the schedule right away; the invite works for 14 days.</p>
          <InviteLink person={done.person} url={done.inviteUrl} />
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={() => { setDone(null); setF({ name: '', email: '', phone: '', positions: [] }); }}>
              Add another
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>Name</span>
            <input required value={f.name} onChange={set('name')} autoComplete="off" />
          </label>
          <label className="field">
            <span>Email (they sign in with this)</span>
            <input type="email" required value={f.email} onChange={set('email')} autoComplete="off" />
          </label>
          <label className="field">
            <span>Mobile (for WhatsApp)</span>
            <input type="tel" value={f.phone} onChange={set('phone')} placeholder="(423) 555-0100" />
          </label>
          <fieldset className="fieldset">
            <legend>Trained positions</legend>
            <div className="check-grid">
              {app.positions.map((p) => (
                <label key={p.key} className="check">
                  <input type="checkbox" checked={f.positions.includes(p.key)} onChange={() => togglePos(p.key)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <div className="error" role="alert">{error}</div>}
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy}>
              Add and get invite link
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// Regular commitments: e.g. "2nd Sabbath of the month · Worship Service · any of their positions".
// Auto-fill places regulars first; leaders can still move them to a different job any week.
function Regulars({ person }) {
  const app = useApp();
  const { posLabel, settings } = app;
  const [list, setList] = useState(person.regulars || []);
  const [f, setF] = useState({ week: '2', service: '', positions: [], anchor: fridayOf(todayISO()) });
  const [busy, setBusy] = useState(false);
  const services = [...new Set(settings.weekendTemplate.filter((t) => (t.kind || 'service') === 'service').map((t) => t.title))];

  const save = async (next, msg) => {
    setBusy(true);
    try {
      await api(`/people/${person.id}`, { method: 'PATCH', body: { regulars: next.map(({ id, ...r }) => r) } });
      setList(next);
      app.toast(msg);
      await app.reload();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const togglePos = (k) => setF({ ...f, positions: f.positions.includes(k) ? f.positions.filter((x) => x !== k) : [...f.positions, k] });

  return (
    <fieldset className="fieldset">
      <legend>Regular schedule</legend>
      <p className="muted small">For people who serve on a pattern. Auto-fill places them first; their job can change week to week, and you can still move them by hand.</p>
      {list.length === 0 && <p className="small muted">No regular schedule.</p>}
      <ul className="req-mini">
        {list.map((r, i) => {
          const d = describeRule(r, posLabel);
          return (
            <li key={r.id || i}>
              <span className="grow">
                <strong>{d.week}</strong>
                <span className="small muted">
                  {d.svc} · {d.pos}
                  {r.week === 'alt' && r.anchor ? ` · starting ${fmtDay(r.anchor)}` : ''}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(list.filter((_, j) => j !== i), 'Removed from their regular schedule')}>
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <div className="stack-sm divider-top">
        <div className="row-wrap fields-2">
          <label className="field">
            <span>When</span>
            <select value={f.week} onChange={(e) => setF({ ...f, week: e.target.value })}>
              {WEEK_OPTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Service</span>
            <select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>
              <option value="">Any service that weekend</option>
              {services.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        {f.week === 'alt' && (
          <label className="field">
            <span>Starting the weekend of</span>
            <input type="date" value={f.anchor} onChange={(e) => setF({ ...f, anchor: e.target.value ? fridayOf(e.target.value) : f.anchor })} />
          </label>
        )}
        <div className="small strong">Job</div>
        <div className="check-grid">
          {person.positions.map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={f.positions.includes(k)} onChange={() => togglePos(k)} />
              <span>{posLabel(k)}</span>
            </label>
          ))}
        </div>
        <p className="muted small">Leave all unticked to use whichever of their positions is open (their job changes up). Tick some to limit it; the first ticked is preferred.</p>
        <button
          type="button"
          className="btn btn-outline self-start"
          disabled={busy || !person.positions.length}
          onClick={() => save([...list, { week: f.week, service: f.service, positions: f.positions.filter((k) => person.positions.includes(k)), anchor: f.week === 'alt' ? f.anchor : '' }], `Added: ${describeRule(f, posLabel).week}`)}
        >
          Add to regular schedule
        </button>
        {!person.positions.length && <p className="small danger">Give them a trained position first.</p>}
      </div>
    </fieldset>
  );
}
