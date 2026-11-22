// Order of service, and the two things made from it:
//  - the rundown: the order with times, who and cues, for speakers, worship leaders and the AV team
//  - the bulletin: the order without times or cues, plus sermon, Bible texts, songs and announcements,
//    for the congregation
// Both open from a private link (and its QR code) without signing in.
import { Assignment, Media, ORDER_KINDS, Position, Team } from '../models.js';
import { isHttpUrl, normalizeUrl, str } from './util.js';
import { baseOf, isShadow } from './availability.js';

const MAX_ITEMS = 80;
const MAX_LINKS = 6;
const MAX_FILES = 10;
// Cue boxes for each crew, in the order they're shown
export const CREWS = [
  ['audio', 'Audio'],
  ['slides', 'Slides & ProPresenter'],
  ['lights', 'Lights'],
  ['camera', 'Camera & stream'],
];

// The video id of a YouTube link (watch, youtu.be, shorts, live, embed), or ''
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

function readLinks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_LINKS)
    .map((l) => ({ url: normalizeUrl(str(l?.url, 500)), title: str(l?.title, 120) }))
    .filter((l) => isHttpUrl(l.url));
}

// media: the ids of files in this service that items may point to (left out: none, e.g. templates)
export function readOrder(list, { media = null } = {}) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, MAX_ITEMS)
    .map((x) => {
      const kind = ORDER_KINDS.includes(x?.kind) ? x.kind : 'item';
      const minutes = Math.round(Number(x?.minutes));
      return {
        kind,
        title: str(x?.title, 160),
        who: kind === 'heading' ? '' : str(x?.who, 80),
        minutes: kind === 'heading' || !Number.isFinite(minutes) ? 0 : Math.min(300, Math.max(0, minutes)),
        notes: kind === 'heading' ? '' : str(x?.notes, 2000),
        cues: Object.fromEntries(CREWS.map(([k]) => [k, kind === 'heading' ? '' : str(x?.cues?.[k], 1000)])),
        bulletinNote: kind === 'heading' ? '' : str(x?.bulletinNote, 300),
        links: kind === 'heading' ? [] : readLinks(x?.links),
        media: kind === 'heading' || !media || !Array.isArray(x?.media) ? [] : [...new Set(x.media.map(String))].filter((id) => media.has(id)).slice(0, MAX_FILES),
        bulletin: x?.bulletin !== false,
      };
    })
    .filter((x) => x.title);
}

export const orderView = (order = []) =>
  order.map((x) => ({
    id: String(x._id),
    kind: x.kind,
    title: x.title,
    who: x.who,
    minutes: x.minutes || 0,
    notes: x.notes,
    cues: Object.fromEntries(CREWS.map(([k]) => [k, x.cues?.[k] || ''])),
    bulletinNote: x.bulletinNote || '',
    links: (x.links || []).map((l) => ({ url: l.url, title: l.title || '', youtube: youtubeId(l.url) })),
    media: (x.media || []).map(String),
    bulletin: x.bulletin !== false,
  }));

// The order for people outside the editor (rundown, run sheet): files named, not linked by id
export async function orderWithFiles(order = []) {
  const view = orderView(order);
  const ids = [...new Set(view.flatMap((x) => x.media))];
  const names = Object.fromEntries((ids.length ? await Media.find({ _id: { $in: ids }, purgedAt: null }, { originalName: 1, title: 1 }).lean() : []).map((m) => [String(m._id), m.title || m.originalName]));
  return view.map(({ id, media, ...x }) => ({ ...x, files: media.map((m) => names[m]).filter(Boolean) }));
}

// Who's serving, by position (names only: the rundown link can reach guest speakers)
// Everyone serving, every team, grouped by team in the team order
async function crewNames(ev) {
  const [positions, asg, teams] = await Promise.all([Position.find({}).sort({ order: 1 }).lean(), Assignment.find({ event: ev._id }).populate('user', 'name'), Team.find({}).sort({ order: 1, name: 1 }).lean()]);
  const label = Object.fromEntries(positions.map((p) => [p.key, p.label]));
  const teamOf = Object.fromEntries(positions.map((p) => [p.key, p.team || 'av']));
  const rank = Object.fromEntries(teams.map((t, i) => [t.key, i]));
  const teamName = Object.fromEntries(teams.map((t) => [t.key, t.name]));
  const needs = [...(ev.needs || [])].sort((x, y) => (rank[teamOf[x]] ?? 99) - (rank[teamOf[y]] ?? 99));
  return needs
    .flatMap((pos) => [pos, `${pos}+shadow`])
    .map((slot) => {
      const a = asg.find((y) => y.position === slot);
      if (isShadow(slot) && !a?.user) return null;
      const t = teamOf[baseOf(slot)] || 'av';
      return { team: teamName[t] || 'AV Team', position: label[baseOf(slot)] || baseOf(slot), shadow: isShadow(slot), name: a?.user?.name || '' };
    })
    .filter(Boolean);
}

const eventPart = (ev) => ({ title: ev.title, date: ev.date, call: ev.call, start: ev.start, end: ev.end });

export async function rundownData(plan, ev, orgName) {
  await plan.populate('songs.song', 'title artist');
  return {
    kind: 'rundown',
    orgName,
    event: eventPart(ev),
    order: await orderWithFiles(plan.order),
    crews: Object.fromEntries(CREWS),
    sermonTitle: plan.sermonTitle,
    speaker: plan.speaker,
    scriptures: plan.scriptures.map((x) => ({ reference: x.reference, version: x.version, text: x.text })),
    songs: plan.songs.filter((x) => x.song).map((x) => ({ title: x.song.title, artist: x.song.artist, key: x.key, note: x.note })),
    playlist: (plan.playlist || []).map((x) => ({ title: x.title, note: x.note || '', url: x.url })),
    crew: await crewNames(ev),
  };
}

export async function bulletinData(plan, ev, orgName) {
  await plan.populate('songs.song', 'title artist');
  const order = plan.order.filter((x) => x.bulletin !== false).map((x) => ({ kind: x.kind, title: x.title, who: x.who, note: x.bulletinNote || '' }));
  return {
    kind: 'bulletin',
    orgName,
    event: { title: ev.title, date: ev.date, start: ev.start },
    order,
    sermonTitle: plan.sermonTitle,
    speaker: plan.speaker,
    scriptures: plan.scriptures.map((x) => ({ reference: x.reference, version: x.version })),
    // Songs whose title is already a line in the order aren't listed twice
    songs: plan.songs
      .filter((x) => x.song && !order.some((o) => o.title.toLowerCase().includes(x.song.title.toLowerCase())))
      .map((x) => ({ title: x.song.title, artist: x.song.artist })),
    announcements: plan.announcements,
  };
}
