// Gear → Reports. Crew: report a problem or missing gear, and see what happened to their reports.
// Team leaders and the admin: problems, the inventory, audits, equipment requests with price checks,
// stores and links, and a full report to print.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, fmtDay, fmtWhen } from '../lib.js';
import { DateInput, Empty, Modal, useApp } from '../ui.jsx';
import './reports.css';

const KIND = { problem: 'Problem', missing: 'Missing', other: 'Something else' };
const CONDITION = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor', broken: 'Broken' };
const STATUS = { requested: 'Requested', approved: 'Approved', ordered: 'Ordered', received: 'Received', declined: 'Declined' };
const usd = (n, cents = true) => (n === null || n === undefined ? '' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`);
const dayOf = (iso) => (iso ? fmtDay(String(iso).slice(0, 10)) : '');

export default function Reports() {
  const app = useApp();
  const [problems, setProblems] = useState(null);
  const [gear, setGear] = useState([]);
  const [reporting, setReporting] = useState(null); // {} or { gearId, kind }
  const loadProblems = useCallback(() => api('/reports/problems').then(setProblems, (e) => app.toast(e.message)), [app]);
  const loadGear = useCallback(() => api('/gear').then(setGear, () => {}), []);
  useEffect(() => {
    loadProblems();
    loadGear();
  }, [loadProblems, loadGear]);
  const openCount = (problems?.list || []).filter((p) => p.status === 'open').length;
  useEffect(() => {
    if (problems?.lead) app.setGearOpen?.(openCount);
  }, [problems, openCount, app]);

  if (!problems) return <div className="loading-inline">Loading…</div>;
  const reported = () => {
    setReporting(null);
    loadProblems();
    loadGear();
  };
  return (
    <div className="stack-lg">
      {problems.lead ? (
        <LeaderView app={app} problems={problems.list} gear={gear} reloadProblems={loadProblems} reloadGear={loadGear} onReport={() => setReporting({})} />
      ) : (
        <CrewView problems={problems.list} onReport={(x) => setReporting(x || {})} />
      )}
      {reporting && <ReportForm gear={gear} start={reporting} onClose={() => setReporting(null)} onDone={reported} />}
    </div>
  );
}

// ---------- crew ----------
function CrewView({ problems, onReport }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="muted">Something not working, or can’t find it? Tell the team leaders here.</div>
        </div>
      </div>
      <div className="rp-ask">
        <button type="button" className="rp-ask-btn" onClick={() => onReport({ kind: 'problem' })}>
          <strong>Something isn’t working</strong>
          <span className="muted small">Crackling mic, dead battery, broken cable, a light that flickers</span>
        </button>
        <button type="button" className="rp-ask-btn" onClick={() => onReport({ kind: 'missing' })}>
          <strong>Something is missing</strong>
          <span className="muted small">It isn’t where it belongs and nobody has it checked out</span>
        </button>
      </div>
      <section className="card stack">
        <h2>Your reports</h2>
        {problems.length === 0 ? <p className="muted">Nothing yet. What you report shows here, with what the leaders did about it.</p> : <ProblemRows list={problems} />}
      </section>
    </>
  );
}

function ProblemRows({ list, lead, onResolve, onReopen, onDelete }) {
  return (
    <ul className="rp-list">
      {list.map((p) => (
        <li key={p.id} className={`rp-row ${p.status === 'fixed' ? 'rp-done' : ''}`}>
          <span className={`rp-kind rp-kind-${p.kind}`}>{KIND[p.kind]}</span>
          <div className="stack-xs grow">
            <strong>{p.title}</strong>
            {p.details && <span className="small">{p.details}</span>}
            <span className="small muted">{[p.gear?.name, lead && p.reportedBy && `reported by ${p.reportedBy}`, fmtWhen(p.createdAt)].filter(Boolean).join(' · ')}</span>
            {p.status === 'fixed' && (
              <span className="small rp-fixed">
                {p.kind === 'missing' ? 'Found' : 'Fixed'}
                {p.fixedBy ? ` by ${p.fixedBy}` : ''}
                {p.fixedAt ? `, ${fmtWhen(p.fixedAt)}` : ''}
                {p.fixNote ? `: ${p.fixNote}` : ''}
              </span>
            )}
            {p.status === 'open' && !lead && <span className="small muted">Waiting on a team leader</span>}
          </div>
          {lead && (
            <div className="row-wrap tight rp-acts">
              {p.status === 'open' ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onResolve(p)}>
                  {p.kind === 'missing' ? 'Found it' : 'Mark fixed'}
                </button>
              ) : (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onReopen(p)}>
                  Reopen
                </button>
              )}
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Delete “${p.title}”`} onClick={() => onDelete(p)}>
                ✕
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReportForm({ gear, start, onClose, onDone }) {
  const app = useApp();
  const [f, setF] = useState({ kind: start.kind || 'problem', gearId: start.gearId || '', title: '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const item = gear.find((g) => g.id === f.gearId);
  const groups = useMemo(() => {
    const out = {};
    for (const g of gear) (out[g.category || 'Other'] ||= []).push(g);
    return Object.entries(out).sort(([a], [b]) => a.localeCompare(b));
  }, [gear]);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/reports/problems', { method: 'POST', body: f });
      app.toast(f.kind === 'missing' ? 'Reported missing. Thanks for letting us know.' : 'Reported. Thanks for letting us know.');
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={f.kind === 'missing' ? 'Report missing gear' : 'Report a problem'} onClose={onClose}>
      <form className="stack" onSubmit={send}>
        <fieldset className="rp-kinds">
          <legend className="sr-only">What kind of report</legend>
          {Object.entries(KIND).map(([k, l]) => (
            <label key={k} className={`rp-kind-pick ${f.kind === k ? 'rp-kind-on' : ''}`}>
              <input type="radio" name="kind" value={k} checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} className="sr-only" />
              {k === 'problem' ? 'Not working' : k === 'missing' ? 'Missing' : 'Something else'}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Which item{f.kind === 'missing' ? '' : ' (if it’s on the list)'}</span>
          <select value={f.gearId} onChange={(e) => setF({ ...f, gearId: e.target.value })} required={f.kind === 'missing' && !f.title}>
            <option value="">{f.kind === 'missing' ? 'Pick it, or describe it below' : 'Not on the list / not gear'}</option>
            {groups.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{f.kind === 'missing' ? (item ? 'Anything else? (optional)' : 'What’s missing') : 'What’s wrong'}</span>
          <input
            value={f.title}
            maxLength={120}
            required={!(f.kind === 'missing' && item)}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            placeholder={f.kind === 'missing' ? (item ? `${item.name} is missing` : 'e.g. The spare XLR bag') : 'e.g. Crackles when the cable moves'}
          />
        </label>
        <label className="field">
          <span>Details (optional)</span>
          <textarea
            rows={3}
            maxLength={1000}
            value={f.details}
            onChange={(e) => setF({ ...f, details: e.target.value })}
            placeholder={f.kind === 'missing' ? 'Where and when you last saw it' : 'When it happens, which service, what you tried'}
          />
        </label>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send report'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- team leaders and the admin ----------
const PARTS = [
  ['problems', 'Problems'],
  ['inventory', 'Inventory'],
  ['audit', 'Audit'],
  ['requests', 'Requests'],
  ['prices', 'Prices & links'],
];
function LeaderView({ app, problems, gear, reloadProblems, reloadGear, onReport }) {
  const [part, setPartState] = useState(() => {
    try {
      return localStorage.getItem('cc-reports-part') || 'problems';
    } catch {
      return 'problems';
    }
  });
  const setPart = (p) => {
    setPartState(p);
    try {
      localStorage.setItem('cc-reports-part', p);
    } catch {
      /* private mode */
    }
  };
  const [sum, setSum] = useState(null);
  const [printing, setPrinting] = useState(false);
  const loadSum = useCallback(() => api('/reports/summary', { background: true }).then(setSum, () => {}), []);
  useEffect(() => {
    loadSum();
  }, [loadSum, problems, gear]);
  const open = problems.filter((p) => p.status === 'open');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="muted">What’s broken or missing, what you have, and what to buy next.</div>
        </div>
        <div className="row-wrap">
          <button type="button" className="btn btn-ghost" onClick={onReport}>
            Report a problem
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setPrinting(true)}>
            Full report
          </button>
        </div>
      </div>
      {sum && (
        <div className="rp-sums">
          <Sum label="Items" value={sum.units} note={sum.units !== sum.items ? `${sum.items} kinds` : null} onClick={() => setPart('inventory')} />
          <Sum label="Value" value={usd(sum.value, false)} note={sum.unpriced ? `${sum.unpriced} without a price` : null} onClick={() => setPart('inventory')} />
          <Sum label="Open problems" value={sum.openProblems} warn={sum.openProblems > 0} onClick={() => setPart('problems')} />
          <Sum label="Missing" value={sum.missing} warn={sum.missing > 0} onClick={() => setPart('problems')} />
          <Sum label="Last audit" value={sum.auditOpen ? 'Going on' : sum.lastAuditAt ? dayOf(sum.lastAuditAt) : 'Never'} onClick={() => setPart('audit')} />
          <Sum label="Requested" value={usd(sum.requests.waitingCost, false)} note={`${sum.requests.waiting} waiting · ${usd(sum.requests.approvedCost, false)} approved`} onClick={() => setPart('requests')} />
        </div>
      )}
      <div className="seg seg-scroll rp-parts" role="group" aria-label="Part of Reports">
        {PARTS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={part === k} onClick={() => setPart(k)}>
            {l}
            {k === 'problems' && open.length > 0 && <span className="badge">{open.length}</span>}
          </button>
        ))}
      </div>
      {part === 'problems' && <Problems app={app} list={problems} reload={reloadProblems} reloadGear={reloadGear} />}
      {part === 'inventory' && <Inventory app={app} gear={gear} reload={reloadGear} />}
      {part === 'audit' && <Audit app={app} gear={gear} reload={() => (reloadGear(), reloadProblems(), loadSum())} />}
      {part === 'requests' && <Requests app={app} onChange={loadSum} />}
      {part === 'prices' && <Prices app={app} />}
      {printing && <FullReport onClose={() => setPrinting(false)} />}
    </>
  );
}

function Sum({ label, value, note, warn, onClick }) {
  return (
    <button type="button" className={`rp-sum ${warn ? 'rp-sum-warn' : ''}`} onClick={onClick}>
      <span className="rp-sum-label">{label}</span>
      <strong>{value}</strong>
      {note && <span className="small muted">{note}</span>}
    </button>
  );
}

function Problems({ app, list, reload, reloadGear }) {
  const [showDone, setShowDone] = useState(false);
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const open = list.filter((p) => p.status === 'open');
  const done = list.filter((p) => p.status === 'fixed');
  const act = async (fn, msg) => {
    try {
      await fn();
      app.toast(msg);
      setResolving(null);
      setNote('');
      reload();
      reloadGear();
    } catch (e) {
      app.toast(e.message);
    }
  };
  return (
    <section className="card stack">
      <div className="row-between">
        <h2>Open</h2>
        <span className="muted small">Anyone on the AV team can report; crew see only their own reports.</span>
      </div>
      {open.length === 0 ? (
        <Empty>Nothing broken or missing. 🎉</Empty>
      ) : (
        <ProblemRows
          list={open}
          lead
          onResolve={setResolving}
          onReopen={() => {}}
          onDelete={(p) => window.confirm(`Delete “${p.title}”?`) && act(() => api(`/reports/problems/${p.id}`, { method: 'DELETE' }), 'Deleted')}
        />
      )}
      {done.length > 0 && (
        <div className="stack">
          <button type="button" className="link-btn self-start" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            {showDone ? 'Hide' : 'Show'} fixed and found ({done.length})
          </button>
          {showDone && (
            <ProblemRows
              list={done}
              lead
              onReopen={(p) => act(() => api(`/reports/problems/${p.id}/reopen`, { method: 'POST' }), 'Reopened')}
              onDelete={(p) => window.confirm(`Delete “${p.title}”?`) && act(() => api(`/reports/problems/${p.id}`, { method: 'DELETE' }), 'Deleted')}
            />
          )}
        </div>
      )}
      {resolving && (
        <Modal title={resolving.kind === 'missing' ? 'Found it' : 'Mark fixed'} onClose={() => setResolving(null)}>
          <form
            className="stack"
            onSubmit={(e) => (e.preventDefault(), act(() => api(`/reports/problems/${resolving.id}/resolve`, { method: 'POST', body: { note } }), resolving.kind === 'missing' ? 'Marked found' : 'Marked fixed'))}
          >
            <p>
              <strong>{resolving.title}</strong>
            </p>
            <label className="field">
              <span>{resolving.kind === 'missing' ? 'Where was it? (optional)' : 'What was done? (optional)'}</span>
              <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={resolving.kind === 'missing' ? 'e.g. In the youth room' : 'e.g. Replaced the cable'} />
            </label>
            <div className="row-wrap">
              <button className="btn btn-primary">{resolving.kind === 'missing' ? 'Found it' : 'Mark fixed'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setResolving(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// ---------- inventory ----------
const EMPTY_ITEM = { name: '', category: '', brand: '', model: '', serial: '', assetTag: '', quantity: 1, location: '', purchasedOn: '', cost: '', condition: '', notes: '' };
function Inventory({ app, gear, reload }) {
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const shown = gear.filter((g) => !q || [g.name, g.category, g.brand, g.model, g.serial, g.assetTag, g.location].join(' ').toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => {
    const out = {};
    for (const g of shown) (out[g.category || 'Other'] ||= []).push(g);
    return Object.entries(out).sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
  }, [shown]);
  const csv = () => {
    const cols = ['name', 'category', 'brand', 'model', 'serial', 'assetTag', 'quantity', 'location', 'condition', 'cost', 'purchasedOn', 'missing', 'attention', 'auditedAt'];
    const head = ['Name', 'Category', 'Brand', 'Model', 'Serial', 'Asset tag', 'Quantity', 'Location', 'Condition', 'Value each', 'Purchased', 'Missing', 'Needs fixing', 'Last audited'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = gear.map((g) => cols.map((c) => cell(c === 'missing' ? (g.missing ? 'yes' : '') : c === 'auditedAt' ? (g.auditedAt || '').slice(0, 10) : g[c])).join(','));
    const blob = new Blob([[head.map(cell).join(','), ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gear-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="card stack">
      <div className="row-between">
        <input className="rp-search" type="search" placeholder="Search name, brand, serial, location…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the inventory" />
        <div className="row-wrap tight">
          <button type="button" className="btn btn-ghost btn-sm" onClick={csv} disabled={!gear.length}>
            Download spreadsheet (CSV)
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_ITEM })}>
            Add item
          </button>
        </div>
      </div>
      {!gear.length && <Empty>No gear yet. Add what the team owns: mics, cables, cameras, lights, stands.</Empty>}
      {groups.map(([cat, list]) => (
        <div key={cat} className="table-scroll">
          <table className="rp-table">
            <caption>
              {cat} <span className="muted">· {list.reduce((n, g) => n + (g.quantity ?? 1), 0)}</span>
            </caption>
            <thead>
              <tr>
                <th>Item</th>
                <th>Brand / model</th>
                <th>Serial / tag</th>
                <th className="num">Qty</th>
                <th>Where</th>
                <th>Condition</th>
                <th className="num">Value</th>
                <th>Audited</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} onClick={() => setEditing({ ...EMPTY_ITEM, ...g, cost: g.cost ?? '' })} className="rp-click">
                  <td>
                    <button type="button" className="rp-name" onClick={(e) => (e.stopPropagation(), setEditing({ ...EMPTY_ITEM, ...g, cost: g.cost ?? '' }))}>
                      {g.name}
                    </button>
                    {g.missing && <span className="rp-flag rp-flag-missing">Missing</span>}
                    {g.attention && <span className="rp-flag">Needs fixing</span>}
                  </td>
                  <td>{[g.brand, g.model].filter(Boolean).join(' ')}</td>
                  <td className="small">{[g.serial, g.assetTag].filter(Boolean).join(' · ')}</td>
                  <td className="num">{g.quantity ?? 1}</td>
                  <td>{g.location}</td>
                  <td>{CONDITION[g.condition] || ''}</td>
                  <td className="num">{g.cost !== null ? usd(g.cost * (g.quantity ?? 1)) : <span className="muted">—</span>}</td>
                  <td className="small">{g.auditedAt ? dayOf(g.auditedAt) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {editing && <ItemForm app={app} item={editing} onClose={() => setEditing(null)} onDone={() => (setEditing(null), reload())} />}
    </section>
  );
}

function ItemForm({ app, item, onClose, onDone }) {
  const [f, setF] = useState(item);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, quantity: Number(f.quantity) || 0 };
      if (f.id) await api(`/gear/${f.id}`, { method: 'PATCH', body });
      else await api('/gear', { method: 'POST', body });
      app.toast(f.id ? 'Saved' : `Added ${f.name}`);
      onDone();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove ${f.name} from the gear list? Its check-out history goes too.`)) return;
    try {
      await api(`/gear/${f.id}`, { method: 'DELETE' });
      app.toast(`Removed ${f.name}`);
      onDone();
    } catch (err) {
      app.toast(err.message);
    }
  };
  return (
    <Modal title={f.id ? f.name : 'Add an item'} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Name</span>
            <input required maxLength={80} value={f.name} onChange={set('name')} placeholder="e.g. Wireless mic 3" />
          </label>
          <label className="field">
            <span>Category</span>
            <input maxLength={40} value={f.category} onChange={set('category')} placeholder="e.g. Microphones" />
          </label>
        </div>
        <div className="row-wrap fields-3">
          <label className="field">
            <span>Brand</span>
            <input maxLength={80} value={f.brand} onChange={set('brand')} placeholder="Shure" />
          </label>
          <label className="field">
            <span>Model</span>
            <input maxLength={80} value={f.model} onChange={set('model')} placeholder="SLXD24/B58" />
          </label>
          <label className="field">
            <span>Serial number</span>
            <input maxLength={80} value={f.serial} onChange={set('serial')} />
          </label>
        </div>
        <div className="row-wrap fields-3">
          <label className="field">
            <span>Asset tag</span>
            <input maxLength={80} value={f.assetTag} onChange={set('assetTag')} placeholder="AV-031" />
          </label>
          <label className="field">
            <span>How many</span>
            <input type="number" min="0" max="9999" value={f.quantity} onChange={set('quantity')} />
          </label>
          <label className="field">
            <span>Where it’s kept</span>
            <input maxLength={80} value={f.location} onChange={set('location')} placeholder="Booth cabinet" />
          </label>
        </div>
        <div className="row-wrap fields-3">
          <label className="field">
            <span>Value each ($)</span>
            <input type="number" min="0" step="0.01" value={f.cost} onChange={set('cost')} placeholder="What it cost or would cost now" />
          </label>
          <label className="field">
            <span>Bought</span>
            <DateInput type="date" value={f.purchasedOn} onChange={set('purchasedOn')} />
          </label>
          <label className="field">
            <span>Condition</span>
            <select value={f.condition} onChange={set('condition')}>
              <option value="">Not noted</option>
              {Object.entries(CONDITION).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Notes</span>
          <input maxLength={300} value={f.notes} onChange={set('notes')} placeholder="e.g. Goes with receiver 3; uses AA batteries" />
        </label>
        {f.id && (
          <label className="check">
            <input type="checkbox" checked={!!f.missing} onChange={(e) => setF({ ...f, missing: e.target.checked })} />
            Missing
          </label>
        )}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {f.id ? 'Save' : 'Add item'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {f.id && (
            <button type="button" className="btn btn-danger push-right" onClick={remove}>
              Remove
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------- audit ----------
function Audit({ app, gear, reload }) {
  const [list, setList] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/reports/audits').then(setList, (e) => app.toast(e.message)), [app]);
  useEffect(() => {
    load();
  }, [load]);
  const current = list?.find((a) => !a.finishedAt);
  const setCurrent = (a) => setList((l) => l.map((x) => (x.id === a.id ? a : x)));
  const start = async () => {
    setBusy(true);
    try {
      const a = await api('/reports/audits', { method: 'POST' });
      setList((l) => [a, ...l.filter((x) => x.id !== a.id)]);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  if (!list) return <div className="loading-inline">Loading…</div>;
  if (current) return <AuditRun app={app} audit={current} gear={gear} onChange={setCurrent} onDone={() => (load(), reload())} />;
  const past = list.filter((a) => a.finishedAt);
  return (
    <section className="card stack">
      <div className="row-between">
        <div className="stack-xs">
          <h2>Audit</h2>
          <span className="muted small">Walk through the gear and mark each item found, missing or needing repair. Missing and damaged items go on the problem list when you finish.</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={start} disabled={busy || !gear.length}>
          Start an audit
        </button>
      </div>
      {!gear.length && <Empty>Add gear to the inventory first.</Empty>}
      {past.length > 0 && (
        <ul className="rp-list">
          {past.map((a) => (
            <li key={a.id} className="rp-row">
              <div className="stack-xs grow">
                <strong>{dayOf(a.finishedAt)}</strong>
                <span className="small muted">
                  {a.finishedBy || a.startedBy} · {a.counts.found} found · {a.counts.missing} missing · {a.counts.damaged} need repair
                </span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => api(`/reports/audits/${a.id}`).then(setViewing, (e) => app.toast(e.message))}>
                See results
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <Modal title={`Audit · ${dayOf(viewing.finishedAt)}`} onClose={() => setViewing(null)} wide>
          <AuditResults audit={viewing} gear={gear} />
        </Modal>
      )}
    </section>
  );
}

const MARKS = [
  ['found', 'Found'],
  ['missing', 'Missing'],
  ['damaged', 'Needs repair'],
];
function AuditRun({ app, audit, gear, onChange, onDone }) {
  const [noting, setNoting] = useState(null);
  const [hideDone, setHideDone] = useState(false);
  const byGear = Object.fromEntries(audit.results.map((r) => [r.gearId, r]));
  const done = gear.filter((g) => byGear[g.id]).length;
  const mark = async (g, status, note = byGear[g.id]?.note || '') => {
    try {
      onChange(await api(`/reports/audits/${audit.id}/mark`, { method: 'POST', body: { gearId: g.id, status: byGear[g.id]?.status === status && !noting ? null : status, note }, background: true }));
    } catch (e) {
      app.toast(e.message);
    }
  };
  const finish = async () => {
    const left = gear.length - done;
    if (!window.confirm(`Finish the audit?${left ? ` ${left} item${left === 1 ? ' isn’t' : 's aren’t'} checked; they stay as they are.` : ''} Missing and damaged items go on the problem list.`)) return;
    try {
      const a = await api(`/reports/audits/${audit.id}/finish`, { method: 'POST' });
      app.toast(`Audit finished: ${a.counts.found} found, ${a.counts.missing} missing, ${a.counts.damaged} need repair`);
      onDone();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const cancel = async () => {
    if (!window.confirm('Throw away this audit? Nothing it marked is kept.')) return;
    await api(`/reports/audits/${audit.id}`, { method: 'DELETE' }).catch((e) => app.toast(e.message));
    onDone();
  };
  const groups = {};
  for (const g of gear) if (!hideDone || !byGear[g.id]) (groups[g.category || 'Other'] ||= []).push(g);
  const pct = gear.length ? Math.round((done / gear.length) * 100) : 0;
  return (
    <section className="card stack">
      <div className="row-between">
        <div className="stack-xs">
          <h2>Audit in progress</h2>
          <span className="muted small">
            Started {fmtWhen(audit.startedAt)} by {audit.startedBy}. Anyone leading can carry on with it, on a phone in the booth.
          </span>
        </div>
        <div className="row-wrap tight">
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
            Throw away
          </button>
          <button type="button" className="btn btn-primary" onClick={finish} disabled={!done}>
            Finish audit
          </button>
        </div>
      </div>
      <div className="rp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={gear.length} aria-valuenow={done} aria-label="Items checked">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row-between small">
        <span>
          <strong>{done}</strong> of {gear.length} checked · {audit.counts.found} found · {audit.counts.missing} missing · {audit.counts.damaged} need repair
        </span>
        <label className="check">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide what’s checked
        </label>
      </div>
      {Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cat, list]) => (
          <div key={cat} className="stack-xs">
            <h3 className="rp-cat">{cat}</h3>
            <ul className="rp-list">
              {list.map((g) => {
                const r = byGear[g.id];
                return (
                  <li key={g.id} className={`rp-audit ${r ? `rp-audit-${r.status}` : ''}`}>
                    <div className="stack-xs grow">
                      <strong>
                        {g.name}
                        {(g.quantity ?? 1) > 1 && <span className="muted"> × {g.quantity}</span>}
                      </strong>
                      <span className="small muted">{[g.location, [g.brand, g.model].filter(Boolean).join(' '), g.serial && `SN ${g.serial}`, g.holder && `checked out to ${g.holder}`].filter(Boolean).join(' · ')}</span>
                      {r?.note && <span className="small">{r.note}</span>}
                    </div>
                    <div className="seg rp-marks" role="group" aria-label={`${g.name}: found, missing or needs repair`}>
                      {MARKS.map(([k, l]) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={r?.status === k}
                          className={`rp-mark-${k}`}
                          onClick={() => (k === 'found' ? mark(g, k) : r?.status === k ? mark(g, k) : setNoting({ g, status: k, note: r?.note || '' }))}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      {noting && (
        <Modal title={`${noting.g.name}: ${noting.status === 'missing' ? 'missing' : 'needs repair'}`} onClose={() => setNoting(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const n = noting;
              setNoting(null);
              mark(n.g, n.status, n.note);
            }}
          >
            <label className="field">
              <span>{noting.status === 'missing' ? 'Where did you look? (optional)' : 'What’s wrong with it? (optional)'}</span>
              <input autoFocus value={noting.note} maxLength={300} onChange={(e) => setNoting({ ...noting, note: e.target.value })} />
            </label>
            <div className="row-wrap">
              <button className="btn btn-primary">Mark {noting.status === 'missing' ? 'missing' : 'needs repair'}</button>
              <button type="button" className="btn btn-ghost" onClick={() => setNoting(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function AuditResults({ audit, gear }) {
  const by = Object.fromEntries(audit.results.map((r) => [r.gearId, r]));
  const notChecked = gear.filter((g) => !by[g.id] && new Date(g.auditedAt || 0) < new Date(audit.startedAt));
  const rows = (status) => audit.results.filter((r) => r.status === status);
  return (
    <div className="stack">
      {[
        ['missing', 'Missing'],
        ['damaged', 'Needs repair'],
        ['found', 'Found'],
      ].map(([k, l]) =>
        rows(k).length ? (
          <div key={k} className="stack-xs">
            <h3 className="rp-cat">
              {l} ({rows(k).length})
            </h3>
            <ul className="rp-plain">
              {rows(k).map((r) => (
                <li key={r.gearId}>
                  {r.name}
                  {r.note && <span className="muted"> · {r.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {notChecked.length > 0 && <p className="muted small">Not checked: {notChecked.map((g) => g.name).join(', ')}</p>}
    </div>
  );
}

// ---------- equipment requests ----------
const EMPTY_REQ = { title: '', details: '', category: '', quantity: 1, unitCost: '', neededBy: '', links: [] };
function Requests({ app, onChange }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [stores, setStores] = useState([]);
  const [show, setShow] = useState('open');
  const load = useCallback(() => api('/reports/requests').then(setList, (e) => app.toast(e.message)), [app]);
  useEffect(() => {
    load();
    api('/reports/links', { background: true }).then(
      (l) => setStores(l.filter((x) => x.store)),
      () => {},
    );
  }, [load]);
  const setStatus = async (r, status) => {
    try {
      await api(`/reports/requests/${r.id}`, { method: 'PATCH', body: { status } });
      app.toast(`${STATUS[status]}: ${r.title}`);
      load();
      onChange();
    } catch (e) {
      app.toast(e.message);
    }
  };
  if (!list) return <div className="loading-inline">Loading…</div>;
  const isOpen = (r) => ['requested', 'approved', 'ordered'].includes(r.status);
  const shown = list.filter((r) => (show === 'open' ? isOpen(r) : !isOpen(r)));
  const total = (rs) => rs.reduce((n, r) => n + (r.total || 0), 0);
  return (
    <section className="card stack">
      <div className="row-between">
        <div className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={show === 'open'} onClick={() => setShow('open')}>
            Open ({list.filter(isOpen).length})
          </button>
          <button type="button" aria-pressed={show === 'closed'} onClick={() => setShow('closed')}>
            Received or declined ({list.filter((r) => !isOpen(r)).length})
          </button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ ...EMPTY_REQ })}>
          Request equipment
        </button>
      </div>
      {show === 'open' && list.some(isOpen) && (
        <p className="small">
          Waiting for a decision: <strong>{usd(total(list.filter((r) => r.status === 'requested')))}</strong> · approved or ordered:{' '}
          <strong>{usd(total(list.filter((r) => r.status === 'approved' || r.status === 'ordered')))}</strong>
        </p>
      )}
      {shown.length === 0 && <Empty>{show === 'open' ? 'Nothing requested. Add what the team needs, with a price, so it’s ready when the budget comes around.' : 'Nothing here yet.'}</Empty>}
      <ul className="rp-list">
        {shown.map((r) => (
          <li key={r.id} className="rp-req">
            <div className="stack-xs grow">
              <div className="row-wrap tight">
                <strong>{r.title}</strong>
                {r.quantity > 1 && <span className="muted">× {r.quantity}</span>}
                <span className={`rp-status rp-status-${r.status}`}>{STATUS[r.status]}</span>
              </div>
              {r.details && <span className="small">{r.details}</span>}
              <span className="small muted">
                {[r.unitCost ? `${usd(r.unitCost)} each · ${usd(r.total)} in all` : 'No price yet', r.neededBy && `needed by ${fmtDay(r.neededBy)}`, `asked by ${r.requestedBy || 'someone'} ${fmtWhen(r.createdAt)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {r.note && <span className="small">Note: {r.note}</span>}
              {r.links.length > 0 && (
                <span className="small row-wrap tight">
                  {r.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">
                      {l.label || new URL(l.url).hostname.replace(/^www\./, '')}
                    </a>
                  ))}
                </span>
              )}
              {isOpen(r) && stores.length > 0 && (
                <span className="small rp-check">
                  Check prices:{' '}
                  {stores.slice(0, 5).map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ' · '}
                      <a href={s.url.replace('{q}', encodeURIComponent(r.title))} target="_blank" rel="noreferrer noopener">
                        {s.label}
                      </a>
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className="row-wrap tight rp-acts">
              {r.status === 'requested' && (
                <>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setStatus(r, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStatus(r, 'declined')}>
                    Decline
                  </button>
                </>
              )}
              {r.status === 'approved' && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setStatus(r, 'ordered')}>
                  Mark ordered
                </button>
              )}
              {r.status === 'ordered' && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setStatus(r, 'received')}>
                  Mark received
                </button>
              )}
              {!isOpen(r) && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStatus(r, 'requested')}>
                  Reopen
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...EMPTY_REQ, ...r, unitCost: r.unitCost ?? '' })}>
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <RequestForm app={app} req={editing} stores={stores} onClose={() => setEditing(null)} onDone={() => (setEditing(null), load(), onChange())} />}
    </section>
  );
}

function RequestForm({ app, req, stores, onClose, onDone }) {
  const [f, setF] = useState({ ...req, links: req.links?.length ? req.links : [{ label: '', url: '' }] });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setLink = (i, k, v) => setF({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, links: f.links.filter((l) => l.url.trim()) };
      if (f.id) await api(`/reports/requests/${f.id}`, { method: 'PATCH', body });
      else await api('/reports/requests', { method: 'POST', body });
      app.toast(f.id ? 'Saved' : 'Requested');
      onDone();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the request for ${f.title}?`)) return;
    await api(`/reports/requests/${f.id}`, { method: 'DELETE' }).catch((err) => app.toast(err.message));
    onDone();
  };
  const total = Number(f.unitCost) > 0 ? Number(f.unitCost) * (Number(f.quantity) || 1) : 0;
  return (
    <Modal title={f.id ? f.title : 'Request equipment'} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>What</span>
            <input required maxLength={120} value={f.title} onChange={set('title')} placeholder="e.g. Shure SM58" />
          </label>
          <label className="field">
            <span>Category</span>
            <input maxLength={40} value={f.category} onChange={set('category')} placeholder="e.g. Microphones" />
          </label>
        </div>
        <label className="field">
          <span>Why it’s needed</span>
          <textarea rows={2} maxLength={1000} value={f.details} onChange={set('details')} placeholder="e.g. Two of the choir mics crackle; spares for Easter" />
        </label>
        <div className="row-wrap fields-3">
          <label className="field">
            <span>How many</span>
            <input type="number" min="1" max="999" value={f.quantity} onChange={set('quantity')} />
          </label>
          <label className="field">
            <span>Price each ($, estimate)</span>
            <input type="number" min="0" step="0.01" value={f.unitCost} onChange={set('unitCost')} />
          </label>
          <label className="field">
            <span>Needed by (optional)</span>
            <DateInput type="date" value={f.neededBy} onChange={set('neededBy')} />
          </label>
        </div>
        {total > 0 && <p className="small">Estimate: {usd(total)} in all</p>}
        {f.title.trim() && stores.length > 0 && (
          <p className="small rp-check">
            Find a price:{' '}
            {stores.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' · '}
                <a href={s.url.replace('{q}', encodeURIComponent(f.title.trim()))} target="_blank" rel="noreferrer noopener">
                  {s.label}
                </a>
              </span>
            ))}
          </p>
        )}
        <fieldset className="plain-fieldset stack-xs">
          <legend className="small strong">Where you priced it (optional)</legend>
          {f.links.map((l, i) => (
            <div key={i} className="row-wrap tight rp-linkrow">
              <input aria-label="Store" placeholder="Store" maxLength={60} value={l.label} onChange={(e) => setLink(i, 'label', e.target.value)} />
              <input aria-label="Web address" placeholder="Paste the product’s web address" value={l.url} onChange={(e) => setLink(i, 'url', e.target.value)} className="grow" />
            </div>
          ))}
          {f.links.length < 6 && (
            <button type="button" className="link-btn self-start" onClick={() => setF({ ...f, links: [...f.links, { label: '', url: '' }] })}>
              Add another link
            </button>
          )}
        </fieldset>
        {f.id && (
          <label className="field">
            <span>Note (e.g. which budget, order number)</span>
            <input maxLength={300} value={f.note || ''} onChange={set('note')} />
          </label>
        )}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {f.id ? 'Save' : 'Request it'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {f.id && (
            <button type="button" className="btn btn-danger push-right" onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------- prices and links ----------
function Prices({ app }) {
  const [links, setLinks] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const load = useCallback(() => api('/reports/links').then(setLinks, (e) => app.toast(e.message)), [app]);
  useEffect(() => {
    load();
  }, [load]);
  if (!links) return <div className="loading-inline">Loading…</div>;
  const stores = links.filter((l) => l.store);
  const others = links.filter((l) => !l.store);
  const save = async (e) => {
    e.preventDefault();
    try {
      setLinks(adding.id ? await api(`/reports/links/${adding.id}`, { method: 'PATCH', body: adding }) : await api('/reports/links', { method: 'POST', body: adding }));
      setAdding(null);
    } catch (err) {
      app.toast(err.message);
    }
  };
  const remove = async (l) => {
    if (!window.confirm(`Remove ${l.label}?`)) return;
    setLinks(await api(`/reports/links/${l.id}`, { method: 'DELETE' }));
  };
  return (
    <div className="stack-lg">
      <section className="card stack">
        <h2>Find a price</h2>
        <form className="row-wrap tight" onSubmit={(e) => e.preventDefault()}>
          <input className="grow rp-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What are you pricing? e.g. Shure SLXD24 B58" aria-label="What are you pricing" />
        </form>
        <ul className="rp-stores">
          {stores.map((s) => (
            <li key={s.id}>
              <a
                className={`rp-store ${q.trim() ? '' : 'rp-store-off'}`}
                href={q.trim() ? s.url.replace('{q}', encodeURIComponent(q.trim())) : undefined}
                target="_blank"
                rel="noreferrer noopener"
                aria-disabled={!q.trim()}
              >
                <strong>{s.label}</strong>
                {s.note && <span className="small muted">{s.note}</span>}
              </a>
              <span className="rp-store-edit">
                <button type="button" className="link-btn small" onClick={() => setAdding({ ...s })}>
                  Edit
                </button>
                <button type="button" className="link-btn small" onClick={() => remove(s)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">Each store opens its own search in a new tab. Put a price you find on a request so the total adds up. Prices change, so check again before you buy.</p>
        <button type="button" className="link-btn self-start" onClick={() => setAdding({ label: '', url: 'https://', note: '', store: true })}>
          Add a store
        </button>
      </section>
      <section className="card stack">
        <h2>Links and resources</h2>
        {others.length === 0 && <p className="muted">Add the people and places you go to for gear: a sales rep, the church’s purchasing form, a repair shop, a grant.</p>}
        <ul className="rp-list">
          {others.map((l) => (
            <li key={l.id} className="rp-row">
              <div className="stack-xs grow">
                <a href={l.url} target="_blank" rel="noreferrer noopener">
                  <strong>{l.label}</strong>
                </a>
                {l.note && <span className="small muted">{l.note}</span>}
              </div>
              <button type="button" className="link-btn small" onClick={() => setAdding({ ...l })}>
                Edit
              </button>
              <button type="button" className="link-btn small" onClick={() => remove(l)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setAdding({ label: '', url: 'https://', note: '', store: false })}>
          Add a link
        </button>
      </section>
      {adding && (
        <Modal title={adding.id ? `Edit ${adding.label}` : adding.store ? 'Add a store' : 'Add a link'} onClose={() => setAdding(null)}>
          <form className="stack" onSubmit={save}>
            <label className="field">
              <span>Name</span>
              <input
                required
                maxLength={60}
                value={adding.label}
                onChange={(e) => setAdding({ ...adding, label: e.target.value })}
                placeholder={adding.store ? 'e.g. Full Compass' : 'e.g. Our Sweetwater sales engineer'}
              />
            </label>
            <label className="field">
              <span>Web address</span>
              <input required value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} />
              {adding.store && <span className="muted small">For a store, search it for anything, copy the address of the results page, and put {'{q}'} where your search words were.</span>}
            </label>
            <label className="field">
              <span>Note (optional)</span>
              <input maxLength={200} value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} />
            </label>
            <div className="row-wrap">
              <button className="btn btn-primary">Save</button>
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------- the full report ----------
function FullReport({ onClose }) {
  const app = useApp();
  const [r, setR] = useState(null);
  const [sheet, setSheet] = useState(false); // a copy of the report on its own, for the printer
  useEffect(() => {
    api('/reports/full').then(setR, (e) => app.toast(e.message));
  }, [app]);
  useEffect(() => {
    if (!sheet) return;
    document.body.classList.add('print-gear-report');
    const done = () => setSheet(false);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('print-gear-report');
    };
  }, [sheet]);
  const print = () => setSheet(true);
  const groups = {};
  for (const g of r?.gear || []) (groups[g.category] ||= []).push(g);
  return (
    <Modal title="Full gear report" onClose={onClose} wide>
      {!r ? (
        <div className="loading-inline">Loading…</div>
      ) : (
        <>
          <div className="row-wrap no-print">
            <button type="button" className="btn btn-primary" onClick={print}>
              Print or save as PDF
            </button>
          </div>
          {sheet && createPortal(<div className="rp-sheet">{body()}</div>, document.body)}
          {body()}
        </>
      )}
    </Modal>
  );
  function body() {
    return (
      <article className="rp-print">
        <header className="rp-print-head">
          <h1>Gear report</h1>
          <p>
            {r.church ? `${r.church} · ` : ''}AV team · {new Date(r.at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </header>
        <dl className="rp-print-sums">
          <div>
            <dt>Items</dt>
            <dd>{r.summary.units}</dd>
          </div>
          <div>
            <dt>Value</dt>
            <dd>{usd(r.summary.value, false)}</dd>
          </div>
          <div>
            <dt>Open problems</dt>
            <dd>{r.summary.openProblems}</dd>
          </div>
          <div>
            <dt>Missing</dt>
            <dd>{r.summary.missing}</dd>
          </div>
          <div>
            <dt>Last audit</dt>
            <dd>{r.summary.lastAuditAt ? dayOf(r.summary.lastAuditAt) : 'Never'}</dd>
          </div>
          <div>
            <dt>Requested</dt>
            <dd>{usd(r.summary.requests.waitingCost + r.summary.requests.approvedCost, false)}</dd>
          </div>
        </dl>

        <h2>Open problems and missing gear</h2>
        {r.open.length ? (
          <table className="rp-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Kind</th>
                <th>Item</th>
                <th>Reported</th>
              </tr>
            </thead>
            <tbody>
              {r.open.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.title}
                    {p.details && <div className="small muted">{p.details}</div>}
                  </td>
                  <td>{KIND[p.kind]}</td>
                  <td>{p.gear?.name || ''}</td>
                  <td className="small">
                    {dayOf(p.createdAt)}
                    {p.reportedBy ? `, ${p.reportedBy}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>None.</p>
        )}

        <h2>Equipment requests</h2>
        {r.requests.length ? (
          <table className="rp-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Status</th>
                <th className="num">Qty</th>
                <th className="num">Each</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.requests.map((q) => (
                <tr key={q.id}>
                  <td>
                    {q.title}
                    {q.details && <div className="small muted">{q.details}</div>}
                    {q.links.length > 0 && <div className="small muted">{q.links.map((l) => l.url).join(' · ')}</div>}
                  </td>
                  <td>{STATUS[q.status]}</td>
                  <td className="num">{q.quantity}</td>
                  <td className="num">{usd(q.unitCost)}</td>
                  <td className="num">{usd(q.total)}</td>
                </tr>
              ))}
              <tr className="rp-total">
                <td colSpan={4}>Total of requests not yet received</td>
                <td className="num">{usd(r.requests.filter((q) => q.status !== 'received').reduce((n, q) => n + (q.total || 0), 0))}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>None.</p>
        )}

        <h2>Last audit</h2>
        {r.audit ? (
          <>
            <p>
              {dayOf(r.audit.finishedAt)}, by {r.audit.finishedBy || r.audit.startedBy}: {r.audit.counts.found} found, {r.audit.counts.missing} missing, {r.audit.counts.damaged} needed repair, {r.audit.counts.checked} of{' '}
              {r.gear.length} checked.
            </p>
            {r.audit.results.filter((x) => x.status !== 'found').length > 0 && (
              <ul>
                {r.audit.results
                  .filter((x) => x.status !== 'found')
                  .map((x) => (
                    <li key={x.gearId}>
                      {x.name}: {x.status === 'missing' ? 'missing' : 'needs repair'}
                      {x.note ? ` (${x.note})` : ''}
                    </li>
                  ))}
              </ul>
            )}
          </>
        ) : (
          <p>No audit yet.</p>
        )}

        <h2>Inventory</h2>
        {Object.entries(groups).map(([cat, list]) => (
          <table key={cat} className="rp-table">
            <caption>{cat}</caption>
            <thead>
              <tr>
                <th>Item</th>
                <th>Brand / model</th>
                <th>Serial / tag</th>
                <th className="num">Qty</th>
                <th>Where</th>
                <th>Condition</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.name}
                    {g.missing ? ' (missing)' : ''}
                    {g.attention ? ' (needs fixing)' : ''}
                  </td>
                  <td>{[g.brand, g.model].filter(Boolean).join(' ')}</td>
                  <td className="small">{[g.serial, g.assetTag].filter(Boolean).join(' · ')}</td>
                  <td className="num">{g.quantity}</td>
                  <td>{g.location}</td>
                  <td>{CONDITION[g.condition] || ''}</td>
                  <td className="num">{g.cost !== null ? usd(g.cost * g.quantity) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {r.fixed.length > 0 && (
          <>
            <h2>Fixed or found in the last 90 days</h2>
            <ul>
              {r.fixed.map((p) => (
                <li key={p.id}>
                  {p.title}: {p.kind === 'missing' ? 'found' : 'fixed'} {dayOf(p.fixedAt)}
                  {p.fixedBy ? ` by ${p.fixedBy}` : ''}
                  {p.fixNote ? ` (${p.fixNote})` : ''}
                </li>
              ))}
            </ul>
          </>
        )}
      </article>
    );
  }
}
