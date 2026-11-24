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

export function Player({ items, fit = 'contain', empty = null, onItem }) {
  const [at, setAt] = useState(0);
  const [cycle, setCycle] = useState(0); // bumps when the same item plays again, so it restarts
  const timer = useRef(null);
  const list = items || [];
  const cur = list.length ? list[at % list.length] : null;
  const curId = useRef(null);

  // The playlist changed: stay on the same item if it's still there
  useEffect(() => {
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === curId.current);
    setAt(i >= 0 ? i : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.map((x) => x.id).join(',')]);

  const next = useCallback(() => {
    setAt((n) => (list.length ? (n + 1) % list.length : 0));
    setCycle((c) => c + 1);
  }, [list.length]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!cur) return;
    curId.current = cur.id;
    onItem?.(cur);
    // Videos move on when they end, unless they have their own seconds
    if (cur.kind !== 'video' || cur.seconds > 0) timer.current = setTimeout(next, Math.max(2, cur.seconds || 10) * 1000);
    // Get the next picture ready
    const after = list[(at + 1) % list.length];
    if (after?.kind === 'image') new Image().src = after.url;
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, cycle]);

  if (!cur) return <div className="sp sp-empty">{empty}</div>;
  const key = `${cur.id}:${cycle}`;
  return (
    <div className={`sp sp-${fit}`}>
      {cur.kind === 'image' && <img key={key} className="sp-item" src={cur.url} alt={cur.name} onError={() => setTimeout(next, 1500)} />}
      {cur.kind === 'video' && (
        <video key={key} className="sp-item" src={cur.url} autoPlay muted={!cur.sound} playsInline loop={list.length === 1} onEnded={next} onError={() => setTimeout(next, 1500)} />
      )}
      {cur.kind === 'web' && <iframe key={key} className="sp-item sp-web" src={cur.url} title={cur.name} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />}
    </div>
  );
}

// /screen/<token>: full screen, checks for a new playlist every minute, keeps playing the last one
// it had if the internet drops (and after a restart), and reloads itself overnight for app updates.
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

  if (error) return <div className="sp-screen sp-msg">{error}</div>;
  if (!data) return <div className="sp-screen" />;
  return (
    <div className="sp-screen">
      <Player items={data.items} fit={data.fit} empty={<div className="sp-msg">{data.church || 'Welcome'}</div>} />
    </div>
  );
}
