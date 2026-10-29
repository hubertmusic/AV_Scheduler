import { useCallback, useEffect, useState } from 'react';
import { academyHref, api, firstName, prettyPhone, roleLabel } from '../lib.js';
import { Avatar, Empty, Icon, Modal, useApp } from '../ui.jsx';

const KINDS = ['Link', 'Checklist', 'Guide', 'Video', 'Course module'];

export default function Resources() {
  const app = useApp();
  const { can, positions, posLabel, people, me, resFilter, setResFilter, academy } = app;
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setList(await api('/resources'));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const chips = [{ key: 'all', label: 'All' }, ...positions, { key: '', label: 'General' }];
  const shown = (list || []).filter((r) => resFilter === 'all' || r.position === resFilter);
  const contacts = people.filter((p) => p.active && (p.role === 'admin' || p.role === 'leader') && p.id !== me.id);

  const message = (p) =>
    app.openWa({
      title: `Message ${p.name}`,
      text: `Hi ${firstName(p.name)}, it’s ${firstName(me.name)} from the AV crew. I have a question about `,
      recipients: [p],
      groupLink: '',
    });

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Resources &amp; help</h1>
          <div className="muted">Quick reviews before your shift, and a direct line to your leaders.</div>
        </div>
        {can.resources && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ title: '', url: '', position: resFilter === 'all' ? '' : resFilter, kind: 'Link', minutes: 0 })}>
            <Icon name="plus" /> Add resource
          </button>
        )}
      </div>
      {academy && (
        <section className="card academy-card" aria-label="Booth Crew Academy">
          <div className="grow stack-xs">
            <div className="eyebrow">Training</div>
            <h2>Booth Crew Academy</h2>
            <div className="muted small">Sound, stream, slides and camera practice. You’re signed in with your Crew Call account, so there’s no separate account to make.</div>
          </div>
          <a className="btn btn-primary" href="/api/academy/go?to=%2F" target="_blank" rel="noopener">
            Open the Academy
          </a>
        </section>
      )}
      <div className="row-wrap" role="group" aria-label="Filter by position">
        {chips.map((c) => (
          <button key={c.key || 'general'} type="button" className={`pill ${resFilter === c.key ? 'pill-on' : ''}`} aria-pressed={resFilter === c.key} onClick={() => setResFilter(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="split">
        <div className="main-col stack">
          {error && <div className="error" role="alert">{error}</div>}
          {!list && !error && <div className="loading-inline">Loading…</div>}
          {list && shown.length === 0 && (
            <Empty>{list.length === 0 ? (can.resources ? 'No resources yet. Add checklists, videos or course modules for each position.' : 'No resources yet — your leaders will add them here.') : 'Nothing for this position yet.'}</Empty>
          )}
          <div className="card-grid">
            {shown.map((r) => (
              <article key={r.id} className="card stack-sm res">
                <div className="eyebrow">{r.position ? posLabel(r.position) : 'General'}</div>
                <h3>{r.title}</h3>
                <div className="muted small">
                  {r.kind}
                  {r.minutes ? ` · ${r.minutes} min` : ''}
                </div>
                <div className="row-wrap push-down">
                  {r.url ? (
                    <a className="btn btn-primary" href={academyHref(r.url, academy)} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  ) : (
                    <span className="muted small">No link yet</span>
                  )}
                  {can.resources && (
                    <button type="button" className="icon-btn" aria-label={`Edit ${r.title}`} onClick={() => setEditing(r)}>
                      <Icon name="edit" />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
        <aside className="card side stack" aria-label="Contacts">
          <h2>Reach a leader</h2>
          {contacts.length === 0 && <Empty>No leaders yet.</Empty>}
          <ul className="contact-list">
            {contacts.map((p) => (
              <li key={p.id}>
                <Avatar name={p.name} size={36} />
                <span className="grow col">
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {roleLabel(p)}
                    {p.phone ? ` · ${prettyPhone(p.phone)}` : ''}
                  </span>
                </span>
                {p.phone ? (
                  <button type="button" className="btn btn-outline" onClick={() => message(p)} aria-label={`Message ${p.name} on WhatsApp`}>
                    <Icon name="chat" size={16} /> WhatsApp
                  </button>
                ) : (
                  <span className="muted small">No phone</span>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {editing && (
        <ResourceModal
          res={editing}
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

function ResourceModal({ res, onClose, onSaved }) {
  const { positions } = useApp();
  const isNew = !res.id;
  const [f, setF] = useState({ title: res.title, url: res.url, position: res.position, kind: res.kind, minutes: res.minutes || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, minutes: Number(f.minutes) || 0 };
      if (isNew) await api('/resources', { method: 'POST', body });
      else await api(`/resources/${res.id}`, { method: 'PATCH', body });
      onSaved(isNew ? 'Resource added' : 'Resource saved');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove “${res.title}”?`)) return;
    await api(`/resources/${res.id}`, { method: 'DELETE' }).then(() => onSaved('Resource removed'), (err) => setError(err.message));
  };

  return (
    <Modal title={isNew ? 'Add a resource' : 'Edit resource'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Title</span>
          <input required value={f.title} onChange={set('title')} placeholder="e.g. FOH preflight checklist" />
        </label>
        <label className="field">
          <span>Link</span>
          <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.url} onChange={set('url')} placeholder="practiceav.fyi or https://…" />
        </label>
        <div className="row-wrap fields-3">
          <label className="field">
            <span>Position</span>
            <select value={f.position} onChange={set('position')}>
              <option value="">General</option>
              {positions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={f.kind} onChange={set('kind')}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Minutes</span>
            <input type="number" min="0" max="600" value={f.minutes} onChange={set('minutes')} />
          </label>
        </div>
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
              Remove
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
