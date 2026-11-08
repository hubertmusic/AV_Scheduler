import { useCallback, useEffect, useState } from 'react';
import { addDays, api, fmtDate, fmtDateTime, fmtDay, fmtSize, fmtTime, fmtWhen, fridayOf, todayISO, uploadFiles, weekendLabel } from '../lib.js';
import { BibleFields } from '../scripture.jsx';
import { DropZone, Empty, Icon, Modal, useApp } from '../ui.jsx';
import SongLibrary, { SongFiles, SongModal } from './Songs.jsx';
import MediaLibrary, { AssetPicker, MediaCard, SaveToLibrary } from './Library.jsx';

const VIEWS = [
  { id: 'plans', tab: 'Plans', title: 'Service plans', blurb: 'Sermon notes, Bible texts, songs and media for each service, ready for ProPresenter.' },
  { id: 'archive', tab: 'Archive', title: 'Archive', blurb: 'Past services, read-only. Search them, and copy anything you need into this week.' },
  { id: 'songs', tab: 'Songs', title: 'Song library', blurb: 'Every song the team uses, with lyrics, .pro files and when it was last sung.' },
  { id: 'media', tab: 'Media', title: 'Media library', blurb: 'Backgrounds, countdowns and logo loops you use every week. Services link to these instead of uploading them again.' },
];

export default function Plans() {
  const [view, setView] = useState('plans');
  const v = VIEWS.find((x) => x.id === view);
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{v.title}</h1>
          <div className="muted">{v.blurb}</div>
        </div>
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((x) => (
            <button key={x.id} type="button" aria-pressed={view === x.id} onClick={() => setView(x.id)}>
              {x.tab}
            </button>
          ))}
        </div>
      </div>
      {view === 'plans' && <PlanBrowser />}
      {view === 'archive' && <ArchiveBrowser />}
      {view === 'songs' && <SongLibrary />}
      {view === 'media' && <MediaLibrary />}
    </div>
  );
}

