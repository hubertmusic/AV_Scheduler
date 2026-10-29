import { useCallback, useEffect, useState } from 'react';
import { addDays, api, BIBLE_VERSIONS, fmtDateTime, fmtDay, fmtSize, fmtTime, fridayOf, lookUpBible, todayISO, uploadFiles, weekendLabel } from '../lib.js';
import { DropZone, Empty, Icon, useApp } from '../ui.jsx';
import SongLibrary, { SongFiles, SongModal } from './Songs.jsx';

export default function Plans() {
  const [view, setView] = useState('plans');
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{view === 'plans' ? 'Service plans' : 'Song library'}</h1>
          <div className="muted">Sermon notes, Bible texts, songs and media for each service, ready for ProPresenter.</div>
        </div>
        <div className="seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'plans'} onClick={() => setView('plans')}>
            Plans
          </button>
          <button type="button" aria-pressed={view === 'songs'} onClick={() => setView('songs')}>
            Song library
          </button>
        </div>
      </div>
      {view === 'plans' ? <PlanBrowser /> : <SongLibrary />}
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
  const canEdit = app.can.plans;
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');

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

  return (
    <div className="stack-lg">
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
      <MediaSection plan={plan} canEdit={canEdit} eventId={eventId} setPlan={setPlan} reload={load} onChanged={onChanged} />
      {canEdit && <Guests plan={plan} eventId={eventId} reload={load} />}
    </div>
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
  const [looking, setLooking] = useState(false);
  const [err, setErr] = useState('');
  const list = plan.scriptures;

  const lookUp = async () => {
    const v = BIBLE_VERSIONS.find((x) => x.label === f.version);
    if (!v) {
      setErr(`${f.version} can’t be looked up automatically (it’s copyrighted). Paste the text instead.`);
      return;
    }
    setLooking(true);
    setErr('');
    try {
      const r = await lookUpBible(f.reference, v.id);
      setF({ ...f, reference: r.reference, text: r.text });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLooking(false);
    }
  };
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
          <div className="row-wrap fields-3">
            <label className="field field-wide">
              <span>Reference</span>
              <input required value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="e.g. John 4:13-14" />
            </label>
            <label className="field">
              <span>Version</span>
              <input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} list="bible-versions" />
              <datalist id="bible-versions">
                {[...BIBLE_VERSIONS.map((v) => v.label), 'NKJV', 'NIV', 'ESV', 'NLT'].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
            <button type="button" className="btn btn-outline self-end" onClick={lookUp} disabled={!f.reference || looking}>
              {looking ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          <label className="field">
            <span>Text</span>
            <textarea rows={4} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} placeholder="Look up KJV, WEB or ASV, or paste any version" />
          </label>
          {err && <div className="small danger">{err}</div>}
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

  useEffect(() => {
    if (canEdit) api('/songs').then(setLibrary, () => {});
  }, [canEdit, plan.songs.length]);

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
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Add from the song library…</option>
              {library.filter((s) => !inPlan.has(s.id)).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.artist ? ` — ${s.artist}` : ''}
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

const ext = (name) => (name.includes('.') ? name.split('.').pop().slice(0, 5) : 'file');

function MediaSection({ plan, canEdit, eventId, setPlan, reload, onChanged }) {
  const app = useApp();
  const upload = async (files, onProgress) => {
    setPlan(await uploadFiles(`/plans/${eventId}/media`, files, { onProgress }));
    app.toast(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`);
    onChanged();
  };
  const remove = async (m) => {
    if (!window.confirm(`Delete ${m.title}?`)) return;
    await api(`/media/${m.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message));
    reload();
    onChanged();
  };
  return (
    <section className="card stack" aria-label="Media">
      <div>
        <h2>Media</h2>
        {plan.media?.length > 0 && <div className="muted small">Download for ProPresenter includes all of these. Pictures also go into the PowerPoint.</div>}
      </div>
      {canEdit && <DropZone onFiles={upload} />}
      {plan.media.length === 0 && !canEdit && <Empty>No media yet.</Empty>}
      <div className="media-grid">
        {plan.media.map((m) => (
          <div key={m.id} className="media-card">
            <a className="media-thumb" href={m.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.title}`}>
              {/^image\/(png|jpeg|gif|webp)$/.test(m.mime) ? <img src={m.url} alt="" loading="lazy" /> : ext(m.originalName)}
            </a>
            <div className="media-body">
              <strong className="small ellipsis" title={m.title}>{m.title}</strong>
              <span className="muted small">
                {fmtSize(m.size)} · {m.guestName ? `from ${m.guestName}` : m.uploadedBy || ''}
              </span>
              {m.status === 'pending' && <span className="chip chip-pending self-start">Waiting for approval</span>}
              <div className="row-wrap push-down">
                <a className="btn btn-outline" href={`${m.url}?download=1`} download>
                  Download
                </a>
                {canEdit && m.status !== 'pending' && (
                  <button type="button" className="icon-btn" aria-label={`Delete ${m.title}`} onClick={() => remove(m)}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Guests({ plan, eventId, reload }) {
  const app = useApp();
  const [f, setF] = useState({ name: '', note: '' });
  const [busy, setBusy] = useState(false);
  const ev = plan.event;

  const share = (g) =>
    app.openWa({
      title: `Send ${g.name} their upload link`,
      text: `Hi ${g.name}, it’s ${app.me.name.split(' ')[0]} from ${app.settings.orgName}. Here’s your link to send your slides, videos, Bible texts and song lyrics for ${ev.title} on ${fmtDay(ev.date)}:\n\n${g.url}\n\nIt works for ${Math.round((new Date(g.expiresAt) - Date.now()) / 3600e3)} hours. Files up to 80 MB; for bigger videos, AirDrop or email them.${g.note ? `\n\n${g.note}` : ''}`,
      recipients: [],
      groupLink: '',
    });

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const g = await api(`/guest-links/${eventId}`, { method: 'POST', body: f });
      setF({ name: '', note: '' });
      await reload();
      share(g);
    } catch (err) {
      app.toast(err.message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (g) => {
    await api(`/guest-links/link/${g.id}/revoke`, { method: 'POST' });
    app.toast('Link turned off');
    reload();
  };

  return (
    <section className="card stack" aria-label="Guest uploads">
      <div>
        <h2>Guest upload links</h2>
        <p className="muted small">For a guest speaker or visiting group: they can send files, notes, Bible texts and lyrics for this service only. Links stop working after 4 hours, and nothing reaches the plan until you approve it.</p>
      </div>
      <form className="row-wrap fields-2" onSubmit={create}>
        <label className="field">
          <span>Who’s it for?</span>
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Pastor Daniels" />
        </label>
        <label className="field">
          <span>Note to them (optional)</span>
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Please send slides by Thursday" />
        </label>
        <button className="btn btn-primary self-end" disabled={busy}>
          Make link
        </button>
      </form>
      {plan.guests?.length > 0 && (
        <ul className="req-mini">
          {plan.guests.map((g) => (
            <li key={g.id}>
              <span className="grow">
                <strong>{g.name}</strong>
                <span className="small muted">{g.active ? `Works until ${fmtDateTime(g.expiresAt)}` : 'Expired'}</span>
              </span>
              {g.active && (
                <>
                  <button type="button" className="btn btn-green" onClick={() => share(g)}>
                    Send
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => navigator.clipboard.writeText(g.url).then(() => app.toast('Link copied'), () => app.toast(g.url))}
                  >
                    Copy
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => revoke(g)}>
                    Turn off
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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
  return (
    <section className="card card-strong stack" aria-label="Waiting for approval">
      <h2>Waiting for your approval ({pending.length})</h2>
      {pending.map((s) => (
        <div key={s.id} className="sub-item">
          <div className="section-head">
            <span>
              <span className="eyebrow">{label[s.kind]}</span> <span className="muted small">from {s.guestName} · {fmtDateTime(s.createdAt)}</span>
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
