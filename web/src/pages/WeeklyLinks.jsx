// Weekly links (Service plans → Weekly links): one permanent link and code for each person who
// sends things every week, like the pastor or worship leader. It always opens the next matching
// service, with the deadline a set time before it.
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDay, fmtTime, fmtWhen, waLink } from '../lib.js';
import { Empty, Modal, useApp } from '../ui.jsx';

const DAYS = [
  [0, 'the same day'],
  [1, '1 day before'],
  [2, '2 days before'],
  [3, '3 days before'],
  [4, '4 days before'],
  [5, '5 days before'],
  [6, '6 days before'],
];
const urlOf = (t) => `${window.location.origin}/weekly/${t}`;
const deadlineText = (l) => `${DAYS.find((d) => d[0] === l.deadlineDays)?.[1] || ''} at ${fmtTime(l.deadlineTime)}`;

export default function WeeklyLinks() {
  const app = useApp();
  const [d, setD] = useState(null);
  const [editing, setEditing] = useState(null); // link or 'new'

  const load = useCallback(() => api('/standing-links').then(setD, (e) => app.toast(e.message)), [app]);
  useEffect(() => {
    load();
  }, [load]);

  if (!app.can.plans) return <Empty>Only people who can edit service plans manage weekly links.</Empty>;
  if (!d) return <div className="loading-inline">Loading…</div>;

  return (
    <div className="stack">
      <div className="row-wrap">
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          New weekly link
        </button>
        <span className="small muted">Send it once. Each week it opens the next service, so you don’t make a new guest link every time.</span>
      </div>
      {d.links.length === 0 && <Empty>No weekly links yet. Make one for your pastor or worship leader.</Empty>}
      <div className="wl-grid">
        {d.links.map((l) => (
          <WeeklyCard key={l.id} l={l} onEdit={() => setEditing(l)} onChanged={load} />
        ))}
      </div>
      {editing && <WeeklyModal link={editing === 'new' ? null : editing} titles={d.titles} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />}
    </div>
  );
}

function WeeklyCard({ l, onEdit, onChanged }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const url = urlOf(l.token);
  const message = `Hi! Here’s your weekly link for ${app.settings.orgName || 'the AV team'}. Use it every week to send sermon notes, Bible texts, songs and files for the next ${l.serviceTitle || 'service'}.\n\n${url}\nCode: ${l.code}\n\nPlease send everything by ${deadlineText(l)} the service. Save this message; the link and code stay the same.`;
  const act = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      if (msg) app.toast(msg);
      onChanged();
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  return (
    <section className="card stack-sm wl-card">
      <div className="section-head">
        <div>
          <h3>{l.name}</h3>
          <p className="small muted">
            Every {l.serviceTitle || 'service'} · deadline {deadlineText(l)}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="wl-code" aria-label="Code">
        {l.code}
      </div>
      <p className="small">
        {l.next ? (
          <>
            Opens <strong>{l.next.title}</strong>, {fmtDay(l.next.date)} {fmtTime(l.next.start)} · deadline {fmtWhen(l.next.closesAt)}
          </>
        ) : (
          <span className="muted">No upcoming {l.serviceTitle || 'service'} is scheduled yet.</span>
        )}
      </p>
      <div className="row-wrap">
        <a className="btn btn-primary btn-sm" href={waLink('', message)} target="_blank" rel="noopener noreferrer">
          Send link + code
        </a>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => navigator.clipboard.writeText(`${url}\nCode: ${l.code}`).then(() => app.toast('Copied'), () => app.toast(url))}>
          Copy
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api(`/standing-links/${l.id}/new-code`, { method: 'POST' }), 'New code made. Send it to them; the old one stops working.')}>
          New code
        </button>
        {confirmOff ? (
          <>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(() => api(`/standing-links/${l.id}`, { method: 'DELETE' }), 'Weekly link turned off')}>
              Turn it off
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmOff(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmOff(true)}>
            Turn off…
          </button>
        )}
      </div>
    </section>
  );
}

function WeeklyModal({ link, titles, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({
    name: link?.name || '',
    note: link?.note || '',
    serviceTitle: link?.serviceTitle ?? (titles.includes('Worship Service') ? 'Worship Service' : ''),
    deadlineDays: link?.deadlineDays ?? 2,
    deadlineTime: link?.deadlineTime || '18:00',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: k === 'deadlineDays' ? Number(e.target.value) : e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(link ? `/standing-links/${link.id}` : '/standing-links', { method: link ? 'PATCH' : 'POST', body: f });
      app.toast(link ? 'Saved' : 'Weekly link made');
      onSaved();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={link ? `Edit ${link.name}’s weekly link` : 'New weekly link'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Who it’s for</span>
          <input required maxLength={80} value={f.name} onChange={set('name')} placeholder="Pastor James" />
        </label>
        <label className="field">
          <span>For which services</span>
          <select value={f.serviceTitle} onChange={set('serviceTitle')}>
            <option value="">Any service</option>
            {titles.map((t) => (
              <option key={t} value={t}>
                Every {t}
              </option>
            ))}
          </select>
        </label>
        <div className="row-wrap">
          <label className="field">
            <span>Deadline</span>
            <select value={f.deadlineDays} onChange={set('deadlineDays')}>
              {DAYS.map(([n, label]) => (
                <option key={n} value={n}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>at</span>
            <input type="time" value={f.deadlineTime} onChange={set('deadlineTime')} required />
          </label>
        </div>
        <p className="small muted">Before the deadline, what they send goes straight into the plan. After it, it waits for a leader’s approval, the same as other guest links.</p>
        <label className="field">
          <span>Note for them (optional)</span>
          <input maxLength={300} value={f.note} onChange={set('note')} placeholder="Sermon notes, Bible texts and any videos" />
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : link ? 'Save' : 'Make the link'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// /weekly/<token>: find this week's guest page and go there
export function WeeklyRedirect({ token }) {
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/public/weekly/${token}`).then(
      (r) => window.location.replace(`/guest/${r.token}`),
      (e) => setError(e.message)
    );
  }, [token]);
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {error ? (
          <>
            <h1>Can’t open this link</h1>
            <p className="muted">{error}</p>
          </>
        ) : (
          <p className="muted">Opening this week’s service…</p>
        )}
      </div>
    </div>
  );
}
