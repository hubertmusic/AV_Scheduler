// Church Admin: Planning — meetings (agenda, minutes, motions, action items), goals and
// milestones, action items, votes on record, the yearly calendar, event requests and flow charts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, api, copyText, fmtDate, fmtDay, fmtTime, todayISO } from '../lib.js';
import { Empty, Icon, Modal, useApp } from '../ui.jsx';
import { CommitteeChips, CommitteePicker, committeeName, MEETING_TYPES, TYPES, TypeChip, whenText } from '../office.jsx';
import Boards from './Boards.jsx';
import { CallBar, HereBar, useLive } from '../live.jsx';

const VIEWS = [
  { id: 'meetings', tab: 'Meetings', blurb: 'Agendas before, minutes after. The secretary takes the minutes; a leader can open them to anyone in the meeting.' },
  { id: 'goals', tab: 'Goals', blurb: 'Long-range goals broken into milestones, with owners and due dates. They fill the quarter, year and 3-year views.' },
  { id: 'actions', tab: 'Action items', blurb: 'Who’s doing what, by when. Owners get an email when something is due.' },
  { id: 'votes', tab: 'Votes on record', blurb: 'Every motion from the meetings you can see, newest first.' },
  { id: 'year', tab: 'Yearly calendar', blurb: 'The church year’s rhythm — Week of Prayer, budget season, nominating. Set it once and fill in each year.', perm: 'plans' },
  { id: 'requests', tab: 'Requests', blurb: 'Rooms and church events people ask for, in Crew Call or with the room request link. Each one goes on the next board meeting’s agenda. Approve it into the calendar or decline it; they get an email either way.', perm: 'approve' },
  { id: 'boards', tab: 'Flow charts', blurb: 'Sketch processes with boxes and lines, like the budget approval steps. Shared with Church Admin leaders.', leader: true },
];
const STATUS = { 'not-started': 'Not started', 'on-track': 'On track', behind: 'Behind', done: 'Done' };

export default function OfficePlanning() {
  const app = useApp();
  const views = VIEWS.filter((v) => (!v.perm || app.officeCan[v.perm] || (v.perm === 'approve' && app.me.role === 'admin')) && (!v.leader || (app.officeMember && ['admin', 'leader'].includes(app.me.role))));
  const [view, setView] = useState(app.officeMeeting ? 'meetings' : 'meetings');
  const v = views.find((x) => x.id === view) || views[0];
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Planning</h1>
          <div className="muted">{v.blurb}</div>
        </div>
      </div>
      <div className="seg seg-scroll" role="group" aria-label="Planning views">
        {views.map((x) => (
          <button key={x.id} type="button" aria-pressed={v.id === x.id} onClick={() => setView(x.id)}>
            {x.tab}
          </button>
        ))}
      </div>
      {v.id === 'meetings' && <Meetings />}
      {v.id === 'goals' && <Goals />}
      {v.id === 'actions' && <Actions />}
      {v.id === 'votes' && <Votes />}
      {v.id === 'year' && <YearPlan />}
      {v.id === 'requests' && <EventRequests />}
      {v.id === 'boards' && <Boards />}
    </div>
  );
}

