// Public pages opened from a link or QR code, no sign-in:
//   /rundown/<token>   service rundown for the platform and crew (times, cues, who's serving)
//   /bulletin/<token>  the congregation's bulletin
// Add ?print=1 to open the print dialog straight away.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDay, fmtMinutes, fmtTime, orderTimes } from '../lib.js';
import { Qr } from '../qr.jsx';
import { ItemExtras } from '../orderItem.jsx';
import './bulletin.css';
import './runsheet.css';

function usePublic(kind, token) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/public/${kind}/${token}`).then(setD, (e) => setError(e.message));
    // Keep these pages out of search results
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [kind, token]);
  return [d, error];
}

// Open the print dialog once the page and its QR code are drawn
function useAutoPrint(ready) {
  const done = useRef(false);
  const wanted = new URLSearchParams(window.location.search).has('print');
  return useCallback(() => {
    if (!wanted || done.current || !ready) return;
    done.current = true;
    setTimeout(() => window.print(), 300);
  }, [wanted, ready]);
}

function Problem({ error }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Can’t open this page</h1>
        <p className="muted">{error}</p>
      </div>
    </div>
  );
}

export function RundownPage({ token }) {
  const [d, error] = usePublic('rundown', token);
  const onQr = useAutoPrint(!!d);
  useEffect(() => {
    if (d) document.title = `Rundown · ${d.event.title}`;
  }, [d]);
  if (error) return <Problem error={error} />;
  if (!d) return <div className="loading">Loading…</div>;
  const e = d.event;
  const times = orderTimes(e.start, d.order);
  const timed = times.total > 0;

  return (
    <div className="rs linkcard-page">
      <div className="rs-tools no-print">
        <span className="chip chip-pending">Platform & crew only — please don’t share</span>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <header className="rs-head linkcard-head">
        <div>
          <div className="eyebrow">Service rundown · platform & crew only</div>
          <h1>{e.title}</h1>
          <div className="rs-meta">
            {fmtDay(e.date)}
            {e.call ? (
              <>
                {' '}
                · Crew call <strong>{fmtTime(e.call)}</strong>
              </>
            ) : null}{' '}
            · Starts <strong>{fmtTime(e.start)}</strong>
            {e.end ? ` · Ends ${fmtTime(e.end)}` : ''}
          </div>
          {(d.sermonTitle || d.speaker) && (
            <div className="rs-sermon">
              {d.sermonTitle && <strong>“{d.sermonTitle}”</strong>} {d.speaker && <span>— {d.speaker}</span>}
            </div>
          )}
        </div>
        <figure className="linkcard-qr print-only">
          <Qr value={window.location.origin + window.location.pathname} size={96} label="QR code for this rundown" onReady={onQr} />
          <figcaption>Open on your phone</figcaption>
        </figure>
      </header>

      {d.order.length > 0 ? (
        <section className="rs-block rs-sec-order">
          <h2>Order of service</h2>
          <table className="rd-table">
            <thead>
              <tr>
                {timed && <th scope="col">Time</th>}
                <th scope="col">Item</th>
                <th scope="col">Who</th>
                <th scope="col">Cues</th>
              </tr>
            </thead>
            <tbody>
              {d.order.map((x, i) =>
                x.kind === 'heading' ? (
                  <tr key={i} className="rd-heading">
                    <th colSpan={timed ? 4 : 3} scope="rowgroup">
                      {x.title}
                    </th>
                  </tr>
                ) : (
                  <tr key={i} className={`rd-k rs-k-${x.kind}`}>
                    {timed && <td className="rd-time">{fmtTime(times.at[i])}</td>}
                    <td>
                      <strong>{x.title}</strong>
                      {x.minutes > 0 && <span className="small muted"> · {x.minutes} min</span>}
                    </td>
                    <td>{x.who}</td>
                    <td className="small">
                      <ItemExtras x={x} compact />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          {timed && (
            <p className="small muted">
              Runs {fmtMinutes(times.total)}, ending about {fmtTime(times.end)}
              {e.end ? ` (scheduled ${fmtTime(e.end)})` : ''}.
            </p>
          )}
        </section>
      ) : (
        <p className="muted">No order of service yet.</p>
      )}

      <div className="rs-cols">
        {d.songs.length > 0 && (
          <section className="rs-block rs-sec-songs">
            <h2>Songs</h2>
            <ol className="rs-songs">
              {d.songs.map((s, i) => (
                <li key={i}>
                  <strong>{s.title}</strong>
                  {s.key && <span className="rs-key">{s.key}</span>}
                  {s.artist && <span className="muted small"> · {s.artist}</span>}
                  {s.note && <div className="small">{s.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        )}
        {d.playlist?.length > 0 && (
          <section className="rs-block rs-sec-playlist">
            <h2>Playlist</h2>
            <ol className="rs-songs">
              {d.playlist.map((s, i) => (
                <li key={i}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    <strong>{s.title || s.url.replace(/^https?:\/\//, '').slice(0, 50)}</strong>
                  </a>
                  {s.note && <div className="small">{s.note}</div>}
                </li>
              ))}
            </ol>
          </section>
        )}
        {d.crew.length > 0 && (
          <section className="rs-block rs-sec-crew">
            <h2>Who’s serving</h2>
            <table className="rs-crew">
              <tbody>
                {d.crew.map((c, i) => [
                  c.team && c.team !== d.crew[i - 1]?.team && (
                    <tr key={`t${i}`} className="rd-heading">
                      <th colSpan={2} scope="rowgroup">
                        {c.team}
                      </th>
                    </tr>
                  ),
                  <tr key={i}>
                    <th scope="row">
                      {c.position}
                      {c.shadow ? ' (shadow)' : ''}
                    </th>
                    <td>{c.name || <span className="muted">open</span>}</td>
                  </tr>,
                ])}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {d.inputs?.length > 0 && (
        <section className="rs-block rs-sec-inputs">
          <h2>Inputs</h2>
          <table className="rd-table">
            <thead>
              <tr>
                <th scope="col">Ch</th>
                <th scope="col">Source</th>
                <th scope="col">Mic / DI</th>
                <th scope="col">Stand</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {d.inputs.map((r, i) => (
                <tr key={i}>
                  <td className="rd-time">{r.ch}</td>
                  <td>{r.source}</td>
                  <td>{r.mic}</td>
                  <td>{r.stand}</td>
                  <td className="small">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d.scriptures.length > 0 && (
        <section className="rs-block rs-sec-scripture">
          <h2>Bible texts</h2>
          {d.scriptures.map((s, i) => (
            <div key={i} className="rs-scripture">
              <strong>
                {s.reference}
                {s.version ? ` (${s.version})` : ''}
              </strong>
              {s.text && <p>{s.text}</p>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// Printed sizes, in CSS pixels (96 to the inch): a full letter page with half-inch margins, or
// one of two half sheets side by side on a landscape page
const PAPER = {
  full: { w: 7.5 * 96, h: 10 * 96, page: '@page { size: letter portrait; margin: 0.5in; }' },
  half: { w: 4.75 * 96, h: 7.8 * 96, page: '@page { size: letter landscape; margin: 0.35in; }' },
};

// Shrink the printed bulletin just enough to fit on one page (or one half sheet). It's measured off
// screen at the printed width; narrower type would reflow, so the width grows as the zoom shrinks.
function fitSheet(sheet, size) {
  const pages = sheet ? [...sheet.querySelectorAll('.bl-paper')] : [];
  if (!pages.length) return;
  const { w, h } = PAPER[size];
  const el = pages[0];
  const height = (z) => {
    el.style.zoom = '1';
    el.style.width = `${w / z}px`;
    return el.offsetHeight * z;
  };
  let z = 1;
  if (height(1) > h * 0.985) {
    let lo = 0.45;
    let hi = 1;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (height(mid) <= h * 0.985) lo = mid;
      else hi = mid;
    }
    z = lo;
  }
  for (const p of pages) {
    p.style.width = `${w / z}px`;
    p.style.zoom = String(z);
  }
  sheet.dataset.fit = z.toFixed(3);
}

export function BulletinPage({ token }) {
  const [d, error] = usePublic('bulletin', token);
  const wanted = new URLSearchParams(window.location.search).get('print');
  const [half, setHalf] = useState(wanted === 'half');
  const printed = useRef(false);
  const sheet = useRef(null);
  const size = half ? 'half' : 'full';
  const refit = useCallback(() => fitSheet(sheet.current, size), [size]);
  useEffect(() => {
    if (d) document.title = `${d.event.title} · ${fmtDate(d.event.date)}`;
  }, [d]);
  // The page size for printing
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = PAPER[size].page;
    document.head.appendChild(style);
    return () => style.remove();
  }, [size]);
  useLayoutEffect(() => {
    if (!d) return;
    refit();
    document.fonts?.ready.then(refit);
    window.addEventListener('beforeprint', refit);
    return () => window.removeEventListener('beforeprint', refit);
  }, [d, refit]);
  useEffect(() => {
    const after = () => wanted !== 'half' && setHalf(false);
    window.addEventListener('afterprint', after);
    return () => window.removeEventListener('afterprint', after);
  }, [wanted]);
  const onQr = useCallback(() => {
    refit();
    if (!wanted || printed.current) return;
    printed.current = true;
    setTimeout(() => (refit(), window.print()), 500);
  }, [wanted, refit]);
  const print = (h) => {
    setHalf(h);
    setTimeout(() => (fitSheet(sheet.current, h ? 'half' : 'full'), window.print()), 400);
  };
  if (error) return <Problem error={error} />;
  if (!d) return <div className="loading">Loading…</div>;
  const look = { '--bl': d.style?.color || '#1f3a5f' };
  const font = d.style?.font === 'sans' ? 'bl-sans' : 'bl-serif';

  return (
    <div className={`blp ${font}`} style={look}>
      <div className="bl-tools no-print">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => print(false)}>
          Print full page
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => print(true)}>
          Print half sheets
        </button>
      </div>
      <BulletinBody d={d} className="bl-screen no-print" />
      {/* What prints: laid out off screen at paper size so it can be fitted to one page */}
      <div className={`bl-sheet bl-sheet-${size}`} ref={sheet} aria-hidden="true">
        <BulletinBody d={d} paper={size} onQr={onQr} onImg={refit} />
        {half && <BulletinBody d={d} paper="half" onImg={refit} />}
      </div>
    </div>
  );
}

// Announcements as separate notices with a bold title: the first line of each one (a blank line
// between them), or the part before a dash or colon, or the first sentence.
export function splitAnnouncements(text) {
  const t = String(text || '').replace(/\r/g, '').trim();
  if (!t) return [];
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
  return blocks
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const lines = b.split('\n');
      if (lines.length > 1 && lines[0].length <= 90) return { title: lines[0].trim(), body: lines.slice(1).join('\n').trim() };
      const m = b.match(/^(.{3,70}?)\s+[—–-]\s+([\s\S]+)$/) || b.match(/^([^:\n]{3,60}):\s+([\s\S]+)$/) || b.match(/^(.{3,90}?[.!?])\s+([\s\S]+)$/);
      if (m) return { title: m[1].trim(), body: m[2].trim() };
      return b.length <= 90 ? { title: b, body: '' } : { title: '', body: b };
    });
}

function BulletinBody({ d, paper, onQr, onImg, className = '' }) {
  const e = d.event;
  const notices = splitAnnouncements(d.announcements);
  return (
    <article className={`bl ${paper ? `bl-paper bl-${paper}` : ''} ${className}`}>
      <header className="bl-head">
        {d.logo && <img className="bl-logo" src={d.logo} alt={d.orgName ? `${d.orgName} logo` : 'Logo'} onLoad={onImg} />}
        <div className="bl-titles">
          {d.orgName && <div className="bl-org">{d.orgName}</div>}
          <h1>{e.title}</h1>
          <div className="bl-date">
            {fmtDay(e.date)}, {e.date.slice(0, 4)} · {fmtTime(e.start)}
          </div>
        </div>
      </header>

      {(d.sermonTitle || d.speaker) && (
        <section className="bl-sermon" aria-label="Sermon">
          {d.sermonTitle && <div className="bl-sermon-title">“{d.sermonTitle}”</div>}
          {d.speaker && <div className="bl-speaker">{d.speaker}</div>}
        </section>
      )}

      {d.order.length > 0 && (
        <section className="bl-section">
          <h2>Order of service</h2>
          <ol className="bl-order">
            {d.order.map((x, i) =>
              x.kind === 'heading' ? (
                <li key={i} className="bl-phase">
                  <span>{x.title}</span>
                </li>
              ) : (
                <li key={i} className={`bl-k-${x.kind}`}>
                  <span className="bl-item">{x.title}</span>
                  <span className="bl-dots" aria-hidden="true" />
                  <span className="bl-who">{x.who}</span>
                  {x.note && <span className="bl-note">{x.note}</span>}
                </li>
              )
            )}
          </ol>
        </section>
      )}

      {(d.scriptures.length > 0 || d.songs.length > 0) && (
        <div className="bl-pair">
          {d.scriptures.length > 0 && (
            <section className="bl-section">
              <h2>Scripture</h2>
              <ul className="bl-list">
                {d.scriptures.map((s, i) => (
                  <li key={i}>
                    {s.reference}
                    {s.version && <span className="bl-muted"> {s.version}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.songs.length > 0 && (
            <section className="bl-section">
              <h2>Songs</h2>
              <ul className="bl-list">
                {d.songs.map((s, i) => (
                  <li key={i}>
                    {s.title}
                    {s.artist && <span className="bl-muted"> · {s.artist}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {notices.length > 0 && (
        <section className="bl-section">
          <h2>Announcements</h2>
          <div className="bl-notices">
            {notices.map((n, i) => (
              <div key={i} className="bl-notice">
                {n.title && <strong>{n.title}</strong>}
                {n.body && <p>{n.body}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {paper && (
        <footer className="bl-foot">
          <Qr value={window.location.origin + window.location.pathname} size={paper === 'half' ? 56 : 72} label="QR code for the digital bulletin" onReady={onQr} />
          <span>
            Scan for this bulletin on your phone
            {d.orgName && <span className="bl-muted"> · {d.orgName}</span>}
          </span>
        </footer>
      )}
    </article>
  );
}
