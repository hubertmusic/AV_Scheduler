// Order of service (with optional run times) and the two things made from it: the service rundown
// for the platform and crew, and the congregation's bulletin. Each has its own link, QR code and
// printable page.
import { useEffect, useState } from 'react';
import { api, fmtDate, fmtMinutes, fmtTime, orderTimes } from '../lib.js';
import { Empty, Icon, Modal, useApp } from '../ui.jsx';
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

  const [templates, setTemplates] = useState([]);
  const [savingTpl, setSavingTpl] = useState(false);
  const loadTemplates = () => api('/order-templates').then(setTemplates, () => {});
  useEffect(() => {
    if (canEdit) loadTemplates();
  }, [canEdit]);
  const applyTemplate = async (id) => {
    if (!id) return;
    if (dirty) return app.toast('Save or discard your changes first');
    setBusy(true);
    try {
      setPlan(await api(`/plans/${ev.id}/order/template/${id}`, { method: 'POST' }));
      app.toast('Template added');
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  const templatePicker = templates.length > 0 && (
    <select className="oos-tpl" aria-label="Add a template" value="" disabled={busy} onChange={(e) => applyTemplate(e.target.value)}>
      <option value="">{items.length ? 'Add a template…' : 'Start from a template…'}</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} ({t.order.length} line{t.order.length === 1 ? '' : 's'})
        </option>
      ))}
    </select>
  );

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
          {templatePicker}
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
        {items.length > 0 && templatePicker}
        {items.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => setSavingTpl(true)}>
            Save as template…
          </button>
        )}
      </div>
      {savingTpl && <SaveTemplate ev={ev} order={clean(items)} templates={templates} onClose={() => setSavingTpl(false)} onSaved={() => (setSavingTpl(false), loadTemplates())} />}
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

