import { useCallback, useEffect, useState } from 'react';
import { academyHref, api, firstName, prettyPhone, roleLabel } from '../lib.js';
import { Avatar, DropZone, Empty, Icon, Modal, useApp } from '../ui.jsx';
import { fmtDate, fmtSize, uploadFiles } from '../lib.js';
import { CommitteeChips, CommitteePicker } from '../office.jsx';

const KINDS = ['Link', 'Checklist', 'Guide', 'Video', 'Course module'];
// Who can see a resource; each level sees its own and everything below it
const AUDIENCES = [
  { key: 'all', label: 'Everyone on the team', short: '' },
  { key: 'leaders', label: 'Team leaders and up', short: 'Team leaders' },
  { key: 'heads', label: 'Head leaders and the admin', short: 'Head leaders' },
  { key: 'admin', label: 'Only the admin', short: 'Admin only' },
];
const LEVEL = { all: 0, leaders: 1, heads: 2, admin: 3 };
const GUIDE_FOR = { all: 'everyone on the team', leaders: 'team leaders', heads: 'head leaders', admin: 'the admin' };
const myLevel = (me) => (me.role === 'admin' ? 3 : me.head ? 2 : me.role === 'leader' ? 1 : 0);
const fileHref = (r, team, download) => `/api/resources/${r.id}/file?team=${encodeURIComponent(team.key)}${download ? '&download=1' : ''}`;

