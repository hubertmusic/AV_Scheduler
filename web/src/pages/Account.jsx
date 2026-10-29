import { useState } from 'react';
import { api, prettyPhone } from '../lib.js';
import { Modal, useApp } from '../ui.jsx';

export default function Account({ onClose }) {
  const app = useApp();
  const [f, setF] = useState({ name: app.me.name, phone: prettyPhone(app.me.phone || '') });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn, msg) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      app.toast(msg);
      await app.reload();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Your account" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => api('/account', { method: 'PATCH', body: f }), 'Saved'); }}>
        <label className="field">
          <span>Name</span>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </label>
        <label className="field">
          <span>Mobile (so leaders can reach you on WhatsApp)</span>
          <input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </label>
        <div className="muted small">Signed in as {app.me.email}</div>
        <button className="btn btn-primary self-start" disabled={busy}>Save</button>
      </form>
      <form className="stack divider-top" onSubmit={(e) => { e.preventDefault(); run(() => api('/account/password', { method: 'POST', body: pw }), 'Password changed'); }}>
        <h3>Change password</h3>
        <input type="email" value={app.me.email} autoComplete="username" readOnly hidden />
        <label className="field">
          <span>Current password</span>
          <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        </label>
        <label className="field">
          <span>New password (8+ characters)</span>
          <input type="password" autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required />
        </label>
        <button className="btn btn-outline self-start" disabled={busy}>Change password</button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
    </Modal>
  );
}
