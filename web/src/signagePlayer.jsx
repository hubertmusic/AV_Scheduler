// What a church screen shows: the playlist from the Signage tab, one item after another. Pictures
// and PDF pages show for their seconds, videos play to the end (or for their seconds), web pages
// show live. Used full screen at /screen/<token> (add that link to Anthias as a web page), and
// small in the Signage tab's preview.
import { useCallback, useEffect, useRef, useState } from 'react';
import './signagePlayer.css';

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

// follow: { id, startedAt } — jump to that item, that far in (the mirror of a real screen).
// onItem(item, { startedAt, length, next }) — told when an item starts (and a video's length once known).
export function Player({ items, fit = 'contain', empty = null, onItem, follow }) {
  const [at, setAt] = useState(0);
  const [cycle, setCycle] = useState(0); // bumps when an item (re)starts, so it plays from the top
  const timer = useRef(null);
  const offset = useRef(0); // ms into the current item when it started here
  const startedAt = useRef(Date.now());
  const list = items || [];
  const cur = list.length ? list[at % list.length] : null;
  const curId = useRef(null);
  const tell = useRef(onItem);
  tell.current = onItem;

  // The playlist changed: stay on the same item if it's still there
  useEffect(() => {
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === curId.current);
    setAt(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((x) => x.id).join(',')]);

  // Following a real screen: go where it is, unless we're already there (within a couple of seconds)
  useEffect(() => {
    if (!follow?.id || !list.length) return;
    const i = list.findIndex((x) => x.id === follow.id);
    if (i < 0) return;
    const into = Math.max(0, Date.now() - follow.startedAt);
    if (i === at % list.length && Math.abs(Date.now() - startedAt.current - into) < 2500) return;
    offset.current = into;
    setAt(i);
    setCycle((c) => c + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow?.id, follow?.startedAt, list.length]);

  const next = useCallback(() => {
    offset.current = 0;
    setAt((n) => (list.length ? (n + 1) % list.length : 0));
    setCycle((c) => c + 1);
  }, [list.length]);

  const after = list.length ? list[(at + 1) % list.length] : null;
  useEffect(() => {
    clearTimeout(timer.current);
    if (!cur) return;
    curId.current = cur.id;
    startedAt.current = Date.now() - offset.current;
    const length = cur.kind === 'video' ? cur.seconds || 0 : Math.max(2, cur.seconds || 10);
    tell.current?.(cur, { startedAt: startedAt.current, length, next: after });
    // Videos move on when they end, unless they have their own seconds
    if (cur.kind !== 'video' || cur.seconds > 0) timer.current = setTimeout(next, Math.max(500, length * 1000 - offset.current));
    // Get the next picture ready
    if (after?.kind === 'image') new Image().src = after.url;
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, cycle]);

  if (!cur) return <div className="sp sp-empty">{empty}</div>;
  const key = `${cur.id}:${cycle}`;
  const videoReady = (e) => {
    const v = e.currentTarget;
    if (offset.current > 0 && offset.current / 1000 < (v.duration || 0)) v.currentTime = offset.current / 1000;
    if (!cur.seconds && v.duration) tell.current?.(cur, { startedAt: startedAt.current, length: Math.round(v.duration), next: after });
  };
  return (
    <div className={`sp sp-${fit}`}>
      {cur.kind === 'image' && <img key={key} className="sp-item" src={cur.url} alt={cur.name} onError={() => setTimeout(next, 1500)} />}
      {cur.kind === 'video' && (
        <video key={key} className="sp-item" src={cur.url} autoPlay muted={!cur.sound} playsInline loop={list.length === 1} onLoadedMetadata={videoReady} onEnded={next} onError={() => setTimeout(next, 1500)} />
      )}
      {cur.kind === 'web' && <iframe key={key} className="sp-item sp-web" src={cur.url} title={cur.name} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />}
    </div>
  );
}

// /screen/<token>: full screen, checks for a new playlist every minute, keeps playing the last one
// it had if the internet drops (and after a restart), and reloads itself overnight for app updates.
// Each open copy of a screen link is its own player (two TVs on one link show as two)
function playerId() {
  try {
    let id = sessionStorage.getItem('cc-player');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem('cc-player', id);
    }
    return id;
  } catch {
    return (window.__ccPlayer ||= Math.random().toString(36).slice(2, 12));
  }
}

export function ScreenPage({ token }) {
  const saved = store.get(`cc-screen-${token}`);
  const [data, setData] = useState(saved);
  const [error, setError] = useState('');
  const v = useRef(saved?.v);
  useEffect(() => {
    document.title = saved?.name ? `${saved.name} · Screen` : 'Screen';
    document.documentElement.classList.add('sp-page');
    let t;
    const load = async () => {
      let wait = 60;
      try {
        const res = await fetch(`/api/screen/${token}`, { cache: 'no-store' });
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          if (res.status === 404) {
            setError(d?.error || 'This screen link isn’t valid any more.');
            setData(null);
          }
        } else {
          setError('');
          wait = d.check || 60;
          if (d.v !== v.current) {
            v.current = d.v;
            setData(d);
            store.set(`cc-screen-${token}`, d);
            document.title = `${d.name} · Screen`;
          }
        }
      } catch {
        /* offline: keep showing what we have */
      }
      t = setTimeout(load, wait * 1000);
    };
    load();
    // Reload between 3 and 4 in the morning, so the screen picks up Crew Call updates
    const nightly = setInterval(() => {
      const h = new Date().getHours();
      if (h === 3 && performance.now() > 2 * 3600e3) window.location.reload();
    }, 15 * 60e3);
    return () => {
      clearTimeout(t);
      clearInterval(nightly);
    };
  }, [token]);

  // Tell Crew Call what's on screen: when each item starts, and every 10 seconds
  const showing = useRef(null);
  const report = useCallback(() => {
    const d = showing.current;
    fetch(`/api/screen/${token}/now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        player: playerId(),
        v: v.current,
        count: d?.count || 0,
        item: d?.item ? { id: d.item.id, name: d.item.name, kind: d.item.kind } : null,
        elapsed: d ? (Date.now() - d.startedAt) / 1000 : 0,
        length: d?.length || 0,
        next: d?.next ? { id: d.next.id, name: d.next.name } : null,
        w: window.screen?.width || window.innerWidth,
        h: window.screen?.height || window.innerHeight,
      }),
    }).catch(() => {});
  }, [token]);
  useEffect(() => {
    report();
    const t = setInterval(report, 10000);
    return () => clearInterval(t);
  }, [report]);
  const onItem = useCallback(
    (item, info) => {
      showing.current = { item, ...info, count: data?.items?.length || 0 };
      report();
    },
    [report, data]
  );

  if (error) return <div className="sp-screen sp-msg">{error}</div>;
  if (!data) return <div className="sp-screen" />;
  return (
    <div className="sp-screen">
      <Player items={data.items} fit={data.fit} onItem={onItem} empty={<div className="sp-msg">{data.church || 'Welcome'}</div>} />
    </div>
  );
}
