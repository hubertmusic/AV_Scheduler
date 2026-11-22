// Team setup: each team's head leader names the team, sets its WhatsApp group, its positions and
// which of them each weekend service needs. The admin also adds teams and picks each head leader.
import { useEffect, useState } from 'react';
import { api, unsaved } from '../lib.js';
import { Icon, useApp } from '../ui.jsx';
import { COMMITTEE_COLORS } from '../office.jsx';
import { Positions, useSaver } from './Settings.jsx';
import TeamLook from './TeamLook.jsx';
import { CallLinkHelp } from '../live.jsx';

const DAY_NAMES = ['Friday', 'Sabbath', 'Sunday'];
const KIND_LABEL = { av: 'AV', music: 'Music / praise', other: 'Other', office: 'Church office' };

export default function TeamSetup() {
  const { team, isOffice } = useApp();
  if (isOffice) return <OfficeSetup />;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Team setup</h1>
          <div className="muted">As head leader of the {team.name}, you set up how your team runs. Pick leaders and their privileges on Team &amp; roles.</div>
        </div>
      </div>
      <div className="split">
        <div className="main-col stack-lg">
          <TemplateNeeds />
        </div>
        <div className="side-col stack-lg">
          <TeamInfo />
          <TeamLook />
          <Positions />
        </div>
      </div>
    </div>
  );
}

// Name and WhatsApp group for the team you're working in
function TeamInfo() {
  const { team } = useApp();
  const [f, setF] = useState({ name: team.name, groupLink: team.groupLink || '', callLink: team.callLink || '' });
  const { busy, error, run } = useSaver();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card stack" aria-label="Team">
      <h2>Team</h2>
      <label className="field">
        <span>Team name</span>
        <input value={f.name} onChange={set('name')} maxLength={40} />
      </label>
      <GroupLinkField value={f.groupLink} onChange={set('groupLink')} />
      <label className="field">
        <span>Team call link (optional)</span>
        <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.callLink} onChange={set('callLink')} placeholder="https://call.whatsapp.com/voice/…" />
      </label>
      <p className="muted small">A standing call for quick huddles: everyone on the {team.name} gets a <strong>Team call</strong> button at the top of Crew Call.</p>
      <CallLinkHelp />
      {error && <div className="error" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary self-start" disabled={busy} onClick={() => run(() => api(`/teams/${team.key}`, { method: 'PATCH', body: f }), 'Team saved')}>
        Save
      </button>
    </section>
  );
}

function GroupLinkField({ value, onChange, id }) {
  return (
    <>
      <label className="field" htmlFor={id}>
        <span>WhatsApp group invite link (optional)</span>
        <input id={id} type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={value} onChange={onChange} placeholder="https://chat.whatsapp.com/…" />
      </label>
      <p className="muted small">Message sheets get a “Copy &amp; open crew group” button, and everyone can find the group from a service’s line-up. WhatsApp doesn’t let other apps pre-fill a group message, so the text is copied for you to paste.</p>
    </>
  );
}