function SaveTemplate({ ev, order, templates, onClose, onSaved }) {
  const app = useApp();
  const auto = templates.find((t) => t.serviceTitle === ev.title);
  const [name, setName] = useState(auto?.name || ev.title);
  const [useAuto, setUseAuto] = useState(!auto || auto.name === (auto?.name || ev.title));
  const [busy, setBusy] = useState(false);
  const replacing = templates.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/order-templates', { method: 'POST', body: { name: name.trim(), serviceTitle: useAuto ? ev.title : '', order } });
      app.toast(replacing ? 'Template updated' : 'Template saved');
      onSaved();
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  const remove = async (t) => {
    try {
      await api(`/order-templates/${t.id}`, { method: 'DELETE' });
      app.toast(`Deleted “${t.name}”`);
      onSaved();
    } catch (err) {
      app.toast(err.message);
    }
  };
  return (
    <Modal title="Save as a template" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Template name</span>
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {replacing && <p className="small muted">This replaces the saved template “{replacing.name}”.</p>}
        <label className="check check-top">
          <input type="checkbox" checked={useAuto} onChange={(e) => setUseAuto(e.target.checked)} />
          <span>
            Start every new <strong>{ev.title}</strong> plan from this
            {auto && auto.name !== name.trim() ? <span className="small muted block">Instead of “{auto.name}”.</span> : null}
          </span>
        </label>
        <p className="small muted">Saves the {order.length} line{order.length === 1 ? '' : 's'} with who, minutes and cues. Plans that already exist don’t change.</p>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save template'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
        {templates.length > 0 && (
          <div className="stack-xs divider-top">
            <div className="label-sm">Saved templates</div>
            {templates.map((t) => (
              <div key={t.id} className="row-wrap tpl-row">
                <span className="grow small">
                  <strong>{t.name}</strong> · {t.order.length} line{t.order.length === 1 ? '' : 's'}
                  {t.serviceTitle ? ` · used for new ${t.serviceTitle} plans` : ''}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(t)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
    </Modal>
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
          {ann === plan.announcements && plan.announcements.trim() && (
            <a className="btn btn-ghost btn-sm oos-slides" href={`/api/plans/${plan.event.id}/announcements.pptx`}>
              Download as slides (.pptx) for ProPresenter
            </a>
          )}
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
        {which === 'bulletin' && (
          <a className="btn btn-outline btn-sm" href={`${url}?print=half`} target="_blank" rel="noopener noreferrer">
            Print half sheets
          </a>
        )}
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

// Livestream: a YouTube title and description written from the plan, with chapter times taken from
// the order of service (its planned minutes, or the times logged live when available)
const stamp = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = String(Math.floor(sec % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
export function streamChapters(order, actual) {
  const lines = order.filter((x) => x.kind !== 'heading');
  if (actual?.length) {
    const first = actual[0].at;
    return actual.map((a) => ({ at: Math.max(0, Math.round((new Date(a.at) - new Date(first)) / 1000)), title: a.title }));
  }
  if (!lines.some((x) => x.minutes > 0)) return [];
  let t = 0;
  return lines.map((x) => {
    const c = { at: t * 60, title: x.title };
    t += Number(x.minutes) || 0;
    return c;
  });
}

export function LivestreamCard({ plan }) {
  const app = useApp();
  const ev = plan.event;
  const org = app.settings.orgName || '';
  const chapters = streamChapters(plan.order, plan.live?.log);
  const okChapters = chapters.length >= 3 && chapters.every((c, i) => i === 0 || c.at - chapters[i - 1].at >= 10);
  const title = [plan.sermonTitle ? `“${plan.sermonTitle}”` : ev.title, plan.speaker, org].filter(Boolean).join(' | ');
  const lines = [
    `${ev.title} · ${fmtDate(ev.date)}${org ? ` · ${org}` : ''}`,
    plan.sermonTitle || plan.speaker ? `\n${plan.sermonTitle ? `Sermon: “${plan.sermonTitle}”` : 'Sermon'}${plan.speaker ? ` — ${plan.speaker}` : ''}` : '',
    plan.scriptures.length ? `\nScripture: ${plan.scriptures.map((x) => x.reference + (x.version ? ` (${x.version})` : '')).join('; ')}` : '',
    plan.songs.length ? `\nSongs: ${plan.songs.map((x) => x.song.title).join(', ')}` : '',
    okChapters ? `\nChapters\n${chapters.map((c) => `${stamp(c.at)} ${c.title}`).join('\n')}` : '',
    app.settings.streamFooter ? `\n${app.settings.streamFooter}` : '',
  ];
  const description = lines.filter(Boolean).join('\n');
  const copy = (text, what) => navigator.clipboard.writeText(text).then(() => app.toast(`${what} copied`), () => app.toast('Couldn’t copy; select the text instead'));
  return (
    <section className="card stack" aria-label="Livestream">
      <div>
        <h3>Livestream</h3>
        <p className="small muted">A title and description for YouTube or Facebook, written from this plan. Copy them when you upload or schedule the stream.</p>
      </div>
      <div className="field">
        <span className="label-sm">Title</span>
        <div className="ls-box">{title}</div>
        <div className="row-wrap">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(title, 'Title')}>
            Copy title
          </button>
          {title.length > 100 && <span className="small danger">YouTube titles max out at 100 characters ({title.length} now).</span>}
        </div>
      </div>
      <div className="field">
        <span className="label-sm">Description</span>
        <div className="ls-box rs-pre">{description}</div>
        <div className="row-wrap">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => copy(description, 'Description')}>
            Copy description
          </button>
          {!okChapters && <span className="small muted">Add minutes to at least three lines of the order of service to get chapter markers.</span>}
          {okChapters && plan.live?.log?.length > 0 && <span className="small muted">Chapter times come from when each part actually started.</span>}
        </div>
      </div>
      {!app.settings.streamFooter && app.me.role === 'admin' && <p className="small muted">Tip: add a standard ending (website, giving link) under Settings → Bulletin and livestream.</p>}
    </section>
  );
}
