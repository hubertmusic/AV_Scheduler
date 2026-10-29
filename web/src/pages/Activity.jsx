import { useCallback, useEffect, useMemo, useState } from 'react';
import { ago, api, fmtDay, roleLabel } from '../lib.js';
import { Avatar, Empty, Icon, useApp } from '../ui.jsx';

const KIND = {
  login: { label: 'Signed in', tone: 'k-login' },
  'login-failed': { label: 'Failed sign-in', tone: 'k-fail' },
  view: { label: 'Viewed', tone: 'k-view' },
  calendar: { label: 'Calendar', tone: 'k-cal' },
  change: { label: 'Change', tone: 'k-change' },
  guest: { label: 'Guest', tone: 'k-guest' },
  system: { label: 'System', tone: 'k-system' },
};

function readPref(key, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writePref(key, on) {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage blocked: the setting just won't stick */
  }
}

// Thin live band under the tabs, only for the admin.
export function ActivityTicker({ onOpen }) {
  const [items, setItems] = useState([]);
  const [show, setShow] = useState(() => readPref('cc-ticker', true));

  useEffect(() => {
    if (!show) return undefined;
    let alive = true;
    const load = () =>
      api('/activity/feed?limit=12')
        .then((list) => alive && setItems(list))
        .catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [show]);

  const toggle = () => {
    writePref('cc-ticker', !show);
    setShow(!show);
  };

  if (!show)
    return (
      <div className="ticker ticker-off">
        <button type="button" className="ticker-toggle" onClick={toggle}>
          Show activity ticker
        </button>
      </div>
    );

  const line = items.map((a) => (
    <span key={a.id} className="ticker-item">
      <span className={`kdot ${KIND[a.kind]?.tone || ''}`} aria-hidden="true" />
      <strong>{a.who || 'Someone'}</strong> {a.action.replace(/^Signed in$/, 'signed in')} <span className="ticker-time">{ago(a.at)}</span>
    </span>
  ));

  return (
    <div className="ticker" aria-label="Recent activity">
      <span className="ticker-live">
        <span className="live-dot" aria-hidden="true" /> Live
      </span>
      <button type="button" className="ticker-track" onClick={onOpen} title="Open the Activity page">
        {items.length === 0 ? (
          <span className="ticker-item muted">No activity yet</span>
        ) : (
          <span className="ticker-move">
            {line}
            <span aria-hidden="true">{line}</span>
          </span>
        )}
      </button>
      <button type="button" className="ticker-toggle" onClick={toggle} aria-label="Hide the activity ticker">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

const SORTS = {
  seen: { label: 'Last seen', fn: (a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '') },
  quiet: { label: 'Least active', fn: (a, b) => a.views30 + a.changes30 + a.logins30 - (b.views30 + b.changes30 + b.logins30) },
  changes: { label: 'Most changes', fn: (a, b) => b.changes30 - a.changes30 },
  name: { label: 'Name', fn: (a, b) => a.name.localeCompare(b.name) },
};

const FILTERS = [
  ['', 'Everything'],
  ['change', 'Changes'],
  ['login', 'Sign-ins'],
  ['view', 'Page views'],
  ['calendar', 'Calendar syncs'],
  ['guest', 'Guests'],
  ['system', 'Reminders'],
];

export default function Activity() {
  const [rows, setRows] = useState(null);
  const [feed, setFeed] = useState([]);
  const [kind, setKind] = useState('');
  const [who, setWho] = useState('');
  const [sort, setSort] = useState('seen');
  const [more, setMore] = useState(true);

  const loadRows = useCallback(() => api('/activity/people').then(setRows).catch(() => setRows([])), []);
  const query = useCallback((before) => `/activity/feed?limit=60${kind ? `&kind=${kind}` : ''}${who ? `&user=${who}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`, [kind, who]);

  const loadFeed = useCallback(async () => {
    const list = await api(query()).catch(() => []);
    setFeed(list);
    setMore(list.length === 60);
  }, [query]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);
  useEffect(() => {
    loadFeed();
    const id = setInterval(() => {
      loadFeed();
      loadRows();
    }, 20000);
    return () => clearInterval(id);
  }, [loadFeed, loadRows]);

  const older = async () => {
    const list = await api(query(feed[feed.length - 1]?.at)).catch(() => []);
    setFeed([...feed, ...list]);
    setMore(list.length === 60);
  };

  const active = (rows || []).filter((r) => r.active && r.role !== 'admin');
  const stats = useMemo(() => {
    const day = Date.now() - 24 * 3600e3;
    const week = Date.now() - 7 * 24 * 3600e3;
    return {
      today: active.filter((r) => r.lastSeenAt && Date.parse(r.lastSeenAt) > day).length,
      week: active.filter((r) => r.lastSeenAt && Date.parse(r.lastSeenAt) > week).length,
      never: active.filter((r) => !r.lastLoginAt).length,
      synced: active.filter((r) => r.calLastFetchedAt && Date.parse(r.calLastFetchedAt) > week).length,
      unconfirmed: active.reduce((n, r) => n + r.unconfirmed, 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const sorted = [...(rows || [])].sort((a, b) => (a.active === b.active ? SORTS[sort].fn(a, b) : a.active ? -1 : 1));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <div className="muted">Only you can see this page. Updates every 20 seconds.</div>
        </div>
      </div>

      <div className="stat-row">
        <Stat n={stats.today} of={active.length} label="seen in the last 24 hours" />
        <Stat n={stats.week} of={active.length} label="seen this week" />
        <Stat n={stats.synced} of={active.length} label="calendars synced this week" />
        <Stat n={stats.never} label="have never signed in" warn={stats.never > 0} />
        <Stat n={stats.unconfirmed} label="upcoming shifts not confirmed" warn={stats.unconfirmed > 0} />
      </div>

      <section className="card stack" aria-label="People">
        <div className="section-head">
          <h2>People</h2>
          <label className="field field-row">
            <span className="small">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!rows && <div className="loading-inline">Loading…</div>}
        <div className="table-scroll">
          <table className="act-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Last seen</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Calendar</th>
                <th scope="col">Views (7d)</th>
                <th scope="col">Changes (30d)</th>
                <th scope="col">Shifts</th>
                <th scope="col">Availability</th>
                <th scope="col">
                  <span className="sr-only">Show activity</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'row-off'}>
                  <th scope="row">
                    <span className="row">
                      <Avatar name={r.name} size={30} tone={r.role === 'admin' ? 'accent' : 'dark'} />
                      <span className="col">
                        <span>{r.name}</span>
                        <span className="muted small">
                          {r.active ? roleLabel(r) : 'Inactive'}
                          {r.lastDevice ? ` · ${r.lastDevice}` : ''}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td>{r.lastSeenAt ? <Fresh at={r.lastSeenAt} /> : <span className="danger small strong">{r.signedUp ? 'Not yet' : 'Hasn’t accepted invite'}</span>}</td>
                  <td className="small">
                    {r.lastLoginAt ? ago(r.lastLoginAt) : '—'}
                    {r.failedLogins30 > 0 && <div className="danger small">{r.failedLogins30} failed</div>}
                  </td>
                  <td className="small">
                    {r.calLastFetchedAt ? (
                      <>
                        <Fresh at={r.calLastFetchedAt} />
                        <div className="muted">{r.calClient}</div>
                      </>
                    ) : (
                      <span className="muted">Not subscribed</span>
                    )}
                  </td>
                  <td className="num">{r.views7}</td>
                  <td className="num">{r.changes30}</td>
                  <td className="small">
                    {r.upcoming ? `${r.upcoming} upcoming` : '—'}
                    {r.unconfirmed > 0 && <div className="danger">{r.unconfirmed} unconfirmed</div>}
                  </td>
                  <td className="small">{r.availabilityUpdatedAt ? ago(r.availabilityUpdatedAt) : <span className="muted">Never</span>}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWho(who === r.id ? '' : r.id)} aria-pressed={who === r.id}>
                      {who === r.id ? 'Showing' : 'History'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack" aria-label="Activity feed">
        <div className="section-head">
          <h2>
            Feed{who && rows ? ` · ${rows.find((r) => r.id === who)?.name}` : ''}
            {who && (
              <button type="button" className="link-btn small" onClick={() => setWho('')} style={{ marginLeft: 8 }}>
                Show everyone
              </button>
            )}
          </h2>
          <div className="row-wrap" role="group" aria-label="Filter">
            {FILTERS.map(([k, l]) => (
              <button key={k || 'all'} type="button" className={`pill ${kind === k ? 'pill-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {feed.length === 0 && <Empty>Nothing here yet.</Empty>}
        <ol className="feed">
          {feed.map((a, i) => {
            const day = new Date(a.at).toDateString();
            const newDay = i === 0 || new Date(feed[i - 1].at).toDateString() !== day;
            return (
              <li key={a.id}>
                {newDay && <div className="feed-day">{fmtDay(localDay(a.at))}</div>}
                <div className="feed-item">
                  <span className={`kchip ${KIND[a.kind]?.tone || ''}`}>{KIND[a.kind]?.label || a.kind}</span>
                  <span className="grow">
                    <strong>{a.who || 'Someone'}</strong> <span>{a.action}</span>
                    {(a.device || a.ip) && (
                      <span className="muted small">
                        {' '}
                        · {[a.device, a.ip].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <time className="muted small nowrap" dateTime={a.at} title={new Date(a.at).toLocaleString()}>
                    {new Date(a.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
        {more && feed.length > 0 && (
          <button type="button" className="btn btn-ghost self-start" onClick={older}>
            Load older
          </button>
        )}
      </section>
    </div>
  );
}

function localDay(iso) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function Stat({ n, of, label, warn }) {
  return (
    <div className={`stat ${warn ? 'stat-warn' : ''}`}>
      <strong className="mono">
        {n}
        {of !== undefined && <span className="muted">/{of}</span>}
      </strong>
      <span className="small">{label}</span>
    </div>
  );
}

function Fresh({ at }) {
  const hrs = (Date.now() - Date.parse(at)) / 3600e3;
  const cls = hrs < 24 ? 'fresh-good' : hrs < 24 * 14 ? '' : 'fresh-old';
  return <span className={`small ${cls}`}>{ago(at)}</span>;
}