// Which of this team's positions each weekend template service needs
function TemplateNeeds() {
  const { settings, positions, team } = useApp();
  const keys = new Set(positions.map((p) => p.key));
  const fromSettings = () => settings.weekendTemplate.map((t) => (t.needs || []).filter((k) => keys.has(k)));
  const [needs, setNeeds] = useState(fromSettings);
  const [saved, setSaved] = useState(() => JSON.stringify(fromSettings()));
  const dirty = JSON.stringify(needs) !== saved;
  const { busy, error, run } = useSaver();
  useEffect(() => {
    if (dirty) unsaved.add('team-template');
    else unsaved.delete('team-template');
    return () => unsaved.delete('team-template');
  }, [dirty]);
  const toggle = (i, k) => setNeeds(needs.map((list, j) => (j !== i ? list : list.includes(k) ? list.filter((x) => x !== k) : [...list, k])));
  const save = async () => {
    if (await run(() => api('/teams/current/template', { method: 'PUT', body: { needs } }), 'Saved. Use “Sync with template” on the Schedule to add these to weekends already built.')) setSaved(JSON.stringify(needs));
  };
  const rows = settings.weekendTemplate.map((t, i) => ({ ...t, i })).filter((t) => (team.kind === 'av' || (t.kind || 'service') === 'service') && !t.off);

  return (
    <section className="card stack" aria-label="Weekend services">
      <div>
        <h2>Weekend services</h2>
        <p className="muted small">
          Tick the {team.name} positions each service needs. When a weekend is built these spots appear on the Schedule for your team to fill. The admin sets the services and their times; other teams’ positions aren’t changed here.
        </p>
      </div>
      {positions.length === 0 && <p className="warn-box">Add your team’s positions first (for example Worship leader, Vocals, Keys).</p>}
      {rows.length === 0 && <p className="muted">The admin hasn’t added any weekend services yet.</p>}
      {rows.map((r) => (
        <div key={r.i} className="tmpl-row stack-sm">
          <div className="row-wrap spread">
            <strong>
              {r.title || 'Untitled service'} <span className="muted small">· {DAY_NAMES[r.day]} {r.start}</span>
            </strong>
            {r.kind === 'soundcheck' && <span className="chip chip-cold">Sound check</span>}
          </div>
          <div className="check-grid">
            {positions.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={needs[r.i]?.includes(p.key) || false} onChange={() => toggle(r.i, p.key)} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      {error && <div className="error" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary self-start" disabled={busy || !dirty} onClick={save}>
        {dirty ? 'Save' : 'Saved'}
      </button>
    </section>
  );
}

// Admin: every team, its head leader, name, kind and WhatsApp group; add a team
export function TeamsAdmin() {
  const app = useApp();
  const [teams, setTeams] = useState(null);
  const [adding, setAdding] = useState({ name: '', kind: 'music' });
  const { busy, error, run } = useSaver();
  const load = () => api('/teams').then(setTeams, () => setTeams([]));
  useEffect(() => {
    load();
  }, [app.allTeams]);

  return (
    <section className="card stack" aria-label="Teams">
      <div>
        <h2>Teams</h2>
        <p className="muted small">
          Each team has its own positions, people, schedule spots and leaders. Everyone signs in with one account; people on more than one team switch at the top. Services, plans, songs and the calendar are shared. Only you set a team’s head leader; the head leader names the other leaders.
        </p>
      </div>
      {!teams && <p className="muted">Loading…</p>}
      {teams?.map((t) => (
        <TeamRow key={t.key + t.name + t.groupLink + t.heads.map((h) => h.id).join()} t={t} onSaved={load} />
      ))}
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api('/teams', { method: 'POST', body: adding }), `Added the ${adding.name}`).then((ok) => ok && setAdding({ name: '', kind: 'music' }));
        }}
      >
        <label className="field grow">
          <span>New team</span>
          <input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="e.g. Choir, Greeters" required maxLength={40} />
        </label>
        <label className="field">
          <span>Kind</span>
          <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
            <option value="music">Music / praise</option>
            <option value="office">Church office (committees, meetings)</option>
            <option value="other">Other</option>
          </select>
        </label>
        <button className="btn btn-outline self-end" disabled={busy}>
          <Icon name="plus" /> Add team
        </button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

function TeamRow({ t, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ name: t.name, groupLink: t.groupLink || '', callLink: t.callLink || '' });
  const [head, setHead] = useState(t.heads.find((h) => h.id !== app.me.id)?.id || '');
  const { busy, error, run } = useSaver();
  const changed = f.name !== t.name || f.groupLink !== (t.groupLink || '') || f.callLink !== (t.callLink || '');
  const candidates = app.everyone.filter((p) => p.id !== app.me.id);
  const saveHead = () => {
    const p = candidates.find((x) => x.id === head);
    if (!p) return;
    const onTeam = (p.teams || []).includes(t.key);
    if (!window.confirm(`Make ${p.name} head leader of the ${t.name}?${onTeam ? '' : ' They’ll be added to the team.'} The current head leader stays a leader.`)) return;
    run(() => api(`/teams/${t.key}/head`, { method: 'PUT', body: { userId: head } }), `${p.name} is now head leader`).then((ok) => ok && onSaved());
  };
  return (
    <div className="tmpl-row stack-sm">
      <div className="row-wrap spread">
        <strong>
          {t.name} <span className="muted small">· {KIND_LABEL[t.kind] || t.kind}</span>
        </strong>
        <span className="muted small">
          {t.people} {t.people === 1 ? 'person' : 'people'} · {t.positions} position{t.positions === 1 ? '' : 's'}
        </span>
      </div>
      <div className="row-wrap fields-2">
        <label className="field">
          <span>Name</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} />
        </label>
        <label className="field">
          <span>WhatsApp group link</span>
          <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.groupLink} onChange={(e) => setF({ ...f, groupLink: e.target.value })} placeholder="https://chat.whatsapp.com/…" />
        </label>
        <label className="field">
          <span>Team call link</span>
          <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.callLink} onChange={(e) => setF({ ...f, callLink: e.target.value })} placeholder="https://call.whatsapp.com/…" />
        </label>
      </div>
      {changed && (
        <button type="button" className="btn btn-primary btn-sm self-start" disabled={busy} onClick={() => run(() => api(`/teams/${t.key}`, { method: 'PATCH', body: f }), 'Team saved').then((ok) => ok && onSaved())}>
          Save
        </button>
      )}
      <div className="row-wrap">
        <label className="field grow">
          <span>Head leader {t.heads.length ? `(now ${t.heads.map((h) => h.name).join(', ')})` : '(none yet)'}</span>
          <select value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="">{t.key === 'av' ? 'You (the admin)' : 'Pick someone…'}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {(p.teams || []).includes(t.key) ? '' : ' (not on this team yet)'}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-outline self-end" disabled={busy || !head || t.heads.some((h) => h.id === head)} onClick={saveHead}>
          Make head leader
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

// ---------- Church Admin: committees, rooms and reminders ----------
function OfficeSetup() {
  const { team } = useApp();
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Team setup</h1>
          <div className="muted">Set up how the {team.name} runs: its committees, rooms and meeting reminders. Pick leaders, committee members and offices on Team &amp; roles.</div>
        </div>
      </div>
      <div className="split">
        <div className="main-col stack-lg">
          <Committees />
        </div>
        <div className="side-col stack-lg">
          <TeamInfo />
          <TeamLook />
          <RoomsCard />
        </div>
      </div>
    </div>
  );
}

function Committees() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState({ name: '', color: 'blue' });
  const { busy, error, run } = useSaver();
  const load = () => api('/office/committees').then(setList, () => setList([]));
  useEffect(() => {
    load();
  }, []);
  const people = app.people.filter((p) => p.active);
  return (
    <section className="card stack" aria-label="Committees">
      <div>
        <h2>Committees</h2>
        <p className="muted small">Each committee keeps its own meetings, minutes, goals and documents. Tick more than one committee on a meeting for a joint meeting, or pass an item down so another committee can read it. As head leader you see everything.</p>
      </div>
      {!list && <p className="muted">Loading…</p>}
      {list?.map((c) => (
        <CommitteeRow key={c.key + c.members.length + c.quorum + c.name + c.color} c={c} people={people} onSaved={load} />
      ))}
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api('/office/committees', { method: 'POST', body: adding }), `Added the ${adding.name}`).then((ok) => ok && (setAdding({ name: '', color: 'blue' }), load()));
        }}
      >
        <label className="field grow">
          <span>New committee</span>
          <input required maxLength={60} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="e.g. Building Committee" />
        </label>
        <button className="btn btn-outline self-end" disabled={busy}>
          <Icon name="plus" /> Add
        </button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

