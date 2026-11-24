// The upload link for the church screens (/send/<token>): anyone with it can send pictures, videos
// and PDFs. Nothing shows until someone who manages the screens approves it.
import { useEffect, useRef, useState } from 'react';
import { api, fmtSize, uploadFiles } from '../lib.js';
import './sendToScreens.css';

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-m4v,video/webm,application/pdf,.pdf,.mov,.mp4,.m4v';

export default function SendToScreens({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', email: '', note: '', startDate: '', endDate: '', website: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState(null);
  const input = useRef(null);
  const top = useRef(null);
  useEffect(() => {
    api(`/send/${token}`).then(setInfo, (e) => setError(e.message));
  }, [token]);
  useEffect(() => {
    if (info?.church) document.title = `Send for the screens · ${info.church}`;
  }, [info]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const tooBig = info ? files.filter((x) => x.size > info.maxMB * 1024 * 1024) : [];
  const add = (fileList) => {
    const list = [...fileList]; // copy now: clearing the input empties its FileList
    setFiles((old) => [...old, ...list.filter((x) => !old.some((o) => o.name === x.name && o.size === x.size))].slice(0, 10));
  };

  const send = async (e) => {
    e.preventDefault();
    if (!files.length) return setFormError('Choose at least one picture, video or PDF.');
    if (tooBig.length) return setFormError(`${tooBig.map((x) => x.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over ${info.maxMB} MB.`);
    setBusy(true);
    setFormError('');
    setProgress(0);
    try {
      await uploadFiles(`/send/${token}`, files, { extra: f, onProgress: setProgress });
      setSent({ count: files.length, name: f.name });
      setFiles([]);
      top.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      if (err.status === 410) setError(err.message);
      else setFormError(err.message);
    }
    setBusy(false);
  };

  if (error)
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand name={info?.church} />
          <h1>Link not available</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  if (!info) return <div className="loading">Loading…</div>;

  return (
    <div className="guest-wrap sts-wrap" ref={top}>
      <Brand name={info.church} />
      {sent ? (
        <section className="card stack" aria-live="polite">
          <div className="rs-check" aria-hidden="true">
            ✓
          </div>
          <h1>Thanks, {sent.name.split(' ')[0]}. We got {sent.count === 1 ? 'it' : `all ${sent.count}`}.</h1>
          <p>Someone who looks after the church screens will check {sent.count === 1 ? 'it' : 'them'} before {sent.count === 1 ? 'it shows' : 'they show'}.</p>
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => setSent(null)}>
              Send something else
            </button>
          </div>
        </section>
      ) : (
        <form className="card stack" onSubmit={send}>
          <div className="stack-xs">
            <h1>Send something for the church screens</h1>
            {info.label && <p className="sts-label">{info.label}</p>}
            <p className="muted">Pictures, videos and PDFs. Someone who looks after the screens checks everything before it shows.</p>
          </div>

          <div
            className="sts-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.files);
            }}
          >
            <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id="sts-files" onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
            <label htmlFor="sts-files" className="btn btn-primary">
              Choose files
            </label>
            <span className="muted small">or drop them here · up to 10 at a time, {info.maxMB} MB each</span>
          </div>
          {files.length > 0 && (
            <ul className="sts-files">
              {files.map((x, i) => (
                <li key={`${x.name}${x.size}`} className={x.size > info.maxMB * 1024 * 1024 ? 'sts-big' : ''}>
                  <span className="grow">{x.name}</span>
                  <span className="muted small">{fmtSize(x.size)}</span>
                  <button type="button" className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Slides from PowerPoint, Keynote or Word? Save them as a PDF first (File → Export → PDF); each page shows on its own. Bigger videos than {info.maxMB} MB: AirDrop or email them instead.</p>

          <label className="field">
            <span>Your name</span>
            <input required maxLength={80} autoComplete="name" value={f.name} onChange={set('name')} />
          </label>
          <label className="field">
            <span>Email (optional, in case there’s a question)</span>
            <input type="email" maxLength={120} autoComplete="email" value={f.email} onChange={set('email')} />
          </label>
          <label className="field">
            <span>What is it? (optional)</span>
            <textarea rows={2} maxLength={800} value={f.note} onChange={set('note')} placeholder="e.g. Flyer for the youth lock-in on December 12" />
          </label>
          <div className="row-wrap fields-2">
            <label className="field">
              <span>Show from (optional)</span>
              <input type="date" min={info.today} value={f.startDate} onChange={set('startDate')} />
            </label>
            <label className="field">
              <span>Until (optional)</span>
              <input type="date" min={f.startDate || info.today} value={f.endDate} onChange={set('endDate')} />
            </label>
          </div>
          {/* People never see this; bots fill it in */}
          <label className="rs-hp" aria-hidden="true">
            Website
            <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} />
          </label>

          {formError && (
            <div className="error" role="alert">
              {formError}
            </div>
          )}
          {busy && (
            <div className="sts-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? `Sending… ${Math.round(progress * 100)}%` : `Send ${files.length > 1 ? `${files.length} files` : ''}`.trim()}
          </button>
          {info.expiresAt && <p className="muted small">This link works until {new Date(info.expiresAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</p>}
        </form>
      )}
    </div>
  );
}

function Brand({ name }) {
  return (
    <div className="brand brand-dark">
      <img src="/icon.svg" width="32" height="32" alt="" />
      <span>{name || 'Crew Call'}</span>
    </div>
  );
}