// Past services, newest first, with search. Picking one opens it read-only on the right.
function ArchiveBrowser() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [selId, setSelId] = useState(null);

  const load = useCallback(async (pg, query) => {
    const r = await api(`/plans/archive?page=${pg}${query ? `&q=${encodeURIComponent(query)}` : ''}`).catch(() => ({ items: [], more: false }));
    setItems((cur) => (pg === 0 ? r.items : [...(cur || []), ...r.items]));
    setMore(r.more);
    setPage(pg);
    if (pg === 0) setSelId(r.items[0]?.id || null);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(0, q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <div className="split">
      <aside className="side-col stack" aria-label="Past services">
        <label className="field">
          <span className="sr-only">Search the archive</span>
          <input type="search" placeholder="Search sermon, song, speaker, verse" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {items && items.length === 0 && <Empty>{q.trim() ? 'Nothing in the archive matches.' : 'No past services yet. A service moves here the day after it happens.'}</Empty>}
        <div className="plan-list">
          {(items || []).map((r) => (
            <button key={r.id} type="button" className={`plan-item ${r.id === selId ? 'plan-on' : ''}`} aria-pressed={r.id === selId} onClick={() => setSelId(r.id)}>
              <span className="muted small strong">
                {fmtDate(r.date)} · {r.title}
              </span>
              {r.sermonTitle ? <strong>“{r.sermonTitle}”</strong> : <strong className="muted">No sermon title</strong>}
              {r.speaker && <span className="small">{r.speaker}</span>}
              {r.songs.length > 0 && <span className="small muted ellipsis-2">{r.songs.join(' · ')}</span>}
              <span className="plan-stats">
                {r.scriptures.length > 0 && <span>{r.scriptures.join(', ')}</span>}
                {r.media > 0 && <span>{r.media} file{r.media === 1 ? '' : 's'}</span>}
              </span>
            </button>
          ))}
        </div>
        {more && (
          <button type="button" className="btn btn-outline" onClick={() => load(page + 1, q.trim())}>
            Show older services
          </button>
        )}
      </aside>
      <div className="main-col">{selId ? <PlanEditor key={selId} eventId={selId} onChanged={() => {}} /> : items === null ? <div className="loading-inline">Loading…</div> : null}</div>
    </div>
  );
}

function PlanBrowser() {
  const [fri, setFri] = useState(() => fridayOf(todayISO()));
  const [list, setList] = useState(null);
  const [selId, setSelId] = useState(null);

  const load = useCallback(async () => {
    const rows = await api(`/plans/summary?from=${fri}&to=${addDays(fri, 2)}`).catch(() => []);
    setList(rows);
    setSelId((cur) => (rows.some((r) => r.id === cur) ? cur : rows.find((r) => r.kind !== 'soundcheck')?.id || rows[0]?.id || null));
  }, [fri]);
  useEffect(() => {
    setList(null);
    load();
  }, [load]);

  return (
    <div className="split">
      <aside className="side-col stack" aria-label="Services">
        <div className="week-nav">
          <button type="button" className="icon-btn" aria-label="Previous weekend" onClick={() => setFri(addDays(fri, -7))}>
            <Icon name="chevL" />
          </button>
          <div className="week-label">
            <span className="muted small">Weekend of</span>
            <strong className="mono">{weekendLabel(fri)}</strong>
          </div>
          <button type="button" className="icon-btn" aria-label="Next weekend" onClick={() => setFri(addDays(fri, 7))}>
            <Icon name="chevR" />
          </button>
        </div>
        {list && list.length === 0 && <Empty>Nothing scheduled this weekend. Build it on the Schedule tab first.</Empty>}
        <div className="plan-list">
          {(list || []).map((r) => (
            <button key={r.id} type="button" className={`plan-item ${r.id === selId ? 'plan-on' : ''}`} aria-pressed={r.id === selId} onClick={() => setSelId(r.id)}>
              <span className="muted small strong">
                {fmtDay(r.date)} · {fmtTime(r.start)}
              </span>
              <strong>{r.title}</strong>
              {r.sermonTitle && <span className="small">“{r.sermonTitle}”{r.speaker ? ` — ${r.speaker}` : ''}</span>}
              <span className="plan-stats">
                {r.hasNotes && <span>Notes</span>}
                {r.scriptures > 0 && <span>{r.scriptures} Bible text{r.scriptures === 1 ? '' : 's'}</span>}
                {r.songs > 0 && <span>{r.songs} song{r.songs === 1 ? '' : 's'}</span>}
                {r.media > 0 && <span>{r.media} file{r.media === 1 ? '' : 's'}</span>}
                {r.pending > 0 && <span className="chip chip-pending">{r.pending} to approve</span>}
                {r.archived && <span className="chip chip-archived">Archived</span>}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="main-col">{selId ? <PlanEditor key={selId} eventId={selId} onChanged={load} /> : !list ? <div className="loading-inline">Loading…</div> : null}</div>
    </div>
  );
}

function PlanEditor({ eventId, onChanged }) {
  const app = useApp();
  const canPlans = app.can.plans;
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    try {
      setPlan(await api(`/plans/${eventId}`));
    } catch (e) {
      setError(e.message);
    }
  }, [eventId]);
  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body, msg) => {
    try {
      setPlan(await api(`/plans/${eventId}`, { method: 'PATCH', body }));
      if (msg) app.toast(msg);
      onChanged();
    } catch (e) {
      app.toast(e.message);
      throw e;
    }
  };

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!plan) return <div className="loading-inline">Loading…</div>;
  const ev = plan.event;
  // Past services are read-only. Anything in them can still be copied into an upcoming one.
  const canEdit = canPlans && !plan.archived;

  return (
    <div className="stack-lg">
      {plan.archived && (
        <div className="archive-banner" role="note">
          <div>
            <strong>In the archive</strong>
            <div className="small muted">This service has passed, so it’s read-only. Nothing in it was deleted.</div>
          </div>
          {canPlans && (
            <button type="button" className="btn btn-primary" onClick={() => setCopying(true)}>
              <Icon name="copy" size={16} /> Copy to this week…
            </button>
          )}
        </div>
      )}
      <section className="card stack">
        <div className="section-head">
          <div>
            <div className="eyebrow">{ev.kind === 'soundcheck' ? 'Sound check' : 'Service'}</div>
            <h2>{ev.title}</h2>
            <div className="muted small">
              {fmtDay(ev.date)} · {fmtTime(ev.start)}
              {plan.updatedBy ? ` · last edited by ${plan.updatedBy}` : ''}
            </div>
          </div>
          <div className="row-wrap export-btns">
            <a className="btn btn-primary" href={`/api/plans/${eventId}/propresenter.zip`} download title="Songs, Bible texts, notes, every uploaded file and a PowerPoint, in one zip">
              <Icon name="doc" size={16} /> Download for ProPresenter
            </a>
            <a className="btn btn-outline" href={`/api/plans/${eventId}/service.pptx`} download title="Title, song lyrics, Bible texts and pictures as slides">
              PowerPoint
            </a>
          </div>
        </div>
        <Details plan={plan} canEdit={canEdit} onSave={patch} />
      </section>
      {canEdit && plan.submissions?.some((s) => s.status === 'pending') && <Approvals plan={plan} onDone={() => { load(); onChanged(); }} />}
      <Scriptures plan={plan} canEdit={canEdit} onSave={patch} />
      <Songs plan={plan} canEdit={canEdit} onSave={patch} reload={load} />
      <MediaSection plan={plan} canEdit={canEdit} canPlans={canPlans} eventId={eventId} setPlan={setPlan} reload={load} onChanged={onChanged} />
      {canEdit && <Guests plan={plan} eventId={eventId} reload={load} />}
      {copying && <CopyModal plan={plan} onClose={() => setCopying(false)} />}
    </div>
  );
}