function CommitteeRow({ c, people, onSaved }) {
  const [f, setF] = useState({ name: c.name, color: c.color, quorum: c.quorum, members: c.members.map((m) => m.id) });
  const { busy, error, run } = useSaver();
  const dirty = f.name !== c.name || f.color !== c.color || Number(f.quorum) !== c.quorum || f.members.slice().sort().join() !== c.members.map((m) => m.id).sort().join();
  const toggle = (id) => setF({ ...f, members: f.members.includes(id) ? f.members.filter((x) => x !== id) : [...f.members, id] });
  return (
    <div className={`tmpl-row stack-sm oc-edge-${f.color}`}>
      <div className="row-wrap fields-3">
        <label className="field">
          <span>Name</span>
          <input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Color</span>
          <select value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })}>
            {COMMITTEE_COLORS.map((x) => (
              <option key={x} value={x}>
                {x[0].toUpperCase() + x.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Quorum (0 = not tracked)</span>
          <input type="number" min={0} max={200} value={f.quorum} onChange={(e) => setF({ ...f, quorum: e.target.value })} />
        </label>
      </div>
      <fieldset className="field">
        <legend>Members ({f.members.length})</legend>
        <div className="check-grid">
          {people.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={f.members.includes(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.name}</span>
            </label>
          ))}
        </div>
        {people.length === 0 && <p className="muted small">Add people on Team &amp; roles first.</p>}
      </fieldset>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row-wrap spread">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => run(() => api(`/office/committees/${c.key}`, { method: 'PATCH', body: { ...f, quorum: Number(f.quorum) || 0 } }), 'Committee saved').then((ok) => ok && onSaved())}>
          {dirty ? 'Save' : 'Saved'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => window.confirm(`Remove the ${c.name}? Its meetings, goals and documents stay, and belong to the whole team.`) && run(() => api(`/office/committees/${c.key}`, { method: 'DELETE' }), 'Committee removed').then((ok) => ok && onSaved())}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function RoomsCard() {
  const app = useApp();
  const [f, setF] = useState(() => ({ rooms: (app.office?.rooms || []).map((r) => ({ ...r })), remindMinutes: app.office?.remindMinutes ?? 60, remindDays: app.office?.remindDays ?? 1 }));
  const { busy, error, run } = useSaver();
  const setRoom = (i, k, v) => setF({ ...f, rooms: f.rooms.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  return (
    <section className="card stack" aria-label="Rooms and reminders">
      <h2>Rooms</h2>
      <p className="muted small">Rooms people can pick for meetings. Tick the room services and rehearsals use, so bookings there warn about them.</p>
      {f.rooms.map((r, i) => (
        <div key={i} className="row-wrap tight">
          <input aria-label="Room" className="grow" value={r.name} maxLength={60} onChange={(e) => setRoom(i, 'name', e.target.value)} />
          <label className="check small">
            <input type="checkbox" checked={!!r.services} onChange={(e) => setRoom(i, 'services', e.target.checked)} />
            <span>Services use it</span>
          </label>
          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${r.name}`} onClick={() => setF({ ...f, rooms: f.rooms.filter((_, j) => j !== i) })}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setF({ ...f, rooms: [...f.rooms, { name: '', services: false }] })}>
        <Icon name="plus" size={16} /> Room
      </button>
      <h2>Meeting reminders</h2>
      <p className="muted small">Alerts in people’s calendars for meetings they’re invited to.</p>
      <div className="row-wrap fields-2">
        <label className="field">
          <span>Days before (0 = none)</span>
          <input type="number" min={0} max={14} value={f.remindDays} onChange={(e) => setF({ ...f, remindDays: e.target.value })} />
        </label>
        <label className="field">
          <span>Minutes before (0 = none)</span>
          <input type="number" min={0} max={1440} value={f.remindMinutes} onChange={(e) => setF({ ...f, remindMinutes: e.target.value })} />
        </label>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary self-start" disabled={busy} onClick={() => run(() => api('/office/setup', { method: 'PATCH', body: { rooms: f.rooms.filter((r) => r.name.trim()), remindDays: Number(f.remindDays) || 0, remindMinutes: Number(f.remindMinutes) || 0 } }), 'Saved')}>
        Save
      </button>
    </section>
  );
}
