import { useCallback, useEffect, useState } from 'react';
import { addDays, api, fmtDate, fmtSize, todayISO, uploadFiles } from '../lib.js';
import { DropZone, Empty, Icon, Modal, useApp } from '../ui.jsx';

export const LYRICS_HINT = `Put each section label on its own line, and leave a blank line between slides:

Verse 1
Amazing grace, how sweet the sound
That saved a wretch like me

Chorus
My chains are gone…`;

export function SongFiles({ song, compact }) {
  return (
    <div className="row-wrap">
      <a className="btn btn-outline" href={`/api/songs/${song.id}/propresenter.txt`} download>
        <Icon name="doc" size={16} /> {compact ? '.txt' : 'Text for ProPresenter'}
      </a>
      {song.pro && (
        <a className="btn btn-outline" href={`${song.pro.url}?download=1`} download>
          <Icon name="doc" size={16} /> {compact ? '.pro' : song.pro.name}
        </a>
      )}
    </div>
  );
}

function usedLine(s) {
  if (!s.lastUsed) return 'Not sung in a service yet';
  return `Last sung ${fmtDate(s.lastUsed)} · ${s.usedThisYear}× in the past year`;
}

export default function SongLibrary() {
  const { can } = useApp();
  const [q, setQ] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [report, setReport] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (showRetired) params.set('all', '1');
    setList(await api(`/songs?${params}`).catch(() => []));
  }, [q, showRetired]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="stack-lg">
      <div className="row-wrap spread">
        <label className="field field-inline">
          <span className="sr-only">Search songs</span>
          <input type="search" placeholder="Search songs" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired songs
        </label>
        <div className="row-wrap">
          {can.plans && (
            <button type="button" className="btn btn-outline" aria-expanded={report} onClick={() => setReport(!report)}>
              CCLI usage report
            </button>
          )}
          {can.plans && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ title: '', artist: '', ccli: '', lyrics: '', notes: '' })}>
              <Icon name="plus" /> New song
            </button>
          )}
        </div>
      </div>
      {report && <UsageReport />}
      {list && list.length === 0 && <Empty>{q ? 'No songs match.' : 'No songs yet. Add songs here, or from a service plan.'}</Empty>}
      <div className="card-grid">
        {(list || []).map((s) => (
          <article key={s.id} className="card stack-sm">
            <div className="row spread">
              <h3>
                {s.title} {s.retired && <span className="chip chip-archived">Retired</span>}
              </h3>
              {can.plans && (
                <button type="button" className="icon-btn" aria-label={`Edit ${s.title}`} onClick={() => setEditing(s)}>
                  <Icon name="edit" />
                </button>
              )}
            </div>
            <div className="muted small">
              {[s.artist, s.ccli && `CCLI ${s.ccli}`].filter(Boolean).join(' · ') || '—'}
            </div>
            <div className="small">{s.pro ? (s.proOutdated ? '.pro stored — lyrics changed since' : '.pro stored') : 'No .pro file yet'}</div>
            <div className="small muted">{usedLine(s)}</div>
            <div className="push-down">
              <SongFiles song={s} compact />
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <SongModal
          song={editing}
          onClose={() => {
            setEditing(null);
            load();
          }}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// Songs sung between two dates, as a spreadsheet, for the church's CCLI report
function UsageReport() {
  const today = todayISO();
  const [from, setFrom] = useState(addDays(today, -183));
  const [to, setTo] = useState(today);
  return (
    <section className="card stack-sm" aria-label="CCLI usage report">
      <h3>CCLI usage report</h3>
      <p className="muted small">Every song sung in a service between these dates, how many times and when, as a spreadsheet (CSV). Use it when you report song usage to CCLI.</p>
      <div className="row-wrap">
        <label className="field">
          <span>From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
        <a className="btn btn-primary self-end" href={`/api/songs/usage.csv?from=${from}&to=${to}`} download>
          Download report
        </a>
      </div>
    </section>
  );
}

export function SongModal({ song: initial, onClose, onSaved, onCreated }) {
  const app = useApp();
  const [song, setSong] = useState(initial);
  const isNew = !song.id;
  const [f, setF] = useState({ title: song.title, artist: song.artist || '', ccli: song.ccli || '', lyrics: song.lyrics || '', notes: song.notes || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const out = isNew ? await api('/songs', { method: 'POST', body: f }) : await api(`/songs/${song.id}`, { method: 'PATCH', body: f });
      if (isNew) {
        // stay open so the .pro file can be uploaded right away
        setSong(out);
        setBusy(false);
        app.toast(`Added ${out.title}. You can upload its .pro file below.`);
        onCreated?.(out);
        return;
      }
      app.toast(`Saved ${out.title}`);
      onSaved?.(out);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const uploadPro = async (files, onProgress) => {
    const out = await uploadFiles(`/songs/${song.id}/pro`, files.slice(0, 1), { field: 'file', onProgress });
    setSong(out);
    app.toast('.pro file stored');
  };
  const removePro = async () => {
    if (!window.confirm('Remove the stored .pro file?')) return;
    setSong(await api(`/songs/${song.id}/pro`, { method: 'DELETE' }));
  };
  const remove = async () => {
    if (!window.confirm(`Delete “${song.title}”? It’s taken out of upcoming services. If past services used it, it’s retired instead: hidden from the library, but those services still list it.`)) return;
    try {
      const r = await api(`/songs/${song.id}`, { method: 'DELETE' });
      app.toast(r?.retired ? 'Retired. Past services still list it.' : 'Song deleted');
      onSaved?.(null);
    } catch (e) {
      app.toast(e.message);
    }
  };
  const bringBack = async () => {
    setSong(await api(`/songs/${song.id}`, { method: 'PATCH', body: { retired: false } }));
    app.toast('Back in the song library');
  };

  return (
    <Modal title={isNew ? 'New song' : `Edit ${song.title}`} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="row-wrap fields-3">
          <label className="field field-wide">
            <span>Title</span>
            <input required value={f.title} onChange={set('title')} />
          </label>
          <label className="field">
            <span>Artist / author</span>
            <input value={f.artist} onChange={set('artist')} />
          </label>
          <label className="field">
            <span>CCLI #</span>
            <input value={f.ccli} onChange={set('ccli')} inputMode="numeric" />
          </label>
        </div>
        <label className="field">
          <span>Lyrics</span>
          <textarea rows={14} value={f.lyrics} onChange={set('lyrics')} placeholder={LYRICS_HINT} className="mono" />
        </label>
        <p className="muted small">
          ProPresenter 7: <strong>File → Import</strong>, pick the downloaded .txt. Section labels (Verse 1, Chorus, Bridge…) become groups; set the delimiter so each blank-line-separated block becomes one slide. Save it there to get your .pro file, then upload it below.
        </p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap spread">
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy}>
              {isNew ? 'Add song' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {!isNew &&
            (song.retired ? (
              <button type="button" className="btn btn-outline" onClick={bringBack}>
                Bring back to the library
              </button>
            ) : (
              <button type="button" className="btn btn-danger" onClick={remove}>
                Delete song
              </button>
            ))}
        </div>
      </form>
      {!isNew && (
        <div className="stack divider-top">
          <h3>ProPresenter files</h3>
          <SongFiles song={song} />
          {song.pro ? (
            <div className="stack-sm">
              <div className="small">
                Stored: {song.pro.name} · {fmtSize(song.pro.size)}{' '}
                <button type="button" className="link-btn small" onClick={removePro}>
                  Remove
                </button>
              </div>
              {song.proOutdated && <div className="warn-box">The lyrics were edited after this .pro was uploaded. Re-import the .txt in ProPresenter and upload the new .pro.</div>}
            </div>
          ) : null}
          <DropZone onFiles={uploadPro} multiple={false} accept=".pro" label={song.pro ? 'Replace the .pro file' : 'Upload the .pro file'} hint="The ProPresenter 7 file for this song, so anyone can download it" />
        </div>
      )}
    </Modal>
  );
}
