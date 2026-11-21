// The details under each order-of-service item: general cues, cues for each crew, a note for the
// bulletin, links (YouTube videos, scripts) and files from this service's media. Plus one read-only
// display of the same, used on the plan, the rundown, the run sheet and the live view.
import { useLayoutEffect, useRef, useState } from 'react';
import { uploadFiles } from './lib.js';
import { Icon, useApp } from './ui.jsx';

export const CREWS = [
  ['audio', 'Audio'],
  ['slides', 'Slides & ProPresenter'],
  ['lights', 'Lights'],
  ['camera', 'Camera & stream'],
];
export const emptyCues = () => ({ audio: '', slides: '', lights: '', camera: '' });

// The YouTube video id of a link, or ''
export function youtubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/) || [])[2] || '';
    return /^[\w-]{11}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}
const withScheme = (v) => {
  const s = String(v || '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s) ? `https://${s}` : s;
};
const isLink = (v) => {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

// A text box that grows with what's typed (and keeps line breaks)
export function AutoText({ value, onChange, minRows = 1, className = '', ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={minRows} className={`autotext ${className}`} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

// What's filled in, for the collapsed summary ("Audio · Slides · 1 link · 2 files")
export function detailSummary(x) {
  const parts = CREWS.filter(([k]) => x.cues?.[k]?.trim()).map(([, l]) => l.split(' ')[0]);
  if (x.bulletinNote?.trim()) parts.push('Bulletin note');
  if (x.links?.length) parts.push(`${x.links.length} link${x.links.length === 1 ? '' : 's'}`);
  if (x.media?.length) parts.push(`${x.media.length} file${x.media.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function ItemDetails({ x, onChange, plan, setPlan, files }) {
  const app = useApp();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const setCue = (k, v) => onChange({ cues: { ...x.cues, [k]: v } });
  const addLink = () => {
    const u = withScheme(url);
    if (!isLink(u)) return app.toast('That doesn’t look like a web link. Paste the full address, e.g. https://youtu.be/…');
    if ((x.links || []).length >= 6) return app.toast('Up to 6 links per item');
    onChange({ links: [...(x.links || []), { url: u, title: title.trim() }] });
    setUrl('');
    setTitle('');
  };
  const attached = (x.media || []).map((id) => files.find((f) => f.id === id)).filter(Boolean);
  const free = files.filter((f) => !(x.media || []).includes(f.id));
  const upload = async (list) => {
    if (!list.length) return;
    setBusy(true);
    try {
      const before = new Set(files.map((f) => f.id));
      const out = await uploadFiles(`/plans/${plan.event.id}/media`, list);
      const after = [...(out.media || []), ...(out.assets || [])];
      const added = after.filter((m) => !before.has(m.id)).map((m) => m.id);
      setPlan(out);
      onChange({ media: [...new Set([...(x.media || []), ...added])].slice(0, 10) });
      app.toast(`Attached ${list.length === 1 ? list[0].name : `${list.length} files`}. It’s in this service’s media and the ProPresenter download too. Save the order to keep it on this item.`);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="oid">
      <fieldset className="oid-crews">
        <legend className="label-sm">Cues for each crew (rundown, run sheet and live view only)</legend>
        <div className="oid-grid">
          {CREWS.map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <AutoText value={x.cues?.[k] || ''} onChange={(v) => setCue(k, v)} maxLength={1000} placeholder={{ audio: 'e.g. Pastor’s lav on, choir mics up', slides: 'e.g. Lyrics from verse 2, sermon slides 4–9', lights: 'e.g. House to 30%, warm wash', camera: 'e.g. Wide shot, then pastor close-up' }[k]} />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span>Note for the bulletin {x.bulletin ? '(the congregation sees this under the item)' : '(turn on Bulletin to show it)'}</span>
        <input maxLength={300} value={x.bulletinNote || ''} onChange={(e) => onChange({ bulletinNote: e.target.value })} disabled={!x.bulletin} placeholder="e.g. Hymn 100 · Please stand · Read by Maria Lopez" />
      </label>

      <div className="stack-xs">
        <span className="label-sm">Links (videos, scripts, pages)</span>
        {(x.links || []).map((l, i) => {
          const yt = youtubeId(l.url);
          return (
            <div key={i} className="oid-link">
              {yt ? (
                <img className="oid-thumb" src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`} alt="" loading="lazy" onError={(e) => e.currentTarget.replaceWith(Object.assign(document.createElement('span'), { className: 'oid-thumb oid-thumb-web', textContent: '▶' }))} />
              ) : (
                <span className="oid-thumb oid-thumb-web" aria-hidden="true">🔗</span>
              )}
              <span className="oid-link-main">
                <input aria-label="Link name" maxLength={120} placeholder={yt ? 'Name it, e.g. Mission story video' : 'Name (optional)'} value={l.title} onChange={(e) => onChange({ links: x.links.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) })} />
                <a className="small ellipsis" href={l.url} target="_blank" rel="noopener noreferrer">
                  {yt ? 'YouTube · ' : ''}
                  {l.url.replace(/^https?:\/\//, '')}
                </a>
              </span>
              <button type="button" className="icon-btn" aria-label="Remove link" onClick={() => onChange({ links: x.links.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          );
        })}
        {(x.links || []).length < 6 && (
          <div className="oid-addlink">
            <input inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Link address" placeholder="Paste a link, e.g. https://youtu.be/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())} />
            <input aria-label="Name for the link" maxLength={120} placeholder="Name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLink())} />
            <button type="button" className="btn btn-outline btn-sm" disabled={!url.trim()} onClick={addLink}>
              Add link
            </button>
          </div>
        )}
      </div>

      <div className="stack-xs">
        <span className="label-sm">Files (from this service’s media; included in the ProPresenter download)</span>
        {attached.map((f) => (
          <div key={f.id} className="oid-file">
            <Icon name="doc" size={15} />
            <span className="grow ellipsis">{f.title}</span>
            <button type="button" className="icon-btn" aria-label={`Take ${f.title} off this item`} onClick={() => onChange({ media: x.media.filter((id) => id !== f.id) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="row-wrap">
          {free.length > 0 && (
            <select aria-label="Attach a file from this service" value="" onChange={(e) => e.target.value && onChange({ media: [...(x.media || []), e.target.value].slice(0, 10) })}>
              <option value="">Attach a file from this service…</option>
              {free.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || (x.media || []).length >= 10} onClick={() => fileRef.current?.click()}>
            {busy ? 'Uploading…' : 'Upload a file'}
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload([...e.target.files])} />
        </div>
      </div>
    </div>
  );
}

// Read-only: cues, links and files under an item
export function ItemExtras({ x, files = null, compact = false }) {
  const cues = CREWS.filter(([k]) => x.cues?.[k]?.trim());
  const names = files ? (x.media || []).map((id) => files.find((f) => f.id === id)?.title).filter(Boolean) : x.files || [];
  if (!x.notes && !cues.length && !x.links?.length && !names.length) return null;
  return (
    <div className={`oix ${compact ? 'oix-compact' : ''}`}>
      {x.notes && <div className="oix-note">{x.notes}</div>}
      {cues.map(([k, l]) => (
        <div key={k} className="oix-cue">
          <span className={`oix-crew oix-${k}`}>{l}</span>
          <span className="oix-text">{x.cues[k]}</span>
        </div>
      ))}
      {x.links?.length > 0 && (
        <div className="oix-links">
          {x.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="oix-link">
              {(l.youtube || youtubeId(l.url)) ? '▶ ' : '🔗 '}
              {l.title || l.url.replace(/^https?:\/\//, '').slice(0, 60)}
              {(l.youtube || youtubeId(l.url)) && <span className="muted"> (YouTube)</span>}
            </a>
          ))}
        </div>
      )}
      {names.length > 0 && <div className="oix-files">📎 {names.join(' · ')}</div>}
    </div>
  );
}
