import { useCallback, useEffect, useState } from 'react';
import { addDays, api, firstName, fmtDay, fmtTime, prettyPhone, todayISO } from '../lib.js';
import { Empty, Icon, Modal, useApp } from '../ui.jsx';
import { groupRecipients, soundcheckText } from '../outreach.js';

export default function Groups() {
  const app = useApp();
  const { groups, can } = app;
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(null);

  const loadEvents = useCallback(async () => {
    const from = todayISO();
    try {
      setEvents(await api(`/events?from=${from}&to=${addDays(from, 90)}`));
    } catch {
      setEvents([]);
    }
  }, []);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const upcomingFor = (g) => events.filter((e) => e.groups.includes(g.id));

  const message = (g) =>
    app.openWa({
      title: `Message ${g.name}`,
      text: `Hi ${g.contactName ? firstName(g.contactName) : 'all'} — it’s ${firstName(app.me.name)} from ${app.settings.orgName}. `,
      recipients: groupRecipients([g], { members: true }),
      groupLink: '',
    });

  const sendTimes = (g) => {
    const list = upcomingFor(g);
    if (list.length === 1 && list[0].kind === 'soundcheck') {
      const e = list[0];
      app.openWa({
        title: `Send ${g.name} their sound check`,
        text: soundcheckText({ event: e, forEvent: events.find((x) => x.id === e.forEvent), groups: [g], orgName: app.settings.orgName, fromName: app.me.name }),
        recipients: groupRecipients([g], { members: true }),
        groupLink: '',
      });
      return;
    }
    const lines = [`Hi ${g.contactName ? firstName(g.contactName) : 'all'} — it’s ${firstName(app.me.name)} from ${app.settings.orgName}. Here’s what we have on the calendar for ${g.name}:`, ''];
    for (const e of list.slice(0, 12)) {
      lines.push(`• ${fmtDay(e.date)} — ${e.title}: ${e.kind === 'soundcheck' ? 'sound check' : 'starts'} ${fmtTime(e.start)}${e.kind === 'soundcheck' ? `, done by ${fmtTime(e.end)}` : ''}`);
    }
    lines.push('', 'Let us know if anything changes (players, instruments, tracks or click).');
    app.openWa({ title: `Send ${g.name} their schedule`, text: lines.join('\n'), recipients: groupRecipients([g], { members: true }), groupLink: '' });
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Groups</h1>
          <div className="muted">Praise teams, choirs, guest musicians and speakers you coordinate sound checks with. They don’t need accounts.</div>
        </div>
        {can.groups && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ name: '', contactName: '', phone: '', groupLink: '', notes: '', members: [] })}>
            <Icon name="plus" /> Add group
          </button>
        )}
      </div>
      {groups.length === 0 && <Empty>No groups yet.{can.groups ? ' Add the teams you run sound checks with, then attach them to services and sound checks on the Schedule.' : ''}</Empty>}
      <div className="card-grid">
        {groups.map((g) => {
          const up = upcomingFor(g);
          return (
            <article key={g.id} className="card stack-sm">
              <div className="row spread">
                <h2>{g.name}</h2>
                {can.groups && (
                  <button type="button" className="icon-btn" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                    <Icon name="edit" />
                  </button>
                )}
              </div>
              <div className="small">
                {g.contactName || 'No contact set'}
                {g.phone ? ` · ${prettyPhone(g.phone)}` : ''}
              </div>
              <div className="muted small">
                {g.members.length} member{g.members.length === 1 ? '' : 's'}
                {g.groupLink ? ' · WhatsApp group linked' : ''}
              </div>
              {g.notes && <p className="small quote">{g.notes}</p>}
              <div className="stack-xs divider-top">
                <div className="label-sm">Coming up</div>
                {up.length === 0 && <span className="muted small">Nothing scheduled in the next 90 days</span>}
                {up.slice(0, 4).map((e) => (
                  <span key={e.id} className="small">
                    {e.kind === 'soundcheck' && <span className="chip chip-check">Sound check</span>} {fmtDay(e.date)} · {fmtTime(e.start)} · {e.title}
                  </span>
                ))}
              </div>
              <div className="row-wrap push-down">
                <button type="button" className="btn btn-green" onClick={() => message(g)}>
                  <Icon name="chat" size={16} /> Message
                </button>
                {up.length > 0 && (
                  <button type="button" className="btn btn-outline" onClick={() => sendTimes(g)}>
                    Send their times
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {editing && (
        <GroupModal
          group={editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            app.toast(msg);
            await app.reload();
            loadEvents();
          }}
        />
      )}
    </div>
  );
}

function GroupModal({ group, onClose, onSaved }) {
  const isNew = !group.id;
  const [f, setF] = useState({
    name: group.name,
    contactName: group.contactName || '',
    phone: prettyPhone(group.phone || ''),
    groupLink: group.groupLink || '',
    notes: group.notes || '',
    members: (group.members || []).map((m) => ({ ...m, phone: prettyPhone(m.phone || '') })),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setMember = (i, k, v) => setF({ ...f, members: f.members.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isNew) await api('/groups', { method: 'POST', body: f });
      else await api(`/groups/${group.id}`, { method: 'PATCH', body: f });
      onSaved(isNew ? `Added ${f.name}` : `Saved ${f.name}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${group.name}? It will be taken off any services and sound checks.`)) return;
    try {
      await api(`/groups/${group.id}`, { method: 'DELETE' });
      onSaved(`Removed ${group.name}`);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isNew ? 'Add a group' : `Edit ${group.name}`} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Group name</span>
          <input required value={f.name} onChange={set('name')} placeholder="e.g. Praise Team, Choir, Youth Band" />
        </label>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Contact person</span>
            <input value={f.contactName} onChange={set('contactName')} placeholder="Leader or music director" />
          </label>
          <label className="field">
            <span>Contact’s mobile (WhatsApp)</span>
            <input type="tel" value={f.phone} onChange={set('phone')} placeholder="(423) 555-0100" />
          </label>
        </div>
        <label className="field">
          <span>WhatsApp group invite link (optional)</span>
          <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.groupLink} onChange={set('groupLink')} placeholder="https://chat.whatsapp.com/…" />
        </label>
        <label className="field">
          <span>Tech notes (input list, monitors, tracks)</span>
          <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="e.g. 4 vocal mics, DI for keys, in-ears for drummer" />
        </label>
        <fieldset className="fieldset">
          <legend>Members (optional)</legend>
          {f.members.length === 0 && <p className="muted small">Add members if you want to message them one by one, not just the contact or group chat.</p>}
          {f.members.map((m, i) => (
            <div key={i} className="row-wrap fields-3">
              <label className="field">
                <span>Name</span>
                <input value={m.name} onChange={(e) => setMember(i, 'name', e.target.value)} />
              </label>
              <label className="field">
                <span>Part</span>
                <input value={m.role} onChange={(e) => setMember(i, 'role', e.target.value)} placeholder="Vocals, keys…" />
              </label>
              <label className="field">
                <span>Mobile</span>
                <input type="tel" value={m.phone} onChange={(e) => setMember(i, 'phone', e.target.value)} />
              </label>
              <button type="button" className="icon-btn self-end" aria-label={`Remove ${m.name || 'member'}`} onClick={() => setF({ ...f, members: f.members.filter((_, j) => j !== i) })}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost self-start" onClick={() => setF({ ...f, members: [...f.members, { name: '', role: '', phone: '' }] })}>
            <Icon name="plus" /> Add member
          </button>
        </fieldset>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap spread">
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {!isNew && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Remove group
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
