// Public pages opened from a link or QR code, no sign-in:
//   /rundown/<token>   service rundown for the platform and crew (times, cues, who's serving)
//   /bulletin/<token>  the congregation's bulletin
// Add ?print=1 to open the print dialog straight away.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate, fmtDay, fmtMinutes, fmtTime, orderTimes } from '../lib.js';
import { Qr } from '../qr.jsx';

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
    <div className="rs share-page">
      <div className="rs-tools no-print">
        <span className="chip chip-pending">Platform & crew only — please don’t share</span>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <header className="rs-head share-head">
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
        <figure className="share-qr print-only">
          <Qr value={window.location.origin + window.location.pathname} size={96} label="QR code for this rundown" onReady={onQr} />
          <figcaption>Open on your phone</figcaption>
        </figure>
      </header>

      {d.order.length > 0 ? (
        <section className="rs-block">
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
                  <tr key={i}>
                    {timed && <td className="rd-time">{fmtTime(times.at[i])}</td>}
                    <td>
                      <strong>{x.title}</strong>
                      {x.minutes > 0 && <span className="small muted"> · {x.minutes} min</span>}
                    </td>
                    <td>{x.who}</td>
                    <td className="small">{x.notes}</td>
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
          <section className="rs-block">
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
        {d.crew.length > 0 && (
          <section className="rs-block">
            <h2>AV team</h2>
            <table className="rs-crew">
              <tbody>
                {d.crew.map((c, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {c.position}
                      {c.shadow ? ' (shadow)' : ''}
                    </th>
                    <td>{c.name || <span className="muted">open</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {d.scriptures.length > 0 && (
        <section className="rs-block">
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

export function BulletinPage({ token }) {
  const [d, error] = usePublic('bulletin', token);
  const wanted = new URLSearchParams(window.location.search).get('print');
  const [half, setHalf] = useState(wanted === 'half');
  const printed = useRef(false);
  useEffect(() => {
    if (d) document.title = `${d.event.title} · ${fmtDate(d.event.date)}`;
  }, [d]);
  // Half sheets: two copies side by side on a landscape page, to cut in half
  useEffect(() => {
    if (!half) return;
    const style = document.createElement('style');
    style.textContent = '@page { size: letter landscape; margin: 0.35in; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [half]);
  useEffect(() => {
    const after = () => wanted !== 'half' && setHalf(false);
    window.addEventListener('afterprint', after);
    return () => window.removeEventListener('afterprint', after);
  }, [wanted]);
  const onQr = useCallback(() => {
    if (!wanted || printed.current) return;
    printed.current = true;
    setTimeout(() => window.print(), 400);
  }, [wanted]);
  const printHalf = () => {
    setHalf(true);
    setTimeout(() => window.print(), 400);
  };
  if (error) return <Problem error={error} />;
  if (!d) return <div className="loading">Loading…</div>;

  return (
    <div className={half ? 'bl-two' : ''}>
      <div className="bl-tools no-print">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => (setHalf(false), setTimeout(() => window.print(), 200))}>
          Print full page
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={printHalf}>
          Print half sheets
        </button>
      </div>
      <BulletinBody d={d} half={half} onQr={onQr} />
      {half && <BulletinBody d={d} half copy />}
    </div>
  );
}

function BulletinBody({ d, half, copy, onQr }) {
  const e = d.event;
  return (
    <div className={`bl${half ? ' bl-half' : ''}${copy ? ' bl-copy' : ''}`} aria-hidden={copy || undefined}>
      <header className="bl-head">
        {d.logo && <img className="bl-logo" src={d.logo} alt={d.orgName ? `${d.orgName} logo` : 'Logo'} />}
        {d.orgName && <div className="bl-org">{d.orgName}</div>}
        <h1>{e.title}</h1>
        <div className="bl-date">
          {fmtDate(e.date)} · {fmtTime(e.start)}
        </div>
      </header>

      {(d.sermonTitle || d.speaker) && (
        <section className="bl-sermon">
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
                <li key={i} className="bl-order-heading">
                  {x.title}
                </li>
              ) : (
                <li key={i}>
                  <span className="bl-item">{x.title}</span>
                  <span className="bl-dots" aria-hidden="true" />
                  <span className="bl-who">{x.who}</span>
                </li>
              )
            )}
          </ol>
        </section>
      )}

      {d.scriptures.length > 0 && (
        <section className="bl-section">
          <h2>Scripture</h2>
          <ul className="bl-list">
            {d.scriptures.map((s, i) => (
              <li key={i}>
                {s.reference}
                {s.version ? ` (${s.version})` : ''}
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

      {d.announcements && (
        <section className="bl-section">
          <h2>Announcements</h2>
          <div className="bl-announce">{d.announcements}</div>
        </section>
      )}

      <footer className="bl-foot print-only">
        <Qr value={window.location.origin + window.location.pathname} size={half ? 64 : 88} label="QR code for the digital bulletin" onReady={onQr} />
        <span>Scan for the digital bulletin</span>
      </footer>
    </div>
  );
}
