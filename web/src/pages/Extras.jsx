// Extra features the admin turns on in Settings → Extra features. Each piece checks its switch.
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, fmtDay, fmtTime, fmtWhen } from '../lib.js';
import { Empty, Modal, useApp } from '../ui.jsx';

export const FEATURE_INFO = [
  ['liveShow', 'Live run-of-show', 'A booth view that follows the order of service during the service (Now, Next, ahead or behind), and a stage clock link for a screen the speaker can see.'],
  ['checklists', 'Pre-service checklists', 'A checklist per position (line check, batteries, test stream…). Crew tick it off in My shifts; leaders see who’s ready.'],
  ['inputList', 'Input list', 'A channel list for each service (who’s on which mic or DI), printable for FOH and the stage, and shown on the rundown.'],
  ['problems', 'Problem reports', 'Anyone can report a problem (“Mic 3 crackling”). It goes on a fix list in the Gear tab until a leader marks it fixed.'],
  ['debrief', 'After-service check-in', 'People who served get three quick questions in My shifts. Leaders read the answers on the plan and can send them to a flow chart.'],
  ['signoffs', 'Training sign-offs', 'A Lead who has a learner shadowing them can sign them off, moving that position from Learning to Capable.'],
];
export const featureOn = (app, k) => !!app.settings.features?.[k];

// ---------- Settings → Extra features ----------
export function ExtraFeaturesCard() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const toggle = async (k, on) => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PATCH', body: { features: { [k]: on } } });
      await app.reload();
      app.toast(on ? 'Turned on' : 'Turned off');
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  return (
    <section className="card stack" aria-label="Extra features">
      <h2>Extra features</h2>
      <p className="muted small">Off until you turn them on. Turning one off hides it again; nothing saved is lost.</p>
      <div className="stack-sm">
        {FEATURE_INFO.map(([k, name, blurb]) => (
          <label key={k} className="check check-top feature-row">
            <input type="checkbox" checked={featureOn(app, k)} disabled={busy} onChange={(e) => toggle(k, e.target.checked)} />
            <span>
              <strong>{name}</strong>
              <span className="small muted block">{blurb}</span>
            </span>
          </label>
        ))}
      </div>
      {featureOn(app, 'checklists') && <ChecklistEditor />}
    </section>
  );
}

function ChecklistEditor() {
  const app = useApp();
  const [lists, setLists] = useState(() => Object.fromEntries(app.positions.map((p) => [p.key, (app.settings.checklists?.[p.key] || []).join('\n')])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('/settings', { method: 'PATCH', body: { checklists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.split('\n').map((x) => x.trim()).filter(Boolean)])) } });
      await app.reload();
      app.toast('Checklists saved');
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  return (
    <div className="stack-sm divider-top">
      <div className="label-sm">Checklists, one item per line</div>
      {app.positions.map((p) => (
        <label key={p.key} className="field">
          <span>{p.label}</span>
          <textarea rows={3} value={lists[p.key] || ''} onChange={(e) => setLists({ ...lists, [p.key]: e.target.value })} placeholder={p.key === 'foh' ? 'Line check every mic\nFresh batteries in wireless\nMonitor mixes set' : 'One item per line'} />
        </label>
      ))}
      <button type="button" className="btn btn-primary btn-sm self-start" disabled={busy} onClick={save}>
        Save checklists
      </button>
    </div>
  );
}

