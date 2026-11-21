// The playlist on a service plan (beta): songs and playlists from Spotify, Apple Music and YouTube,
// played in each service's own embedded player. A player's address is always built from the parts
// we recognise in the link, never from the pasted link itself.
import { str } from './util.js';

const MAX = 40;

// { provider, kind, embed, height } for a link we can play, or null
export function playable(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim().replace(/^(?!https?:\/\/)/i, 'https://'));
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  // Spotify: open.spotify.com/(intl-xx/)track|album|playlist|episode|show|artist/ID
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{22})/);
    if (!m) return null;
    const small = m[1] === 'track' || m[1] === 'episode';
    return { provider: 'spotify', kind: m[1], url: `https://open.spotify.com/${m[1]}/${m[2]}`, embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: small ? 152 : 352 };
  }
  // Apple Music: music.apple.com/us/album|playlist|song|music-video/name/id(?i=track)
  if (host === 'music.apple.com') {
    const m = u.pathname.match(/^\/([a-z]{2})\/(album|playlist|song|music-video)\/([^/?#]{0,200}\/)?((?:pl\.)?[A-Za-z0-9.-]{1,80})\/?$/);
    if (!m) return null;
    const track = /^\d{1,15}$/.test(u.searchParams.get('i') || '') ? u.searchParams.get('i') : '';
    let slug = '';
    try {
      slug = m[3] ? `${encodeURIComponent(decodeURIComponent(m[3].slice(0, -1)))}/` : '';
    } catch {
      slug = ''; // a broken %-escape: the name part isn't needed to play it
    }
    const path = `/${m[1]}/${m[2]}/${slug}${m[4]}`;
    const single = m[2] === 'song' || !!track;
    return { provider: 'apple', kind: single ? 'song' : m[2], url: `https://music.apple.com${path}${track ? `?i=${track}` : ''}`, embed: `https://embed.music.apple.com${path}${track ? `?i=${track}` : ''}`, height: m[2] === 'music-video' ? 360 : single ? 175 : 450 };
  }
  // YouTube and YouTube Music: a video, or a playlist
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const list = u.searchParams.get('list') || '';
    let id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.searchParams.get('v') || (u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/) || [])[2] || '';
    if (!/^[\w-]{11}$/.test(id)) id = '';
    if (id) return { provider: 'youtube', kind: 'video', url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}`, height: 0 };
    if (/^[\w-]{10,64}$/.test(list)) return { provider: 'youtube', kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}`, embed: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`, height: 0 };
    return null;
  }
  return null;
}

export function readPlaylist(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX)
    .map((x) => {
      const p = playable(x?.url);
      return p ? { url: p.url, title: str(x?.title, 160), note: str(x?.note, 300), addedBy: str(x?.addedBy, 80) } : null;
    })
    .filter(Boolean);
}

export const playlistView = (list = []) =>
  list.map((x) => {
    const p = playable(x.url) || {};
    return { url: x.url, title: x.title, note: x.note || '', addedBy: x.addedBy || '', provider: p.provider, kind: p.kind, embed: p.embed, height: p.height };
  });

// A title for a pasted link, from the service's public oEmbed (Spotify, YouTube); '' if not found
export async function lookupTitle(url) {
  const p = playable(url);
  if (!p) return '';
  const endpoint = { spotify: 'https://open.spotify.com/oembed?url=', youtube: 'https://www.youtube.com/oembed?format=json&url=' }[p.provider];
  if (!endpoint) return '';
  try {
    const r = await fetch(endpoint + encodeURIComponent(p.url), { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return '';
    const d = await r.json();
    return str(d.title, 160);
  } catch {
    return '';
  }
}
