// Order of service (with optional run times) and the two things made from it: the service rundown
// for the platform and crew, and the congregation's bulletin. Each has its own link, QR code and
// printable page.
import { useEffect, useState } from 'react';
import { api, fmtDate, fmtMinutes, fmtTime, orderTimes } from '../lib.js';
import { Empty, Icon, useApp } from '../ui.jsx';
import { Qr, qrPng } from '../qr.jsx';

export const KIND_LABEL = { item: 'Item', song: 'Song', scripture: 'Scripture', prayer: 'Prayer', sermon: 'Sermon', heading: 'Heading' };

let tempId = 0;
const newItem = (over = {}) => ({ id: `new-${++tempId}`, kind: 'item', title: '', who: '', minutes: '', notes: '', bulletin: true, ...over });

const BASIC = [
  ['item', 'Welcome and announcements'],
  ['song', 'Opening song'],
  ['prayer', 'Opening prayer'],
  ['scripture', 'Scripture reading'],
  ['item', 'Offering'],
  ['item', 'Children’s story'],
  ['sermon', 'Sermon'],
  ['song', 'Closing song'],
  ['prayer', 'Benediction'],
];

const clean = (list) =>
  list
    .filter((x) => x.title.trim())
    .map((x) => ({ kind: x.kind, title: x.title.trim(), who: x.kind === 'heading' ? '' : x.who.trim(), minutes: x.kind === 'heading' ? 0 : Number(x.minutes) || 0, notes: x.kind === 'heading' ? '' : x.notes.trim(), bulletin: x.bulletin }));
const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
const fromPlanOrder = (order) => order.map((x) => ({ ...x, minutes: x.minutes || '' }));

