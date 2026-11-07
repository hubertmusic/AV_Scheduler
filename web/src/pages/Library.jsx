import { useCallback, useEffect, useState } from 'react';
import { ago, api, fmtDate, fmtSize, uploadFiles } from '../lib.js';
import { DropZone, Empty, Icon, Modal, useApp } from '../ui.jsx';

// Same list as the server (LIBRARY_CATEGORIES in api/src/models.js)
export const CATEGORIES = ['Backgrounds', 'Countdowns', 'Logos & bumpers', 'Announcement loops', 'Other'];

const ext = (name = '') => (name.includes('.') ? name.split('.').pop().slice(0, 5) : 'file');
const isImage = (m) => /^image\/(png|jpeg|gif|webp)$/.test(m.mime);

// One file tile. `sub` replaces the size/uploader line; children are extra buttons.
export function MediaCard({ m, sub, children }) {
  const gone = m.stored === 'removed';
  const thumb = isImage(m) && !gone && m.stored !== 'cold' ? <img src={m.url} alt="" loading="lazy" /> : ext(m.originalName);
  return (
    <div className={`media-card ${gone ? 'media-gone' : ''}`}>
      {gone ? (
        <div className="media-thumb">{thumb}</div>
      ) : (
        <a className="media-thumb" href={m.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.title}`}>
          {thumb}
        </a>
      )}
      <div className="media-body">
        <strong className="small ellipsis" title={m.title}>
          {m.title}
        </strong>
        <span className="muted small">{sub ?? `${fmtSize(m.size)} · ${m.guestName ? `from ${m.guestName}` : m.uploadedBy || ''}`}</span>
        {m.status === 'pending' && <span className="chip chip-pending self-start">Waiting for approval</span>}
        {m.stored === 'cold' && (
          <span className="chip chip-cold self-start" title="Moved to the archive on the NAS. It still opens, a little slower.">
            In the archive
          </span>
        )}
        {gone && <span className="chip chip-removed self-start">Removed to save space</span>}
        <div className="row-wrap push-down">
          {!gone && (
            <a className="btn btn-outline" href={`${m.url}?download=1`} download>
              Download
            </a>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

function usageLine(u) {
  const parts = [];
  if (u.nextUse) parts.push(`Next: ${fmtDate(u.nextUse)}`);
  if (u.lastUsed) parts.push(`Last: ${fmtDate(u.lastUsed)}`);
  const n = u.past + u.upcoming;
  return n ? `Used in ${n} service${n === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(' · ')}` : ''}` : 'Not used in a service yet';
}

export default function MediaLibrary() {
  const app = useApp();
  const canEdit = app.can.plans;
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [uploadCat, setUploadCat] = useState('Backgrounds');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (q.trim()) params.set('q', q.trim());
    const r = await api(`/library?${params}`).catch(() => ({ items: [] }));
    setItems(r.items);
  }, [cat, q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const upload = async (files, onProgress) => {
    const r = await uploadFiles('/library', files, { onProgress, extra: { category: uploadCat } });
    app.toast(r.skipped?.length ? `${r.added ? `Added ${r.added}. ` : ''}${r.skipped.join('; ')}` : `Added ${r.added} to ${uploadCat}`);
    load();
  };
  const remove = async (m) => {
    const used = m.usage.past > 0;
    const msg = used
      ? `Delete “${m.title}” from the library? Upcoming services lose it. Past services that used it will still list it, but the file will be gone.`
      : `Delete “${m.title}” from the library?${m.usage.upcoming ? ' Upcoming services that use it lose it.' : ''}`;
    if (!window.confirm(msg)) return;
    try {
      await api(`/library/${m.id}`, { method: 'DELETE' });
      app.toast('Deleted from the library');
      load();
    } catch (e) {
      app.toast(e.message);
    }
  };

  return (
    <div className="stack-lg">
      {canEdit && (
        <section className="card stack">
          <div className="row-wrap">
            <h2 className="grow">Add to the library</h2>
            <label className="field field-row">
              <span className="small">Kind</span>
              <select value={uploadCat} onChange={(e) => setUploadCat(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <DropZone onFiles={upload} hint="Backgrounds, countdowns, logo loops: anything you use more than once. Up to 80 MB each." />
        </section>
      )}
      <div className="row-wrap spread">
        <div className="cat-filter" role="group" aria-label="Kind">
          {['', ...CATEGORIES].map((c) => (
            <button key={c || 'all'} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c || 'All'}
            </button>
          ))}
        </div>
        <label className="field field-inline">
          <span className="sr-only">Search the media library</span>
          <input type="search" placeholder="Search the library" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {items === null && <div className="loading-inline">Loading…</div>}
      {items && items.length === 0 && (
        <Empty>{q || cat ? 'Nothing matches.' : 'The library is empty. Add files here, or use Save to library on any file in a service plan.'}</Empty>
      )}
      <div className="media-grid">
        {(items || []).map((m) => (
          <MediaCard key={m.id} m={m} sub={`${m.category || 'Other'} · ${fmtSize(m.size)}`}>
            {canEdit && (
              <>
                <button type="button" className="icon-btn" aria-label={`Edit ${m.title}`} onClick={() => setEditing(m)}>
                  <Icon name="edit" />
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${m.title}`} onClick={() => remove(m)}>
                  <Icon name="close" size={16} />
                </button>
              </>
            )}
            <span className="muted small grow-w">{usageLine(m.usage)}</span>
          </MediaCard>
        ))}
      </div>
      {editing && (
        <EditItem
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {app.me.role === 'admin' && <StorageCard />}
    </div>
  );
}

function EditItem({ item, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ title: item.title, category: item.category || 'Other' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/library/${item.id}`, { method: 'PATCH', body: f });
      app.toast('Saved');
      onSaved();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Edit library item" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={item.originalName} />
        </label>
        <label className="field">
          <span>Kind</span>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            Save
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// "Save to library" on a file in a service plan
export function SaveToLibrary({ media, archived, onClose, onSaved }) {
  const app = useApp();
  const [category, setCategory] = useState(/^video\//.test(media.mime) ? 'Backgrounds' : 'Other');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api(`/library/from-media/${media.id}`, { method: 'POST', body: { category } });
      app.toast(r.already ? `Already in the library as “${r.item.title}”${archived ? '' : ', so this service now links to it'}` : `Saved “${r.item.title}” to the library`);
      onSaved();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Save to the media library" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p>
          <strong>{media.title}</strong>
        </p>
        <p className="muted small">
          {archived
            ? 'A copy goes into the library. This archived service stays as it was.'
            : 'The file moves into the library, and this service links to it. Next time, pick it from the library instead of uploading it again.'}
        </p>
        <label className="field">
          <span>Kind</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            Save to library
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Pick library items to add to a service
export function AssetPicker({ have, onAdd }) {
  const [items, setItems] = useState(null);
  const [pick, setPick] = useState('');
  useEffect(() => {
    api('/library').then((r) => setItems(r.items), () => setItems([]));
  }, []);
  const taken = new Set(have.map((a) => a.id));
  const choices = (items || []).filter((m) => !taken.has(m.id));
  return (
    <div className="row-wrap">
      <label className="field grow">
        <span className="sr-only">Add from the media library</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!items}>
          <option value="">{items && !items.length ? 'The media library is empty' : 'Add from the media library…'}</option>
          {CATEGORIES.map((c) => {
            const list = choices.filter((m) => (m.category || 'Other') === c);
            return list.length ? (
              <optgroup key={c} label={c}>
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-outline"
        disabled={!pick}
        onClick={() => {
          onAdd(choices.find((m) => m.id === pick));
          setPick('');
        }}
      >
        Add
      </button>
    </div>
  );
}

function StorageCard() {
  const app = useApp();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/library/storage').then(setS, () => {});
  }, []);
  if (!s) return null;
  const run = async () => {
    setBusy(true);
    try {
      const out = await api('/library/storage/run', { method: 'POST' });
      setS(out);
      const c = out.lastRun?.cold;
      const p = out.lastRun?.purge;
      app.toast(c?.skipped && s.enabled ? c.skipped : `Moved ${c?.moved || 0} file(s) to the archive${p?.purged ? `, removed ${p.purged} old video(s)` : ''}`);
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const stat = (label, x) => (
    <div>
      <span className="label-sm">{label}</span>
      <strong className="mono">{fmtSize(x.bytes)}</strong>
      <span className="muted small">
        {x.count} file{x.count === 1 ? '' : 's'}
      </span>
    </div>
  );
  return (
    <section className="card stack" aria-label="Storage">
      <div className="section-head">
        <div>
          <h2>Storage</h2>
          <div className="muted small">
            {!s.enabled
              ? 'Cold storage is off. Set ARCHIVE_DIR to a NAS folder to move files of old services there.'
              : s.ready
                ? `Files from services more than ${s.archiveAfterDays} days old move to the NAS archive.${s.purgeVideoAfterDays ? ` Videos older than ${s.purgeVideoAfterDays} days are removed.` : ' Nothing is ever deleted.'}`
                : 'The NAS archive isn’t reachable (the .crewcall-archive file is missing). Files stay on this server until it’s back.'}
          </div>
        </div>
        {s.enabled && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={run}>
            {busy ? 'Working…' : 'Run now'}
          </button>
        )}
      </div>
      <div className="storage-stats">
        {stat('Media library', s.library)}
        {stat('Recent services', s.hot)}
        {stat('In the archive (NAS)', s.cold)}
        {stat('Removed to save space', s.removed)}
      </div>
      {s.lastRun && <div className="muted small">Last checked {ago(s.lastRun.at)}. It runs on its own every 6 hours.</div>}
    </section>
  );
}
