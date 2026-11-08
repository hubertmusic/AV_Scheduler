// Order of service, and the two things made from it:
//  - the rundown: the order with times, who and cues, for speakers, worship leaders and the AV team
//  - the bulletin: the order without times or cues, plus sermon, Bible texts, songs and announcements,
//    for the congregation
// Both open from a private link (and its QR code) without signing in.
import { Assignment, ORDER_KINDS, Position } from '../models.js';
import { str } from './util.js';
import { baseOf, isShadow } from './availability.js';

const MAX_ITEMS = 80;

export function readOrder(list) {
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
        notes: kind === 'heading' ? '' : str(x?.notes, 500),
        bulletin: x?.bulletin !== false,
      };
    })
    .filter((x) => x.title);
}

export const orderView = (order = []) =>
  order.map((x) => ({ id: String(x._id), kind: x.kind, title: x.title, who: x.who, minutes: x.minutes || 0, notes: x.notes, bulletin: x.bulletin !== false }));

// Who's serving, by position (names only: the rundown link can reach guest speakers)
async function crewNames(ev) {
  const [positions, asg] = await Promise.all([Position.find({}).sort({ order: 1 }).lean(), Assignment.find({ event: ev._id }).populate('user', 'name')]);
  const label = Object.fromEntries(positions.map((p) => [p.key, p.label]));
  return (ev.needs || [])
    .flatMap((pos) => [pos, `${pos}+shadow`])
    .map((slot) => {
      const a = asg.find((y) => y.position === slot);
      if (isShadow(slot) && !a?.user) return null;
      return { position: label[baseOf(slot)] || baseOf(slot), shadow: isShadow(slot), name: a?.user?.name || '' };
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
    order: orderView(plan.order).map(({ id, ...x }) => x),
    sermonTitle: plan.sermonTitle,
    speaker: plan.speaker,
    scriptures: plan.scriptures.map((x) => ({ reference: x.reference, version: x.version, text: x.text })),
    songs: plan.songs.filter((x) => x.song).map((x) => ({ title: x.song.title, artist: x.song.artist, key: x.key, note: x.note })),
    crew: await crewNames(ev),
  };
}

export async function bulletinData(plan, ev, orgName) {
  await plan.populate('songs.song', 'title artist');
  const order = plan.order.filter((x) => x.bulletin !== false).map((x) => ({ kind: x.kind, title: x.title, who: x.who }));
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
