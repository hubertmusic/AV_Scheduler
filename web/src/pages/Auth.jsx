import { useEffect, useState } from 'react';
import { api } from '../lib.js';

function AuthCard({ title, sub, children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand brand-dark">
          <img src="/icon.svg" width="36" height="36" alt="" />
          <span>Crew Call</span>
        </div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function Login({ orgName, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    onDone();
  });
  return (
    <AuthCard title="Sign in" sub={orgName ? `${orgName} AV scheduling` : null}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted small">New to the crew? Use the invite link your team leader sent you. Forgot your password? Ask the admin for a reset link.</p>
      </form>
    </AuthCard>
  );
}

export function Setup({ onDone }) {
  const [f, setF] = useState({ orgName: '', name: '', email: '', phone: '', password: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/setup', { method: 'POST', body: f });
    onDone();
  });
  return (
    <AuthCard title="Set up Crew Call" sub="You’ll be the admin. You can invite your crew and name team leaders next.">
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Organization or team name</span>
          <input required value={f.orgName} onChange={set('orgName')} placeholder="e.g. Church AV Crew" />
        </label>
        <label className="field">
          <span>Your name</span>
          <input required autoComplete="name" value={f.name} onChange={set('name')} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span>Mobile number (for WhatsApp)</span>
          <input type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} placeholder="(423) 555-0100" />
        </label>
        <label className="field">
          <span>Password (8+ characters)</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Setting up…' : 'Create admin account'}
        </button>
      </form>
    </AuthCard>
  );
}

export function Invite({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    api(`/auth/invite/${token}`).then(setInfo, (e) => setLoadErr(e.message));
  }, [token]);
  const { busy, error, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('The two passwords don’t match.');
    await api(`/auth/invite/${token}`, { method: 'POST', body: { password } });
    onDone();
  });
  if (loadErr)
    return (
      <AuthCard title="Invite link not valid">
        <p className="error">{loadErr}</p>
        <a className="btn btn-outline" href="/">Go to sign in</a>
      </AuthCard>
    );
  if (!info) return <AuthCard title="Loading…" />;
  return (
    <AuthCard title={`Welcome, ${info.name.split(' ')[0]}`} sub={`Choose a password to join ${info.orgName}. You’ll sign in with ${info.email}.`}>
      <form onSubmit={submit} className="stack">
        <input type="email" value={info.email} autoComplete="username" readOnly hidden />
        <label className="field">
          <span>Password (8+ characters)</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <span>Type it again</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Join the crew'}
        </button>
      </form>
    </AuthCard>
  );
}
