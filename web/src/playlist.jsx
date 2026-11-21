// Playlist (beta) on a service plan: songs and playlists from Spotify, Apple Music and YouTube,
// played in each service's own player. One player open at a time, so the page stays quick.
import { useState } from 'react';
import { api } from './lib.js';
import { useApp } from './ui.jsx';

const PROVIDER = {
  spotify: { name: 'Spotify', mark: '●', cls: 'pl-spotify' },
  apple: { name: 'Apple Music', mark: '♪', cls: 'pl-apple' },
  youtube: { name: 'YouTube', mark: '▶', cls: 'pl-youtube' },
};
const KIND = { track: 'Song', song: 'Song', album: 'Album', playlist: 'Playlist', episode: 'Episode', show: 'Podcast', artist: 'Artist', video: 'Video', 'music-video': 'Music video' };

export function PlaylistCard({ plan, canEdit, onSave }) {
  const app = useApp();
  const [list, setList] = useState(plan.playlist || []);
  const [playing, setPlaying] = useState(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (next, msg) => {
    setBusy(true);
    try {
      await onSave({ playlist: next.map(({ url, title, note, addedBy }) => ({ url, title, note, addedBy })) }, msg);
      setList(next);
    } catch {
      /* toast shown */
    }
    setBusy(false);
  };
  const add = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const r = await api(`/plans/playlist-link?url=${encodeURIComponent(url.trim())}`);
      setBusy(false);
      await save([...list, { url: r.url, title: r.title || '', note: note.trim(), addedBy: app.me.name, provider: r.provider, kind: r.kind }], r.title ? `Added “${r.title}”` : 'Added to the playlist');
      setUrl('');
      setNote('');
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    save(next);
  };
  const rename = (i, title) => setList(list.map((x, j) => (j === i ? { ...x, title } : x)));

  if (!canEdit && !list.length) return null;
  return (
    <section className="card stack" aria-label="Playlist">
      <div>
        <h3>
          Playlist <span className="chip chip-beta">Beta</span>
        </h3>
        <p className="small muted">Songs to sample or play, like special music or what the praise team is learning. Paste a Spotify, Apple Music or YouTube link. People signed in to that service in their browser hear the full song; otherwise it plays a short preview.</p>
      </div>
      {list.length === 0 && <p className="muted small">Nothing yet.</p>}
      <ol className="pl-list">
        {list.map((x, i) => {
          const p = PROVIDER[x.provider] || {};
          const open = playing === i;
          return (
            <li key={`${x.url}-${i}`} className="pl-row">
              <div className="pl-head">
                <span className={`pl-mark ${p.cls}`} aria-hidden="true">
                  {p.mark}
                </span>
                <div className="pl-main">
                  {canEdit ? (
                    <input className="pl-title" aria-label="Title" maxLength={160} placeholder={`${KIND[x.kind] || 'Link'} on ${p.name || 'the web'}`} value={x.title} onChange={(e) => rename(i, e.target.value)} onBlur={() => save(list)} />
                  ) : (
                    <strong>{x.title || `${KIND[x.kind] || 'Link'} on ${p.name}`}</strong>
                  )}
                  <span className="small muted">
                    {p.name} · {KIND[x.kind] || 'Link'}
                    {x.note ? ` · ${x.note}` : ''}
                    {x.addedBy ? ` · added by ${x.addedBy}` : ''}
                  </span>
                </div>
                <div className="pl-actions">
                  <button type="button" className={`btn btn-sm ${open ? 'btn-primary' : 'btn-outline'}`} aria-expanded={open} onClick={() => setPlaying(open ? null : i)}>
                    {open ? 'Close' : '▶ Play'}
                  </button>
                  <a className="btn btn-ghost btn-sm" href={x.url} target="_blank" rel="noopener noreferrer">
                    Open in {p.name || 'app'}
                  </a>
                  {canEdit && (
                    <>
                      <button type="button" className="icon-btn" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" className="icon-btn" aria-label="Move down" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Remove ${x.title || 'this'}`} disabled={busy} onClick={() => (setPlaying(null), save(list.filter((_, j) => j !== i), 'Removed from the playlist'))}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
              {open && x.embed && (
                <div className={`pl-player ${x.height ? '' : 'pl-video'}`} style={x.height ? { height: x.height } : undefined}>
                  <iframe
                    title={`${p.name} player: ${x.title || KIND[x.kind] || ''}`}
                    src={x.embed}
                    allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write; picture-in-picture"
                    // Apple's own embed code sandboxes its player; Spotify and YouTube need their sign-in to play full songs
                    {...(x.provider === 'apple' ? { sandbox: 'allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation' } : {})}
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {canEdit && list.length < 40 && (
        <form className="pl-add" onSubmit={add}>
          <input inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Spotify, Apple Music or YouTube link" placeholder="Paste a Spotify, Apple Music or YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input aria-label="Note" maxLength={300} placeholder="Note (optional), e.g. Special music · Sarah · offertory" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-outline" disabled={busy || !url.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
    </section>
  );
}
