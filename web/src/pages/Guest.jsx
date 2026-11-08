import { useCallback, useEffect, useState } from 'react';
import { api, fmtDay, fmtSize, fmtTime, fmtWhen, uploadFiles } from '../lib.js';
import { BibleFields } from '../scripture.jsx';
import { DropZone } from '../ui.jsx';
import { LYRICS_HINT } from './Songs.jsx';

// Public page for outside guests: their link + 6-digit code opens one service. They only see
// what they've sent. Until the deadline, what they submit goes straight into the plan and they
// can change it; after it, changes go to the team for approval.
const KINDS = { note: 'Note', scripture: 'Bible text', song: 'Song', media: 'File' };
const STATUS = {
  draft: ['Draft — only you can see it', 'chip-draft'],
  live: ['In the service plan', 'chip-approved'],
  approved: ['In the service plan', 'chip-approved'],
  pending: ['Waiting for the team to approve', 'chip-pending'],
};

function Shell({ orgName, children }) {
  return (
    <div className="guest-wrap">
      <div className="brand brand-dark">
        <img src="/icon.svg" width="32" height="32" alt="" />
        <span>{orgName || 'Crew Call'}</span>
      </div>
      {children}
    </div>
  );
}

export default function Guest({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      setInfo(await api(`/guest/${token}`));
    } catch (e) {
      if (e.status === 401) setInfo((cur) => ({ ...(cur || {}), needsCode: true }));
      else setError(e.message);
    }
  }, [token]);
  useEffect(() => {
    load();
  }, [load]);

  // Refresh when the window opens, locks or the link runs out, so the page never acts on stale rules.
  useEffect(() => {
    if (!info?.schedule) return undefined;
    const times = [info.schedule.opensAt, info.schedule.closesAt, info.schedule.expiresAt].map((t) => (t ? new Date(t) - Date.now() : -1)).filter((ms) => ms > 0);
    if (!times.length) return undefined;
    const t = setTimeout(load, Math.min(Math.min(...times) + 1000, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [info, load]);

  const done = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
    load();
  };
  const fail = (e) => {
    if (e.status === 410) setError(e.message);
    if (e.status === 401) load();
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
  if (info.needsCode) return <CodeEntry token={token} info={info} onDone={load} />;

  const ev = info.event;
  const sch = info.schedule;
  const locked = sch.state === 'locked';
  const waiting = sch.state === 'waiting';

  return (
    <Shell orgName={info.orgName}>
      <div className="stack-sm">
        <h1>Hi {info.name}</h1>
        <div className="guest-service">
          <span className="label-sm">Service</span>
          <strong>{ev.title}</strong>
          <span>
            {fmtDay(ev.date)} · starts {fmtTime(ev.start)}
            {ev.end ? `, ends ${fmtTime(ev.end)}` : ''}
          </span>
        </div>
        {info.note && <p className="warn-box">{info.note}</p>}
        <div className={`guest-window guest-window-${sch.state}`} role="status">
          {sch.legacy ? (
            <>The AV team reviews everything you send. This link works until {fmtWhen(sch.expiresAt)}.</>
          ) : waiting ? (
            <>
              You can start adding things <strong>{fmtWhen(sch.opensAt)}</strong>. Deadline: {fmtWhen(sch.closesAt)}.
            </>
          ) : locked ? (
            <>
              <strong>Locked</strong> since {fmtWhen(sch.closesAt)}. You can still send changes, and the team will approve them, until {fmtWhen(sch.expiresAt)}.
            </>
          ) : (
            <>
              Add and change things until <strong>{fmtWhen(sch.closesAt)}</strong>. What you submit goes straight into the service plan. After the deadline it locks, and changes go to the team for approval.
            </>
          )}
        </div>
      </div>

      {!waiting && <AddSection token={token} info={info} locked={locked} onDone={done} fail={fail} />}

      <section className="card stack" aria-label="What you’ve added">
        <h2>What you’ve added</h2>
        <p className="muted small">Only you can see this list. Drafts stay private until you submit them.</p>
        {info.submissions.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="guest-items">
          {info.submissions.map((s) => (
            <GuestItem key={s.id} s={s} token={token} state={sch.state} onDone={done} fail={fail} />
          ))}
        </ul>
      </section>
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </Shell>
  );
}

function CodeEntry({ token, info, onDone }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/guest/${token}/unlock`, { method: 'POST', body: { code } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="auth-wrap">
      <form className="auth-card stack" onSubmit={submit}>
        <div className="brand brand-dark">
          <img src="/icon.svg" width="36" height="36" alt="" />
          <span>{info.orgName || 'Crew Call'}</span>
        </div>
        <h1>{info.name ? `Hi ${info.name}` : 'Enter your code'}</h1>
        <p className="muted">Enter the 6-digit code that came with your link.</p>
        <label className="field">
          <span>Code</span>
          <input
            className="code-input mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
          />
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || code.replace(/\D/g, '').length !== 6}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function AddSection({ token, info, locked, onDone, fail }) {
  const [tab, setTab] = useState('files');
  const tabs = [
    ['files', 'Files'],
    ['note', 'Note'],
    ['scripture', 'Bible text'],
    ['song', 'Song lyrics'],
  ];
  return (
    <section className="card stack" aria-label="Add something">
      <h2>{locked ? 'Send a late addition' : 'Add something'}</h2>
      <div className="seg" role="group" aria-label="What are you adding?">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'files' && (
        <DropZone
          maxMB={info.maxUploadMB}
          hint={`Slides, videos, photos, audio, documents — up to ${info.maxUploadMB} MB each. ${locked ? 'They’ll go to the team for approval.' : 'They go straight into the service plan.'} For bigger videos, AirDrop or email them to the team.`}
          onFiles={async (files, onProgress) => {
            const r = await uploadFiles(`/guest/${token}/files`, files, { onProgress }).catch(fail);
            onDone(r?.status === 'live' ? `Added ${files.length} file${files.length === 1 ? '' : 's'} to the plan` : `Sent ${files.length} file${files.length === 1 ? '' : 's'} for approval`);
          }}
        />
      )}
      {tab !== 'files' && <ItemForm key={tab} kind={tab} token={token} locked={locked} onDone={onDone} fail={fail} />}
    </section>
  );
}

const EMPTY = {
  note: { text: '' },
  scripture: { reference: '', version: 'KJV', text: '' },
  song: { title: '', artist: '', key: '', lyrics: '' },
};

// Add a new item, or edit one (`item`). Drafts can be saved and finished later.
function ItemForm({ kind, token, locked, item, onDone, fail, onCancel }) {
  const start = item ? { ...EMPTY[kind], ...(item.change?.data || item.data) } : EMPTY[kind];
  const [f, setF] = useState(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isDraft = !item || item.status === 'draft';

  const send = async (submit) => {
    setBusy(true);
    setError('');
    try {
      const body = { kind, ...f, draft: !submit, submit };
      const r = item ? await api(`/guest/${token}/items/${item.id}`, { method: 'PATCH', body }).catch(fail) : await api(`/guest/${token}/items`, { method: 'POST', body }).catch(fail);
      const msg =
        r.status === 'draft'
          ? 'Draft saved. Only you can see it until you submit it.'
          : r.status === 'live'
            ? item && item.status === 'live'
              ? 'Updated in the service plan'
              : 'Added to the service plan'
            : r.status === 'change-pending'
              ? 'Change sent to the team for approval'
              : 'Sent to the team for approval';
      if (!item) setF(EMPTY[kind]);
      onDone(msg);
      onCancel?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = !item || item.status === 'draft' ? (locked ? 'Send for approval' : 'Submit') : item.status === 'live' ? (locked ? 'Send change for approval' : 'Save changes') : 'Update request';

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        send(true);
      }}
    >
      {kind === 'note' && (
        <label className="field">
          <span>Note for the AV team</span>
          <textarea rows={6} required value={f.text} onChange={set('text')} placeholder="Sermon outline, when to show which slide, video cues, mic needs…" />
        </label>
      )}
      {kind === 'scripture' && <BibleFields value={f} onChange={setF} refPlaceholder="e.g. Psalm 23:1-4" rows={5} />}
      {kind === 'song' && (
        <>
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
        </>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="row-wrap">
        <button className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
        {isDraft && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => send(false)}>
            Save draft
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function GuestItem({ s, token, state, onDone, fail }) {
  const [editing, setEditing] = useState(false);
  const locked = state === 'locked';
  const title = s.kind === 'media' ? s.media?.name || s.data.name : s.kind === 'note' ? (s.data.text || '').split('\n')[0].slice(0, 80) : s.kind === 'scripture' ? s.data.reference : s.data.title;
  const [label, chip] = s.change ? ['Change waiting for the team to approve', 'chip-pending'] : STATUS[s.status] || [s.status, ''];
  const canEdit = s.kind !== 'media' && s.status !== 'approved';
  const canRemove = s.status === 'draft' || s.status === 'pending' || (s.status === 'live' && !locked);

  const remove = async () => {
    const msg = s.status === 'live' ? `Take “${title}” out of the service plan?` : `Delete “${title}”?`;
    if (!window.confirm(msg)) return;
    try {
      await api(`/guest/${token}/items/${s.id}`, { method: 'DELETE' }).catch(fail);
      onDone(s.status === 'live' ? 'Taken out of the plan' : 'Deleted');
    } catch (e) {
      window.alert(e.message);
    }
  };
  const withdraw = async () => {
    try {
      await api(`/guest/${token}/changes/${s.change.id}`, { method: 'DELETE' }).catch(fail);
      onDone('Change withdrawn');
    } catch (e) {
      window.alert(e.message);
    }
  };

  return (
    <li className="guest-item">
      <div className="row-wrap spread">
        <span className="stack-xs grow">
          <span className="eyebrow">{KINDS[s.kind]}</span>
          <strong className="ellipsis">{title || KINDS[s.kind]}</strong>
          <span className="muted small">
            {s.kind === 'media' && s.media ? `${fmtSize(s.media.size)} · ` : ''}
            {fmtWhen(s.updatedAt || s.createdAt)}
          </span>
        </span>
        <span className={`chip ${chip}`}>{label}</span>
      </div>
      {!editing && (
        <div className="row-wrap">
          {canEdit && state !== 'waiting' && (
            <button type="button" className="btn btn-outline" onClick={() => setEditing(true)}>
              {s.status === 'draft' ? 'Edit draft' : s.status === 'live' && locked ? 'Request a change' : 'Edit'}
            </button>
          )}
          {s.change && (
            <button type="button" className="btn btn-ghost" onClick={withdraw}>
              Withdraw change
            </button>
          )}
          {canRemove && (
            <button type="button" className="btn btn-ghost" onClick={remove}>
              {s.status === 'live' ? 'Take out' : 'Delete'}
            </button>
          )}
        </div>
      )}
      {editing && <ItemForm kind={s.kind} token={token} locked={locked} item={s} onDone={onDone} fail={fail} onCancel={() => setEditing(false)} />}
    </li>
  );
}
