// Gear check-out: who has what, battery swaps, and anything that needs fixing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, fmtWhen } from '../lib.js';
import { Empty, Modal, useApp } from '../ui.jsx';

export default function Gear() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null); // item id showing its history
  const [filter, setFilter] = useState('all');

  const load = useCallback(() => api('/gear').then(setList, (e) => app.toast(e.message)), [app]);
  useEffect(() => {
    load();
  }, [load]);
  const replace = (g) => setList((cur) => cur.map((x) => (x.id === g.id ? g : x)));

  const shown = useMemo(() => {
    if (!list) return [];
    if (filter === 'out') return list.filter((g) => g.holder);
    if (filter === 'attention') return list.filter((g) => g.attention);
    if (filter === 'mine') return list.filter((g) => g.holderId === app.me.id);
    return list;
  }, [list, filter, app.me.id]);
  const groups = useMemo(() => {
    const out = {};
    for (const g of shown) (out[g.category || 'Other'] ||= []).push(g);
    return Object.entries(out).sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
  }, [shown]);
  const counts = list ? { out: list.filter((g) => g.holder).length, attention: list.filter((g) => g.attention).length, mine: list.filter((g) => g.holderId === app.me.id).length } : {};

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Gear</h1>
          <div className="muted">Who has the mics, camera bag and spare batteries, and what needs fixing.</div>
        </div>
        {app.can.plans && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            Add gear
          </button>
        )}
      </div>
      {list && list.length > 0 && (
        <div className="seg" role="group" aria-label="Show">
          {[
            ['all', `All (${list.length})`],
            ['out', `Checked out (${counts.out})`],
            ['attention', `Needs fixing (${counts.attention})`],
            ['mine', `With me (${counts.mine})`],
          ].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
      )}
      {!list && <div className="loading-inline">Loading…</div>}
      {list && list.length === 0 && <Empty>{app.can.plans ? 'No gear yet. Add the things people borrow or need to track, like wireless mics and the camera bag.' : 'No gear has been added yet.'}</Empty>}
      {list && list.length > 0 && shown.length === 0 && <Empty>Nothing here.</Empty>}
      {groups.map(([cat, items]) => (
        <section key={cat} className="card stack-sm" aria-label={cat}>
          <h3>{cat}</h3>
          <ul className="gear-list">
            {items.map((g) => (
              <GearRow key={g.id} g={g} onChange={replace} onRemoved={load} history={open === g.id} toggleHistory={() => setOpen(open === g.id ? null : g.id)} />
            ))}
          </ul>
        </section>
      ))}
      {adding && <AddGear categories={[...new Set((list || []).map((g) => g.category).filter(Boolean))]} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), load())} />}
    </div>
  );
}

