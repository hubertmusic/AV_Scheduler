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
  const listRef = useRef(list);
  listRef.current = list;
  const prevIds = useRef(null);
  const upNext = useRef(null); // something just added: it plays next, so you see it straight away

  // The playlist changed: stay on the same item if it's still there
  useEffect(() => {
    if (!list.length) return;
    const ids = list.map((x) => x.id);
    const added = prevIds.current && ids.find((id) => !prevIds.current.includes(id));
    if (added) upNext.current = added;
    prevIds.current = ids;
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
    const l = listRef.current;
    const jump = upNext.current ? l.findIndex((x) => x.id === upNext.current) : -1;
    upNext.current = null;
    if (jump >= 0) setAt(jump);
    else setAt((n) => (l.length ? (n + 1) % l.length : 0));
    setCycle((c) => c + 1);
  }, []);

  const queued = upNext.current ? list.find((x) => x.id === upNext.current) : null;
  const after = queued || (list.length ? list[(at + 1) % list.length] : null);
  // Moves on only when there's something else to show and the item has a time: on its own, or set
  // to 0 seconds (stays on), a picture or page just stays; a lone video loops without a gap
  const alone = list.length === 1;
  const holds = cur && (alone || (cur.kind !== 'video' && cur.seconds === 0));
  useEffect(() => {
    clearTimeout(timer.current);
    if (!cur) return;
    curId.current = cur.id;
    startedAt.current = Date.now() - offset.current;
    const length = holds ? 0 : cur.kind === 'video' ? cur.seconds || 0 : Math.max(2, cur.seconds || 10);
    tell.current?.(cur, { startedAt: startedAt.current, length, next: holds ? null : after });
    // Videos move on when they end, unless they have their own seconds
    if (!holds && (cur.kind !== 'video' || cur.seconds > 0)) timer.current = setTimeout(next, Math.max(500, length * 1000 - offset.current));
    // Get the next picture ready
    if (!holds && after?.kind === 'image') new Image().src = after.url;
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, cycle, holds]);

  // Seamless changes: the last item stays up underneath until the new one has loaded, then the new
  // one fades in over it. An item that stays on is never reloaded.
  const key = cur ? `${cur.id}:${cur.url}:${cycle}` : ''; // cycle only moves when an item starts over
  const [shown, setShown] = useState({ key: '', item: null, prev: null, ready: false });
  if (cur && shown.key !== key) setShown({ key, item: cur, prev: shown.item ? { key: shown.key, item: shown.item } : null, ready: false });
  const ready = useCallback(() => setShown((x) => (x.key === key && !x.ready ? { ...x, ready: true } : x)), [key]);
  useEffect(() => {
    if (!shown.ready && shown.key) {
      const t = setTimeout(ready, 4000); // never stuck behind something that didn't say it loaded
      return () => clearTimeout(t);
    }
    if (shown.prev) {
      const t = setTimeout(() => setShown((x) => (x.key === shown.key ? { ...x, prev: null } : x)), 800);
      return () => clearTimeout(t);
    }
  }, [shown.key, shown.ready, shown.prev, ready]);

  if (!cur) return <div className="sp sp-empty">{empty}</div>;
  const videoReady = (e) => {
    const v = e.currentTarget;
    if (offset.current > 0 && offset.current / 1000 < (v.duration || 0)) v.currentTime = offset.current / 1000;
    if (!cur.seconds && v.duration && !holds) tell.current?.(cur, { startedAt: startedAt.current, length: Math.round(v.duration), next: after });
  };
  const skip = () => !alone && setTimeout(next, 1500);
  const layer = (item, k, top) => {
    const cls = `sp-item ${top ? `sp-top ${shown.ready ? 'sp-on' : ''}` : 'sp-under'}`;
    if (item.kind === 'image') return <img key={k} className={cls} src={item.url} alt={top ? item.name : ''} onLoad={top ? ready : undefined} onError={top ? skip : undefined} />;
    if (item.kind === 'video')
      return (
        <video
          key={k}
          className={cls}
          src={item.url}
          autoPlay
          muted={!top || !item.sound}
          playsInline
          loop={top && alone}
          onLoadedMetadata={top ? videoReady : undefined}
          onLoadedData={top ? ready : undefined}
          onEnded={top && !alone ? next : undefined}
          onError={top ? skip : undefined}
        />
      );
    return <iframe key={k} className={`${cls} sp-web`} src={item.url} title={item.name} onLoad={top ? ready : undefined} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />;
  };
  return (
    <div className={`sp sp-${fit}`}>
      {shown.prev && shown.prev.key !== shown.key && layer(shown.prev.item, shown.prev.key, false)}
      {layer(cur, key, true)}
    </div>
  );
}

// /screen/<token>: full screen, picks up changes from the Signage tab within about 10 seconds, keeps playing the last one
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
  const refresh = useRef(() => {});
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
    refresh.current = () => {
      clearTimeout(t);
      load();
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
    })
      .then((r) => (r.ok ? r.json() : null))
      // Something changed in the Signage tab: get the new playlist now, not at the next minute's check
      .then((r) => r?.v && r.v !== v.current && refresh.current())
      .catch(() => {});
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