// ---------- checklist on a shift (My shifts) ----------
export function ShiftChecklist({ eventId, position }) {
  const app = useApp();
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api(`/checklists/${eventId}`).then(setD, () => setD({ positions: [] })), [eventId]);
  useEffect(() => {
    load();
  }, [load]);
  const p = d?.positions.find((x) => x.key === position);
  if (!p) return null;
  const tick = async (item, done) => {
    try {
      setD(await api(`/checklists/${eventId}`, { method: 'POST', body: { position, item, done } }));
    } catch (e) {
      app.toast(e.message);
    }
  };
  const all = p.done === p.items.length;
  return (
    <div className={`shift-check${all ? ' shift-check-done' : ''}`}>
      <button type="button" className="btn btn-soft btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {all ? '✓ ' : ''}Pre-service checklist {p.done}/{p.items.length}
      </button>
      {open && (
        <ul className="check-list">
          {p.items.map((it) => (
            <li key={it.text}>
              <label className="check">
                <input type="checkbox" checked={it.done} onChange={(e) => tick(it.text, e.target.checked)} />
                <span>
                  {it.text}
                  {it.done && it.by && <span className="small muted"> · {it.by}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- input list (plan editor) ----------
const EMPTY_ROW = { ch: '', source: '', mic: '', stand: '', notes: '' };
export function InputListCard({ plan, canEdit, onSave, setPlan }) {
  const app = useApp();
  const [rows, setRows] = useState(plan.inputs);
  const [busy, setBusy] = useState(false);
  useEffect(() => setRows(plan.inputs), [plan.inputs]);
  const dirty = JSON.stringify(rows.filter((r) => r.ch || r.source || r.mic)) !== JSON.stringify(plan.inputs);
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ inputs: rows }, 'Input list saved');
    } catch {
      /* toast shown */
    }
    setBusy(false);
  };
  const copyLast = async () => {
    setBusy(true);
    try {
      const r = await api(`/plans/${plan.event.id}/inputs/copy-last`, { method: 'POST' });
      setPlan(r);
      app.toast(`Copied from ${r.copiedFrom.title}, ${fmtDate(r.copiedFrom.date)}`);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  const print = () => {
    document.body.classList.add('print-inputs');
    const done = () => {
      document.body.classList.remove('print-inputs');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };
  return (
    <section className="card stack input-print" aria-label="Input list">
      <div className="section-head">
        <div>
          <h3>Input list</h3>
          <p className="small muted no-print">Who’s on which channel, mic and stand. Prints for FOH and the stage, and shows on the rundown link.</p>
          <p className="print-only-block small">
            {plan.event.title} · {fmtDay(plan.event.date)} · {fmtTime(plan.event.start)}
          </p>
        </div>
        {rows.length > 0 && (
          <button type="button" className="btn btn-outline btn-sm no-print" onClick={print}>
            Print
          </button>
        )}
      </div>
      {rows.length === 0 && !canEdit && <Empty>No input list for this one.</Empty>}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="input-table">
            <thead>
              <tr>
                <th scope="col">Ch</th>
                <th scope="col">Source</th>
                <th scope="col">Mic / DI</th>
                <th scope="col">Stand</th>
                <th scope="col">Notes</th>
                {canEdit && <th scope="col" className="no-print"><span className="sr-only">Remove</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {['ch', 'source', 'mic', 'stand', 'notes'].map((k) => (
                    <td key={k}>
                      {canEdit ? <input aria-label={k} className={`in-${k}`} value={r[k] || ''} onChange={(e) => set(i, k, e.target.value)} placeholder={{ ch: String(i + 1), source: 'Lead vocal', mic: 'SM58', stand: 'Tall boom', notes: '' }[k]} /> : r[k]}
                    </td>
                  ))}
                  {canEdit && (
                    <td className="no-print">
                      <button type="button" className="icon-btn" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="row-wrap no-print">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setRows([...rows, { ...EMPTY_ROW, ch: String(rows.length + 1) }])}>
            Add channel
          </button>
          {rows.length === 0 && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={copyLast}>
              Copy last week’s
            </button>
          )}
          {dirty && (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
                Save input list
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(plan.inputs)}>
                Discard
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- problem reports ----------
export function ReportProblem({ eventId, gearId, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({ title: '', details: '', gearId: gearId || '' });
  const [gear, setGear] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/gear').then(setGear, () => {});
  }, []);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/issues', { method: 'POST', body: { ...f, eventId } });
      app.toast('Reported. It’s on the fix list.');
      onSaved?.();
      onClose();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title="Report a problem" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>What’s wrong</span>
          <input required maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Mic 3 crackles when moved" autoFocus />
        </label>
        <label className="field">
          <span>Details (optional)</span>
          <textarea rows={3} maxLength={1000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="When it happened, what you tried" />
        </label>
        {gear.length > 0 && (
          <label className="field">
            <span>Which gear (optional)</span>
            <select value={f.gearId} onChange={(e) => setF({ ...f, gearId: e.target.value })}>
              <option value="">Not a gear item</option>
              {gear.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Report it'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FixList() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [showFixed, setShowFixed] = useState(false);
  const [fixing, setFixing] = useState(null);
  const [note, setNote] = useState('');
  const load = useCallback(() => api('/issues').then(setList, (e) => app.toast(e.message)), [app]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (fn, msg) => {
    try {
      await fn();
      app.toast(msg);
      setFixing(null);
      setNote('');
      load();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const open = (list || []).filter((i) => i.status === 'open');
  const fixed = (list || []).filter((i) => i.status === 'fixed');
  const row = (i) => (
    <li key={i.id} className={`fix-row${i.status === 'fixed' ? ' fix-done' : ''}`}>
      <div className="stack-xs grow">
        <strong>{i.title}</strong>
        {i.details && <span className="small">{i.details}</span>}
        <span className="small muted">
          {[i.gear?.name, i.event && `${i.event.title}, ${fmtDay(i.event.date)}`, `reported by ${i.reportedBy || 'someone'} ${fmtWhen(i.createdAt)}`].filter(Boolean).join(' · ')}
        </span>
        {i.status === 'fixed' && (
          <span className="small good">
            Fixed by {i.fixedBy} {fmtWhen(i.fixedAt)}
            {i.fixNote ? ` · ${i.fixNote}` : ''}
          </span>
        )}
        {fixing === i.id && (
          <form className="row-wrap" onSubmit={(e) => (e.preventDefault(), act(() => api(`/issues/${i.id}/fix`, { method: 'POST', body: { note } }), 'Marked fixed'))}>
            <input className="grow" aria-label="What was done" placeholder="What was done (optional)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
            <button className="btn btn-primary btn-sm">Mark fixed</button>
          </form>
        )}
      </div>
      {app.can.plans && i.status === 'open' && fixing !== i.id && (
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setFixing(i.id)}>
          Fixed…
        </button>
      )}
      {app.can.plans && i.status === 'fixed' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api(`/issues/${i.id}/reopen`, { method: 'POST' }), 'Reopened')}>
          Reopen
        </button>
      )}
    </li>
  );
  return (
    <div className="stack">
      <div className="row-wrap">
        <button type="button" className="btn btn-primary" onClick={() => setReporting(true)}>
          Report a problem
        </button>
        <span className="small muted">Stays on this list until a leader marks it fixed.</span>
      </div>
      {!list && <div className="loading-inline">Loading…</div>}
      {list && (
        <section className="card stack-sm" aria-label="Open problems">
          <h3>To fix ({open.length})</h3>
          {open.length === 0 ? <Empty>Nothing to fix right now.</Empty> : <ul className="fix-list">{open.map(row)}</ul>}
        </section>
      )}
      {fixed.length > 0 && (
        <section className="card stack-sm" aria-label="Fixed problems">
          <button type="button" className="btn btn-ghost btn-sm self-start" aria-expanded={showFixed} onClick={() => setShowFixed(!showFixed)}>
            {showFixed ? 'Hide' : 'Show'} fixed ({fixed.length})
          </button>
          {showFixed && <ul className="fix-list">{fixed.map(row)}</ul>}
        </section>
      )}
      {reporting && <ReportProblem onClose={() => setReporting(false)} onSaved={load} />}
    </div>
  );
}

// ---------- after-service check-in ----------
export function DebriefPrompt() {
  const app = useApp();
  const [pending, setPending] = useState([]);
  const [f, setF] = useState({ wentWell: '', problems: '', ideas: '', toFixList: true });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api('/debrief/pending').then(setPending, () => setPending([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const ev = pending[0];
  if (!ev) return null;
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/debrief/${ev.id}`, { method: 'POST', body: f });
      app.toast('Thanks for checking in!');
      setF({ wentWell: '', problems: '', ideas: '', toFixList: true });
      load();
    } catch (err) {
      app.toast(err.message);
    }
    setBusy(false);
  };
  return (
    <section className="card card-strong stack" aria-label="After-service check-in">
      <div>
        <h2>How did {ev.title} go?</h2>
        <p className="small muted">{fmtDay(ev.date)} · Takes a minute. Your leaders read these to plan next week.</p>
      </div>
      <form className="stack-sm" onSubmit={send}>
        <label className="field">
          <span>What went well?</span>
          <textarea rows={2} maxLength={1000} value={f.wentWell} onChange={(e) => setF({ ...f, wentWell: e.target.value })} />
        </label>
        <label className="field">
          <span>Any problems?</span>
          <textarea rows={2} maxLength={1000} value={f.problems} onChange={(e) => setF({ ...f, problems: e.target.value })} />
        </label>
        {featureOn(app, 'problems') && f.problems.trim() && (
          <label className="check small">
            <input type="checkbox" checked={f.toFixList} onChange={(e) => setF({ ...f, toFixList: e.target.checked })} />
            <span>Add it to the fix list</span>
          </label>
        )}
        <label className="field">
          <span>Ideas for next time?</span>
          <textarea rows={2} maxLength={1000} value={f.ideas} onChange={(e) => setF({ ...f, ideas: e.target.value })} />
        </label>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy}>
            Send
          </button>
          {pending.length > 1 && <span className="small muted">{pending.length - 1} more after this</span>}
        </div>
      </form>
    </section>
  );
}

export function DebriefAnswers({ plan }) {
  const app = useApp();
  const [list, setList] = useState(null);
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState('');
  useEffect(() => {
    api(`/debrief/${plan.event.id}`).then(setList, () => setList([]));
    if (app.me.role === 'admin' || app.me.role === 'leader') api('/boards').then(setBoards, () => {});
  }, [plan.event.id, app.me.role]);
  if (!list || list.length === 0) return null;
  const toBoard = async () => {
    try {
      const b = await api(`/boards/${boardId}`);
      const baseY = Math.max(0, ...b.nodes.map((n) => n.y)) + 160;
      const notes = list.flatMap((d, i) =>
        [
          d.wentWell && { label: `✓ ${d.wentWell}\n— ${d.name}`, color: 'green' },
          d.problems && { label: `⚠ ${d.problems}\n— ${d.name}`, color: 'red' },
          d.ideas && { label: `💡 ${d.ideas}\n— ${d.name}`, color: 'yellow' },
        ]
          .filter(Boolean)
          .map((n, k) => ({ id: `db${Date.now().toString(36)}${i}${k}`, type: 'note', x: k * 220, y: baseY + i * 150, w: null, h: null, label: n.label, color: n.color, personId: null }))
      );
      await api(`/boards/${boardId}`, { method: 'PUT', body: { rev: b.rev, nodes: [...b.nodes, ...notes], edges: b.edges } });
      app.toast(`Added ${notes.length} note${notes.length === 1 ? '' : 's'} to “${b.title}”`);
    } catch (e) {
      app.toast(e.message);
    }
  };
  return (
    <section className="card stack" aria-label="After-service check-ins">
      <h3>After-service check-ins ({list.length})</h3>
      <div className="stack-sm">
        {list.map((d, i) => (
          <div key={i} className="debrief">
            <strong>{d.name}</strong>
            {d.wentWell && <span className="small">✓ {d.wentWell}</span>}
            {d.problems && <span className="small danger">⚠ {d.problems}</span>}
            {d.ideas && <span className="small">💡 {d.ideas}</span>}
          </div>
        ))}
      </div>
      {boards.length > 0 && (
        <div className="row-wrap">
          <select aria-label="Board" value={boardId} onChange={(e) => setBoardId(e.target.value)}>
            <option value="">Send to a flow chart…</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-outline btn-sm" disabled={!boardId} onClick={toBoard}>
            Add as sticky notes
          </button>
        </div>
      )}
    </section>
  );
}

// ---------- training sign-offs ----------
export function SignOffButton({ shift, onDone }) {
  const app = useApp();
  const learner = app.person(shift.learner);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!learner || !(learner.trainee || []).includes(shift.position)) return null;
  const go = async () => {
    setBusy(true);
    try {
      await api('/signoffs', { method: 'POST', body: { userId: learner.id, position: shift.position, eventId: shift.id, note } });
      app.toast(`${learner.name} is now Capable on ${app.posLabel(shift.position)}`);
      await app.reload();
      onDone?.();
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  return open ? (
    <div className="signoff-box stack-xs">
      <span className="small">
        Sign off <strong>{learner.name}</strong> on {app.posLabel(shift.position)}? They’ll be able to take it on their own.
      </span>
      <input aria-label="Note" placeholder="Note (optional): ran the whole service" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row-wrap">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={go}>
          Sign off
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          Not yet
        </button>
      </div>
    </div>
  ) : (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
      Sign off {learner.name.split(' ')[0]}…
    </button>
  );
}

export function SignOffHistory({ person }) {
  const app = useApp();
  const [list, setList] = useState(null);
  const [pos, setPos] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/signoffs?userId=${person.id}`).then(setList, () => setList([])), [person.id]);
  useEffect(() => {
    load();
  }, [load]);
  const canSign = app.me.role === 'admin' && (person.trainee || []).length > 0;
  const go = async () => {
    setBusy(true);
    try {
      await api('/signoffs', { method: 'POST', body: { userId: person.id, position: pos } });
      app.toast(`Signed off on ${app.posLabel(pos)}`);
      setPos('');
      await app.reload();
      load();
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  if (!list || (!list.length && !canSign)) return null;
  return (
    <div className="stack-xs">
      <div className="label-sm">Training sign-offs</div>
      {list.map((s, i) => (
        <span key={i} className="small">
          {app.posLabel(s.position)} · signed off by {s.by || 'someone'} {fmtWhen(s.at)}
          {s.note ? ` · ${s.note}` : ''}
        </span>
      ))}
      {canSign && (
        <div className="row-wrap">
          <select aria-label="Position to sign off" value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">Sign off on…</option>
            {person.trainee.map((k) => (
              <option key={k} value={k}>
                {app.posLabel(k)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-outline btn-sm" disabled={!pos || busy} onClick={go}>
            Sign off
          </button>
        </div>
      )}
    </div>
  );
}