function GearRow({ g, onChange, onRemoved, history, toggleHistory }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null); // give | attention | note
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const mine = g.holderId === app.me.id;
  const act = async (path, body, msg) => {
    setBusy(true);
    try {
      onChange(await api(`/gear/${g.id}/${path}`, { method: 'POST', body: body || {} }));
      if (msg) app.toast(msg);
      setMode(null);
      setText('');
      setTo('');
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  const remove = async () => {
    try {
      await api(`/gear/${g.id}`, { method: 'DELETE' });
      app.toast(`Removed ${g.name}`);
      onRemoved();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const people = app.people.filter((p) => p.active !== false && p.id !== app.me.id).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <li className={`gear-row${g.attention ? ' gear-attention' : ''}`}>
      <div className="gear-main">
        <div className="stack-xs">
          <strong>{g.name}</strong>
          <span className="small">
            {g.holder ? (
              <span className={mine ? 'good' : ''}>
                With {mine ? 'you' : g.holder} since {fmtWhen(g.outAt)}
              </span>
            ) : (
              <span className="muted">Available</span>
            )}
            {g.batteryAt && <span className="muted"> · batteries {ago(g.batteryAt)}</span>}
          </span>
          {g.attention && <span className="small danger">Needs fixing: {g.attention}</span>}
          {g.notes && <span className="small muted">{g.notes}</span>}
        </div>
        <div className="row-wrap gear-actions">
          {g.holder ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act('in', null, `Returned ${g.name}`)}>
              {mine ? 'Return' : 'Mark returned'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act('out', null, `You have ${g.name}`)}>
              Take it
            </button>
          )}
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setMode(mode === 'give' ? null : 'give')}>
            Give to…
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('log', { action: 'battery' }, 'Battery swap noted')}>
            Batteries swapped
          </button>
          {g.attention ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('log', { action: 'fixed' }, 'Marked as fixed')}>
              Fixed
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode(mode === 'attention' ? null : 'attention')}>
              Report a problem
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(mode === 'note' ? null : 'note')}>
            Note
          </button>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={history} onClick={toggleHistory}>
            History
          </button>
        </div>
      </div>
      {mode === 'give' && (
        <form className="row-wrap gear-form" onSubmit={(e) => (e.preventDefault(), act('out', to.startsWith('u:') ? { userId: to.slice(2) } : { name: text }, 'Checked out'))}>
          <select aria-label="Give to" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Give to…</option>
            {people.map((p) => (
              <option key={p.id} value={`u:${p.id}`}>
                {p.name}
              </option>
            ))}
            <option value="other">Someone else (type a name)</option>
          </select>
          {to === 'other' && <input aria-label="Name" placeholder="Guest speaker" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} required />}
          <button className="btn btn-primary btn-sm" disabled={busy || !to}>
            Check out
          </button>
        </form>
      )}
      {(mode === 'attention' || mode === 'note') && (
        <form className="row-wrap gear-form" onSubmit={(e) => (e.preventDefault(), act('log', { action: mode, text }, mode === 'attention' ? 'Problem reported' : 'Note added'))}>
          <input className="grow" aria-label={mode === 'attention' ? 'What’s wrong' : 'Note'} placeholder={mode === 'attention' ? 'Crackles when moved, battery door broken…' : 'Note'} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
          <button className="btn btn-primary btn-sm" disabled={busy}>
            Save
          </button>
        </form>
      )}
      {history && <GearHistory id={g.id} canRemove={app.can.plans} onRemove={remove} />}
    </li>
  );
}

const ACTION = { out: 'Checked out', in: 'Returned', battery: 'Batteries swapped', note: 'Note', attention: 'Problem', fixed: 'Fixed' };

function GearHistory({ id, canRemove, onRemove }) {
  const [rows, setRows] = useState(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    api(`/gear/${id}/log`).then(setRows, () => setRows([]));
  }, [id]);
  return (
    <div className="gear-history stack-xs">
      {!rows && <span className="small muted">Loading…</span>}
      {rows && rows.length === 0 && <span className="small muted">No history yet.</span>}
      {rows?.map((r, i) => (
        <span key={i} className="small">
          <strong>{ACTION[r.action]}</strong>
          {r.text ? ` · ${r.text}` : ''} <span className="muted">· {r.by || 'Someone'}, {fmtWhen(r.at)}</span>
        </span>
      ))}
      {canRemove &&
        (confirm ? (
          <span className="row-wrap">
            <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
              Remove from the gear list
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setConfirm(true)}>
            Remove item…
          </button>
        ))}
    </div>
  );
}

function AddGear({ categories, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ name: '', category: categories[0] || '', notes: '' });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/gear', { method: 'POST', body: f });
      app.toast(`Added ${f.name}`);
      onSaved();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Add gear" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Wireless mic 3" />
        </label>
        <label className="field">
          <span>Category</span>
          <input list="gear-cats" maxLength={40} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Microphones" />
          <datalist id="gear-cats">
            {['Microphones', 'Video', 'Cables', 'Batteries', 'Lighting', 'Computers', ...categories].filter((x, i, a) => a.indexOf(x) === i).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <input maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Shure ULXD, frequency G50" />
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
