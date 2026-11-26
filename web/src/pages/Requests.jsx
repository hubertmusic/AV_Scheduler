import { useCallback, useEffect, useState } from 'react';
import { ago, api, firstName, fmtDay, TYPE_LABEL } from '../lib.js';
import { Avatar, Empty, StatusChip, useApp } from '../ui.jsx';

export default function Requests() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [denying, setDenying] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api('/requests'));
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const where = (ev, pos) => (ev ? `${app.posLabel(pos)} · ${ev.title} · ${fmtDay(ev.date)}` : `${app.posLabel(pos)} · removed service`);

  const decide = async (r, action) => {
    setBusy(true);
    try {
      const out = await api(`/requests/${r.id}/${action}`, { method: 'POST', body: action === 'deny' ? { reason } : {} });
      if (action === 'approve') app.toast(out.status === 'approved' ? 'Approved — the schedule and calendar feeds are updated' : `Couldn’t apply it: ${out.reason}`);
      else app.toast('Request denied');
      setDenying(null);
      setReason('');
      await load();
      app.refreshPending();
    } catch (e) {
      app.toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tell = (r) => {
    const verb = r.status === 'approved' ? 'was approved' : 'wasn’t approved';
    const extra = r.status === 'approved' ? ' Your calendar feed is already updated.' : r.reason ? ` Reason: ${r.reason}` : '';
    app.openWa({
      title: `Tell ${r.from.name}`,
      text: `Hi ${firstName(r.from.name)}, your ${TYPE_LABEL[r.type].toLowerCase()} request for ${where(r.event, r.position)} ${verb}.${extra}`,
      recipients: [r.from],
    });
  };

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!list) return <div className="loading-inline">Loading…</div>;
  const pending = list.filter((r) => r.status === 'pending');
  const done = list.filter((r) => r.status !== 'pending');

  const card = (r) => (
    <article className="card stack-sm req" key={r.id}>
      <div className="row spread">
        <div className="row">
          <Avatar name={r.from?.name || '?'} size={34} />
          <div>
            <div className="strong">{r.from?.name}</div>
            <div className="muted small">{ago(r.createdAt)}</div>
          </div>
        </div>
        <StatusChip status={r.status} />
      </div>
      <div>
        <div className="eyebrow">{TYPE_LABEL[r.type]}</div>
        <div className="strong">{where(r.event, r.position)}</div>
        {r.type === 'transfer' && r.targetUser && <div className="small">To {r.targetUser.name}</div>}
        {r.type === 'swap' && r.targetEvent && (
          <div className="small">
            For {where(r.targetEvent, r.targetPosition)} ({r.targetUser?.name})
          </div>
        )}
        {r.note && <div className="muted small quote">“{r.note}”</div>}
        {r.reason && <div className="small danger">{r.reason}</div>}
        {r.decidedBy && <div className="muted small">Handled by {r.decidedBy.name}</div>}
      </div>
      {r.status === 'pending' && denying !== r.id && (
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(r, 'approve')}>
            Approve
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDenying(r.id)}>
            Deny
          </button>
        </div>
      )}
      {denying === r.id && (
        <div className="stack-sm">
          <label className="field">
            <span>Reason (optional, shown to {firstName(r.from?.name)})</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          <div className="row-wrap">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide(r, 'deny')}>
              Deny request
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDenying(null)}>
              Back
            </button>
          </div>
        </div>
      )}
      {(r.status === 'approved' || r.status === 'denied') && app.can.message && (
        <button type="button" className="btn btn-ghost self-start" onClick={() => tell(r)}>
          Tell {firstName(r.from?.name)} on WhatsApp
        </button>
      )}
    </article>
  );

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Shift requests</h1>
          <div className="muted">Approving updates the schedule and everyone’s calendar feed right away. If the schedule changed since the request, it’s refused with a reason instead.</div>
        </div>
      </div>
      <h2>Waiting on you ({pending.length})</h2>
      {pending.length === 0 ? <Empty>No pending requests.</Empty> : <div className="card-grid">{pending.map(card)}</div>}
      {done.length > 0 && (
        <>
          <h2>Recently handled</h2>
          <div className="card-grid">{done.map(card)}</div>
        </>
      )}
    </div>
  );
}
