// A PowerPoint of a service plan: title, song lyrics, Bible texts and the plan's pictures.
// Built for the screen: 16:9, white text on black. ProPresenter, Keynote and
// PowerPoint all open it.
import path from 'node:path';
import pptxgen from 'pptxgenjs';
import { imageSize } from 'image-size';
import { config } from '../config.js';
import { isSectionLabel } from './propresenter.js';

const W = 13.333;
const H = 7.5;
const FONT = 'Arial';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);
const MAX_SCRIPTURE_CHARS = 380;
const MAX_LYRIC_LINES = 6;

const LABEL_CLEAN = /^\s*[[(]?\s*(.*?)\s*[\])]?\s*:?\s*$/;

// Lyrics → slides: a section label starts a new group; blank lines split slides;
// long stanzas are split so nothing runs off the screen.
export function lyricSlides(lyrics) {
  const slides = [];
  let label = '';
  let lines = [];
  const flush = () => {
    for (let i = 0; i < lines.length; i += MAX_LYRIC_LINES) slides.push({ label, lines: lines.slice(i, i + MAX_LYRIC_LINES) });
    lines = [];
  };
  for (const raw of String(lyrics || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (isSectionLabel(line)) {
      flush();
      label = LABEL_CLEAN.exec(line)[1].replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    } else if (!line) {
      flush();
    } else {
      lines.push(line);
    }
  }
  flush();
  return slides;
}

// Long passages → several slides. Breaks between verses ("35 And…"); a single verse
// that is still too long breaks between sentences, then between words.
export function scriptureChunks(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const verses = clean.split(/\s+(?=\d{1,3}\s+\S)/);
  const pieces = [];
  for (const v of verses) {
    if (v.length <= MAX_SCRIPTURE_CHARS) pieces.push(v);
    else pieces.push(...v.split(/(?<=[.;:!?])\s+/));
  }
  const out = [];
  let cur = '';
  for (let p of pieces) {
    while (p.length > MAX_SCRIPTURE_CHARS) {
      const cut = p.lastIndexOf(' ', MAX_SCRIPTURE_CHARS);
      const at = cut > 0 ? cut : MAX_SCRIPTURE_CHARS;
      if (cur) out.push(cur);
      cur = '';
      out.push(p.slice(0, at));
      p = p.slice(at).trim();
    }
    if (cur && (cur + ' ' + p).length > MAX_SCRIPTURE_CHARS) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur} ${p}` : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function fitImage(file) {
  try {
    const { width, height } = imageSize(file);
    if (!width || !height) return null;
    const scale = Math.min(W / width, H / height);
    const w = width * scale;
    const h = height * scale;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  } catch {
    return null;
  }
}

const fmtDate = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

/**
 * @param ev    the event (title, date)
 * @param plan  plan with songs.song populated
 * @param media approved Media docs for the plan
 * @returns {Promise<{buffer: Buffer, skipped: string[]}>}
 */
export async function buildServicePptx(ev, plan, media, orgName = '') {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = `${ev.title} — ${ev.date}`;
  pres.company = orgName || 'Crew Call';
  pres.defineSlideMaster({ title: 'SCREEN', background: { color: '000000' } });
  const skipped = [];

  const slide = () => pres.addSlide({ masterName: 'SCREEN' });
  const label = (s, text) =>
    s.addText(text.toUpperCase(), { x: 0.6, y: 0.35, w: W - 1.2, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: 'A0A0A0', charSpacing: 2, margin: 0 });

  // Title
  const t = slide();
  t.addText(ev.title, { x: 0.8, y: 2.2, w: W - 1.6, h: 1.4, fontFace: FONT, fontSize: 48, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fit: 'shrink' });
  const sub = [plan.sermonTitle, plan.speaker].filter(Boolean).join(' · ');
  if (sub) t.addText(sub, { x: 0.8, y: 3.7, w: W - 1.6, h: 0.8, fontFace: FONT, fontSize: 28, color: 'E0E0E0', align: 'center', valign: 'middle', fit: 'shrink' });
  t.addText(fmtDate(ev.date), { x: 0.8, y: 4.6, w: W - 1.6, h: 0.6, fontFace: FONT, fontSize: 20, color: 'A0A0A0', align: 'center' });
  if (plan.notes) t.addNotes(`Pastor's notes:\n${plan.notes}`);

  // Songs
  for (const x of plan.songs) {
    const song = x.song;
    if (!song) continue;
    const head = slide();
    head.addText(song.title, { x: 0.8, y: 2.6, w: W - 1.6, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fit: 'shrink' });
    const by = [song.artist, song.ccli && `CCLI ${song.ccli}`].filter(Boolean).join(' · ');
    if (by) head.addText(by, { x: 0.8, y: 4.0, w: W - 1.6, h: 0.6, fontFace: FONT, fontSize: 20, color: 'A0A0A0', align: 'center' });
    if (x.key || x.note) head.addNotes([x.key && `Key: ${x.key}`, x.note].filter(Boolean).join('\n'));
    for (const ls of lyricSlides(song.lyrics)) {
      const s = slide();
      if (ls.label) label(s, ls.label);
      s.addText(ls.lines.join('\n'), { x: 0.6, y: 1.0, w: W - 1.2, h: H - 1.9, fontFace: FONT, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fit: 'shrink', lineSpacingMultiple: 1.1 });
      s.addText(song.title, { x: 0.6, y: H - 0.7, w: W - 1.2, h: 0.4, fontFace: FONT, fontSize: 12, color: '707070', align: 'left', margin: 0 });
    }
  }

  // Bible texts
  for (const sc of plan.scriptures) {
    const ref = `${sc.reference}${sc.version ? ` (${sc.version})` : ''}`;
    const chunks = scriptureChunks(sc.text);
    if (!chunks.length) {
      const s = slide();
      s.addText(ref, { x: 0.8, y: 2.6, w: W - 1.6, h: 1.6, fontFace: FONT, fontSize: 48, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fit: 'shrink' });
      continue;
    }
    chunks.forEach((c, i) => {
      const s = slide();
      label(s, chunks.length > 1 ? `${ref} · ${i + 1}/${chunks.length}` : ref);
      s.addText(c, { x: 0.8, y: 1.0, w: W - 1.6, h: H - 1.6, fontFace: 'Georgia', fontSize: 34, color: 'FFFFFF', align: 'center', valign: 'middle', fit: 'shrink', lineSpacingMultiple: 1.15 });
    });
  }

  // Pictures (sermon slides, announcements, graphics). Videos and documents stay as files.
  for (const m of media) {
    const name = m.title || m.originalName;
    if (!IMAGE_TYPES.has(m.mime)) {
      skipped.push(name);
      continue;
    }
    const file = path.join(config.uploadDir, m.storedName);
    const box = fitImage(file);
    if (!box) {
      skipped.push(name);
      continue;
    }
    const s = slide();
    s.addImage({ path: file, ...box });
    s.addNotes(name);
  }

  const buffer = await pres.write({ outputType: 'nodebuffer' });
  return { buffer, skipped };
}