// ======================= meetings =======================
function Meetings() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(app.officeMeeting || null);
  const load = useCallback(() => {
    const t = todayISO();
    api(`/office/events?from=${addDays(t, -90)}&to=${addDays(t, 120)}`).then((evs) => setList(evs.filter((e) => MEETING_TYPES.includes(e.type) || e.agendaItems > 0 || e.minutesStatus !== 'none')), () => setList([]));
  }, []);
  useEffect(() => {
    load();
    if (app.officeMeeting) app.clearMeeting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  const t = todayISO();
  const [all, setAll] = useState(false);
  const upAll = (list || []).filter((e) => e.date >= t);
  const pastAll = (list || []).filter((e) => e.date < t).reverse();
  const upcoming = all ? upAll : upAll.slice(0, 6);
  const past = all ? pastAll : pastAll.slice(0, 3);
  const more = upAll.length + pastAll.length - upcoming.length - past.length;
  const pick = (id) => {
    setSel(id);
    // On a phone the meeting is below the list: bring it into view
    if (window.matchMedia?.('(max-width: 900px)').matches) setTimeout(() => document.getElementById('meeting-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  return (
    <div className="split">
      <div className="side-col stack mtg-list">
        {!list && <div className="loading-inline">Loading…</div>}
        {list && list.length === 0 && <Empty>No meetings yet. Add a board or committee meeting on the Schedule.</Empty>}
        {upcoming.length > 0 && <h2 className="small-head">Coming up</h2>}
        {upcoming.map((e) => (
          <MeetingButton key={e.id} e={e} on={sel === e.id} onClick={() => pick(e.id)} />
        ))}
        {past.length > 0 && <h2 className="small-head">Past</h2>}
        {past.map((e) => (
          <MeetingButton key={e.id} e={e} on={sel === e.id} onClick={() => pick(e.id)} />
        ))}
        {more > 0 && (
          <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setAll(true)}>
            Show {more} more
          </button>
        )}
      </div>
      <div className="main-col" id="meeting-panel">{sel ? <Meeting key={sel} id={sel} onChanged={load} /> : <Empty>Pick a meeting to see its agenda and minutes.</Empty>}</div>
    </div>
  );
}
function MeetingButton({ e, on, onClick }) {
  return (
    <button type="button" className={`mtg-btn ${on ? 'mtg-on' : ''}`} aria-current={on || undefined} onClick={onClick}>
      <span className="strong">{e.title}</span>
      <span className="muted small">{whenText(e)}</span>
      <span className="row-wrap tight">
        <CommitteeChips keys={e.committees} shared={e.sharedWith} />
        {e.agendaItems > 0 ? <span className="chip oc oc-gray">{e.agendaItems} agenda items</span> : <span className="chip oc oc-orange">No agenda</span>}
        {e.minutesStatus === 'approved' && <span className="chip oc oc-green">Minutes approved</span>}
        {e.minutesStatus === 'draft' && <span className="chip oc oc-yellow">Minutes draft</span>}
      </span>
    </button>
  );
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function printDoc(title, body) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:15px/1.5 -apple-system,Segoe UI,sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#17191c}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 8px;border-bottom:1px solid #ccc}ol,ul{padding-left:22px}li{margin:4px 0}.muted{color:#5b6068}.h{font-weight:700;list-style:none;margin-left:-22px;margin-top:12px}pre{white-space:pre-wrap;font:inherit}</style>${body}<script>setTimeout(()=>print(),200)</script>`);
  w.document.close();
}
function agendaText(m, orgName) {
  let n = 0;
  return [m.title, whenText(m) + (m.room ? ` · ${m.room}` : ''), ...(m.callLink ? ['', `Join the call: ${m.callLink}`] : []), '', 'Agenda', ...m.agenda.map((x) => (x.kind === 'heading' ? `\n${x.title.toUpperCase()}` : `${++n}. ${x.title}${x.presenter ? ` — ${x.presenter}` : ''}${x.minutes ? ` (${x.minutes} min)` : ''}`)), '', `— ${orgName}`].join('\n');
}

function Meeting({ id, onChanged }) {
  const app = useApp();
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api(`/office/events/${id}`, { background: true }).then(setM, (e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);
  const [writing, setWriting] = useState('');
  const { here } = useLive({ url: m ? `/office/events/${m.id}/live` : '', v: m?.v, reload: load, writing });
  const act = async (fn, msg) => {
    try {
      const out = await fn();
      if (out && out.id) setM(out);
      if (msg) app.toast(typeof msg === 'function' ? msg(out) : msg);
      onChanged?.();
      return out;
    } catch (e) {
      app.toast(e.message);
      return null;
    }
  };
  if (error) return <p className="error">{error}</p>;
  if (!m) return <div className="loading-inline">Loading…</div>;
  const going = m.audience.filter((a) => a.rsvp === 'yes').length;
  const presentCount = m.present.length;
  const totalMin = m.agenda.reduce((s, x) => s + (x.kind === 'item' ? x.minutes || 0 : 0), 0);
  const printAgenda = () => {
    let n = 0;
    printDoc(`Agenda · ${m.title}`, `<h1>${esc(m.title)}</h1><div class="muted">${esc(whenText(m))}${m.room ? ` · ${esc(m.room)}` : ''}</div><h2>Agenda</h2><ol>${m.agenda.map((x) => (x.kind === 'heading' ? `<li class="h">${esc(x.title)}</li>` : `<li value="${++n}">${esc(x.title)}${x.presenter ? ` — ${esc(x.presenter)}` : ''}${x.minutes ? ` <span class="muted">(${x.minutes} min)</span>` : ''}${x.notes ? `<div class="muted">${esc(x.notes)}</div>` : ''}</li>`)).join('')}</ol>`);
  };
  const printMinutes = () => {
    const names = (ids) => m.audience.filter((a) => ids.includes(a.id)).map((a) => a.name).join(', ');
    printDoc(
      `Minutes · ${m.title}`,
      `<h1>Minutes: ${esc(m.title)}</h1><div class="muted">${esc(whenText(m))}${m.room ? ` · ${esc(m.room)}` : ''}${m.minutesApprovedAt ? ` · approved ${esc(new Date(m.minutesApprovedAt).toLocaleDateString())}` : ' · draft'}</div><h2>Present</h2><p>${esc(names(m.present)) || '—'}${m.guests ? `<br>Also present: ${esc(m.guests)}` : ''}</p><h2>Minutes</h2><pre>${esc(m.minutes) || '—'}</pre>${m.motions.length ? `<h2>Motions</h2><ol>${m.motions.map((x) => `<li>${esc(x.text)} — moved by ${esc(x.movedBy || '?')}, seconded by ${esc(x.secondedBy || '?')}: <strong>${esc(x.result)}</strong>${x.votesFor || x.votesAgainst || x.abstain ? ` (${x.votesFor}–${x.votesAgainst}, ${x.abstain} abstained)` : ''}</li>`).join('')}</ol>` : ''}${m.actions.length ? `<h2>Action items</h2><ul>${m.actions.map((a) => `<li>${esc(a.title)}${a.owner ? ` — ${esc(a.owner.name)}` : ''}${a.due ? ` (by ${esc(fmtDate(a.due))})` : ''}</li>`).join('')}</ul>` : ''}`
    );
  };

  return (
    <div className="stack-lg">
      <section className="card stack-sm">
        <div className="row-wrap spread">
          <div>
            <h2>{m.title}</h2>
            <div className="muted">
              {whenText(m)}
              {m.room ? ` · ${m.room}` : ''}
            </div>
          </div>
          <div className="row-wrap tight">
            <TypeChip type={m.type} />
            <CommitteeChips keys={m.committees} shared={m.sharedWith} />
          </div>
        </div>
        <CallBar
          link={m.callLink}
          canEdit={m.canAgenda}
          onSave={(link) => act(() => api(`/office/events/${m.id}/call`, { method: 'PUT', body: { link } }), link ? 'Call link saved' : 'Call link removed')}
          addBlurb="Meeting by phone or video? Add a WhatsApp call link and everyone gets a Join button here and in the agenda."
        />
        <div className="small muted">
          {going} of {m.audience.filter((a) => a.invited).length} said they’re coming
          {m.quorum > 0 && (
            <span className={going >= m.quorum ? 'ok-text' : 'danger'}>
              {' '}
              · quorum is {m.quorum}
            </span>
          )}
        </div>
      </section>

      <HereBar here={here} what="this meeting" />
      <AgendaCard m={m} act={act} totalMin={totalMin} onPrint={printAgenda} onWriting={setWriting} />

      <section className="card stack" aria-label="Minutes">
        <div className="row-wrap spread">
          <h2>Minutes</h2>
          <div className="row-wrap tight">
            {m.minutesApprovedAt ? <span className="chip oc oc-green">Approved {fmtDate(m.minutesApprovedAt.slice(0, 10))}</span> : m.minutes || m.motions.length ? <span className="chip oc oc-yellow">Draft</span> : null}
            <button type="button" className="btn btn-ghost btn-sm" onClick={printMinutes}>
              Print
            </button>
          </div>
        </div>
        {!m.canMinutes && !m.minutesApprovedAt && <p className="muted small">{m.minutesOpen ? 'Anyone in this meeting can take the minutes.' : 'The secretary takes the minutes. A leader can open them to anyone in the meeting if the secretary is away.'}</p>}
        {m.canApprove && !m.minutesApprovedAt && (
          <label className="check">
            <input type="checkbox" checked={m.minutesOpen} onChange={(e) => act(() => api(`/office/events/${m.id}/minutes-open`, { method: 'POST', body: { open: e.target.checked } }), e.target.checked ? 'Anyone in the meeting can take minutes now' : 'Back to the secretary')} />
            <span>Let anyone in this meeting take the minutes (the secretary is away)</span>
          </label>
        )}
        <MinutesEditor m={m} setM={setM} onWriting={setWriting} />
        <p className="small muted">
          {presentCount} present{m.quorum > 0 ? (presentCount >= m.quorum ? ' · quorum met' : ` · quorum (${m.quorum}) not met`) : ''}
          {m.minutesBy ? ` · last written by ${m.minutesBy}` : ''}
        </p>
        <Motions m={m} act={act} />
        {m.canApprove && (
          <div className="row-wrap">
            {m.minutesApprovedAt ? (
              <button type="button" className="btn btn-ghost" onClick={() => act(() => api(`/office/events/${m.id}/minutes-approve`, { method: 'POST', body: { approved: false } }), 'Minutes reopened')}>
                Reopen the minutes
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!m.minutes && !m.motions.length} onClick={() => window.confirm('Mark these minutes approved? They lock and go into the document library.') && act(() => api(`/office/events/${m.id}/minutes-approve`, { method: 'POST' }), 'Minutes approved')}>
                Approve the minutes
              </button>
            )}
            {m.minutesApprovedBy && <span className="muted small">Approved by {m.minutesApprovedBy}</span>}
          </div>
        )}
      </section>

      <MeetingActions m={m} act={act} reload={load} />
    </div>
  );
}

function AgendaCard({ m, act, totalMin, onPrint, onWriting }) {
  const app = useApp();
  const [rows, setRows] = useState(null);
  const editing = rows !== null;
  useEffect(() => onWriting(editing ? 'agenda' : ''), [editing, onWriting]);
  const items = m.agenda.filter((x) => x.kind === 'item');
  const nowAt = items.findIndex((x) => x.id === m.liveItem);
  const discuss = (item) => act(() => api(`/office/events/${m.id}/live`, { method: 'PUT', body: { item } }));
  const start = () => setRows(m.agenda.length ? m.agenda.map((x) => ({ ...x })) : [{ kind: 'item', title: '', presenter: '', minutes: 0, notes: '' }]);
  const setRow = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i, d) => {
    const next = rows.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    setRows(next);
  };
  const save = async () => {
    const out = await act(() => api(`/office/events/${m.id}/agenda`, { method: 'PUT', body: { agenda: rows } }), 'Agenda saved');
    if (out) setRows(null);
  };
  let n = 0;
  return (
    <section className="card stack" aria-label="Agenda">
      <div className="row-wrap spread">
        <h2>Agenda{totalMin > 0 && <span className="muted small"> · about {totalMin} min</span>}</h2>
        {!editing && (
          <div className="row-wrap tight">
            {m.agenda.length > 0 && (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
                  Print
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => app.openWa({ title: `Send the agenda for ${m.title}`, text: agendaText(m, app.settings.orgName), recipients: [], groupLink: app.team.groupLink || '' })}>
                  WhatsApp
                </button>
                {m.canAgenda && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm('Email the agenda to everyone invited?') && act(() => api(`/office/events/${m.id}/send-agenda`, { method: 'POST' }), (o) => `Emailed to ${o.sent} of ${o.of}`)}>
                    Email it
                  </button>
                )}
              </>
            )}
            {m.canAgenda && (
              <button type="button" className="btn btn-outline btn-sm" onClick={start}>
                <Icon name="edit" size={16} /> {m.agenda.length ? 'Edit' : 'Write the agenda'}
              </button>
            )}
          </div>
        )}
      </div>
      {m.agendaSentAt && !editing && <p className="muted small">Emailed {new Date(m.agendaSentAt).toLocaleString()}</p>}
      {m.canLead && !editing && items.length > 0 && !m.minutesApprovedAt && (
        <div className="lm-lead">
          {nowAt < 0 ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => discuss(items[0].id)}>
              Start: discuss item 1
            </button>
          ) : (
            <>
              {nowAt < items.length - 1 && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => discuss(items[nowAt + 1].id)}>
                  Next item ({nowAt + 2} of {items.length})
                </button>
              )}
              {nowAt > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => discuss(items[nowAt - 1].id)}>
                  Back
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => discuss(null)}>
                {nowAt === items.length - 1 ? 'Done' : 'Stop'}
              </button>
            </>
          )}
          <span className="muted small">Everyone with this meeting open sees which item you’re on.</span>
        </div>
      )}
      {!editing &&
        (m.agenda.length ? (
          <ol className="agenda-list">
            {m.agenda.map((x) =>
              x.kind === 'heading' ? (
                <li key={x.id} className="agenda-heading">
                  {x.title}
                </li>
              ) : (
                <li key={x.id} value={++n} className={m.liveItem === x.id ? 'agenda-now' : undefined} aria-current={m.liveItem === x.id ? 'step' : undefined}>
                  {m.liveItem === x.id && <span className="lm-now">Now</span>}
                  <strong>{x.title}</strong>
                  {x.presenter && <span className="muted"> — {x.presenter}</span>}
                  {x.minutes > 0 && <span className="muted small"> · {x.minutes} min</span>}
                  {m.canLead && !m.minutesApprovedAt && m.liveItem !== x.id && (
                    <button type="button" className="link-btn lm-discuss" onClick={() => discuss(x.id)}>
                      Discuss now
                    </button>
                  )}
                  {x.notes && <div className="small">{x.notes}</div>}
                </li>
              )
            )}
          </ol>
        ) : (
          <p className="muted">No agenda yet.</p>
        ))}
      {editing && (
        <div className="stack-sm">
          {rows.map((r, i) => (
            <div key={i} className={`agenda-edit ${r.kind === 'heading' ? 'agenda-edit-h' : ''}`}>
              <input aria-label={r.kind === 'heading' ? 'Section heading' : 'Agenda item'} placeholder={r.kind === 'heading' ? 'Section, e.g. Reports' : 'Item'} value={r.title} onChange={(e) => setRow(i, 'title', e.target.value)} maxLength={200} />
              {r.kind === 'item' && (
                <>
                  <input aria-label="Who presents" placeholder="Who" value={r.presenter} onChange={(e) => setRow(i, 'presenter', e.target.value)} maxLength={80} />
                  <input aria-label="Minutes" type="number" min={0} max={600} placeholder="Min" value={r.minutes || ''} onChange={(e) => setRow(i, 'minutes', Number(e.target.value))} />
                </>
              )}
              <span className="row tight">
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="up" size={16} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="down" size={16} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Icon name="close" size={16} />
                </button>
              </span>
              {r.kind === 'item' && <input className="agenda-notes" aria-label="Notes" placeholder="Notes (optional)" value={r.notes} onChange={(e) => setRow(i, 'notes', e.target.value)} maxLength={1000} />}
            </div>
          ))}
          <div className="row-wrap">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { kind: 'item', title: '', presenter: '', minutes: 0, notes: '' }])}>
              <Icon name="plus" size={16} /> Item
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([...rows, { kind: 'heading', title: '' }])}>
              <Icon name="plus" size={16} /> Section
            </button>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={save}>
              Save agenda
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setRows(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Minutes save as they're typed, so everyone with the meeting open sees them come in
const minutesOf = (m) => ({ minutes: m.minutes, present: m.present, guests: m.guests });
const sameMinutes = (a, b) => a.minutes === b.minutes && a.guests === b.guests && a.present.join() === b.present.join();
function MinutesEditor({ m, setM, onWriting }) {
  const app = useApp();
  const [f, setF] = useState(() => minutesOf(m));
  const [state, setState] = useState('saved'); // saved | waiting | saving | error
  const [conflict, setConflict] = useState('');
  const base = useRef(minutesOf(m)); // what the server had last time we heard
  const fRef = useRef(f);
  fRef.current = f;
  const timer = useRef(null);
  const dirty = !sameMinutes(f, base.current);
  // Someone else's save came in
  useEffect(() => {
    const server = minutesOf(m);
    if (sameMinutes(server, base.current)) return;
    base.current = server;
    if (sameMinutes(fRef.current, server)) return;
    if (state === 'saved') setF(server);
    else setConflict(`${m.minutesBy || 'Someone'} also changed the minutes. Yours replace theirs when they save; check you’re not both typing.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.minutes, m.guests, m.present.join()]);
  useEffect(() => onWriting(dirty ? 'minutes' : ''), [dirty, onWriting]);
  useEffect(() => () => onWriting(''), [onWriting]);
  const saveNow = async () => {
    clearTimeout(timer.current);
    const body = fRef.current;
    setState('saving');
    try {
      const out = await api(`/office/events/${m.id}/minutes`, { method: 'PUT', body, background: true });
      base.current = minutesOf(out);
      setState(sameMinutes(fRef.current, body) ? 'saved' : 'waiting');
      setConflict('');
      setM(out);
      if (!sameMinutes(fRef.current, body)) timer.current = setTimeout(saveNow, 1200);
    } catch (e) {
      setState('error');
      app.toast(`Minutes not saved: ${e.message}`);
    }
  };
  const change = (next) => {
    setF(next);
    setState('waiting');
    clearTimeout(timer.current);
    timer.current = setTimeout(saveNow, 1200);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!m.canMinutes)
    return m.minutes || m.present.length ? (
      <div className="stack-sm">
        <p className="small">
          <strong>Present:</strong> {m.audience.filter((a) => m.present.includes(a.id)).map((a) => a.name).join(', ') || '—'}
          {m.guests ? ` · also ${m.guests}` : ''}
        </p>
        {m.minutes && <div className="pre-wrap minutes-read">{m.minutes}</div>}
      </div>
    ) : (
      <p className="muted">No minutes yet.</p>
    );
  const toggle = (id) => change({ ...f, present: f.present.includes(id) ? f.present.filter((x) => x !== id) : [...f.present, id] });
  return (
    <div className="stack-sm">
      <fieldset className="field">
        <legend>Who’s here</legend>
        <div className="check-grid">
          {m.audience.map((a) => (
            <label key={a.id} className="check">
              <input type="checkbox" checked={f.present.includes(a.id)} onChange={() => toggle(a.id)} />
              <span>{a.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>Others present (optional)</span>
        <input value={f.guests} onChange={(e) => change({ ...f, guests: e.target.value })} maxLength={500} placeholder="e.g. Pastor Jo, the treasurer’s assistant" />
      </label>
      <label className="field">
        <span>Minutes</span>
        <textarea rows={10} value={f.minutes} onChange={(e) => change({ ...f, minutes: e.target.value })} onBlur={() => state === 'waiting' && saveNow()} maxLength={30000} placeholder="What was discussed and decided, item by item." />
      </label>
      {conflict && <p className="lm-conflict">{conflict}</p>}
      <div className="row-wrap">
        <span className="lm-saving" role="status">
          {{ saved: 'Saved. Everyone with this meeting open sees it.', waiting: 'Saving as you type…', saving: 'Saving…', error: 'Not saved.' }[state]}
        </span>
        {state === 'error' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={saveNow}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function Motions({ m, act }) {
  const blank = { text: '', movedBy: '', secondedBy: '', result: 'passed', votesFor: '', votesAgainst: '', abstain: '' };
  const [f, setF] = useState(blank);
  const [adding, setAdding] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const names = m.audience.map((a) => a.name);
  return (
    <div className="stack-sm">
      <h3>Motions</h3>
      {m.motions.length === 0 && <p className="muted small">No motions recorded.</p>}
      <ol className="motion-list">
        {m.motions.map((x) => (
          <li key={x.id}>
            <strong>{x.text}</strong>
            <div className="small">
              Moved by {x.movedBy || '—'}, seconded by {x.secondedBy || '—'} · <span className={`chip oc oc-${x.result === 'passed' ? 'green' : x.result === 'failed' ? 'red' : 'gray'}`}>{x.result}</span>
              {x.votesFor || x.votesAgainst || x.abstain ? ` · ${x.votesFor} for, ${x.votesAgainst} against, ${x.abstain} abstained` : ''}
              {m.canMinutes && (
                <>
                  {' · '}
                  <button type="button" className="link-btn small" onClick={() => window.confirm('Remove this motion?') && act(() => api(`/office/events/${m.id}/motions/${x.id}`, { method: 'DELETE' }), 'Removed')}>
                    Remove
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
      {m.canMinutes &&
        (adding ? (
          <form
            className="card-sunk stack-sm"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => api(`/office/events/${m.id}/motions`, { method: 'POST', body: f }), 'Motion recorded')) {
                setF(blank);
                setAdding(false);
              }
            }}
          >
            <label className="field">
              <span>Motion</span>
              <textarea rows={2} required maxLength={1000} value={f.text} onChange={set('text')} placeholder="e.g. Accept the Smith roofing bid of $18,400" />
            </label>
            <datalist id="mtg-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <div className="row-wrap fields-3">
              <label className="field">
                <span>Moved by</span>
                <input list="mtg-names" value={f.movedBy} onChange={set('movedBy')} maxLength={80} />
              </label>
              <label className="field">
                <span>Seconded by</span>
                <input list="mtg-names" value={f.secondedBy} onChange={set('secondedBy')} maxLength={80} />
              </label>
              <label className="field">
                <span>Result</span>
                <select value={f.result} onChange={set('result')}>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                  <option value="tabled">Tabled</option>
                  <option value="withdrawn">Withdrawn</option>
                </select>
              </label>
            </div>
            <div className="row-wrap fields-3">
              <label className="field">
                <span>For (optional)</span>
                <input type="number" min={0} value={f.votesFor} onChange={set('votesFor')} />
              </label>
              <label className="field">
                <span>Against</span>
                <input type="number" min={0} value={f.votesAgainst} onChange={set('votesAgainst')} />
              </label>
              <label className="field">
                <span>Abstained</span>
                <input type="number" min={0} value={f.abstain} onChange={set('abstain')} />
              </label>
            </div>
            <div className="row-wrap">
              <button className="btn btn-primary">Record motion</button>
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn btn-outline btn-sm self-start" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Record a motion
          </button>
        ))}
    </div>
  );
}

function MeetingActions({ m, act, reload }) {
  const app = useApp();
  const canAdd = m.canMinutes || m.canApprove;
  const [f, setF] = useState({ title: '', owner: '', due: '' });
  return (
    <section className="card stack" aria-label="Action items from this meeting">
      <h2>Action items from this meeting</h2>
      {m.actions.length === 0 && <p className="muted small">None yet.</p>}
      {m.actions.map((a) => (
        <ActionRow key={a.id} a={a} onChanged={reload} />
      ))}
      {canAdd && (
        <form
          className="row-wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api('/office/actions', { method: 'POST', body: { ...f, meeting: m.id } }).then(async (x) => (await reload(), x)), 'Action item added')) setF({ title: '', owner: '', due: '' });
          }}
        >
          <label className="field grow">
            <span>New action item</span>
            <input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Sign the roofing contract" />
          </label>
          <label className="field">
            <span>Who</span>
            <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
              <option value="">Nobody yet</option>
              {app.people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>By</span>
            <input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
          </label>
          <button className="btn btn-outline self-end">Add</button>
        </form>
      )}
    </section>
  );
}

function ActionRow({ a, onChanged, showMeeting }) {
  const app = useApp();
  const today = todayISO();
  const tick = async () => {
    try {
      await api(`/office/actions/${a.id}`, { method: 'PATCH', body: { done: !a.done } });
      onChanged();
    } catch (e) {
      app.toast(e.message);
    }
  };
  return (
    <div className={`oc-action ${a.done ? 'oc-action-done' : ''}`}>
      <label className="check grow">
        <input type="checkbox" checked={a.done} disabled={!a.canTick} onChange={tick} />
        <span className="stack-xs">
          <strong>{a.title}</strong>
          <span className={`small ${!a.done && a.due && a.due < today ? 'danger' : 'muted'}`}>
            {a.owner ? a.owner.name : 'Nobody yet'}
            {a.due ? ` · ${!a.done && a.due < today ? 'overdue, was due' : 'due'} ${fmtDay(a.due)}` : ''}
            {showMeeting && a.meetingInfo ? ` · from ${a.meetingInfo.title} (${fmtDate(a.meetingInfo.date)})` : ''}
          </span>
        </span>
      </label>
      {a.canEdit && (
        <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${a.title}`} onClick={() => window.confirm('Remove this action item?') && api(`/office/actions/${a.id}`, { method: 'DELETE' }).then(onChanged, (e) => app.toast(e.message))}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

// ======================= action items =======================
function Actions() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [show, setShow] = useState('open');
  const [f, setF] = useState({ title: '', owner: '', due: '', committees: [] });
  const load = useCallback(() => api('/office/actions').then(setList, () => setList([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const shown = (list || []).filter((a) => (show === 'open' ? !a.done : show === 'mine' ? a.owner?.id === app.me.id && !a.done : a.done));
  const canAdd = app.officeCan.edit || app.officeCan.plans;
  return (
    <div className="stack-lg">
      <div className="seg" role="group" aria-label="Show">
        {[
          ['open', 'Open'],
          ['mine', 'Mine'],
          ['done', 'Done'],
        ].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
            {l}
          </button>
        ))}
      </div>
      {canAdd && (
        <form
          className="card stack-sm"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api('/office/actions', { method: 'POST', body: f });
              app.toast('Added');
              setF({ title: '', owner: '', due: '', committees: f.committees });
              load();
            } catch (err) {
              app.toast(err.message);
            }
          }}
        >
          <div className="row-wrap">
            <label className="field grow">
              <span>New action item</span>
              <input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </label>
            <label className="field">
              <span>Who</span>
              <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>
                <option value="">Nobody yet</option>
                {app.people
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>By</span>
              <input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
            </label>
          </div>
          <CommitteePicker own value={f.committees} onChange={(v) => setF({ ...f, committees: v })} legend="Whose is it? (nothing ticked: the whole team)" />
          <button className="btn btn-primary self-start">Add</button>
        </form>
      )}
      {!list && <div className="loading-inline">Loading…</div>}
      {list && shown.length === 0 && <Empty>Nothing here.</Empty>}
      <div className="stack-sm">
        {shown.map((a) => (
          <ActionRow key={a.id} a={a} onChanged={load} showMeeting />
        ))}
      </div>
    </div>
  );
}

// ======================= goals =======================
function Goals() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api('/office/goals').then(setList, () => setList([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const tick = async (g, ms) => {
    try {
      await api(`/office/goals/${g.id}`, { method: 'PATCH', body: { milestones: g.canEdit ? g.milestones.map((x) => ({ ...x, owner: x.owner?.id || null, done: x.id === ms.id ? !x.done : x.done })) : [{ id: ms.id, done: !ms.done }] } });
      load();
    } catch (e) {
      app.toast(e.message);
    }
  };
  return (
    <div className="stack-lg">
      {app.officeCan.plans && (
        <button type="button" className="btn btn-primary self-start" onClick={() => setEditing({})}>
          <Icon name="plus" /> New goal
        </button>
      )}
      {!list && <div className="loading-inline">Loading…</div>}
      {list && list.length === 0 && <Empty>No goals yet{app.officeCan.plans ? '. Add one, like “Replace the sanctuary roof by 2028”.' : '.'}</Empty>}
      {list?.map((g) => (
        <section key={g.id} className="card stack-sm" aria-label={g.title}>
          <div className="row-wrap spread">
            <div>
              <h2>{g.title}</h2>
              <div className="muted small">
                {g.owner ? `${g.owner.name} · ` : ''}
                {g.start ? `${fmtDate(g.start)} – ` : ''}
                {g.due ? `due ${fmtDate(g.due)}` : 'no due date'}
              </div>
            </div>
            <div className="row-wrap tight">
              <span className={`chip oc oc-${g.status === 'behind' ? 'red' : g.status === 'done' ? 'green' : g.status === 'on-track' ? 'blue' : 'gray'}`}>{STATUS[g.status]}</span>
              <CommitteeChips keys={g.committees} shared={g.sharedWith} />
              {g.canEdit && (
                <button type="button" className="icon-btn" aria-label={`Change ${g.title}`} onClick={() => setEditing(g)}>
                  <Icon name="edit" />
                </button>
              )}
            </div>
          </div>
          {g.description && <p className="small pre-wrap">{g.description}</p>}
          <div className="progress" role="progressbar" aria-valuenow={g.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
            <span style={{ width: `${g.progress}%` }} />
          </div>
          <ul className="ms-list">
            {g.milestones.map((ms) => (
              <li key={ms.id}>
                <label className="check">
                  <input type="checkbox" checked={ms.done} disabled={!g.canEdit && ms.owner?.id !== app.me.id} onChange={() => tick(g, ms)} />
                  <span className={ms.done ? 'ms-done' : ''}>
                    {ms.title}
                    <span className="muted small">
                      {ms.owner ? ` · ${ms.owner.name}` : ''}
                      {ms.due ? ` · ${fmtDate(ms.due)}` : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {editing && (
        <GoalModal
          goal={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function GoalModal({ goal, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState(() =>
    goal
      ? { title: goal.title, description: goal.description, owner: goal.owner?.id || '', start: goal.start, due: goal.due, status: goal.status, committees: goal.committees, sharedWith: goal.sharedWith, milestones: goal.milestones.map((m) => ({ id: m.id, title: m.title, due: m.due, owner: m.owner?.id || '', done: m.done })) }
      : { title: '', description: '', owner: '', start: todayISO(), due: '', status: 'not-started', committees: app.me.head ? [] : (app.me.committees || []).slice(0, 1), sharedWith: [], milestones: [{ title: '', due: '', owner: '', done: false }] }
  );
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setMs = (i, k, v) => setF({ ...f, milestones: f.milestones.map((m, j) => (j === i ? { ...m, [k]: v } : m)) });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api(goal ? `/office/goals/${goal.id}` : '/office/goals', { method: goal ? 'PATCH' : 'POST', body: { ...f, owner: f.owner || null, milestones: f.milestones.filter((m) => m.title.trim()).map((m) => ({ ...m, owner: m.owner || null })) } });
      app.toast('Saved');
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove the goal “${goal.title}”?`)) return;
    try {
      await api(`/office/goals/${goal.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  const people = app.people.filter((p) => p.active);
  return (
    <Modal title={goal ? 'Change the goal' : 'New goal'} onClose={onClose} wide>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Goal</span>
          <input required maxLength={160} value={f.title} onChange={set('title')} placeholder="e.g. Replace the sanctuary roof" />
        </label>
        <label className="field">
          <span>Why and how (optional)</span>
          <textarea rows={3} maxLength={3000} value={f.description} onChange={set('description')} />
        </label>
        <div className="row-wrap fields-4">
          <label className="field">
            <span>Starts</span>
            <input type="date" value={f.start} onChange={set('start')} />
          </label>
          <label className="field">
            <span>Due</span>
            <input type="date" value={f.due} onChange={set('due')} />
          </label>
          <label className="field">
            <span>Owner</span>
            <select value={f.owner} onChange={set('owner')}>
              <option value="">Nobody yet</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={f.status} onChange={set('status')}>
              {Object.entries(STATUS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="field">
          <legend>Milestones</legend>
          <div className="stack-sm">
            {f.milestones.map((m, i) => (
              <div key={i} className="ms-edit">
                <input aria-label="Milestone" placeholder="e.g. Pick a contractor" value={m.title} maxLength={200} onChange={(e) => setMs(i, 'title', e.target.value)} />
                <input aria-label="Due" type="date" value={m.due} onChange={(e) => setMs(i, 'due', e.target.value)} />
                <select aria-label="Owner" value={m.owner} onChange={(e) => setMs(i, 'owner', e.target.value)}>
                  <option value="">Owner</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn icon-btn-sm" aria-label="Remove milestone" onClick={() => setF({ ...f, milestones: f.milestones.filter((_, j) => j !== i) })}>
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => setF({ ...f, milestones: [...f.milestones, { title: '', due: '', owner: '', done: false }] })}>
              <Icon name="plus" size={16} /> Milestone
            </button>
          </div>
        </fieldset>
        <CommitteePicker own value={f.committees} onChange={(v) => setF({ ...f, committees: v, sharedWith: f.sharedWith.filter((k) => !v.includes(k)) })} legend="Whose goal is it? (nothing ticked: the whole team)" />
        {f.committees.length > 0 && <CommitteePicker value={f.sharedWith} onChange={(v) => setF({ ...f, sharedWith: v })} exclude={f.committees} legend="Pass it down: let other committees see it" />}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="row-wrap spread">
          <div className="row-wrap">
            <button className="btn btn-primary">Save</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
          {goal && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              Remove goal
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ======================= votes =======================
function Votes() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => api(`/office/motions?q=${encodeURIComponent(q)}`).then(setList, () => setList([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="stack-lg">
      <label className="field">
        <span>Search motions</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. roof, budget, a name" />
      </label>
      {!list && <div className="loading-inline">Loading…</div>}
      {list && list.length === 0 && <Empty>{q ? 'No motions match.' : 'No motions recorded yet.'}</Empty>}
      <div className="stack-sm">
        {list?.map((x) => (
          <div key={x.id} className="card stack-xs">
            <strong>{x.text}</strong>
            <span className="small">
              <span className={`chip oc oc-${x.result === 'passed' ? 'green' : x.result === 'failed' ? 'red' : 'gray'}`}>{x.result}</span> Moved by {x.movedBy || '—'}, seconded by {x.secondedBy || '—'}
              {x.votesFor || x.votesAgainst ? ` · ${x.votesFor}–${x.votesAgainst}` : ''}
            </span>
            <span className="muted small">
              {x.meeting.title} · {fmtDate(x.meeting.date)}
              {x.meeting.committees.length ? ` · ${x.meeting.committees.map((k) => committeeName(app, k)).join(', ')}` : ''}
              {x.meeting.approved ? ' · minutes approved' : ' · minutes not approved yet'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ======================= yearly calendar =======================
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Sabbath'];
function YearPlan() {
  const app = useApp();
  const [items, setItems] = useState(null);
  const [saved, setSaved] = useState('');
  const [year, setYear] = useState(new Date().getFullYear() + 1);
  useEffect(() => {
    api('/office/setup').then((s) => {
      setItems(s.yearPlan);
      setSaved(JSON.stringify(s.yearPlan));
    });
  }, []);
  const dirty = items && JSON.stringify(items) !== saved;
  const setRow = (i, k, v) => setItems(items.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    try {
      const out = await api('/office/year-plan', { method: 'PUT', body: { items } });
      setItems(out.items);
      setSaved(JSON.stringify(out.items));
      app.toast('Yearly calendar saved');
    } catch (e) {
      app.toast(e.message);
    }
  };
  const fill = async () => {
    if (!window.confirm(`Add these to ${year}’s calendar? Anything already there with the same name and date is skipped.`)) return;
    try {
      const r = await api('/office/year-plan/fill', { method: 'POST', body: { year } });
      app.toast(`Added ${r.added} to ${year}${r.skipped ? ` (${r.skipped} were already there)` : ''}`);
    } catch (e) {
      app.toast(e.message);
    }
  };
  if (!items) return <div className="loading-inline">Loading…</div>;
  return (
    <div className="stack-lg">
      <section className="card stack">
        {items.length === 0 && <p className="muted">Nothing yet. Add the things that happen every year.</p>}
        {items.map((r, i) => (
          <div key={r.id || i} className="year-row">
            <input aria-label="Name" value={r.title} maxLength={120} placeholder="e.g. Week of Prayer" onChange={(e) => setRow(i, 'title', e.target.value)} />
            <select aria-label="Kind" value={r.type} onChange={(e) => setRow(i, 'type', e.target.value)}>
              {Object.entries(TYPES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
            <select aria-label="Month" value={r.month} onChange={(e) => setRow(i, 'month', Number(e.target.value))}>
              {MONTHS.map((m, j) => (
                <option key={m} value={j + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select aria-label="Which day" value={r.day > 0 ? 'day' : String(r.nth)} onChange={(e) => (e.target.value === 'day' ? setRow(i, 'day', r.day || 1) : setItems(items.map((x, j) => (j === i ? { ...x, day: 0, nth: Number(e.target.value) } : x))))}>
              <option value="1">1st</option>
              <option value="2">2nd</option>
              <option value="3">3rd</option>
              <option value="4">4th</option>
              <option value="-1">Last</option>
              <option value="day">On day…</option>
            </select>
            {r.day > 0 ? (
              <input aria-label="Day of the month" type="number" min={1} max={31} value={r.day} onChange={(e) => setRow(i, 'day', Number(e.target.value))} />
            ) : (
              <select aria-label="Weekday" value={r.weekday} onChange={(e) => setRow(i, 'weekday', Number(e.target.value))}>
                {WEEKDAYS.map((w, j) => (
                  <option key={w} value={j}>
                    {w}
                  </option>
                ))}
              </select>
            )}
            <input aria-label="Starts (optional)" type="time" value={r.start} onChange={(e) => setRow(i, 'start', e.target.value)} />
            <label className="check small">
              <input type="checkbox" checked={r.visibility === 'everyone'} onChange={(e) => setRow(i, 'visibility', e.target.checked ? 'everyone' : 'office')} />
              <span>Every team</span>
            </label>
            <button type="button" className="icon-btn icon-btn-sm" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <div className="row-wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setItems([...items, { title: '', type: 'event', month: 1, day: 0, nth: 1, weekday: 6, start: '', end: '', committees: [], visibility: 'office' }])}>
            <Icon name="plus" size={16} /> Add a yearly item
          </button>
        </div>
        <button type="button" className="btn btn-primary self-start" disabled={!dirty} onClick={save}>
          {dirty ? 'Save' : 'Saved'}
        </button>
      </section>
      <section className="card row-wrap" aria-label="Fill in a year">
        <label className="field">
          <span>Fill in</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[0, 1, 2, 3].map((n) => {
              const y = new Date().getFullYear() + n;
              return (
                <option key={y} value={y}>
                  {y}
                </option>
              );
            })}
          </select>
        </label>
        <button type="button" className="btn btn-outline self-end" disabled={dirty || !items.length} onClick={fill}>
          Add to that year’s calendar
        </button>
        {dirty && <span className="muted small self-end">Save first.</span>}
      </section>
    </div>
  );
}

// ======================= event requests =======================
const whenLine = (r) => `${fmtDay(r.date)}${r.start ? ` · ${fmtTime(r.start)}${r.end ? `–${fmtTime(r.end)}` : ''}` : ' · all day'}`;
function EventRequests() {
  const app = useApp();
  const [list, setList] = useState(null);
  const load = useCallback(() => api('/office/requests').then(setList, () => setList([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const decide = async (r, action) => {
    const reply = window.prompt(action === 'approve' ? 'A note back to them (optional). They’ll get it by email:' : 'Why not? They’ll get this by email:', '');
    if (reply === null) return;
    try {
      await api(`/office/requests/${r.id}/${action}`, { method: 'POST', body: { reply } });
      app.toast(action === 'approve' ? 'Approved, added to the calendar, and they’ve been emailed. It’s kept in the archive.' : 'Declined, and they’ve been emailed. It’s kept in the archive.');
      load();
      setArchived((n) => n + 1);
      app.refreshPending?.();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const pending = list || [];
  const [archived, setArchived] = useState(0); // bumps the archive after a decision
  return (
    <div className="stack-lg">
      <RequestLink />
      {!list && <div className="loading-inline">Loading…</div>}
      {list && pending.length === 0 && <Empty>No requests waiting.</Empty>}
      {pending.map((r) => (
        <section key={r.id} className="card stack-sm rq-card" aria-label={r.title}>
          <div className="row-wrap spread">
            <strong className="rq-title">{r.title}</strong>
            <span className="row-wrap tight">
              {r.source === 'link' && <span className="chip chip-cold">From the request link</span>}
              <span className="chip chip-pending">Waiting</span>
            </span>
          </div>
          <div className="small">
            {whenLine(r)}
            {r.room ? ` · ${r.room}` : ' · no room picked'}
            {r.people ? ` · about ${r.people} people` : ''}
            {r.needsAv ? ' · needs AV' : ''}
          </div>
          {r.notes && <p className="small pre-wrap rq-notes">“{r.notes}”</p>}
          <div className="small">
            Asked by <strong>{r.requestedBy || 'someone'}</strong>
            {r.contact?.email && (
              <>
                {' · '}
                <a href={`mailto:${r.contact.email}`}>{r.contact.email}</a>
              </>
            )}
            {r.contact?.phone && (
              <>
                {' · '}
                <a href={`tel:${r.contact.phone}`}>{r.contact.phone}</a>
              </>
            )}
          </div>
          {r.clashes?.length > 0 && (
            <div className="warn-box small" role="note">
              <strong>{r.room} is already in use then:</strong>
              <ul className="rq-clashes">
                {r.clashes.map((c, i) => (
                  <li key={i}>
                    {c.title} {c.start ? `(${fmtTime(c.start)}${c.end ? `–${fmtTime(c.end)}` : ''})` : '(all day)'} {c.kind === 'asked' ? '· another request, waiting' : '· on the calendar'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="small muted rq-agenda">
            {r.meeting ? (
              <>
                <Icon name="cal" size={15} /> On the agenda for{' '}
                <button type="button" className="link-btn" onClick={() => app.openMeeting?.(r.meeting.id)}>
                  {r.meeting.title}, {fmtDay(r.meeting.date)}
                </button>
                {r.meetsAfter && <span className="rq-late"> · that’s after the date they asked for, so decide here if it can’t wait</span>}
              </>
            ) : (
              'No board meeting is on the calendar yet. It goes on the agenda as soon as one is added.'
            )}
          </div>
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={() => decide(r, 'approve')}>
              Approve
            </button>
            <button type="button" className="btn btn-outline" onClick={() => decide(r, 'decline')}>
              Decline
            </button>
          </div>
        </section>
      ))}
      <RequestArchive bump={archived} />
    </div>
  );
}

// Every decision, kept until the head leader or the admin purges it
const STATUS_WORD = { approved: 'Approved', declined: 'Declined' };
// The day a moment fell on here (not in UTC, which is already tomorrow on an evening in Tennessee)
const localDay = (d) => new Date(d).toLocaleDateString('en-CA');
function RequestArchive({ bump }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [purging, setPurging] = useState(false);
  const params = useMemo(() => new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}), ...(year ? { year } : {}) }).toString(), [q, status, year]);
  const load = useCallback(() => {
    api(`/office/requests/archive?${params}&page=${page}`).then(setData, () => setData(null));
  }, [params, page]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, bump]);
  useEffect(() => setPage(1), [params]);
  if (!data) return null;
  const filtered = !!(q.trim() || status || year);
  return (
    <section className="card stack-sm" aria-label="Archive">
      <div className="row-wrap spread">
        <div className="stack-xs">
          <h2>Archive</h2>
          <span className="muted small">
            Every decision is kept here, with who asked, how to reach them and the note back, until {data.canPurge ? 'you purge it' : 'the head leader or the admin purges it'}. {data.all} in all.
          </span>
        </div>
        <div className="row-wrap">
          <a className="btn btn-ghost btn-sm" href={`/api/office/requests/archive.csv?team=${encodeURIComponent(app.team.key)}${params ? `&${params}` : ''}`} download>
            Download{filtered ? ' these' : ''} (CSV)
          </a>
          {data.canPurge && data.all > 0 && (
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => setPurging(true)}>
              Purge…
            </button>
          )}
        </div>
      </div>
      {data.all > 0 && (
        <div className="row-wrap ra-filters">
          <input type="search" className="grow" placeholder="Search name, email, request, room or note" aria-label="Search the archive" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Decision">
            <option value="">Approved and declined</option>
            <option value="approved">Approved</option>
            <option value="declined">Declined</option>
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year decided">
            <option value="">Any year</option>
            {data.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}
      {data.all === 0 && <p className="muted small">Nothing decided yet.</p>}
      {data.all > 0 && data.total === 0 && <p className="muted small">Nothing matches.</p>}
      <ul className="ra-list">
        {data.items.map((r) => (
          <li key={r.id}>
            <details className="ra-item">
              <summary>
                <span className={`chip ${r.status === 'approved' ? 'chip-approved' : 'chip-draft'}`}>{STATUS_WORD[r.status]}</span>
                <span className="strong">{r.title}</span>
                <span className="muted small">
                  {fmtDate(r.date)} · {r.requestedBy || 'someone'}
                </span>
              </summary>
              <div className="small stack-xs ra-body">
                <div>
                  {whenLine(r)}
                  {r.room ? ` · ${r.room}` : ''}
                  {r.people ? ` · about ${r.people} people` : ''}
                  {r.needsAv ? ' · needs AV' : ''}
                </div>
                {r.notes && <div className="pre-wrap">“{r.notes}”</div>}
                <div>
                  Asked by {r.requestedBy || 'someone'}
                  {r.source === 'link' ? ' (request link)' : ''}
                  {r.contact.email && (
                    <>
                      {' · '}
                      <a href={`mailto:${r.contact.email}`}>{r.contact.email}</a>
                    </>
                  )}
                  {r.contact.phone && ` · ${r.contact.phone}`} · {fmtDate(localDay(r.createdAt))}
                </div>
                <div>
                  <strong>{STATUS_WORD[r.status]}</strong> by {r.decidedBy || '—'}
                  {r.decidedAt ? ` on ${fmtDate(localDay(r.decidedAt))}` : ''}
                  {r.reply ? `: “${r.reply}”` : ''}
                </div>
                {r.meeting && (
                  <div>
                    On the agenda for{' '}
                    <button type="button" className="link-btn" onClick={() => app.openMeeting?.(r.meeting.id)}>
                      {r.meeting.title}, {fmtDate(r.meeting.date)}
                    </button>
                  </div>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {data.pages > 1 && (
        <div className="row-wrap">
          <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </button>
          <span className="muted small">
            Page {data.page} of {data.pages}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            Older
          </button>
        </div>
      )}
      {purging && (
        <PurgeModal
          oldest={data.oldest}
          onClose={() => setPurging(false)}
          onDone={() => {
            setPurging(false);
            load();
          }}
        />
      )}
    </section>
  );
}

function PurgeModal({ oldest, onClose, onDone }) {
  const app = useApp();
  const yearAgo = addDays(todayISO(), -365);
  const [before, setBefore] = useState(yearAgo);
  const [status, setStatus] = useState('');
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCount(null);
    if (!before) return;
    const t = setTimeout(() => api('/office/requests/purge', { method: 'POST', body: { before, status } }).then((r) => setCount(r.count), () => setCount(null)), 250);
    return () => clearTimeout(t);
  }, [before, status]);
  const go = async () => {
    if (!window.confirm(`Permanently delete ${count} decision${count === 1 ? '' : 's'}? This can’t be undone.`)) return;
    setBusy(true);
    try {
      const r = await api('/office/requests/purge', { method: 'POST', body: { before, status, confirm: true, count } });
      app.toast(`Purged ${r.purged} decision${r.purged === 1 ? '' : 's'}`);
      onDone();
    } catch (e) {
      app.toast(e.message);
      setBusy(false);
    }
  };
  const dl = `/api/office/requests/archive.csv?team=${encodeURIComponent(app.team.key)}`;
  return (
    <Modal title="Purge old decisions" onClose={onClose}>
      <div className="stack">
        <p className="muted small">This permanently deletes archived decisions, with the names and contact details in them. Requests still waiting are never touched, and the meeting agendas keep their record. Download a copy first if you might need it.</p>
        <a className="btn btn-outline self-start" href={dl} download>
          Download everything first (CSV)
        </a>
        <div className="row-wrap fields-2">
          <label className="field">
            <span>Decided before</span>
            <input type="date" value={before} max={addDays(todayISO(), 1)} onChange={(e) => setBefore(e.target.value)} />
          </label>
          <label className="field">
            <span>Which</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Approved and declined</option>
              <option value="approved">Only approved</option>
              <option value="declined">Only declined</option>
            </select>
          </label>
        </div>
        <div className="row-wrap tight">
          {[
            ['Older than 2 years', addDays(todayISO(), -730)],
            ['Older than 1 year', yearAgo],
            ['Older than 6 months', addDays(todayISO(), -183)],
            ['Everything', addDays(todayISO(), 1)],
          ].map(([l, d]) => (
            <button key={l} type="button" className={`pill ${before === d ? 'pill-on' : ''}`} onClick={() => setBefore(d)}>
              {l}
            </button>
          ))}
        </div>
        <p role="status" className="strong">
          {count === null ? 'Counting…' : count === 0 ? `Nothing was decided before ${fmtDate(before)}.` : `${count} decision${count === 1 ? '' : 's'} will be deleted.`}
          {oldest && count === 0 ? <span className="muted small"> The oldest is from {fmtDate(localDay(oldest))}.</span> : null}
        </p>
        <div className="row-wrap">
          <button type="button" className="btn btn-danger" disabled={busy || !count} onClick={go}>
            {busy ? 'Purging…' : `Purge ${count || ''}`.trim()}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The link anyone can use to ask for a room, without an account
function RequestLink() {
  const app = useApp();
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/office/request-link').then(setLink, () => setLink(null));
  }, []);
  const change = async (body, msg) => {
    setBusy(true);
    try {
      setLink(await api('/office/request-link', { method: 'POST', body }));
      app.toast(msg);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  const copy = async () => app.toast((await copyText(link.url)) ? 'Link copied. Paste it in an email, text or the bulletin.' : link.url);
  if (!link) return null;
  return (
    <section className="card stack-sm rq-link" aria-label="Room request link">
      <div className="row-wrap spread">
        <div className="stack-xs">
          <h2>Room request link</h2>
          <span className="muted small">Share it with any church member. No account needed: they fill in a form, it goes on the next board meeting’s agenda, and they get an email when it’s decided.</span>
        </div>
        {link.on ? <span className="chip chip-approved">On</span> : <span className="chip chip-draft">Off</span>}
      </div>
      {link.on ? (
        <>
          <div className="rq-url">
            <input readOnly value={link.url} aria-label="Room request link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-primary" onClick={copy}>
              Copy link
            </button>
          </div>
          <div className="row-wrap">
            <a className="btn btn-ghost btn-sm" href={link.url} target="_blank" rel="noreferrer">
              Open the form
            </a>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => change({ on: false }, 'The link is off. Anyone who opens it is asked to call the church office.')}>
              Turn off
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => window.confirm('Make a new link? The old one stops working, so anyone who has it will need the new one.') && change({ renew: true }, 'New link made. The old one no longer works.')}
            >
              Make a new link
            </button>
          </div>
        </>
      ) : (
        <div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => change(link.token ? { on: true } : { renew: true }, 'The room request link is on')}>
            {link.token ? 'Turn the link back on' : 'Make the link'}
          </button>
        </div>
      )}
    </section>
  );
}