// Copy parts of an archived service into an upcoming one
function CopyModal({ plan, onClose }) {
  const app = useApp();
  const src = plan.event;
  const files = plan.media.filter((m) => m.status === 'approved' && m.stored !== 'removed');
  const [targets, setTargets] = useState(null);
  const [to, setTo] = useState('');
  const [pick, setPick] = useState({
    sermon: false,
    notes: false,
    scriptures: plan.scriptures.length > 0,
    songs: plan.songs.length > 0,
    assets: plan.assets.some((a) => a.stored !== 'removed'),
  });
  const [media, setMedia] = useState({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState([]);

  useEffect(() => {
    const today = todayISO();
    api(`/plans/summary?from=${today}&to=${addDays(today, 35)}`).then(
      (rows) => {
        const list = rows.filter((r) => !r.archived && r.kind !== 'soundcheck');
        setTargets(list);
        setTo((list.find((r) => r.title === src.title) || list[0])?.id || '');
      },
      () => setTargets([])
    );
  }, [src.title]);

  const options = [
    ['sermon', 'Sermon title and speaker', plan.sermonTitle || plan.speaker ? [plan.sermonTitle && `“${plan.sermonTitle}”`, plan.speaker].filter(Boolean).join(' — ') : null],
    ['notes', 'Pastor’s notes', plan.notes ? 'Added under any notes already there' : null],
    ['scriptures', 'Bible texts', plan.scriptures.length ? plan.scriptures.map((x) => x.reference).join(', ') : null],
    ['songs', 'Songs, with their keys', plan.songs.length ? plan.songs.map((x) => x.song.title).join(' · ') : null],
    ['assets', 'Media library items', plan.assets.filter((a) => a.stored !== 'removed').map((a) => a.title).join(' · ') || null],
  ].filter(([, , detail]) => detail);
  const chosenMedia = files.filter((m) => media[m.id]).map((m) => m.id);
  const anything = options.some(([k]) => pick[k]) || chosenMedia.length > 0;

  const copy = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFailed([]);
    try {
      const r = await api(`/plans/${to}/copy`, { method: 'POST', body: { from: src.id, ...pick, media: chosenMedia } });
      const target = targets.find((t) => t.id === to);
      app.toast(r.copied.length ? `Copied ${r.copied.join(', ')} to ${target.title}, ${fmtDay(target.date)}` : 'Nothing new to copy — it’s already there');
      if (r.failed.length) {
        setFailed(r.failed);
        setBusy(false);
      } else onClose();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Copy to an upcoming service" onClose={onClose} wide>
      <form className="stack" onSubmit={copy}>
        <p className="muted small">
          From {src.title}, {fmtDate(src.date)}. This archived service stays as it is; things already in the other service aren’t added twice.
        </p>
        {targets && targets.length === 0 ? (
          <Empty>No upcoming services in the next five weeks. Build the weekend on the Schedule tab first.</Empty>
        ) : (
          <label className="field">
            <span>Copy into</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} disabled={!targets}>
              {(targets || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {fmtDay(t.date)} · {fmtTime(t.start)} · {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="stack-sm plain-fieldset">
          <legend className="label-sm">What to copy</legend>
          {options.map(([k, label, detail]) => (
            <label key={k} className="check check-top">
              <input type="checkbox" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} />
              <span>
                <strong>{label}</strong>
                <span className="small muted block">{detail}</span>
              </span>
            </label>
          ))}
          {files.map((m) => (
            <label key={m.id} className="check check-top">
              <input type="checkbox" checked={!!media[m.id]} onChange={(e) => setMedia({ ...media, [m.id]: e.target.checked })} />
              <span>
                <strong>{m.title}</strong>
                <span className="small muted block">
                  File · {fmtSize(m.size)}
                  {m.stored === 'cold' ? ' · comes back from the NAS archive' : ''}
                </span>
              </span>
            </label>
          ))}
          {!options.length && !files.length && <p className="muted small">This service has nothing to copy.</p>}
        </fieldset>
        {failed.length > 0 && (
          <div className="warn-box" role="alert">
            Some files couldn’t be copied: {failed.join('; ')}
          </div>
        )}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy || !to || !anything}>
            {busy ? 'Copying…' : 'Copy'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {failed.length ? 'Close' : 'Cancel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Details({ plan, canEdit, onSave }) {
  const [f, setF] = useState({ sermonTitle: plan.sermonTitle, speaker: plan.speaker, notes: plan.notes });
  const [busy, setBusy] = useState(false);
  const dirty = f.sermonTitle !== plan.sermonTitle || f.speaker !== plan.speaker || f.notes !== plan.notes;
  useEffect(() => setF({ sermonTitle: plan.sermonTitle, speaker: plan.speaker, notes: plan.notes }), [plan.sermonTitle, plan.speaker, plan.notes]);

  if (!canEdit)
    return (
      <div className="stack">
        {(plan.sermonTitle || plan.speaker) && (
          <div>
            {plan.sermonTitle && <div className="strong">“{plan.sermonTitle}”</div>}
            {plan.speaker && <div className="muted small">{plan.speaker}</div>}
          </div>
        )}
        <div>
          <div className="label-sm">Pastor’s notes</div>
          {plan.notes ? <div className="notes-view">{plan.notes}</div> : <p className="muted">No notes yet.</p>}
        </div>
      </div>
    );

  const save = async () => {
    setBusy(true);
    try {
      await onSave(f, 'Saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row-wrap fields-2">
        <label className="field">
          <span>Sermon title</span>
          <input value={f.sermonTitle} onChange={(e) => setF({ ...f, sermonTitle: e.target.value })} />
        </label>
        <label className="field">
          <span>Speaker</span>
          <input value={f.speaker} onChange={(e) => setF({ ...f, speaker: e.target.value })} placeholder="e.g. Pastor James" />
        </label>
      </div>
      <label className="field">
        <span>Pastor’s notes (outline, slide cues, anything the booth should know)</span>
        <textarea rows={8} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <div className="row-wrap">
        <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {dirty ? 'Save notes' : 'Saved'}
        </button>
        {dirty && (
          <button type="button" className="btn btn-ghost" onClick={() => setF({ sermonTitle: plan.sermonTitle, speaker: plan.speaker, notes: plan.notes })}>
            Undo changes
          </button>
        )}
      </div>
    </div>
  );
}

function Scriptures({ plan, canEdit, onSave }) {
  const empty = { reference: '', version: 'KJV', text: '' };
  const [f, setF] = useState(empty);
  const list = plan.scriptures;

  const add = async (e) => {
    e.preventDefault();
    await onSave({ scriptures: [...list, f] }, `Added ${f.reference}`);
    setF({ ...empty, version: f.version });
  };
  const move = (i, d) => {
    const next = [...list];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onSave({ scriptures: next });
  };

  return (
    <section className="card stack" aria-label="Bible texts">
      <h2>Bible texts</h2>
      {list.length === 0 && <Empty>No Bible texts yet.</Empty>}
      {list.map((s, i) => (
        <div key={i} className="scripture">
          <div className="section-head">
            <strong>
              {s.reference} {s.version && <span className="muted small">({s.version})</span>}
            </strong>
            {canEdit && (
              <div className="row">
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
                <button type="button" className="icon-btn" aria-label={`Remove ${s.reference}`} onClick={() => onSave({ scriptures: list.filter((_, j) => j !== i) }, 'Removed')}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </div>
          {s.text && <p>{s.text}</p>}
        </div>
      ))}
      {canEdit && (
        <form className="stack divider-top" onSubmit={add}>
          <BibleFields value={f} onChange={setF} />
          <button className="btn btn-primary self-start">Add Bible text</button>
        </form>
      )}
    </section>
  );
}

function Songs({ plan, canEdit, onSave, reload }) {
  const app = useApp();
  const [open, setOpen] = useState({});
  const [library, setLibrary] = useState([]);
  const [pick, setPick] = useState('');
  const [editing, setEditing] = useState(null);
  const rows = plan.songs;
  const body = (list) => list.map((x) => ({ song: x.song.id, key: x.key, note: x.note }));

  const [libLoaded, setLibLoaded] = useState(false);
  const loadLibrary = useCallback(() => {
    if (!canEdit) return;
    api('/songs').then(
      (l) => {
        setLibrary(l);
        setLibLoaded(true);
      },
      () => setLibLoaded(true)
    );
  }, [canEdit]);
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary, plan.songs.length]);

  const move = (i, d) => {
    const next = [...rows];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onSave({ songs: body(next) });
  };
  const setKey = (i, key) => {
    if (rows[i].key === key) return;
    onSave({ songs: body(rows.map((x, j) => (j === i ? { ...x, key } : x))) });
  };
  const addSong = (song) => onSave({ songs: [...body(rows), { song: song.id, key: '', note: '' }] }, `Added ${song.title}`);
  const inPlan = new Set(rows.map((x) => x.song.id));

  return (
    <section className="card stack" aria-label="Songs">
      <h2>Songs</h2>
      {rows.length === 0 && <Empty>No songs yet.</Empty>}
      {rows.map((x, i) => (
        <div key={x.song.id + i} className="song-row">
          <div className="section-head">
            <div className="row">
              <span className="song-num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <strong>{x.song.title}</strong>
                <div className="muted small">{[x.song.artist, x.song.ccli && `CCLI ${x.song.ccli}`].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            <div className="row-wrap">
              {canEdit ? (
                <label className="field field-row">
                  <span className="small">Key</span>
                  <input className="key-input" defaultValue={x.key} onBlur={(e) => setKey(i, e.target.value.trim())} aria-label={`Key for ${x.song.title}`} />
                </label>
              ) : (
                x.key && <span className="chip chip-check">Key {x.key}</span>
              )}
              <button type="button" className="btn btn-ghost" aria-expanded={!!open[i]} onClick={() => setOpen({ ...open, [i]: !open[i] })}>
                {open[i] ? 'Hide lyrics' : 'Lyrics'}
              </button>
            </div>
          </div>
          {open[i] && (x.song.lyrics ? <pre className="lyrics">{x.song.lyrics}</pre> : <p className="muted small">No lyrics yet.</p>)}
          {x.song.proOutdated && <div className="warn-box">Lyrics changed after the .pro was uploaded — re-import in ProPresenter and upload the new .pro.</div>}
          <div className="row-wrap spread">
            <SongFiles song={x.song} compact />
            {canEdit && (
              <div className="row">
                <button type="button" className="icon-btn" aria-label={`Edit ${x.song.title}`} onClick={() => setEditing(x.song)}>
                  <Icon name="edit" />
                </button>
                <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" />
                </button>
                <button type="button" className="icon-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" />
                </button>
                <button type="button" className="icon-btn" aria-label={`Take ${x.song.title} out of this service`} onClick={() => onSave({ songs: body(rows.filter((_, j) => j !== i)) }, 'Removed from this service')}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {canEdit && (
        <div className="row-wrap divider-top">
          <label className="field grow">
            <span className="sr-only">Add a song from the library</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} onFocus={loadLibrary} disabled={libLoaded && library.length === 0}>
              <option value="">
                {!libLoaded
                  ? 'Loading the song library…'
                  : library.length === 0
                    ? 'The song library is empty — add one with New song'
                    : library.every((x) => inPlan.has(x.id))
                      ? 'Every song in the library is already in this service'
                      : `Add from the song library (${library.length - library.filter((x) => inPlan.has(x.id)).length} available)…`}
              </option>
              {library.map((s) => (
                <option key={s.id} value={s.id} disabled={inPlan.has(s.id)}>
                  {s.title}
                  {s.artist ? ` — ${s.artist}` : ''}
                  {inPlan.has(s.id) ? ' (already in this service)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-outline" disabled={!pick} onClick={() => { addSong(library.find((s) => s.id === pick)); setPick(''); }}>
            Add
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ title: '', artist: '', ccli: '', lyrics: '', notes: '' })}>
            <Icon name="plus" /> New song
          </button>
        </div>
      )}
      {editing && (
        <SongModal
          song={editing}
          onCreated={addSong}
          onClose={() => {
            setEditing(null);
            reload();
          }}
          onSaved={() => {
            setEditing(null);
            reload();
            app.refreshPending?.();
          }}
        />
      )}
    </section>
  );
}

function MediaSection({ plan, canEdit, canPlans, eventId, setPlan, reload, onChanged }) {
  const app = useApp();
  const [saving, setSaving] = useState(null);
  const upload = async (files, onProgress) => {
    const out = await uploadFiles(`/plans/${eventId}/media`, files, { onProgress });
    setPlan(out);
    const linked = out.linked || [];
    const stored = files.length - linked.length;
    app.toast(
      linked.length
        ? `${linked.join(', ')} ${linked.length === 1 ? 'is' : 'are'} already in the media library, so ${linked.length === 1 ? 'it’s' : 'they’re'} linked instead${stored ? `. Uploaded ${stored} other${stored === 1 ? '' : 's'}.` : '.'}`
        : `Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`
    );
    onChanged();
  };
  const remove = async (m) => {
    const msg = plan.archived ? `Delete “${m.title}” to free up space? This service will still list it.` : `Delete ${m.title}?`;
    if (!window.confirm(msg)) return;
    await api(`/media/${m.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message));
    reload();
    onChanged();
  };
  const setAssets = async (ids, msg) => {
    try {
      setPlan(await api(`/plans/${eventId}`, { method: 'PATCH', body: { assets: ids } }));
      app.toast(msg);
      onChanged();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const assets = plan.assets || [];
  const showLibrary = assets.length > 0 || canEdit;

  return (
    <section className="card stack" aria-label="Media">
      <div>
        <h2>Media</h2>
        {(plan.media.length > 0 || assets.length > 0) && <div className="muted small">Download for ProPresenter includes all of these. Pictures also go into the PowerPoint.</div>}
      </div>
      {showLibrary && (
        <div className="stack-sm">
          <h3>From the media library</h3>
          {assets.length === 0 && <p className="muted small">Backgrounds, countdowns and logo loops you use every week. Pick them here instead of uploading them again.</p>}
          <div className="media-grid">
            {assets.map((a) => (
              <MediaCard key={a.id} m={a} sub={`${a.category || 'Library'} · ${fmtSize(a.size)}`}>
                {canEdit && (
                  <button type="button" className="icon-btn" aria-label={`Take ${a.title} out of this service`} onClick={() => setAssets(assets.filter((x) => x.id !== a.id).map((x) => x.id), 'Taken out of this service')}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </MediaCard>
            ))}
          </div>
          {canEdit && <AssetPicker have={assets} onAdd={(item) => setAssets([...assets.map((x) => x.id), item.id], `Added ${item.title}`)} />}
        </div>
      )}
      <div className="stack-sm">
        {showLibrary && <h3>Uploaded for this service</h3>}
        {canEdit && <DropZone onFiles={upload} hint="Sermon slides, videos, announcements — up to 80 MB each. Files already in the media library get linked, not stored twice." />}
        {plan.media.length === 0 && !canEdit && <Empty>{assets.length ? 'No other files.' : 'No media yet.'}</Empty>}
        <div className="media-grid">
          {plan.media.map((m) => (
            <MediaCard key={m.id} m={m}>
              {canPlans && m.status === 'approved' && m.stored !== 'removed' && (
                <button type="button" className="link-btn small" onClick={() => setSaving(m)} title="Keep it in the media library to reuse in other services">
                  Save to library
                </button>
              )}
              {canPlans && m.status !== 'pending' && m.stored !== 'removed' && (
                <button type="button" className="icon-btn" aria-label={`Delete ${m.title}`} onClick={() => remove(m)}>
                  <Icon name="close" size={16} />
                </button>
              )}
            </MediaCard>
          ))}
        </div>
      </div>
      {saving && (
        <SaveToLibrary
          media={saving}
          archived={plan.archived}
          onClose={() => setSaving(null)}
          onSaved={() => {
            setSaving(null);
            reload();
            onChanged();
          }}
        />
      )}
    </section>
  );
}

// datetime-local input value (local time) <-> ISO
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : undefined);

function scheduleLine(g) {
  if (!g.active) return 'Turned off or expired';
  if (!g.code) return `Older link · works until ${fmtWhen(g.expiresAt)} · everything needs approval`;
  if (g.state === 'waiting') return `Opens ${fmtWhen(g.opensAt)} · locks ${fmtWhen(g.closesAt)}`;
  if (g.state === 'open') return `Open now · locks ${fmtWhen(g.closesAt)}`;
  return `Locked since ${fmtWhen(g.closesAt)} · late changes need approval until ${fmtWhen(g.expiresAt)}`;
}

function Guests({ plan, eventId, reload }) {
  const app = useApp();
  const [f, setF] = useState({ name: '', note: '', opensAt: '', closesAt: '' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // link whose schedule is being changed
  const ev = plan.event;

  const message = (g) =>
    `Hi ${g.name}, it’s ${app.me.name.split(' ')[0]} from ${app.settings.orgName}. Here’s your link to add your slides, videos, notes, Bible texts and song lyrics for ${ev.title} on ${fmtDay(ev.date)} at ${fmtTime(ev.start)}:\n\n${g.url}\n\nYour code: ${g.code}\n\nYou can add and change things until ${fmtWhen(g.closesAt)}. After that it locks, and changes go to the team for approval. Files up to 80 MB; for bigger videos, AirDrop or email them.${g.note ? `\n\n${g.note}` : ''}`;
  const share = (g) => app.openWa({ title: `Send ${g.name} their link and code`, text: message(g), recipients: [], groupLink: '' });
  const copy = (g) => navigator.clipboard.writeText(message(g)).then(() => app.toast('Link and code copied'), () => app.toast(g.url));

  const run = async (fn, msg) => {
    setBusy(true);
    try {
      const out = await fn();
      if (msg) app.toast(typeof msg === 'function' ? msg(out) : msg);
      await reload();
      return out;
    } catch (e) {
      app.toast(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const create = async (e) => {
    e.preventDefault();
    const g = await run(() => api(`/guest-links/${eventId}`, { method: 'POST', body: { name: f.name, note: f.note, opensAt: fromLocalInput(f.opensAt), closesAt: fromLocalInput(f.closesAt) } }));
    if (g) {
      setF({ name: '', note: '', opensAt: '', closesAt: '' });
      share(g);
    }
  };
  const post = (g, action, body, msg) => run(() => api(`/guest-links/link/${g.id}/${action}`, { method: 'POST', body }), msg);

  return (
    <section className="card stack" aria-label="Guest links">
      <div>
        <h2>Guest links</h2>
        <p className="muted small">
          For a guest speaker or visiting group. They open the link, enter the 6-digit code, and add files, notes, Bible texts and lyrics for this service. They only ever see what they sent. Until the deadline, what they submit goes straight into this plan and they can change it. After that it locks, and changes need your approval, or you can reopen it for a while.
        </p>
      </div>
      <form className="stack-sm" onSubmit={create}>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Who’s it for?</span>
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Pastor Daniels" />
          </label>
          <label className="field">
            <span>Note to them (optional)</span>
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Please include your sermon outline" />
          </label>
        </div>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Opens (optional)</span>
            <input type="datetime-local" value={f.opensAt} onChange={(e) => setF({ ...f, opensAt: e.target.value })} />
          </label>
          <label className="field">
            <span>Deadline: locks at (optional)</span>
            <input type="datetime-local" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} />
          </label>
        </div>
        <p className="muted small">Leave them blank to open it now and lock it at 6 PM the evening before the service.</p>
        <button className="btn btn-primary self-start" disabled={busy}>
          Make link and code
        </button>
      </form>
      {plan.guests?.length > 0 && (
        <ul className="guest-links">
          {plan.guests.map((g) => (
            <li key={g.id} className={g.active ? '' : 'guest-off'}>
              <div className="row-wrap spread">
                <span className="stack-xs">
                  <strong>{g.name}</strong>
                  <span className="small muted">{scheduleLine(g)}</span>
                  {(g.live > 0 || g.waiting > 0) && (
                    <span className="small">
                      {g.live} in the plan{g.waiting ? ` · ${g.waiting} waiting for approval` : ''}
                    </span>
                  )}
                </span>
                {g.active && g.code && (
                  <span className="guest-code" aria-label={`Code ${g.code.split('').join(' ')}`}>
                    <span className="label-sm">Code</span>
                    <strong className="mono">{g.code}</strong>
                  </span>
                )}
              </div>
              {g.codeLocked && g.active && <div className="warn-box small">Too many wrong codes were tried. Make a new code and send it to {g.name}.</div>}
              {g.active && (
                <div className="row-wrap">
                  {g.code && (
                    <button type="button" className="btn btn-green" onClick={() => share(g)}>
                      Send link + code
                    </button>
                  )}
                  {g.code && (
                    <button type="button" className="btn btn-ghost" onClick={() => copy(g)}>
                      Copy
                    </button>
                  )}
                  {g.code && g.state !== 'open' && (
                    <label className="field field-inline">
                      <span className="sr-only">Reopen for</span>
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) => e.target.value && post(g, 'reopen', { minutes: Number(e.target.value) }, (o) => `Open until ${fmtWhen(o.closesAt)}`)}
                      >
                        <option value="">Reopen for…</option>
                        <option value="30">30 minutes</option>
                        <option value="60">1 hour</option>
                        <option value="120">2 hours</option>
                        <option value="240">4 hours</option>
                        <option value="1440">24 hours</option>
                      </select>
                    </label>
                  )}
                  {g.code && g.state === 'open' && (
                    <button type="button" className="btn btn-outline" disabled={busy} onClick={() => post(g, 'lock', undefined, 'Locked. Changes now need approval.')}>
                      Lock now
                    </button>
                  )}
                  {g.code && (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(g)}>
                      Change schedule
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => window.confirm(`Make a new code for ${g.name}? The old code stops working, and they’ll need the new one.`) && post(g, 'new-code', undefined, (o) => `New code: ${o.code}. Send it to ${g.name}.`)}
                  >
                    New code
                  </button>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => window.confirm(`Turn off ${g.name}’s link? What they already added stays in the plan.`) && post(g, 'revoke', undefined, 'Link turned off')}>
                    Turn off
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ScheduleModal
          link={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const out = await run(() => api(`/guest-links/link/${editing.id}`, { method: 'PATCH', body }), 'Schedule saved');
            if (out) setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function ScheduleModal({ link, onClose, onSave }) {
  const [opensAt, setOpensAt] = useState(toLocalInput(link.opensAt));
  const [closesAt, setClosesAt] = useState(toLocalInput(link.closesAt));
  const [note, setNote] = useState(link.note || '');
  return (
    <Modal title={`${link.name}’s schedule`} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ opensAt: fromLocalInput(opensAt), closesAt: fromLocalInput(closesAt), note });
        }}
      >
        <label className="field">
          <span>Opens</span>
          <input type="datetime-local" required value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </label>
        <label className="field">
          <span>Deadline: locks at</span>
          <input type="datetime-local" required value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </label>
        <label className="field">
          <span>Note to them</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="muted small">Until the deadline, what they submit goes straight into the plan. After it, changes wait for your approval.</p>
        <div className="row-wrap">
          <button className="btn btn-primary">Save</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Approvals({ plan, onDone }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const pending = plan.submissions.filter((s) => s.status === 'pending');
  const act = async (s, action) => {
    setBusy(true);
    try {
      await api(`/submissions/${s.id}/${action}`, { method: 'POST' });
      app.toast(action === 'approve' ? 'Added to the plan' : 'Not used');
      app.refreshPending?.();
      onDone();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const label = { note: 'Note', scripture: 'Bible text', song: 'Song', media: 'File' };
  const before = (x) => (x.kind === 'note' ? x.data.text : x.kind === 'scripture' ? `${x.data.reference}${x.data.version ? ` (${x.data.version})` : ''}` : x.kind === 'song' ? `${x.data.title}${x.data.key ? ` · key ${x.data.key}` : ''}` : '');
  return (
    <section className="card card-strong stack" aria-label="Waiting for approval">
      <div>
        <h2>Waiting for your approval ({pending.length})</h2>
        <p className="muted small">Sent after the guest’s deadline. Approve to put it in the plan, or reopen their link if they need more time.</p>
      </div>
      {pending.map((s) => (
        <div key={s.id} className="sub-item">
          <div className="section-head">
            <span>
              <span className="eyebrow">{s.replaces ? `Change to a ${label[s.kind].toLowerCase()}` : `Late ${label[s.kind].toLowerCase()}`}</span>{' '}
              <span className="muted small">from {s.guestName} · {fmtDateTime(s.createdAt)}</span>
            </span>
            <div className="row-wrap">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(s, 'approve')}>
                Approve
              </button>
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act(s, 'reject')}>
                Don’t use
              </button>
            </div>
          </div>
          {s.replaces && (
            <div className="small muted">
              Was: <span className="strike-soft">{before({ kind: s.kind, data: s.replaces.data })}</span>
            </div>
          )}
          {s.kind === 'note' && <div className="notes-view small">{s.data.text}</div>}
          {s.kind === 'scripture' && (
            <div className="small">
              <strong>{s.data.reference}</strong> {s.data.version && `(${s.data.version})`}
              {s.data.text && <div className="notes-view">{s.data.text}</div>}
            </div>
          )}
          {s.kind === 'song' && (
            <div className="small">
              <strong>{s.data.title}</strong>
              {s.data.key ? ` · key ${s.data.key}` : ''}
              {s.data.lyrics && <pre className="lyrics">{s.data.lyrics}</pre>}
            </div>
          )}
          {s.kind === 'media' && s.media && (
            <div className="row-wrap small">
              <strong>{s.media.originalName}</strong> <span className="muted">{fmtSize(s.media.size)}</span>
              <a href={s.media.url} target="_blank" rel="noopener noreferrer">
                Preview
              </a>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
