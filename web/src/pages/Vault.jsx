// Notes & vault: everyone's private notes (the same on every team's side), and the team's vault
// of passwords and keys. Leaders keep the vault and can open it to crew for a while; secrets only
// come back from the server when someone taps Show or Copy, and every look is in the vault log.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtDateTime, unsaved } from '../lib.js';
import { Empty, Icon, Modal, useApp } from '../ui.jsx';

const store = {
  get(k, d) {
    try {
      return window.localStorage.getItem(k) || d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* private window: just don't remember */
    }
  },
};

export default function Vault() {
  const app = useApp();
  const [part, setPart] = useState(() => store.get('cc-vault-part', 'notes'));
  const pick = (p) => {
    setPart(p);
    store.set('cc-vault-part', p);
  };
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Notes &amp; vault</h1>
          <div className="muted">Your own notes, and the {app.team.name}’s passwords and keys.</div>
        </div>
        <div className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={part === 'notes'} onClick={() => pick('notes')}>
            My notes
          </button>
          <button type="button" aria-pressed={part === 'vault'} onClick={() => pick('vault')}>
            {app.team.name} vault
          </button>
        </div>
      </div>
      {part === 'notes' ? <Notes /> : <TeamVault />}
    </div>
  );
}

// ---------------------------------------------------------------- notes
function Notes() {
  const app = useApp();
  const [notes, setNotes] = useState(null);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null); // 'new' for an unsaved note
  const [editorKey, setEditorKey] = useState(0); // stays put when a new note gets its id, so typing isn't interrupted
  const openNote = (id) => {
    setOpenId(id);
    setEditorKey((k) => k + 1);
  };
  const [error, setError] = useState('');
  useEffect(() => {
    api('/notes').then(setNotes, (e) => setError(e.message));
  }, []);
  const shown = useMemo(() => {
    if (!notes) return [];
    const s = q.trim().toLowerCase();
    return s ? notes.filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(s)) : notes;
  }, [notes, q]);
  const current = openId === 'new' ? { id: null, title: '', body: '', pinned: false } : notes?.find((n) => n.id === openId);

  const saved = (n, wasNew) => {
    setNotes((list) => {
      const rest = list.filter((x) => x.id !== n.id);
      return [n, ...rest].sort((a, b) => b.pinned - a.pinned || new Date(b.updatedAt) - new Date(a.updatedAt));
    });
    if (wasNew) setOpenId(n.id);
  };
  const remove = async (n) => {
    if (!window.confirm(`Delete “${n.title || 'Untitled'}”? This can’t be undone.`)) return;
    try {
      await api(`/notes/${n.id}`, { method: 'DELETE' });
      setNotes((l) => l.filter((x) => x.id !== n.id));
      setOpenId(null);
    } catch (e) {
      app.toast(e.message);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!notes) return <div className="loading-inline">Loading…</div>;
  return (
    <div className={`nv-notes ${current ? 'nv-open' : ''}`}>
      <aside className="nv-list stack-sm" aria-label="Your notes">
        <div className="row-wrap">
          <input className="grow" type="search" placeholder="Search notes" aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openNote('new')}>
            <Icon name="plus" /> New
          </button>
        </div>
        <p className="muted small">Only you can see these, on every team. Not even the admin can read them.</p>
        {shown.length === 0 && <Empty>{notes.length ? 'No notes match.' : 'No notes yet.'}</Empty>}
        <ul className="nv-items">
          {shown.map((n) => (
            <li key={n.id}>
              <button type="button" className={`nv-item ${openId === n.id ? 'nv-item-on' : ''}`} onClick={() => openNote(n.id)} aria-current={openId === n.id ? 'true' : undefined}>
                <span className="strong ellipsis">
                  {n.pinned && <span aria-label="Pinned">📌 </span>}
                  {n.title || 'Untitled'}
                </span>
                <span className="muted small ellipsis">{n.body.split('\n').find((l) => l.trim()) || 'Empty'}</span>
                <span className="muted small">{fmtDateTime(n.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="nv-editor" aria-label="Note">
        {current ? (
          <NoteEditor key={editorKey} note={current} onSaved={saved} onRemove={remove} onClose={() => setOpenId(null)} />
        ) : (
          <div className="card nv-blank muted">Pick a note, or start a new one.</div>
        )}
      </section>
    </div>
  );
}

function NoteEditor({ note, onSaved, onRemove, onClose }) {
  const [f, setF] = useState({ title: note.title, body: note.body, pinned: note.pinned });
  const [state, setState] = useState(note.id ? 'saved' : 'new'); // new | dirty | saving | saved | error
  const id = useRef(note.id);
  const timer = useRef(null);
  const latest = useRef(f); // what's typed right now (set as you type, so saves never send old text)
  const dirty = useRef(false); // changed since the last save
  const key = useRef(`note-${Math.random()}`);
  const inflight = useRef(Promise.resolve());
  const saveNow = async () => {
    const body = latest.current;
    if (!dirty.current) return;
    if (!id.current && !body.title.trim() && !body.body.trim()) return;
    dirty.current = false;
    setState('saving');
    try {
      const wasNew = !id.current;
      const n = await api(wasNew ? '/notes' : `/notes/${id.current}`, { method: wasNew ? 'POST' : 'PATCH', body });
      id.current = n.id;
      if (!dirty.current) unsaved.delete(key.current);
      setState(dirty.current ? 'dirty' : 'saved');
      onSaved(n, wasNew);
    } catch {
      dirty.current = true;
      setState('error');
    }
  };
  // One save at a time, so a new note is only created once
  const save = useCallback(() => {
    clearTimeout(timer.current);
    inflight.current = inflight.current.then(saveNow);
    return inflight.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (patch) => {
    latest.current = { ...latest.current, ...patch };
    setF(latest.current);
    dirty.current = true;
    setState('dirty');
    unsaved.add(key.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
  };
  // Save on the way out
  useEffect(
    () => () => {
      unsaved.delete(key.current);
      save();
    },
    [save],
  );

  return (
    <div className="card stack">
      <div className="row-wrap spread">
        <span className={`small ${state === 'error' ? 'error' : 'muted'}`} role="status">
          {{ new: 'New note', dirty: 'Editing…', saving: 'Saving…', saved: 'Saved', error: 'Couldn’t save. Check your connection; it’ll try again as you type.' }[state]}
        </span>
        <div className="row-wrap">
          <label className="check">
            <input type="checkbox" checked={f.pinned} onChange={(e) => change({ pinned: e.target.checked })} /> Pin to top
          </label>
          {id.current && (
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => onRemove({ id: id.current, title: f.title })}>
              Delete
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm nv-back" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      <label className="field">
        <span className="sr-only">Title</span>
        <input className="nv-title" maxLength={160} placeholder="Title" value={f.title} onChange={(e) => change({ title: e.target.value })} onBlur={save} autoFocus={!note.id} />
      </label>
      <label className="field">
        <span className="sr-only">Note</span>
        <textarea rows={16} maxLength={50000} placeholder="Write anything: setup steps, reminders, ideas…" value={f.body} onChange={(e) => change({ body: e.target.value })} onBlur={save} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- vault
const DURATIONS = [
  [30, '30 min'],
  [60, '1 hour'],
  [240, '4 hours'],
  [1440, '1 day'],
  [2880, '2 days'],
  [10080, '1 week'],
  ['none', 'No end'],
  ['custom', 'Pick a date & time'],
];

// The ticking `now` only re-renders; the time itself is always read fresh
function timeLeft(until) {
  const ms = new Date(until) - Date.now();
  if (ms <= 0) return 'ended';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''} left`;
  return `${Math.floor(h / 24)} days left`;
}
function useNow(every = 20000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}
// Works on the plain-http LAN address too, where navigator.clipboard isn't offered
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const t = document.createElement('textarea');
  t.value = text;
  t.setAttribute('readonly', '');
  t.style.position = 'fixed';
  t.style.opacity = '0';
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  t.remove();
  return ok;
}

function TeamVault() {
  const app = useApp();
  const [v, setV] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // {} for new, entry for edit
  const [granting, setGranting] = useState(null); // {} or { userId }
  const [q, setQ] = useState('');
  const now = useNow();
  const load = useCallback(() => {
    api('/vault').then(
      (d) => {
        setV(d);
        setError('');
      },
      (e) => setError(e.message),
    );
  }, []);
  useEffect(load, [load]);
  // Crew: when the time runs out, close it on screen too
  useEffect(() => {
    if (v?.access?.until && new Date(v.access.until) <= now) load();
  }, [now, v, load]);

  if (error) return <div className="card stack-sm"><p className="error">{error}</p></div>;
  if (!v) return <div className="loading-inline">Loading…</div>;

  if (!v.leader && !v.access) return <NoAccess v={v} onAsked={load} />;

  const s = q.trim().toLowerCase();
  const entries = s ? v.entries.filter((e) => `${e.title} ${e.category} ${e.url}`.toLowerCase().includes(s)) : v.entries;
  const byCat = {};
  for (const e of entries) (byCat[e.category] ||= []).push(e);

  return (
    <div className="stack-lg">
      {v.broken && (
        <div className="notice nv-warn" role="alert">
          <strong>The vault is locked.</strong>
          <span>The VAULT_KEY in the server’s .env changed, so saved passwords can’t be read. Put the old key back and restart Crew Call.</span>
        </div>
      )}
      {v.leader && !v.keyFromEnv && !v.broken && (
        <div className="notice nv-warn">
          <strong>Set a vault key on the server.</strong>
          <span>
            Passwords are stored scrambled with a key made from the sign-in secret. Add <code>VAULT_KEY</code> to .env (instructions are in .env.example) so the vault keeps working if that secret ever changes.
          </span>
        </div>
      )}

      {!v.leader && (
        <div className="notice nv-access" role="status">
          <strong>{v.access.until ? `You can open the vault until ${fmtDateTime(v.access.until)} (${timeLeft(v.access.until)}).` : 'A leader gave you access to the vault until they take it back.'}</strong>
          <span className="small">{v.access.all ? 'You can see the entries the leaders share.' : 'You can see the entries a leader picked for you.'} Every time you open one, the leaders can see it in the log.</span>
        </div>
      )}

      <div className="row-wrap spread">
        <input className="grow nv-search" type="search" placeholder="Search the vault" aria-label="Search the vault" value={q} onChange={(e) => setQ(e.target.value)} />
        {v.leader && (
          <div className="row-wrap">
            <button type="button" className="btn btn-ghost" onClick={() => setGranting({})} disabled={!v.members?.length}>
              Give access
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setEditing({})} disabled={v.broken}>
              <Icon name="plus" /> Add
            </button>
          </div>
        )}
      </div>

      {v.leader && v.asks?.length > 0 && (
        <section className="card stack-sm nv-asks" aria-label="Asking for access">
          <h2>Asking for access</h2>
          {v.asks.map((a) => (
            <div key={a.user.id + a.at} className="row-wrap spread">
              <span>
                <strong>{a.user.name}</strong> <span className="muted small">{fmtDateTime(a.at)}</span>
                {a.note && <span className="block small">“{a.note}”</span>}
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setGranting({ userId: a.user.id })}>
                Give access
              </button>
            </div>
          ))}
        </section>
      )}

      {v.entries.length === 0 ? (
        <Empty>{v.leader ? 'Nothing in the vault yet. Add stream keys, ProPresenter licenses, logins and Wi-Fi passwords here.' : 'Nothing has been shared with you yet.'}</Empty>
      ) : entries.length === 0 ? (
        <Empty>Nothing matches “{q}”.</Empty>
      ) : (
        Object.keys(byCat)
          .sort()
          .map((cat) => (
            <section key={cat} className="card stack-sm" aria-label={cat}>
              <h2>{cat}</h2>
              <ul className="nv-entries">
                {byCat[cat].map((e) => (
                  <Entry key={e.id} e={e} leader={v.leader} onEdit={() => setEditing(e)} onChanged={load} />
                ))}
              </ul>
            </section>
          ))
      )}

      {v.leader && <AccessCard v={v} now={now} onChanged={load} onGive={() => setGranting({})} />}
      {v.leader && <VaultLogCard log={v.log || []} />}

      {editing && (
        <EntryModal
          entry={editing.id ? editing : null}
          categories={v.categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {granting && (
        <GrantModal
          v={v}
          preset={granting}
          onClose={() => setGranting(null)}
          onSaved={(msg) => {
            setGranting(null);
            app.toast(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

function NoAccess({ v, onAsked }) {
  const app = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ask = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/vault/ask', { method: 'POST', body: { note } });
      app.toast('Asked. Your leaders will see it in the vault.');
      onAsked();
    } catch (err) {
      app.toast(err.message);
    }
    setBusy(false);
  };
  return (
    <div className="card stack nv-locked">
      <div className="nv-lock" aria-hidden="true">🔒</div>
      <h2>The {v.team} vault is for leaders</h2>
      <p className="muted">It holds the team’s stream keys, licenses and logins. A leader can open it for you for a while, say 30 minutes for a Sunday stream, or longer.</p>
      {v.asked ? (
        <div className="ok-box">You asked. A leader will give you access, or you can reach them below.</div>
      ) : (
        <form className="row-wrap" onSubmit={ask}>
          <input className="grow" maxLength={200} placeholder="What for? (optional, e.g. streaming Sunday)" aria-label="What for?" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Asking…' : 'Ask for access'}
          </button>
        </form>
      )}
      {v.leaders?.length > 0 && (
        <div className="stack-sm">
          <span className="label-sm">Leaders</span>
          <ul className="nv-leaders stack-sm">
            {v.leaders.map((l) => (
              <li key={l.id} className="row-wrap">
                <strong>{l.name}</strong>
                {l.phone && (
                  <a className="small" href={`tel:${l.phone}`}>
                    {l.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const HIDE_AFTER = 45; // seconds a shown secret stays on screen
function Entry({ e, leader, onEdit, onChanged }) {
  const app = useApp();
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  const hideTimer = useRef(null);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const reveal = async () => {
    const r = await api(`/vault/${e.id}/reveal`, { method: 'POST' });
    return r;
  };
  const show = async () => {
    if (shown) {
      setShown(null);
      return;
    }
    setBusy(true);
    try {
      setShown(await reveal());
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShown(null), HIDE_AFTER * 1000);
    } catch (err) {
      app.toast(err.message);
      onChanged();
    }
    setBusy(false);
  };
  const copy = async (field, label) => {
    try {
      const r = shown || (await reveal());
      app.toast((await copyText(r[field])) ? `${label} copied` : 'Couldn’t copy. Tap Show and copy it by hand.');
    } catch (err) {
      app.toast(err.message);
      onChanged();
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove “${e.title}” from the vault? Anyone you shared it with loses it too.`)) return;
    try {
      await api(`/vault/${e.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      app.toast(err.message);
    }
  };
  return (
    <li className="nv-entry">
      <div className="nv-entry-head">
        <div className="stack-xs">
          <span className="strong">
            {e.title} {e.leadersOnly && <span className="chip nv-chip-lead">Leaders only</span>}
          </span>
          {e.url && (
            <a className="small ellipsis" href={e.url} target="_blank" rel="noreferrer noopener">
              {e.url.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
        <div className="row-wrap nv-actions">
          {e.hasSecret && (
            <button type="button" className="btn btn-soft btn-sm" onClick={() => copy('secret', 'Password')}>
              <Icon name="copy" size={15} /> Copy
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={show} disabled={busy} aria-expanded={!!shown}>
            {busy ? '…' : shown ? 'Hide' : 'Show'}
          </button>
          {leader && (
            <>
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Edit ${e.title}`} onClick={onEdit}>
                <Icon name="edit" size={15} />
              </button>
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${e.title}`} onClick={remove}>
                <Icon name="close" size={15} />
              </button>
            </>
          )}
        </div>
      </div>
      {shown && (
        <dl className="nv-secret">
          {shown.username && (
            <>
              <dt>Username</dt>
              <dd>
                <span className="mono">{shown.username}</span>
                <button type="button" className="link-btn small" onClick={() => copy('username', 'Username')}>
                  Copy
                </button>
              </dd>
            </>
          )}
          {shown.secret && (
            <>
              <dt>Password / key</dt>
              <dd>
                <span className="mono nv-key">{shown.secret}</span>
              </dd>
            </>
          )}
          {shown.notes && (
            <>
              <dt>Notes</dt>
              <dd className="pre-wrap">{shown.notes}</dd>
            </>
          )}
          <dd className="muted small nv-hide-note">Hides by itself in {HIDE_AFTER} seconds.</dd>
        </dl>
      )}
    </li>
  );
}

function EntryModal({ entry, categories, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ title: entry?.title || '', category: entry?.category || 'Streaming', url: entry?.url || '', leadersOnly: entry?.leadersOnly || false, username: '', secret: '', notes: '' });
  const [touched, setTouched] = useState({}); // secret fields only go to the server when changed
  const [showKey, setShowKey] = useState(!entry);
  const [busy, setBusy] = useState(false);
  const set = (k, val) => {
    setF((x) => ({ ...x, [k]: val }));
    if (['username', 'secret', 'notes'].includes(k)) setTouched((t) => ({ ...t, [k]: true }));
  };
  const save = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    const body = { title: f.title, category: f.category, url: f.url, leadersOnly: f.leadersOnly };
    for (const k of ['username', 'secret', 'notes']) if (!entry || touched[k]) body[k] = f[k];
    try {
      await api(entry ? `/vault/${entry.id}` : '/vault', { method: entry ? 'PATCH' : 'POST', body });
      app.toast(entry ? 'Saved' : `Added ${f.title}`);
      onSaved();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  const keep = (has) => (entry && has ? 'Saved. Type to replace; clear the box to remove' : '');
  return (
    <Modal title={entry ? `Edit ${entry.title}` : 'Add to the vault'} onClose={onClose}>
      <form className="stack" onSubmit={save} autoComplete="off">
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Name</span>
            <input required maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="YouTube stream key" />
          </label>
          <label className="field">
            <span>Kind</span>
            <select value={f.category} onChange={(e) => set('category', e.target.value)}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Link (optional)</span>
          <input maxLength={500} inputMode="url" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="studio.youtube.com" />
        </label>
        <label className="field">
          <span>Username or email (optional)</span>
          <input maxLength={300} value={f.username} onChange={(e) => set('username', e.target.value)} placeholder={keep(entry?.hasUsername) || 'stream@ourchurch.org'} autoComplete="off" />
        </label>
        <label className="field">
          <span>Password, key or code</span>
          <span className="row nv-keyrow">
            <input className="mono" type={showKey ? 'text' : 'password'} maxLength={4000} value={f.secret} onChange={(e) => set('secret', e.target.value)} placeholder={keep(entry?.hasSecret)} autoComplete="new-password" spellCheck={false} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowKey(!showKey)} aria-pressed={showKey}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <label className="field">
          <span>Notes (optional, kept secret too)</span>
          <textarea rows={3} maxLength={4000} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={keep(entry?.hasNotes) || 'Backup key, who to call if it stops working…'} />
        </label>
        <label className="check check-top">
          <input type="checkbox" checked={f.leadersOnly} onChange={(e) => set('leadersOnly', e.target.checked)} />
          <span>
            <strong>Leaders only</strong>
            <span className="block muted small">Never shared with crew, even when they have access to the whole vault.</span>
          </span>
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : entry ? 'Save' : 'Add'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// datetime-local wants local time, not UTC
const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function GrantModal({ v, preset, onClose, onSaved }) {
  const app = useApp();
  const shareable = v.entries.filter((e) => !e.leadersOnly);
  const [userId, setUserId] = useState(preset.userId || '');
  const [dur, setDur] = useState(60);
  const [custom, setCustom] = useState(() => localInput(new Date(Date.now() + 3 * 3600 * 1000)));
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const existing = v.grants.find((g) => g.user.id === userId);
  const save = async (ev) => {
    ev.preventDefault();
    const body = { userId, all, entries: picked };
    if (dur === 'none') body.unlimited = true;
    else if (dur === 'custom') body.until = new Date(custom).toISOString();
    else body.minutes = dur;
    setBusy(true);
    try {
      await api('/vault/grants', { method: 'POST', body });
      const name = v.members.find((m) => m.id === userId)?.name || 'They';
      const label = dur === 'none' ? 'until you take it back' : dur === 'custom' ? `until ${fmtDateTime(body.until)}` : `for ${DURATIONS.find((d) => d[0] === dur)[1]}`;
      onSaved(`${name} can open the vault ${label}`);
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Give access to the vault" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Who</span>
          <select required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Pick someone on the {v.team}</option>
            {v.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {existing && <p className="muted small">They already have access ({existing.until ? `until ${fmtDateTime(existing.until)}` : 'no end'}). This replaces it.</p>}
        <fieldset className="fieldset">
          <legend>For how long</legend>
          <div className="nv-durations" role="radiogroup" aria-label="For how long">
            {DURATIONS.map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={dur === k} className={`pill ${dur === k ? 'pill-on' : ''}`} onClick={() => setDur(k)}>
                {l}
              </button>
            ))}
          </div>
          {dur === 'custom' && (
            <label className="field">
              <span>Until</span>
              <input type="datetime-local" required value={custom} min={localInput(new Date())} onChange={(e) => setCustom(e.target.value)} />
            </label>
          )}
          {dur === 'none' && <p className="muted small">They keep access until a leader takes it back here.</p>}
        </fieldset>
        <fieldset className="fieldset">
          <legend>What they can see</legend>
          <label className="check">
            <input type="radio" name="scope" checked={all} onChange={() => setAll(true)} /> Everything except “Leaders only” entries
          </label>
          <label className="check">
            <input type="radio" name="scope" checked={!all} onChange={() => setAll(false)} /> Only these:
          </label>
          {!all && (
            <div className="check-grid nv-pick">
              {shareable.length === 0 && <p className="muted small">Nothing can be shared yet: every entry is leaders only.</p>}
              {shareable.map((e) => (
                <label key={e.id} className="check">
                  <input type="checkbox" checked={picked.includes(e.id)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id] : picked.filter((x) => x !== e.id))} /> {e.title}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy || !userId || (!all && !picked.length)}>
            {busy ? 'Giving…' : 'Give access'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AccessCard({ v, now, onChanged, onGive }) {
  const app = useApp();
  const takeBack = async (g) => {
    try {
      await api(`/vault/grants/${g.id}`, { method: 'DELETE' });
      app.toast(`${g.user.name} can’t open the vault anymore`);
      onChanged();
    } catch (err) {
      app.toast(err.message);
    }
  };
  return (
    <section className="card stack-sm" aria-label="Who else can open it">
      <div className="panel-head">
        <div className="stack-xs">
          <h2>Who else can open it</h2>
          <span className="muted small">The team’s leaders always can. Crew only for the time you give them.</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onGive} disabled={!v.members?.length}>
          Give access
        </button>
      </div>
      {v.grants.length === 0 ? (
        <p className="muted small">No crew have access right now.</p>
      ) : (
        <ul className="nv-grants">
          {v.grants.map((g) => (
            <li key={g.id} className="row-wrap spread">
              <span className="stack-xs">
                <strong>{g.user.name}</strong>
                <span className="small muted">
                  {g.all ? 'Whole vault' : g.entries.map((x) => x.title).join(', ')} · {g.until ? `until ${fmtDateTime(g.until)}` : 'no end'}
                  {g.by ? ` · from ${g.by}` : ''}
                </span>
              </span>
              <span className="row-wrap">
                <span className={`chip ${g.until ? 'chip-pending' : 'chip-cold'}`}>{g.until ? timeLeft(g.until) : 'Until taken back'}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => takeBack(g)}>
                  Take back
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ACTION = { viewed: 'opened', added: 'added', changed: 'changed', removed: 'removed', granted: 'gave access to', revoked: 'took back access from', asked: 'asked for access' };
function VaultLogCard({ log }) {
  if (!log.length) return null;
  const detail = (l) => (l.detail || '').replace(/until (\d{4}-\d\d-\d\dT[\d:.]+Z)/, (_, iso) => `until ${fmtDateTime(iso)}`);
  return (
    <details className="card-sunk">
      <summary className="strong">Vault log</summary>
      <p className="muted small">Who opened, changed or shared what. The last 80 things, kept for about a year.</p>
      <ul className="nv-log">
        {log.map((l) => (
          <li key={l.id}>
            <span className="muted small nowrap">{fmtDateTime(l.at)}</span>
            <span>
              <strong>{l.who || 'Someone'}</strong> {ACTION[l.action] || l.action}
              {l.entry && (
                <>
                  {' '}
                  <em>{l.entry}</em>
                </>
              )}
              {l.action === 'asked' ? (l.detail ? `: “${l.detail}”` : '') : detail(l) ? ` ${detail(l)}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
