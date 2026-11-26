import { useState } from 'react';
import { addDays, api, fmtDay, fridayOf, todayISO, weekendLabel } from './lib.js';
import { Icon, Modal, useApp } from './ui.jsx';

// The notes that apply to a shift: permanent → this weekend → this shift.
export function noticesFor(app, date, shiftNote) {
  const a = app.announcements || {};
  const out = [];
  if (a.permanent?.text) out.push({ kind: 'permanent', label: 'Important', text: a.permanent.text });
  const w = date ? a.weekly?.[fridayOf(date)] : null;
  if (w?.text) out.push({ kind: 'weekly', label: 'This weekend', text: w.text });
  if (shiftNote) out.push({ kind: 'shift', label: 'For this shift', text: shiftNote });
  return out;
}

function Clamp({ text, lines }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 70 || text.split('\n').length > lines;
  return (
    <>
      <span className={`notice-text ${!open && long ? 'notice-clamp' : ''}`} style={{ '--lines': lines }}>
        {text}
      </span>
      {long && (
        <button type="button" className="link-btn small notice-more" onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </>
  );
}

// compact: smaller, clamped — used at the top of each shift card.
export function Notices({ items, compact, onEdit }) {
  if (!items.length && !onEdit) return null;
  return (
    <div className={`notices ${compact ? 'notices-compact' : ''}`}>
      {items.map((n) => (
        <div key={n.kind} className={`notice notice-${n.kind}`} role="note">
          <span className="notice-label">{n.label}</span>
          <Clamp text={n.text} lines={compact ? 2 : 6} />
        </div>
      ))}
      {onEdit && (
        <button type="button" className="btn btn-ghost btn-sm self-start" onClick={onEdit}>
          <Icon name="edit" size={14} /> {items.some((n) => n.kind !== 'shift') ? 'Edit announcements' : 'Add an announcement'}
        </button>
      )}
    </div>
  );
}

export const canAnnounce = (app) => app.me.role === 'admin' || app.can.edit;

export function AnnouncementsModal({ friday: startFri, onClose }) {
  const app = useApp();
  const a = app.announcements || {};
  const [fri, setFri] = useState(startFri || fridayOf(todayISO()));
  const [perm, setPerm] = useState(a.permanent?.text || '');
  const [weekly, setWeekly] = useState(() => ({ ...Object.fromEntries(Object.entries(a.weekly || {}).map(([k, v]) => [k, v.text])) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const savedWeekly = a.weekly?.[fri]?.text || '';
  const wText = weekly[fri] ?? '';
  const dirty = perm !== (a.permanent?.text || '') || wText !== savedWeekly;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (perm !== (a.permanent?.text || '')) await api('/announcements/permanent', { method: 'PUT', body: { text: perm } });
      if (wText !== savedWeekly) await api(`/announcements/weekly/${fri}`, { method: 'PUT', body: { text: wText } });
      app.toast('Announcements saved — they show on every shift, in calendars and in reminders');
      await app.reload();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const share = () => {
    const parts = [];
    if (perm) parts.push(`IMPORTANT: ${perm}`);
    if (wText) parts.push(`This weekend (${weekendLabel(fri)}): ${wText}`);
    app.openWa({ title: 'Share announcements', text: `${app.settings.orgName} AV team\n\n${parts.join('\n\n')}`, recipients: [] });
  };

  return (
    <Modal title="Announcements" onClose={onClose} wide>
      <div className="stack">
        <label className="field">
          <span>Permanent — stays at the top of every shift until you change it</span>
          <textarea rows={3} value={perm} onChange={(e) => setPerm(e.target.value)} placeholder="e.g. Arrive 15 minutes before call time. Wear black. No food in the booth." maxLength={2000} />
        </label>
        {a.permanent?.by && <span className="muted small">Last changed by {a.permanent.by}</span>}
        <div className="stack-sm divider-top">
          <div className="section-head">
            <span className="field-title">Weekly — only on this weekend’s shifts</span>
            <div className="week-nav">
              <button type="button" className="icon-btn" aria-label="Previous weekend" onClick={() => setFri(addDays(fri, -7))}>
                <Icon name="chevL" />
              </button>
              <strong className="mono">{weekendLabel(fri)}</strong>
              <button type="button" className="icon-btn" aria-label="Next weekend" onClick={() => setFri(addDays(fri, 7))}>
                <Icon name="chevR" />
              </button>
            </div>
          </div>
          <label className="field">
            <span className="sr-only">Announcement for the weekend of {fmtDay(fri)}</span>
            <textarea rows={3} value={wText} onChange={(e) => setWeekly({ ...weekly, [fri]: e.target.value })} placeholder="e.g. Communion this Sabbath — set an extra mic at the table." maxLength={2000} />
          </label>
          {a.weekly?.[fri]?.by && <span className="muted small">Last changed by {a.weekly[fri].by}</span>}
        </div>
        <p className="muted small">For a note about one service only (e.g. “Baptism after the sermon”), edit that service on the Schedule and use its “Important note for this shift”.</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
            Save
          </button>
          {(perm || wText) && (
            <button type="button" className="btn btn-green" onClick={share}>
              <Icon name="chat" size={16} /> Share on WhatsApp
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