// The guide for this person: of the guides they can see, the one written for the highest level
export function pickGuide(list) {
  return (list || [])
    .filter((r) => r.guide && (r.file || r.url))
    .sort((a, b) => LEVEL[b.audience] - LEVEL[a.audience] || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
}

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
  const guide = pickGuide(list);
  const openHref = (r) => (r.file ? fileHref(r, app.team) : academyHref(r.url, academy));
  const contacts = people.filter((p) => p.active && (p.role === 'admin' || p.role === 'leader') && p.id !== me.id);

  const message = (p) =>
    app.openWa({
      title: `Message ${p.name}`,
      text: `Hi ${firstName(p.name)}, it’s ${firstName(me.name)}${app.isOffice ? '' : ' from the AV crew'}. I have a question about `,
      recipients: [p],
      groupLink: '',
    });

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Resources &amp; help</h1>
          <div className="muted">{app.isOffice ? 'Bylaws, policies, forms and approved minutes, plus a direct line to your leaders.' : 'Quick reviews before your shift, and a direct line to your leaders.'}</div>
        </div>
        {can.resources && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ title: '', url: '', position: resFilter === 'all' ? '' : resFilter, kind: 'Link', minutes: 0, audience: 'all', guide: false, everyTeam: false, file: null })}>
            <Icon name="plus" /> Add resource
          </button>
        )}
      </div>
      {guide && (
        <section className="card guide-card" aria-label="Your guide">
          <span className="guide-icon" aria-hidden="true">
            <Icon name="book" size={22} />
          </span>
          <div className="grow stack-xs">
            <div className="eyebrow">Your guide</div>
            <h2>{guide.title}</h2>
            <div className="muted small">
              Written for {GUIDE_FOR[guide.audience]}
              {guide.file ? ` · ${guide.file.name} · ${fmtSize(guide.file.size)}` : ''}
            </div>
          </div>
          <div className="row-wrap">
            <a className="btn btn-primary" href={openHref(guide)} target="_blank" rel="noopener noreferrer">
              Open
            </a>
            {guide.file && (
              <a className="btn btn-outline" href={fileHref(guide, app.team, true)}>
                Download
              </a>
            )}
          </div>
        </section>
      )}
      {app.isOffice && <DocumentLibrary />}
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
                  {r.file ? ` · ${r.file.name} · ${fmtSize(r.file.size)}` : ''}
                </div>
                {(r.audience !== 'all' || r.everyTeam || r.guide) && (
                  <div className="row-wrap tight">
                    {r.audience !== 'all' && (
                      <span className="tag tag-lock" title={`Only ${AUDIENCES.find((a) => a.key === r.audience).label.toLowerCase()} can see this`}>
                        <Icon name="lock" size={12} /> {AUDIENCES.find((a) => a.key === r.audience).short}
                      </span>
                    )}
                    {r.guide && <span className="tag">Guide</span>}
                    {r.everyTeam && <span className="tag">Every team</span>}
                  </div>
                )}
                <div className="row-wrap push-down">
                  {r.url || r.file ? (
                    <a className="btn btn-primary" href={openHref(r)} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  ) : (
                    <span className="muted small">No link yet</span>
                  )}
                  {r.canEdit && (
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
  const { positions, me } = useApp();
  const isNew = !res.id;
  const level = myLevel(me);
  const [f, setF] = useState({ title: res.title, url: res.url, position: res.position, kind: res.kind, minutes: res.minutes || '', audience: res.audience || 'all', guide: !!res.guide, everyTeam: !!res.everyTeam });
  const [file, setFile] = useState(null); // a new file to upload
  const [dropFile, setDropFile] = useState(false); // remove the one it has
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const hasFile = !!file || (!!res.file && !dropFile);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, minutes: Number(f.minutes) || 0, url: hasFile ? '' : f.url };
      if (isNew && file) {
        const extra = { ...body, title: f.title, guide: String(f.guide), everyTeam: String(f.everyTeam), minutes: String(body.minutes) };
        await uploadFiles('/resources', [file], { field: 'file', extra, onProgress: setProgress });
      } else if (isNew) await api('/resources', { method: 'POST', body });
      else {
        await api(`/resources/${res.id}`, { method: 'PATCH', body: { ...body, removeFile: dropFile && !file } });
        if (file) await uploadFiles(`/resources/${res.id}/file`, [file], { field: 'file', onProgress: setProgress });
      }
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
          <input required={!file} value={f.title} onChange={set('title')} placeholder={file ? file.name.replace(/\.[a-z0-9]+$/i, '') : 'e.g. FOH preflight checklist'} />
        </label>
        {file || (res.file && !dropFile) ? (
          <div className="row-wrap file-chosen">
            <Icon name="doc" size={18} />
            <span className="small grow">
              {file ? `${file.name} · ${fmtSize(file.size)}` : `${res.file.name} · ${fmtSize(res.file.size)}`}
              {busy && file ? ` · ${Math.round(progress * 100)}%` : ''}
            </span>
            <button type="button" className="link-btn small" onClick={() => (file ? setFile(null) : setDropFile(true))}>
              {file && res.file && !dropFile ? 'Keep the old file' : 'Remove'}
            </button>
            {!file && (
              <label className="link-btn small">
                Replace
                <input type="file" className="sr-only" onChange={(e) => e.target.files[0] && setFile(e.target.files[0])} />
              </label>
            )}
          </div>
        ) : (
          <>
            <DropZone onFiles={(fs) => setFile(fs[0])} multiple={false} label="Drop a file here" hint="A PDF guide, checklist, Word file…" />
            <label className="field">
              <span>Or a link</span>
              <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.url} onChange={set('url')} placeholder="practiceav.fyi or https://…" />
            </label>
          </>
        )}
        <label className="field">
          <span>Who can see this</span>
          <select value={f.audience} onChange={set('audience')}>
            {AUDIENCES.map((a) => (
              <option key={a.key} value={a.key} disabled={LEVEL[a.key] > level}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="hint">Crew Call checks this before showing it or sending the file, so a forwarded link won’t open for anyone else.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={f.guide} onChange={(e) => setF({ ...f, guide: e.target.checked })} />
          <span>
            Show as “Your guide”
            <span className="hint">At the top of Resources &amp; help. Each person gets the guide written for the highest level they can see.</span>
          </span>
        </label>
        {me.role === 'admin' && (
          <label className="check">
            <input type="checkbox" checked={f.everyTeam} onChange={(e) => setF({ ...f, everyTeam: e.target.checked })} />
            <span>
              Show on every team
              <span className="hint">AV, Praise and Church Admin all see it (still only the people chosen above).</span>
            </span>
          </label>
        )}
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

// ---------- Church Admin: the document library ----------
function DocumentLibrary() {
  const app = useApp();
  const [d, setD] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api('/office/docs').then(setD, () => setD({ docs: [], minutes: [], categories: [] })), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <div className="loading-inline">Loading documents…</div>;
  const cats = [...new Set(d.docs.map((x) => x.category))];
  const remove = async (doc) => {
    if (!window.confirm(`Remove “${doc.title}”?`)) return;
    try {
      await api(`/office/docs/${doc.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      app.toast(e.message);
    }
  };
  return (
    <section className="card stack" aria-label="Documents">
      <div className="row-wrap spread">
        <h2>Documents</h2>
        {app.officeCan.resources && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add a document
          </button>
        )}
      </div>
      {d.docs.length === 0 && d.minutes.length === 0 && <p className="muted">No documents yet.</p>}
      {cats.map((c) => (
        <div key={c} className="stack-sm">
          <h3>{c}</h3>
          {d.docs
            .filter((x) => x.category === c)
            .map((x) => (
              <div key={x.id} className="row-wrap spread doc-row">
                <span className="stack-xs">
                  <a href={x.file ? `/api/office/docs/${x.id}/file?team=${encodeURIComponent(app.team.key)}` : x.url} target="_blank" rel="noopener noreferrer" className="strong">
                    {x.title}
                  </a>
                  <span className="row-wrap tight">
                    <CommitteeChips keys={x.committees} shared={x.sharedWith} />
                    <span className="muted small">{x.file ? `${x.file.name} · ${fmtSize(x.file.size)}` : 'Link'}</span>
                  </span>
                  {x.notes && <span className="small">{x.notes}</span>}
                </span>
                {x.canEdit && (
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${x.title}`} onClick={() => remove(x)}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>
            ))}
        </div>
      ))}
      {d.minutes.length > 0 && (
        <details>
          <summary>
            <strong>Approved minutes ({d.minutes.length})</strong>
          </summary>
          <ul className="plain-list">
            {d.minutes.map((m) => (
              <li key={m.id}>
                <button type="button" className="link-btn" onClick={() => app.openMeeting(m.id)}>
                  {m.title} · {fmtDate(m.date)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {adding && (
        <DocModal
          categories={d.categories}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </section>
  );
}

function DocModal({ categories, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ title: '', category: 'Policies', url: '', notes: '', committees: [], sharedWith: [] });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const extra = { title: f.title, category: f.category, notes: f.notes, committees: f.committees.join(','), sharedWith: f.sharedWith.join(',') };
      if (file) await uploadFiles('/office/docs', [file], { field: 'file', extra });
      else await api('/office/docs', { method: 'POST', body: { ...f } });
      app.toast('Document added');
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Add a document" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Title</span>
            <input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={file ? file.name : 'e.g. Church bylaws'} required={!file} />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {file ? (
          <div className="row-wrap">
            <span className="small">
              {file.name} · {fmtSize(file.size)}
            </span>
            <button type="button" className="link-btn small" onClick={() => setFile(null)}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <DropZone onFiles={(fs) => setFile(fs[0])} multiple={false} label="Drop a file here" hint="A PDF, Word file, spreadsheet…" />
            <label className="field">
              <span>Or a link</span>
              <input type="text" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
            </label>
          </>
        )}
        <label className="field">
          <span>Notes (optional)</span>
          <input value={f.notes} maxLength={1000} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </label>
        <CommitteePicker own value={f.committees} onChange={(v) => setF({ ...f, committees: v })} legend="Who can see it? (nothing ticked: the whole team)" hint="Tick the Church Board for board-only documents." />
        {f.committees.length > 0 && <CommitteePicker value={f.sharedWith} onChange={(v) => setF({ ...f, sharedWith: v })} exclude={f.committees} legend="Also let these committees see it" />}
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary self-start" disabled={busy}>
          Add
        </button>
      </form>
    </Modal>
  );
}
