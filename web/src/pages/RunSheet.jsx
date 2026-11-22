import { useEffect, useState } from 'react';
import { api, fmtDay, fmtTime, orderTimes, prettyPhone, todayISO } from '../lib.js';
import { ItemExtras } from '../orderItem.jsx';
import './runsheet.css';

// A printable one-page view of a service for the booth. Each kind of section has its own colour,
// and on the day the order of service marks what's on now and what's up next.
export default function RunSheet({ id }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [lyrics, setLyrics] = useState(false);

  useEffect(() => {
    api(`/weekend/runsheet/${id}`).then(setD, (e) => setError(e.message));
    api('/activity/view', { method: 'POST', body: { page: 'runsheet' } }).catch(() => {});
  }, [id]);
  useEffect(() => {
    if (d) document.title = `Run sheet · ${d.event.title}`;
  }, [d]);

  if (error)
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>Can’t open this run sheet</h1>
          <p className="muted">{error}</p>
          <a className="btn btn-outline" href="/">Back to Crew Call</a>
        </div>
      </div>
    );
  if (!d) return <div className="loading">Loading…</div>;
  const e = d.event;
  const p = d.plan;

  return (
    <div className="rs">
      <div className="rs-tools no-print">
        <a className="btn btn-ghost" href="/">← Crew Call</a>
        <label className="check">
          <input type="checkbox" checked={lyrics} onChange={() => setLyrics(!lyrics)} />
          <span>Include lyrics</span>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <header className="rs-head">
        <div className="eyebrow">{e.kind === 'soundcheck' ? 'Sound check' : 'Run sheet'}</div>
        <h1>{e.title}</h1>
        <div className="rs-meta">
          {fmtDay(e.date)} · Crew call <strong>{fmtTime(e.call)}</strong> · Starts <strong>{fmtTime(e.start)}</strong> · Ends {fmtTime(e.end)}
        </div>
        {p && (p.sermonTitle || p.speaker) && (
          <div className="rs-sermon">
            {p.sermonTitle && <strong>“{p.sermonTitle}”</strong>} {p.speaker && <span>— {p.speaker}</span>}
          </div>
        )}
      </header>
      {(d.notices?.permanent || d.notices?.weekly || e.notes) && (
        <div className="rs-notices">
          {d.notices?.permanent && (
            <div className="rs-notice">
              <strong>Important</strong>
              {d.notices.permanent}
            </div>
          )}
          {d.notices?.weekly && (
            <div className="rs-notice">
              <strong>This weekend</strong>
              {d.notices.weekly}
            </div>
          )}
          {e.notes && (
            <div className="rs-notice">
              <strong>For this shift</strong>
              {e.notes}
            </div>
          )}
        </div>
      )}

      <div className="rs-cols">
        <section className="rs-block rs-sec-crew">
          <h2>Crew</h2>
          <Crew list={e.crew} />
          {e.groups.length > 0 && (
            <>
              <h3>Groups</h3>
              {e.groups.map((g) => (
                <div key={g.id} className="rs-group">
                  <strong>{g.name}</strong>
                  {g.contactName && <span> · {g.contactName}{g.phone ? ` ${prettyPhone(g.phone)}` : ''}</span>}
                  {g.notes && <div className="small">{g.notes}</div>}
                </div>
              ))}
            </>
          )}
        </section>

        {d.related.map((r) => (
          <section key={r.id} className="rs-block rs-sec-related">
            <h2>{/^sound check/i.test(r.title) ? r.title : `${r.kind === 'soundcheck' ? 'Sound check' : 'Service'}: ${r.title}`}</h2>
            <div className="small">
              {fmtDay(r.date)} · call {fmtTime(r.call)} · {fmtTime(r.start)}–{fmtTime(r.end)}
            </div>
            <Crew list={r.crew} />
            {r.groups.map((g) => (
              <div key={g.id} className="rs-group">
                <strong>{g.name}</strong>
                {g.notes && <span className="small"> — {g.notes}</span>}
              </div>
            ))}
          </section>
        ))}
      </div>

      {p?.order?.length > 0 && <RunOrder order={p.order} start={e.start} today={e.date === todayISO()} />}

      {p && p.songs.length > 0 && (
        <section className="rs-block rs-sec-songs">
          <h2>Songs</h2>
          <ol className="rs-songs">
            {p.songs.map((s, i) => (
              <li key={i}>
                <strong>{s.title}</strong>
                {s.key && <span className="rs-key">{s.key}</span>}
                {s.artist && <span className="muted small"> · {s.artist}</span>}
                {s.note && <div className="small">{s.note}</div>}
                {lyrics && s.lyrics && <pre className="rs-lyrics">{s.lyrics}</pre>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {p && p.scriptures.length > 0 && (
        <section className="rs-block rs-sec-scripture">
          <h2>Bible texts</h2>
          {p.scriptures.map((s, i) => (
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

      {p && p.notes && (
        <section className="rs-block rs-sec-notes">
          <h2>Pastor’s notes</h2>
          <div className="rs-pre">{p.notes}</div>
        </section>
      )}

      {p && p.files.length > 0 && (
        <section className="rs-block rs-sec-media">
          <h2>Media</h2>
          <ul className="rs-files">
            {p.files.map((f, i) => (
              <li key={i}>{f.name}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Crew({ list }) {
  if (!list.length) return <p className="small muted">No positions.</p>;
  return (
    <table className="rs-crew">
      <tbody>
        {list.map((c, i) => [
          new Set(list.map((x) => x.team)).size > 1 && c.team && c.team !== list[i - 1]?.team && (
            <tr key={`t${i}`} className="rd-heading">
              <th colSpan={4} scope="rowgroup">
                {c.team}
              </th>
            </tr>
          ),
          <tr key={i}>
            <th scope="row">
              {c.position}
              {c.shadow ? ' (shadow)' : ''}
            </th>
            <td>{c.name || <span className="danger">OPEN</span>}</td>
            <td className="small">{c.phone ? prettyPhone(c.phone) : ''}</td>
            <td className="small">{c.name ? (c.confirmed ? '✓ confirmed' : 'not confirmed') : ''}</td>
          </tr>,
        ])}
      </tbody>
    </table>
  );
}

const KIND_LABEL = { song: 'Song', scripture: 'Scripture', prayer: 'Prayer', sermon: 'Sermon' };
const mins = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// On the day: which item is on now and which is up next, from the clock and each item's minutes
function useNowNext(order, times, on) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setClock(Date.now()), 20000);
    return () => clearInterval(id);
  }, [on]);
  if (!on) return {};
  const d = new Date(clock);
  const now = d.getHours() * 60 + d.getMinutes();
  const items = order.map((x, i) => ({ i, x })).filter(({ x }) => x.kind !== 'heading');
  if (!items.length) return {};
  const start = (k) => mins(times.at[items[k].i]);
  if (now < start(0)) return { next: items[0].i, startsIn: start(0) - now };
  for (let k = 0; k < items.length; k++) {
    const end = start(k) + (Number(items[k].x.minutes) || 0);
    if (now >= start(k) && now < end) return { now: items[k].i, next: items[k + 1]?.i };
  }
  return {};
}

// The order of service, numbered, with times (when minutes are set), who, and every crew's cues
function RunOrder({ order, start, today }) {
  const times = orderTimes(start, order);
  const timed = times.total > 0;
  const live = useNowNext(order, times, today && timed);
  let n = 0;
  return (
    <section className="rs-block rs-sec-order">
      <h2>
        Order of service
        {timed && <span className="rs-runs">ends about {fmtTime(times.end)}</span>}
      </h2>
      <ol className="rs-order">
        {order.map((x, i) =>
          x.kind === 'heading' ? (
            <li key={i} className="rs-order-heading">
              {x.title}
            </li>
          ) : (
            <li key={i} className={`rs-k-${x.kind}${live.now === i ? ' rs-now' : ''}${live.next === i ? ' rs-next' : ''}`}>
              <span className="rs-num" aria-hidden="true">{++n}</span>
              {timed && <span className="rs-order-time">{fmtTime(times.at[i])}</span>}
              <div className="rs-order-main">
                {live.now === i && <span className="rs-live rs-live-now">Now</span>}
                {live.next === i && <span className="rs-live rs-live-next">{live.startsIn ? `Up next · starts in ${live.startsIn} min` : 'Up next'}</span>}
                {KIND_LABEL[x.kind] && <span className="rs-kind">{KIND_LABEL[x.kind]}</span>}
                <strong>{x.title}</strong>
                {x.who && <span> · {x.who}</span>}
                {x.minutes > 0 && <span className="muted small"> · {x.minutes} min</span>}
                <ItemExtras x={x} compact />
              </div>
            </li>
          )
        )}
      </ol>
    </section>
  );
}
