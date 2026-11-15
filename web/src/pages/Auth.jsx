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

export function Login({ orgName, notice, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    onDone();
  });
  if (forgot) return <Forgot email={email} orgName={orgName} onBack={() => setForgot(false)} />;
  return (
    <AuthCard title="Sign in" sub={orgName ? `${orgName} scheduling` : null}>
      <form onSubmit={submit} className="stack">
        {notice && (
          <div className="warn-box" role="status">
            {notice}
          </div>
        )}
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
        <button type="button" className="link-btn self-start" onClick={() => setForgot(true)}>
          Forgot your password?
        </button>
        <p className="muted small">New here? Use the invite link your team leader sent you.</p>
      </form>
    </AuthCard>
  );
}

// "Forgot password?": emails a reset link that works for an hour
function Forgot({ email: initial, orgName, onBack }) {
  const [email, setEmail] = useState(initial || '');
  const [sent, setSent] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    await api('/auth/forgot', { method: 'POST', body: { email } });
    setSent(true);
  });
  if (sent)
    return (
      <AuthCard title="Check your email" sub={orgName || null}>
        <div className="stack">
          <p>
            If <strong>{email}</strong> has a Crew Call account, a link to choose a new password is on its way. It works for one hour.
          </p>
          <p className="muted small">Nothing after a few minutes? Check your spam folder, or ask your team leader for a sign-in link.</p>
          <button type="button" className="btn btn-outline" onClick={onBack}>
            Back to sign in
          </button>
        </div>
      </AuthCard>
    );
  return (
    <AuthCard title="Reset your password" sub="We’ll email you a link to choose a new one.">
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Email you sign in with</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a link'}
        </button>
        <button type="button" className="link-btn self-start" onClick={onBack}>
          Back to sign in
        </button>
      </form>
    </AuthCard>
  );
}

// /reset/<token>: choose a new password (from the email, or a link a leader sent)
export function ResetPassword({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    api(`/auth/reset/${token}`).then(setInfo, (e) => setLoadErr(e.message));
  }, [token]);
  const { busy, error, submit } = useSubmit(async () => {
    if (password !== confirm) throw new Error('The two passwords don’t match.');
    await api(`/auth/reset/${token}`, { method: 'POST', body: { password } });
    onDone();
  });
  if (loadErr)
    return (
      <AuthCard title="Reset link not valid">
        <p className="error">{loadErr}</p>
        <a className="btn btn-outline" href="/">
          Go to sign in
        </a>
      </AuthCard>
    );
  if (!info) return <AuthCard title="Loading…" />;
  return (
    <AuthCard title={`New password for ${info.name.split(' ')[0]}`} sub={`${info.orgName} · you sign in with ${info.email}. Any other devices will be signed out.`}>
      <form onSubmit={submit} className="stack">
        <input type="email" value={info.email} autoComplete="username" readOnly hidden />
        <label className="field">
          <span>New password (8+ characters)</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <span>Type it again</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save and sign in'}
        </button>
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
