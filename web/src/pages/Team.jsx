import { useEffect, useMemo, useRef, useState } from 'react';
import { api, describeRule, firstName, fmtDay, fridayOf, prettyPhone, roleLabel, todayISO, WEEK_OPTIONS } from '../lib.js';
import { Avatar, Icon, Modal, useApp } from '../ui.jsx';
import { featureOn, SignOffHistory } from './Extras.jsx';

const PERMS = [
  { id: 'edit', label: 'Edit the schedule', help: 'Place, move and remove people; add and edit services.' },
  { id: 'approve', label: 'Approve shift requests', help: 'Approve or deny swaps, transfers, pick-ups and drops.' },
  { id: 'message', label: 'Message the crew', help: 'Send lineups and reminders on WhatsApp; see crew phone numbers.' },
  { id: 'resources', label: 'Manage training links', help: 'Add, edit and remove quick-review resources.' },
  { id: 'people', label: 'Manage crew & positions', help: 'Invite crew, set who is trained on what, deactivate crew.' },
  { id: 'plans', label: 'Lead service plans', help: 'Set the sermon, speaker, pastor’s notes and order of service; send quick links and approve late changes. (Everyone on the team can add songs, Bible texts, chord notes and slides.)' },
  { id: 'groups', label: 'Manage outside groups', help: 'Add and edit outside groups like a visiting band or choir, with their contacts and WhatsApp group links.', av: true },
  { id: 'vault', label: 'Keep the vault', help: 'See and change the team’s passwords and keys (stream keys, ProPresenter licenses, logins) on Notes & vault, and give others time in it.' },
];
// The same privileges, worded for Church Admin
const OFFICE_PERMS = [
  { id: 'edit', label: 'Schedule meetings and events', help: 'Add and change items on the Church Admin calendar for their committees.' },
  { id: 'plans', label: 'Lead planning', help: 'Write and send agendas, set goals and the yearly calendar, open minutes to anyone, and approve minutes.' },
  { id: 'approve', label: 'Approve event requests', help: 'Approve or decline church events and rooms people ask for.' },
  { id: 'message', label: 'Message the team', help: 'Send messages on WhatsApp; see people’s phone numbers.' },
  { id: 'resources', label: 'Manage documents', help: 'Add and remove documents, policies, forms and resources.' },
  { id: 'people', label: 'Manage people & committees', help: 'Invite people, set committees and offices, and help with sign-in.' },
  { id: 'vault', label: 'Keep the vault', help: 'See and change Church Admin’s passwords and accounts on Notes & vault, and give others time in it. Only people on Church Admin can ever see it, not the Crew Call admin.' },
];
const permsFor = (app) => (app.isOffice ? OFFICE_PERMS : PERMS.filter((p) => !p.av || app.isAv));