export function OrderOfService({ plan, canEdit, onSave, setPlan }) {
  const app = useApp();
  const ev = plan.event;
  const [items, setItems] = useState(() => fromPlanOrder(plan.order));
  const [busy, setBusy] = useState(false);
  useEffect(() => setItems(fromPlanOrder(plan.order)), [plan.order]);

  const dirty = !same(items, plan.order);
  const times = orderTimes(ev.start, items);
  const showTimes = times.total > 0;
  const over = ev.end && times.end > ev.end;

  const set = (i, patch) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };
  const remove = (i) => setItems(items.filter((_, j) => j !== i));
  const add = (over) => setItems([...items, newItem(over)]);

  const fillFromPlan = () => {
    const have = new Set(items.map((x) => x.title.trim().toLowerCase()));
    const add = [];
    const push = (x) => {
      if (have.has(x.title.toLowerCase())) return;
      have.add(x.title.toLowerCase());
      add.push(newItem(x));
    };
    plan.songs.forEach((s) => push({ kind: 'song', title: s.song.title, notes: s.key ? `Key of ${s.key}` : '' }));
    plan.scriptures.forEach((s) => push({ kind: 'scripture', title: `Scripture reading: ${s.reference}${s.version ? ` (${s.version})` : ''}` }));
    if (plan.sermonTitle || plan.speaker) push({ kind: 'sermon', title: plan.sermonTitle ? `Sermon: “${plan.sermonTitle}”` : 'Sermon', who: plan.speaker || '' });
    if (!add.length) return app.toast('Everything from this plan is already in the order');
    setItems([...items, ...add]);
  };

  const copyLast = async () => {
    setBusy(true);
    try {
      const r = await api(`/plans/${ev.id}/order/copy-last`, { method: 'POST' });
      setPlan(r);
      app.toast(`Copied the order from ${r.copiedFrom.title}, ${fmtDate(r.copiedFrom.date)}`);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ order: clean(items) }, 'Order of service saved');
    } catch {
      /* toast shown */
    }
    setBusy(false);
  };

  const summary = showTimes && (
    <p className={`small ${over ? 'danger' : 'muted'}`}>
      Runs {fmtMinutes(times.total)}, from {fmtTime(ev.start)} to {fmtTime(times.end)}
      {ev.end ? (over ? ` — past the scheduled end of ${fmtTime(ev.end)}` : ` (scheduled to end ${fmtTime(ev.end)})`) : ''}.
    </p>
  );

  if (!canEdit) {
    return (
      <section className="card stack" aria-label="Order of service">
        <h3>Order of service</h3>
        {plan.order.length === 0 ? (
          <Empty>No order of service for this one.</Empty>
        ) : (
          <>
            <ol className="oos-read">
              {plan.order.map((x, i) =>
                x.kind === 'heading' ? (
                  <li key={x.id} className="oos-read-heading">{x.title}</li>
                ) : (
                  <li key={x.id}>
                    {showTimes && <span className="oos-time">{fmtTime(times.at[i])}</span>}
                    <span className="oos-read-main">
                      <strong>{x.title}</strong>
                      {x.who && <span className="muted"> · {x.who}</span>}
                      {x.minutes > 0 && <span className="muted small"> · {x.minutes} min</span>}
                      {x.notes && <span className="small block">{x.notes}</span>}
                    </span>
                  </li>
                )
              )}
            </ol>
            {summary}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="card stack" aria-label="Order of service">
      <div className="section-head">
        <div>
          <h3>Order of service</h3>
          <p className="small muted">Optional. Add minutes to get a timed rundown; leave them blank for just the order.</p>
        </div>
      </div>
      {items.length === 0 && (
        <div className="oos-start">
          <button type="button" className="btn btn-outline" onClick={() => setItems(BASIC.map(([kind, title]) => newItem({ kind, title })))}>
            Start with a basic order
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={copyLast}>
            Copy last week’s
          </button>
        </div>
      )}
      {items.length > 0 && (
        <ol className="oos-list">
          {items.map((x, i) => {
            const heading = x.kind === 'heading';
            return (
              <li key={x.id} className={`oos-row${heading ? ' oos-row-heading' : ''}`}>
                <span className="oos-time" aria-label="Starts at">
                  {showTimes && !heading ? fmtTime(times.at[i]) : ''}
                </span>
                <select aria-label="Kind" value={x.kind} onChange={(e) => set(i, { kind: e.target.value })}>
                  {Object.entries(KIND_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <input className="oos-title" aria-label="Item" placeholder={heading ? 'Section heading, e.g. Worship' : 'What happens'} value={x.title} onChange={(e) => set(i, { title: e.target.value })} />
                {!heading && <input className="oos-who" aria-label="Who" placeholder="Who" value={x.who} onChange={(e) => set(i, { who: e.target.value })} />}
                {!heading && (
                  <input className="oos-min" aria-label="Minutes" type="number" min="0" max="300" inputMode="numeric" placeholder="min" value={x.minutes} onChange={(e) => set(i, { minutes: e.target.value })} />
                )}
                <label className="oos-bulletin" title="Show in the congregation’s bulletin">
                  <input type="checkbox" checked={x.bulletin} onChange={(e) => set(i, { bulletin: e.target.checked })} />
                  <span>Bulletin</span>
                </label>
                <span className="oos-actions">
                  <button type="button" className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="icon-btn" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className="icon-btn" aria-label="Remove" onClick={() => remove(i)}>
                    ✕
                  </button>
                </span>
                {!heading && <input className="oos-notes" aria-label="Cues for the team" placeholder="Cues for the team: mics, slides, lights (rundown only)" value={x.notes} onChange={(e) => set(i, { notes: e.target.value })} />}
              </li>
            );
          })}
        </ol>
      )}
      {summary}
      <div className="row-wrap">
        <button type="button" className="btn btn-outline" onClick={() => add()}>
          Add item
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => add({ kind: 'heading' })}>
          Add heading
        </button>
        {(plan.songs.length > 0 || plan.scriptures.length > 0 || plan.sermonTitle || plan.speaker) && (
          <button type="button" className="btn btn-ghost" onClick={fillFromPlan}>
            Add songs, Bible texts and sermon from this plan
          </button>
        )}
      </div>
      {dirty && (
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save order'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setItems(fromPlanOrder(plan.order))}>
            Discard changes
          </button>
        </div>
      )}
    </section>
  );
}

// The rundown and bulletin links, QR codes and print buttons, plus the bulletin's announcements
export function ShareCard({ plan, canEdit, canPlans, onSave, setPlan }) {
  const [ann, setAnn] = useState(plan.announcements);
  const [busy, setBusy] = useState(false);
  useEffect(() => setAnn(plan.announcements), [plan.announcements]);
  const saveAnn = async () => {
    setBusy(true);
    try {
      await onSave({ announcements: ann }, 'Announcements saved');
    } catch {
      /* toast shown */
    }
    setBusy(false);
  };

  return (
    <section className="card stack" aria-label="Rundown and bulletin">
      <div>
        <h3>
          Rundown and bulletin <span className="chip chip-beta">Beta</span>
        </h3>
        <p className="small muted">Two separate links, each with its own QR code and printable page. Neither needs a sign-in, so share each one only with the people it’s for.</p>
      </div>
      <div className="share-grid">
        <ShareBlock
          plan={plan}
          which="rundown"
          title="Service rundown"
          badge="Platform & crew only"
          badgeTone="chip-pending"
          blurb="The order with times, cues and who’s serving, plus songs with keys and Bible texts. For speakers, worship leaders and the AV team."
          canPlans={canPlans}
          setPlan={setPlan}
        />
        <ShareBlock
          plan={plan}
          which="bulletin"
          title="Congregation bulletin"
          badge="For everyone"
          badgeTone="chip-approved"
          blurb="The order of service without times or cues, the sermon, Bible texts, songs and announcements."
          canPlans={canPlans}
          setPlan={setPlan}
        />
      </div>
      {canEdit ? (
        <label className="field">
          <span>Announcements (bulletin only)</span>
          <textarea rows={4} value={ann} maxLength={5000} placeholder="Potluck after church, prayer meeting Wednesday 7 PM…" onChange={(e) => setAnn(e.target.value)} />
          {ann !== plan.announcements && (
            <div className="row-wrap">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={saveAnn}>
                {busy ? 'Saving…' : 'Save announcements'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setAnn(plan.announcements)}>
                Discard
              </button>
            </div>
          )}
        </label>
      ) : (
        plan.announcements && (
          <div>
            <div className="label-sm">Announcements</div>
            <div className="rs-pre small">{plan.announcements}</div>
          </div>
        )
      )}
    </section>
  );
}

function ShareBlock({ plan, which, title, badge, badgeTone, blurb, canPlans, setPlan }) {
  const app = useApp();
  const token = plan.share?.[which];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!token) return null;
  const url = `${window.location.origin}/${which}/${token}`;
  const copy = () => navigator.clipboard.writeText(url).then(() => app.toast('Link copied'), () => app.toast(url));
  const download = async () => {
    const a = document.createElement('a');
    a.href = await qrPng(url);
    a.download = `${which}-qr-${plan.event.date}.png`;
    a.click();
  };
  const renew = async () => {
    setBusy(true);
    try {
      setPlan(await api(`/plans/${plan.event.id}/share/${which}`, { method: 'POST' }));
      app.toast('New link made. The old link and QR code no longer work.');
      setConfirming(false);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };

  return (
    <div className="share-block">
      <div className="share-top">
        <Qr value={url} size={112} label={`QR code for the ${title.toLowerCase()}`} />
        <div className="stack-xs">
          <strong>{title}</strong>
          <span className={`chip ${badgeTone}`}>{badge}</span>
          <span className="small muted">{blurb}</span>
        </div>
      </div>
      <div className="row-wrap">
        <a className="btn btn-outline btn-sm" href={url} target="_blank" rel="noopener noreferrer">
          Open
        </a>
        <a className="btn btn-outline btn-sm" href={`${url}?print=1`} target="_blank" rel="noopener noreferrer">
          <Icon name="doc" size={14} /> Print
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
          Copy link
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
          Save QR image
        </button>
        {canPlans && !confirming && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
            New link…
          </button>
        )}
      </div>
      {confirming && (
        <div className="warn-box small">
          The current link and QR code will stop working, including any already printed.
          <div className="row-wrap">
            <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={renew}>
              Make a new link
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
