import { useEffect, useState } from 'react';
import { api, unsaved } from '../lib.js';
import { Icon, useApp } from '../ui.jsx';

const DAY_NAMES = ['Friday', 'Sabbath', 'Sunday'];

export default function Settings() {
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="muted">Only you (the admin) see this page.</div>
        </div>
      </div>
      <div className="split">
        <div className="main-col stack-lg">
          <Template />
        </div>
        <div className="side-col stack-lg">
          <Reminders />
          <General />
          <Positions />
        </div>
      </div>
    </div>
  );
}

function useSaver() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn, msg) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      app.toast(msg);
      await app.reload();
      return true;
    } catch (e) {
      setError(e.message);
      app.toast(`Not saved: ${e.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Reminders() {
  const app = useApp();
  const { settings } = app;
  const [on, setOn] = useState(settings.reminderEmails);
  const [days, setDays] = useState(settings.reminderDays);
  const { busy, error, run } = useSaver();
  const [note, setNote] = useState('');
  const test = async () => {
    setNote('');
    try {
      const r = await api('/settings/test-email', { method: 'POST' });
      setNote(`Test email sent to ${r.sentTo}. Check your inbox (and spam).`);
    } catch (e) {
      setNote(e.message);
    }
  };
  const runNow = async () => {
    setNote('');
    try {
      const r = await api('/weekend/reminders/run', { method: 'POST' });
      setNote(r.skipped ? r.skipped : `${r.sent} reminder${r.sent === 1 ? '' : 's'} sent.`);
    } catch (e) {
      setNote(e.message);
    }
  };
  return (
    <section className="card stack" aria-label="Reminders">
      <h2>Shift reminders</h2>
      {settings.emailConfigured ? (
        <p className="small good strong">Email is set up.</p>
      ) : (
        <p className="small">
          Email isn’t set up yet. Add <code>SMTP_URL</code> and <code>MAIL_FROM</code> to the server’s <code>.env</code> and restart (the README shows a Gmail example). Until then, use the WhatsApp reminder list on Weekend check.
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={on} onChange={() => setOn(!on)} />
        <span>Email everyone before each shift</span>
      </label>
      <label className="field field-row">
        <span className="small">Days before</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">Each person gets one email per shift: call time, crew, songs, a Confirm link and their Quick review link.</p>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row-wrap">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api('/settings', { method: 'PATCH', body: { reminderEmails: on, reminderDays: days } }), 'Reminder settings saved')}>
          Save
        </button>
        {settings.emailConfigured && (
          <>
            <button type="button" className="btn btn-ghost" onClick={test}>
              Send me a test
            </button>
            <button type="button" className="btn btn-ghost" onClick={runNow}>
              Send due reminders now
            </button>
          </>
        )}
      </div>
      {note && <p className="small">{note}</p>}
    </section>
  );
}

function General() {
  const { settings } = useApp();
  const [f, setF] = useState({ orgName: settings.orgName, timezone: settings.timezone, countryCode: settings.countryCode, groupLink: settings.groupLink });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSaver();
  return (
    <section className="card stack" aria-label="General">
      <h2>General</h2>
      <label className="field">
        <span>Team name</span>
        <input value={f.orgName} onChange={set('orgName')} />
      </label>
      <label className="field">
        <span>Time zone</span>
        <input value={f.timezone} onChange={set('timezone')} list="tz-list" />
        <datalist id="tz-list">
          {['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu', 'Europe/London'].map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Default country code for phone numbers</span>
        <input value={f.countryCode} onChange={set('countryCode')} inputMode="numeric" />
      </label>
      <label className="field">
        <span>WhatsApp crew group invite link (optional)</span>
        <input type="text" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={f.groupLink} onChange={set('groupLink')} placeholder="https://chat.whatsapp.com/…" />
      </label>
      <p className="muted small">With a group link, message sheets get a “Copy &amp; open crew group” button. WhatsApp doesn’t let other apps pre-fill a group message, so the text is copied for you to paste.</p>
      {error && <div className="error" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary self-start" disabled={busy} onClick={() => run(() => api('/settings', { method: 'PATCH', body: f }), 'Settings saved')}>
        Save
      </button>
    </section>
  );
}

function Positions() {
  const { positions } = useApp();
  const [labels, setLabels] = useState(Object.fromEntries(positions.map((p) => [p.key, p.label])));
  const [newLabel, setNewLabel] = useState('');
  const { busy, error, run } = useSaver();

  const move = (i, dir) =>
    run(async () => {
      const list = [...positions];
      const [p] = list.splice(i, 1);
      list.splice(i + dir, 0, p);
      for (let j = 0; j < list.length; j++) if (list[j].order !== j) await api(`/positions/${list[j].key}`, { method: 'PATCH', body: { order: j } });
    }, 'Order saved');

  return (
    <section className="card stack" aria-label="Positions">
      <h2>Positions</h2>
      <ul className="pos-list">
        {positions.map((p, i) => (
          <li key={p.key}>
            <label className="field grow">
              <span className="sr-only">Name for {p.label}</span>
              <input value={labels[p.key] ?? p.label} onChange={(e) => setLabels({ ...labels, [p.key]: e.target.value })} />
            </label>
            {labels[p.key] !== undefined && labels[p.key] !== p.label && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api(`/positions/${p.key}`, { method: 'PATCH', body: { label: labels[p.key] } }), 'Renamed')}>
                Save
              </button>
            )}
            <button type="button" className="icon-btn" aria-label={`Move ${p.label} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
              <Icon name="up" />
            </button>
            <button type="button" className="icon-btn" aria-label={`Move ${p.label} down`} disabled={busy || i === positions.length - 1} onClick={() => move(i, 1)}>
              <Icon name="down" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${p.label}`}
              disabled={busy}
              onClick={() => window.confirm(`Remove ${p.label}? It will be taken off everyone’s trained positions.`) && run(() => api(`/positions/${p.key}`, { method: 'DELETE' }), 'Position removed')}
            >
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => api('/positions', { method: 'POST', body: { label: newLabel } }), `Added ${newLabel}`).then(() => setNewLabel(''));
        }}
      >
        <label className="field grow">
          <span className="sr-only">New position</span>
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New position, e.g. Graphics" required />
        </label>
        <button className="btn btn-outline" disabled={busy}>
          <Icon name="plus" /> Add
        </button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

function Template() {
  const { settings, positions, groups } = useApp();
  const fromSettings = () => settings.weekendTemplate.map((t) => ({ ...t, kind: t.kind || 'service', needs: [...t.needs], groups: (t.groups || []).map(String), off: Boolean(t.off) }));
  const [rows, setRows] = useState(fromSettings);
  const [saved, setSaved] = useState(() => JSON.stringify(fromSettings()));
  const dirty = JSON.stringify(rows) !== saved;
  useEffect(() => {
    if (dirty) unsaved.add('template');
    else unsaved.delete('template');
    return () => unsaved.delete('template');
  }, [dirty]);
  const { busy, error, run } = useSaver();
  const save = async () => {
    const sorted = [...rows].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
    const ok = await run(() => api('/settings', { method: 'PATCH', body: { weekendTemplate: sorted } }), 'Template saved. Use “Sync with template” on the Schedule to apply it to weekends already built.');
    if (ok) {
      setRows(sorted);
      setSaved(JSON.stringify(sorted));
    }
  };
  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (i, k) => upd(i, { needs: rows[i].needs.includes(k) ? rows[i].needs.filter((x) => x !== k) : [...rows[i].needs, k] });
  const toggleGroup = (i, id) => {
    const cur = rows[i].groups || [];
    upd(i, { groups: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  return (
    <section className="card stack" aria-label="Weekend template">
      <div>
        <h2>Weekend template</h2>
        <p className="muted small">
          “Build this weekend” on the Schedule creates these services and sound checks. Turn a service <strong>off</strong> to stop using it without losing its settings. For a weekend that’s already built, press <strong>Sync with template</strong> on the Schedule: it adds missing services, offers to update ones you changed here, and offers to take off ones you removed or turned off.
        </p>
      </div>
      {dirty && (
        <div className="warn-box row-wrap spread">
          <span>You have unsaved changes to the template.</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
            Save template
          </button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      {rows.map((r, i) => (
        <div key={i} className={`tmpl-row stack-sm ${r.off ? 'tmpl-off' : ''}`}>
          <div className="row-wrap spread">
            <label className="switch">
              <input type="checkbox" checked={!r.off} onChange={() => upd(i, { off: !r.off })} />
              <span>{r.off ? 'Off — not built on weekends' : 'On — built every weekend'}</span>
            </label>
            {r.off && r.title && <span className="muted small">{r.title} stays here so you can turn it back on later.</span>}
          </div>
          <div className="row-wrap fields-5">
            <label className="field">
              <span>Type</span>
              <select value={r.kind || 'service'} onChange={(e) => upd(i, { kind: e.target.value })}>
                <option value="service">Service</option>
                <option value="soundcheck">Sound check</option>
              </select>
            </label>
            <label className="field">
              <span>Day</span>
              <select value={r.day} onChange={(e) => upd(i, { day: Number(e.target.value) })}>
                {DAY_NAMES.map((d, n) => (
                  <option key={d} value={n}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-wide">
              <span>Service</span>
              <input value={r.title} onChange={(e) => upd(i, { title: e.target.value })} />
            </label>
            <label className="field">
              <span>Call</span>
              <input type="time" value={r.call} onChange={(e) => upd(i, { call: e.target.value })} />
            </label>
            <label className="field">
              <span>Starts</span>
              <input type="time" value={r.start} onChange={(e) => upd(i, { start: e.target.value })} />
            </label>
            <label className="field">
              <span>Ends</span>
              <input type="time" value={r.end} onChange={(e) => upd(i, { end: e.target.value })} />
            </label>
          </div>
          <div className="row-wrap spread">
            <div className="check-grid">
              {positions.map((p) => (
                <label key={p.key} className="check">
                  <input type="checkbox" checked={r.needs.includes(p.key)} onChange={() => toggle(i, p.key)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          {groups.length > 0 && (
            <div className="row-wrap">
              <span className="label-sm">Groups:</span>
              {groups.map((g) => (
                <label key={g.id} className="check">
                  <input type="checkbox" checked={(r.groups || []).includes(g.id)} onChange={() => toggleGroup(i, g.id)} />
                  <span>{g.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="row-wrap">
        <button type="button" className="btn btn-outline" onClick={() => setRows([...rows, { day: 1, title: '', kind: 'service', start: '11:00', call: '10:15', end: '12:30', needs: [], groups: [] }])}>
          <Icon name="plus" /> Add a service
        </button>
        <button type="button" className="btn btn-outline" onClick={() => setRows([...rows, { day: 1, title: 'Sound check', kind: 'soundcheck', start: '09:45', call: '09:30', end: '10:15', needs: ['foh'], groups: [] }])}>
          <Icon name="mic" /> Add a sound check
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
          {dirty ? 'Save template' : 'Saved'}
        </button>
      </div>
    </section>
  );
}