export default function Team() {
  const app = useApp();
  const { people, me, positions, posLabel, team, isAv } = app;
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
    const committee = (k) => (app.committees || []).find((c) => c.key === k)?.name || k;
    return people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.positions.some((k) => posLabel(k).toLowerCase().includes(q)) || (p.committees || []).some((k) => committee(k).toLowerCase().includes(q)));
  }, [people, filter, posLabel, app.committees]);

  const counts = { all: people.filter((p) => p.active).length, leaders: people.filter((p) => p.active && p.role !== 'crew').length };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Team &amp; roles</h1>
          <div className="muted">
            {team.name} · {counts.all} active · {counts.leaders} leader{counts.leaders === 1 ? '' : 's'}
          </div>
        </div>
        <div className="row-wrap">
          <label className="field field-inline">
            <span className="sr-only">Search people</span>
            <input type="search" placeholder={app.isOffice ? 'Search name or committee' : 'Search name or position'} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          {(app.addTo?.length > 0 || (!app.isOffice && app.can?.people)) && (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> {app.isOffice ? 'Ask someone to join' : 'Add or ask someone'}
            </button>
          )}
        </div>
      </div>
      {app.isOffice && app.seesRoster && <AskedList />}
      {app.isOffice && !app.seesRoster && <p className="muted small">You see the people on your committees and the team’s leaders. Who else is on Church Admin is kept private.</p>}
      <div className="split">
        <section className="card people-list main-col" aria-label="People">
          {shown.map((p) => (
            <button key={p.id} type="button" className={`person-row ${p.id === sel?.id ? 'person-on' : ''} ${p.active ? '' : 'person-off'}`} aria-pressed={p.id === sel?.id} onClick={() => setSelId(p.id)}>
              <Avatar name={p.name} size={36} />
              <span className="grow col">
                <strong>{p.name}</strong>
                {app.isOffice ? (
                  <span className="muted small">
                    {[...(p.offices || []).map((o) => `${o.role}${o.committee ? ` (${(app.committees || []).find((c) => c.key === o.committee)?.name || o.committee})` : ''}`), ...(p.committees || []).map((k) => (app.committees || []).find((c) => c.key === k)?.name || k)].join(' · ') || 'No committees yet'}
                  </span>
                ) : (
                  <span className="muted small">{p.positions.map(posLabel).join(', ') || 'No positions yet'}</span>
                )}
                {p.active && !app.isOffice && (
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
              {p.active && isAv && app.settings.burnoutWeeks > 0 && load[p.id]?.streak >= app.settings.burnoutWeeks && (
                <span className="chip chip-pending" title="Burnout watch: consider giving them a weekend off, or say thanks">
                  {load[p.id].streak} weekends in a row
                </span>
              )}
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
  // The admin and the team's head leader change leaders and roles; only the admin changes the head
  const canRoles = !!me.head && (isAdmin || !person.head);
  const editable = canRoles || person.role === 'crew' || person.id === me.id;
  const otherTeams = (person.teams || []).filter((k) => k !== app.team.key);
  const [f, setF] = useState({
    name: person.name,
    email: person.email || '',
    phone: prettyPhone(person.phone || ''),
    positions: person.positions,
    trainee: person.trainee || [],
    leads: person.leads || [],
    maxPerMonth: person.maxPerMonth ? String(person.maxPerMonth) : '',
    role: person.role,
    leaderTitle: person.leaderTitle || '',
    perms: { ...(person.perms || {}) },
    committees: person.committees || [],
    offices: (person.offices || []).map((o) => ({ ...o })),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(null);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const togglePos = (k) => setF({ ...f, positions: f.positions.includes(k) ? f.positions.filter((x) => x !== k) : [...f.positions, k] });
  const toggleLead = (k) => setF({ ...f, leads: f.leads.includes(k) ? f.leads.filter((x) => x !== k) : [...f.leads, k] });
  const toggleTrainee = (k) => setF({ ...f, trainee: f.trainee.includes(k) ? f.trainee.filter((x) => x !== k) : [...f.trainee, k] });
  const togglePerm = (k) => setF({ ...f, perms: { ...f.perms, [k]: !f.perms[k] } });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = app.isOffice ? { name: f.name, phone: f.phone } : { name: f.name, phone: f.phone, positions: f.positions, trainee: f.trainee, leads: f.leads.filter((k) => f.positions.includes(k)), maxPerMonth: Number(f.maxPerMonth) || 0 };
      if (app.isOffice && app.can.people) {
        body.committees = f.committees;
        body.offices = f.offices.filter((o) => o.role.trim());
      }
      if (f.email && f.email !== person.email) body.email = f.email;
      if (canRoles && person.role !== 'admin' && person.id !== me.id) {
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

  const takeOff = async () => {
    if (!window.confirm(`Take ${person.name} off the ${app.team.name}? They’ll come off the team’s upcoming spots but keep their login${otherTeams.length ? ` and their place on the ${otherTeams.map(app.teamName).join(' and ')}` : ''}.`)) return;
    setBusy(true);
    try {
      await api(`/people/${person.id}`, { method: 'PATCH', body: { onTeam: false } });
      app.toast(`${person.name} is off the ${app.team.name}`);
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

  const signOutPerson = async () => {
    if (!window.confirm(`Sign ${person.name} out on all their devices? They can sign in again with their password.`)) return;
    try {
      await api(`/people/${person.id}/sign-out`, { method: 'POST' });
      app.toast(`${person.name} was signed out everywhere`);
    } catch (e) {
      setError(e.message);
    }
  };

  const newLink = async () => {
    setBusy(true);
    try {
      // Not signed up yet: a fresh invite. Otherwise a 24-hour password reset link.
      if (person.invited) setInvite(await api(`/people/${person.id}/invite`, { method: 'POST' }));
      else {
        const r = await api(`/people/${person.id}/reset-link`, { method: 'POST' });
        setInvite({ inviteUrl: r.url, reset: !r.invite, hours: r.hours });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const isSelfAdmin = person.role === 'admin';
  // Help with sign-in: leaders who manage people, for crew on their team (the head for leaders too)
  const canInvite = person.active && app.can.people && !isSelfAdmin && person.id !== me.id && (person.role === 'crew' || canRoles);

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
          {otherTeams.length > 0 && <div className="muted small">Also on the {otherTeams.map(app.teamName).join(' and ')}</div>}
        </div>
      </div>

      {!editable && <p className="muted small">Only the admin or the {app.team.name}’s head leader can change team leaders.</p>}

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
          {app.isOffice && <CommitteesEditor f={f} setF={setF} canEdit={app.can.people} />}
          {!app.isOffice && (
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
          )}
          {!app.isOffice && f.positions.length > 0 && (
            <fieldset className="fieldset">
              <legend>Lead (most experienced)</legend>
              <div className="check-grid">
                {positions
                  .filter((p) => f.positions.includes(p.key))
                  .map((p) => (
                    <label key={p.key} className="check">
                      <input type="checkbox" checked={f.leads.includes(p.key)} onChange={() => toggleLead(p.key)} />
                      <span>{p.label}</span>
                    </label>
                  ))}
              </div>
              <p className="muted small">Skill levels: Learning (shadows), Capable (trained) and Lead. The month planner checks every service has a Lead.</p>
            </fieldset>
          )}
          {!app.isOffice && (
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
          )}
          {!app.isOffice && featureOn(app, 'signoffs') && <SignOffHistory person={person} />}
          {!app.isOffice && (
          <label className="field field-row">
            <span className="small">Most shifts a month</span>
            <input className="key-input" type="number" min="0" max="31" value={f.maxPerMonth} onChange={set('maxPerMonth')} placeholder="Any" />
            <span className="muted small">
              {person.availabilityUpdatedAt ? `Availability updated ${new Date(person.availabilityUpdatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Availability never updated'}
            </span>
          </label>
          )}
        </>
      )}

      {canRoles && person.role !== 'admin' && person.id !== me.id && (
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
          {permsFor(app).map((p) => (
            <label key={p.id} className="check check-top">
              <input type="checkbox" checked={!!f.perms[p.id]} disabled={!canRoles || person.id === me.id} onChange={() => togglePerm(p.id)} />
              <span className="col">
                <strong>{p.label}</strong>
                <span className="muted small">{p.help}</span>
              </span>
            </label>
          ))}
          {person.head && <p className="muted small">The head leader has every privilege on this team. Only the admin picks the head leader (Settings → Teams).</p>}
          {!person.head && !canRoles && <p className="muted small">Only the admin or the head leader can change privileges.</p>}
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
              {person.invited ? 'New invite link' : 'Help with sign-in'}
            </button>
          )}
          {me.role === 'admin' && person.id !== me.id && person.active && !person.invited && (
            <button type="button" className="btn btn-ghost" onClick={signOutPerson} disabled={busy}>
              Sign out everywhere
            </button>
          )}
          {person.id !== me.id && person.role !== 'admin' && me.head && person.active && (isAdmin || !person.head) && (
            <button type="button" className="btn btn-ghost" onClick={takeOff} disabled={busy}>
              Take off the {app.team.name}
            </button>
          )}
          {person.id !== me.id && person.role !== 'admin' && (isAdmin || !otherTeams.length) && (
            <button type="button" className={`btn ${person.active ? 'btn-danger' : 'btn-ghost'}`} onClick={() => setActive(!person.active)} disabled={busy}>
              {person.active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
        </div>
      )}
      {invite && <InviteLink person={{ ...person, name: f.name, phone: f.phone }} url={invite.inviteUrl} reset={invite.reset} hours={invite.hours} />}
      {editable && person.active && person.regulars && !app.isOffice && <Regulars person={person} />}
    </aside>
  );
}

// Committees they sit on, and offices they hold (with when the term ends)
function CommitteesEditor({ f, setF, canEdit }) {
  const app = useApp();
  const list = app.committees || [];
  const toggle = (k) => setF({ ...f, committees: f.committees.includes(k) ? f.committees.filter((x) => x !== k) : [...f.committees, k] });
  const setOffice = (i, k, v) => setF({ ...f, offices: f.offices.map((o, j) => (j === i ? { ...o, [k]: v } : o)) });
  return (
    <>
      <fieldset className="fieldset">
        <legend>Committees</legend>
        {list.length === 0 && <p className="muted small">No committees yet. The head leader adds them on Team setup.</p>}
        <div className="check-grid">
          {list.map((c) => (
            <label key={c.key} className="check">
              <input type="checkbox" checked={f.committees.includes(c.key)} disabled={!canEdit} onChange={() => toggle(c.key)} />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
        <p className="muted small">They see their committees’ meetings, minutes, goals and documents, and anything passed down to them.</p>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Offices</legend>
        {f.offices.map((o, i) => (
          <div key={i} className="office-row">
            <input aria-label="Office" list="office-roles" placeholder="e.g. Secretary" value={o.role} maxLength={40} disabled={!canEdit} onChange={(e) => setOffice(i, 'role', e.target.value)} />
            <select aria-label="Of" value={o.committee} disabled={!canEdit} onChange={(e) => setOffice(i, 'committee', e.target.value)}>
              <option value="">Whole team</option>
              {list.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
            <input aria-label="Term ends" type="date" value={o.termEnds} disabled={!canEdit} onChange={(e) => setOffice(i, 'termEnds', e.target.value)} />
            {canEdit && (
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Remove office" onClick={() => setF({ ...f, offices: f.offices.filter((_, j) => j !== i) })}>
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        ))}
        <datalist id="office-roles">
          {['Chair', 'Vice chair', 'Secretary', 'Clerk', 'Treasurer', 'Head elder'].map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {canEdit && (
          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setF({ ...f, offices: [...f.offices, { role: '', committee: f.committees[0] || '', termEnds: '' }] })}>
            <Icon name="plus" size={16} /> Add an office
          </button>
        )}
        <p className="muted small">A Secretary (or Clerk) takes the minutes for that committee. Term end dates show on the agenda overview 60 days ahead.</p>
      </fieldset>
    </>
  );
}

function InviteLink({ person, url, reset, hours }) {
  const app = useApp();
  const text = reset
    ? `Hi ${firstName(person.name)}, here’s a link to choose a new Crew Call password (works for ${hours ? `${hours} hours` : '14 days'}): ${url}`
    : `Hi ${firstName(person.name)}, you’ve been added to the ${app.team.name} at ${app.settings.orgName} on Crew Call — ${app.isOffice ? 'that’s where you’ll see your meetings, agendas, minutes and action items.' : 'that’s where you’ll see your shifts, who you’re serving with, swap shifts and find training links.'} Set your password here (works for 14 days): ${url}`;
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
  // Teams they can bring someone onto; this team first. Church Admin sends a request to join.
  const addTo = useMemo(() => {
    const list = app.addTo?.length ? app.addTo : [{ key: app.team.key, name: app.team.name, ask: app.isOffice }];
    return [...list].sort((a, b) => (b.key === app.team.key) - (a.key === app.team.key));
  }, [app.addTo, app.team, app.isOffice]);
  const [teams, setTeams] = useState(() => (addTo.some((t) => t.key === app.team.key) ? [app.team.key] : addTo.slice(0, 1).map((t) => t.key)));
  // Church Admin mostly asks people who are already on Crew Call (the pastor on the AV team…)
  const [mode, setMode] = useState(app.isOffice ? 'existing' : 'new');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [f, setF] = useState({ name: '', email: '', phone: '', positions: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const togglePos = (k) => setF({ ...f, positions: f.positions.includes(k) ? f.positions.filter((x) => x !== k) : [...f.positions, k] });
  const toggleTeam = (k) => setTeams(teams.includes(k) ? teams.filter((x) => x !== k) : [...teams, k]);
  const alreadyOn = (k) => mode === 'existing' && !!pick && (pick.teams || []).includes(k);
  const chosen = addTo.filter((t) => teams.includes(t.key) && !alreadyOn(t.key));

  // Refresh the team list once the dialog closes, if anyone was added.
  const added = useRef(false);
  const reload = useRef(app.reload);
  useEffect(() => () => added.current && reload.current(), []);
  useEffect(() => {
    if (done?.results.some((r) => r.ok)) added.current = true;
  }, [done]);

  const submit = async (e) => {
    e.preventDefault();
    if (!chosen.length) return setError('Pick at least one team.');
    setBusy(true);
    setError('');
    // Teams they join straight away first, then the ones that send a request (Church Admin)
    const order = [...chosen].sort((a, b) => a.ask - b.ask);
    const results = [];
    for (const t of order) {
      const body = mode === 'existing' ? { userId: pick.id } : { name: f.name, email: f.email, phone: f.phone };
      if (t.key === app.team.key) body.positions = f.positions; // trained positions belong to this team
      try {
        const r = await api('/people', { method: 'POST', body, team: t.key });
        results.push({ team: t, ok: true, ...r });
      } catch (err) {
        results.push({ team: t, ok: false, error: err.message });
      }
    }
    setBusy(false);
    if (results.every((r) => !r.ok) && results.length === 1) return setError(results[0].error);
    const first = results.find((r) => r.ok);
    setDone({ name: first?.person?.name || pick?.name || f.name, person: first?.person, results, inviteUrl: results.find((r) => r.inviteUrl)?.inviteUrl || null });
  };
  const reset = () => {
    setDone(null);
    setPick(null);
    setQ('');
    setF({ name: '', email: '', phone: '', positions: [] });
    setTeams([app.team.key].filter((k) => addTo.some((t) => t.key === k)));
  };
  const many = addTo.length > 1;
  const allAsk = chosen.length > 0 && chosen.every((t) => t.ask);

  return (
    <Modal title={done ? done.name : many ? 'Add or ask someone' : app.isOffice ? `Ask someone to join ${app.team.name}` : `Add a person to the ${app.team.name}`} onClose={onClose}>
      {done ? (
        <div className="stack">
          <ul className="ap-results">
            {done.results.map((r) => (
              <li key={r.team.key} className={r.ok ? '' : 'ap-fail'}>
                <strong>{r.team.name}:</strong>{' '}
                {!r.ok
                  ? r.error
                  : r.asked
                    ? 'asked to join. They’ll see the request by email and when they sign in, and it shows on their profile once they accept.'
                    : r.joined
                      ? 'added. They keep the same login and switch teams at the top of the app.'
                      : 'added.'}
              </li>
            ))}
          </ul>
          {done.inviteUrl ? (
            <>
              <p className="muted">They’re new to Crew Call. Send them this link to set their password; it works for 14 days.</p>
              <InviteLink person={done.person} url={done.inviteUrl} />
            </>
          ) : null}
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={reset}>
              Add another
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <div className="seg" role="group" aria-label="Who">
            <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>
              Already on Crew Call
            </button>
            <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
              New to Crew Call
            </button>
          </div>
          {mode === 'existing' ? (
            <ExistingPicker q={q} setQ={setQ} pick={pick} setPick={setPick} teams={teams} />
          ) : (
            <>
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
            </>
          )}
          {many && (
            <fieldset className="fieldset">
              <legend>Which teams</legend>
              {addTo.map((t) => (
                <label key={t.key} className="check check-top">
                  <input type="checkbox" checked={teams.includes(t.key) && !alreadyOn(t.key)} disabled={alreadyOn(t.key)} onChange={() => toggleTeam(t.key)} />
                  <span>
                    {t.name}
                    {alreadyOn(t.key) ? <span className="muted small"> · already on it</span> : t.ask ? <span className="muted small"> · they get a request to join and accept it</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {teams.includes(app.team.key) && app.positions.length > 0 && !app.isOffice && (
            <fieldset className="fieldset">
              <legend>Trained positions on the {app.team.name}</legend>
              <div className="check-grid">
                {app.positions.map((p) => (
                  <label key={p.key} className="check">
                    <input type="checkbox" checked={f.positions.includes(p.key)} onChange={() => togglePos(p.key)} />
                    <span>{p.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && <div className="error" role="alert">{error}</div>}
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy || !chosen.length || (mode === 'existing' && !pick)}>
              {busy ? 'Working…' : mode === 'new' ? 'Add and get invite link' : allAsk ? 'Ask them to join' : chosen.some((t) => t.ask) ? 'Add and ask' : 'Add them'}
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
// Regulars are placed automatically on each weekend as it's built; leaders can still move them.
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
      const r = await api(`/people/${person.id}`, { method: 'PATCH', body: { regulars: next.map(({ id, ...r }) => r) } });
      setList(next);
      app.toast(r?.regularsPlaced ? `${msg} · placed on ${r.regularsPlaced} upcoming weekend${r.regularsPlaced === 1 ? '' : 's'}` : msg);
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
      <p className="muted small">For people who serve on a pattern. They’re placed automatically on each matching weekend as soon as it’s built, so it’s on their calendar early. Their job can change week to week, and you can still move them by hand.</p>
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

// Church Admin: people asked to join who haven't answered yet (leaders and the admin see this)
// Find someone already on Crew Call by name. Only names and teams show; emails stay private.
function ExistingPicker({ q, setQ, pick, setPick, teams }) {
  const app = useApp();
  const wanted = teams?.length ? teams : [app.team.key];
  const s = q.trim().toLowerCase();
  const list = (app.everyone || [])
    .filter((p) => p.id !== app.me.id && !wanted.every((k) => (p.teams || []).includes(k)))
    .filter((p) => !s || p.name.toLowerCase().includes(s))
    .slice(0, 40);
  return (
    <div className="stack-sm">
      <p className="muted small">
        {app.isOffice
          ? `Pick someone from another team, like the pastor on the AV team. They get a request by email and when they sign in, and ${app.team.name} shows on their profile only once they accept.`
          : `Pick someone from another team. They keep one login and one calendar, and switch teams at the top of the app.`}
      </p>
      <input type="search" className="picker-search" placeholder="Type a name" aria-label="Type a name" value={q} onChange={(e) => (setQ(e.target.value), setPick(null))} autoFocus />
      <div className="picker-list" role="listbox" aria-label="People on Crew Call">
        {list.length === 0 && <p className="muted small">{s ? 'Nobody by that name who isn’t already here. Try New to Crew Call.' : 'Everyone on Crew Call is already on this team.'}</p>}
        {list.map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={pick?.id === p.id} className={`picker-row ${pick?.id === p.id ? 'picker-on' : ''}`} onClick={() => setPick(p)}>
            <span className="strong">{p.name}</span>
            <span className="muted small">{(p.teams || []).map(app.teamName).join(', ') || 'No team yet'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AskedList() {
  const app = useApp();
  const [list, setList] = useState([]);
  const load = () => api('/people/asked').then(setList, () => setList([]));
  useEffect(() => {
    load();
  }, [app.people]);
  if (!list.length) return null;
  return (
    <section className="card stack-sm" aria-label="Asked to join">
      <h2>Asked to join ({list.length})</h2>
      {list.map((p) => (
        <div key={p.id} className="row-wrap spread">
          <span>
            {p.name} <span className="muted small">· waiting since {new Date(p.at).toLocaleDateString()}</span>
          </span>
          {app.officeCan.people && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api(`/people/asked/${p.id}`, { method: 'DELETE' }).then(load, (e) => app.toast(e.message))}>
              Take back
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
