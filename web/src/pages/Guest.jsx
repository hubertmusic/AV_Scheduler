import { useCallback, useEffect, useState } from 'react';
import { api, BIBLE_VERSIONS, fmtDateTime, fmtDay, fmtSize, fmtTime, lookUpBible, uploadFiles } from '../lib.js';
import { DropZone } from '../ui.jsx';
import { LYRICS_HINT } from './Songs.jsx';

const STATUS = { pending: 'Waiting for approval', approved: 'Added to the service', rejected: 'Not used' };

// Public page for outside guests: upload-only access to one service, for a few hours.
export default function Guest({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('files');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      setInfo(await api(`/guest/${token}`));
    } catch (e) {
      setError(e.message);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);

  // Tell the guest as soon as the link runs out, instead of failing on their next upload.
  useEffect(() => {
    if (!info) return;
    const ms = new Date(info.expiresAt) - Date.now();
    const t = setTimeout(() => setError('This link has expired. Ask the team for a new one.'), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [info]);

  const done = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
    load();
  };
  const fail = (e) => {
    if (e.status === 410) setError(e.message);
    throw e;
  };

  if (error)
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand brand-dark">
            <img src="/icon.svg" width="36" height="36" alt="" />
            <span>Crew Call</span>
          </div>
          <h1>Link not available</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  if (!info) return <div className="loading">Loading…</div>;

  const ev = info.event;
  const tabs = [
    ['files', 'Files'],
    ['note', 'Note'],
    ['scripture', 'Bible text'],
    ['song', 'Song lyrics'],
  ];

  return (
    <div className="guest-wrap">
      <div className="brand brand-dark">
        <img src="/icon.svg" width="32" height="32" alt="" />
        <span>{info.orgName}</span>
      </div>
      <div className="stack-sm">
        <h1>Hi {info.name}</h1>
        <p>
          Send what you need for <strong>{ev.title}</strong>, {fmtDay(ev.date)} at {fmtTime(ev.start)}. The AV team reviews everything before the service.
        </p>
        {info.note && <p className="warn-box">{info.note}</p>}
        <p className="muted small">This link works until {fmtDateTime(info.expiresAt)}. After that, ask the team for a new one.</p>
      </div>

      <section className="card stack">
        <div className="seg" role="group" aria-label="What are you sending?">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'files' && (
          <DropZone
            maxMB={info.maxUploadMB}
            hint={`Slides, videos, photos, audio, documents — up to ${info.maxUploadMB} MB each. For bigger videos, AirDrop or email them to the team.`}
            onFiles={async (files, onProgress) => {
              await uploadFiles(`/guest/${token}/files`, files, { onProgress }).catch(fail);
              done(`Sent ${files.length} file${files.length === 1 ? '' : 's'}`);
            }}
          />
        )}
        {tab === 'note' && <NoteForm token={token} onDone={done} fail={fail} />}
        {tab === 'scripture' && <ScriptureForm token={token} onDone={done} fail={fail} />}
        {tab === 'song' && <SongForm token={token} onDone={done} fail={fail} />}
      </section>

      <section className="card stack" aria-label="What you’ve sent">
        <h2>What you’ve sent</h2>
        {info.submissions.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="req-mini">
          {info.submissions.map((s) => (
            <li key={s.id}>
              <span className="grow">
                <strong>
                  {s.kind === 'media' ? s.media?.name || s.data.name : s.kind === 'note' ? 'Note' : s.kind === 'scripture' ? s.data.reference : s.data.title}
                </strong>
                <span className="muted small">
                  {s.kind === 'media' && s.media ? `${fmtSize(s.media.size)} · ` : ''}
                  {fmtDateTime(s.createdAt)}
                </span>
              </span>
              <span className={`chip chip-${s.status === 'rejected' ? 'denied' : s.status}`}>{STATUS[s.status]}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}

function useSend(token, onDone, fail) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (body, msg, reset) => {
    setBusy(true);
    setError('');
    try {
      await api(`/guest/${token}/items`, { method: 'POST', body }).catch(fail);
      reset();
      onDone(msg);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send };
}

function NoteForm({ token, onDone, fail }) {
  const [text, setText] = useState('');
  const { busy, error, send } = useSend(token, onDone, fail);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); send({ kind: 'note', text }, 'Note sent', () => setText('')); }}>
      <label className="field">
        <span>Note for the AV team</span>
        <textarea rows={6} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Sermon outline, when to show which slide, video cues, mic needs…" />
      </label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-primary self-start" disabled={busy}>Send note</button>
    </form>
  );
}

function ScriptureForm({ token, onDone, fail }) {
  const empty = { reference: '', version: 'KJV', text: '' };
  const [f, setF] = useState(empty);
  const [looking, setLooking] = useState(false);
  const { busy, error, send } = useSend(token, onDone, fail);
  const [hint, setHint] = useState('');
  const lookUp = async () => {
    const v = BIBLE_VERSIONS.find((x) => x.label === f.version);
    if (!v) return setHint(`Paste the ${f.version} text below.`);
    setLooking(true);
    setHint('');
    try {
      const r = await lookUpBible(f.reference, v.id);
      setF({ ...f, reference: r.reference, text: r.text });
    } catch (e) {
      setHint(e.message);
    } finally {
      setLooking(false);
    }
  };
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); send({ kind: 'scripture', ...f }, `Sent ${f.reference}`, () => setF({ ...empty, version: f.version })); }}>
      <div className="row-wrap fields-3">
        <label className="field field-wide">
          <span>Reference</span>
          <input required value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="e.g. Psalm 23:1-4" />
        </label>
        <label className="field">
          <span>Version</span>
          <input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} list="guest-versions" />
          <datalist id="guest-versions">
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
        <textarea rows={5} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
      </label>
      {hint && <div className="small danger">{hint}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-primary self-start" disabled={busy}>Send Bible text</button>
    </form>
  );
}

function SongForm({ token, onDone, fail }) {
  const empty = { title: '', artist: '', key: '', lyrics: '' };
  const [f, setF] = useState(empty);
  const { busy, error, send } = useSend(token, onDone, fail);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); send({ kind: 'song', ...f }, `Sent ${f.title}`, () => setF(empty)); }}>
      <div className="row-wrap fields-3">
        <label className="field field-wide">
          <span>Song title</span>
          <input required value={f.title} onChange={set('title')} />
        </label>
        <label className="field">
          <span>Artist</span>
          <input value={f.artist} onChange={set('artist')} />
        </label>
        <label className="field">
          <span>Key</span>
          <input value={f.key} onChange={set('key')} />
        </label>
      </div>
      <label className="field">
        <span>Lyrics</span>
        <textarea rows={12} value={f.lyrics} onChange={set('lyrics')} placeholder={LYRICS_HINT} className="mono" />
      </label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-primary self-start" disabled={busy}>Send song</button>
    </form>
  );
}
