// Bible lookups for service plans.
// Two free sources, both called straight from the browser:
//   bible-api.com            KJV, WEB, ASV, YLT, Darby, BBE, Douay-Rheims
//   bible.helloao.org        Berean Standard Bible, plus 1,000+ more translations
// Copyrighted versions (NIV, ESV, NKJV…) can't be looked up; paste their text instead.

export const LOOKUP_VERSIONS = [
  { label: 'KJV', name: 'King James Version', src: 'bibleapi', id: 'kjv' },
  { label: 'BSB', name: 'Berean Standard Bible', src: 'helloao', id: 'BSB' },
  { label: 'WEB', name: 'World English Bible', src: 'bibleapi', id: 'web' },
  { label: 'ASV', name: 'American Standard Version (1901)', src: 'bibleapi', id: 'asv' },
  { label: 'YLT', name: 'Young’s Literal Translation', src: 'bibleapi', id: 'ylt' },
  { label: 'Darby', name: 'Darby Translation', src: 'bibleapi', id: 'darby' },
  { label: 'BBE', name: 'Bible in Basic English', src: 'bibleapi', id: 'bbe' },
  { label: 'DRA', name: 'Douay-Rheims (1899)', src: 'bibleapi', id: 'dra' },
];

// Common versions that are copyrighted: paste the text from your Bible or app.
export const PASTE_VERSIONS = ['NKJV', 'NIV', 'ESV', 'NLT', 'NASB', 'CSB', 'AMP', 'MSG', 'NRSV', 'CEV'];

const EXTRA_KEY = 'cc.bibleVersions';
export function savedExtraVersions() {
  try {
    const v = JSON.parse(localStorage.getItem(EXTRA_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && x.id && x.label) : [];
  } catch {
    return [];
  }
}
export function rememberVersion(v) {
  try {
    const list = savedExtraVersions().filter((x) => x.id !== v.id);
    localStorage.setItem(EXTRA_KEY, JSON.stringify([{ label: v.label, name: v.name, src: 'helloao', id: v.id }, ...list].slice(0, 12)));
  } catch {
    /* private browsing: it just won't be remembered */
  }
}

// ---------- reference parsing ----------
const BOOKS = [
  ['GEN', 'genesis gen ge gn'], ['EXO', 'exodus exod exo ex'], ['LEV', 'leviticus lev le lv'], ['NUM', 'numbers num nu nm nb'],
  ['DEU', 'deuteronomy deut deu dt'], ['JOS', 'joshua josh jos'], ['JDG', 'judges judg jdg jg'], ['RUT', 'ruth rut ru'],
  ['1SA', '1samuel 1sam 1sa 1sm'], ['2SA', '2samuel 2sam 2sa 2sm'], ['1KI', '1kings 1kgs 1ki 1kg'], ['2KI', '2kings 2kgs 2ki 2kg'],
  ['1CH', '1chronicles 1chron 1chr 1ch'], ['2CH', '2chronicles 2chron 2chr 2ch'], ['EZR', 'ezra ezr'], ['NEH', 'nehemiah neh ne'],
  ['EST', 'esther esth est es'], ['JOB', 'job jb'], ['PSA', 'psalms psalm psa ps pss'], ['PRO', 'proverbs prov pro prv pr'],
  ['ECC', 'ecclesiastes eccles eccl ecc ec qoh'], ['SNG', 'songofsolomon songofsongs song sos sng canticles'], ['ISA', 'isaiah isa is'],
  ['JER', 'jeremiah jer je jr'], ['LAM', 'lamentations lam la'], ['EZK', 'ezekiel ezek eze ezk'], ['DAN', 'daniel dan da dn'],
  ['HOS', 'hosea hos ho'], ['JOL', 'joel joe jl'], ['AMO', 'amos amo am'], ['OBA', 'obadiah obad oba ob'], ['JON', 'jonah jon jnh'],
  ['MIC', 'micah mic mi'], ['NAM', 'nahum nah na'], ['HAB', 'habakkuk hab hb'], ['ZEP', 'zephaniah zeph zep zp'],
  ['HAG', 'haggai hag hg'], ['ZEC', 'zechariah zech zec zc'], ['MAL', 'malachi mal ml'],
  ['MAT', 'matthew matt mat mt'], ['MRK', 'mark mrk mar mk mr'], ['LUK', 'luke luk lk'], ['JHN', 'john jhn joh jn'],
  ['ACT', 'acts act ac'], ['ROM', 'romans rom ro rm'], ['1CO', '1corinthians 1cor 1co'], ['2CO', '2corinthians 2cor 2co'],
  ['GAL', 'galatians gal ga'], ['EPH', 'ephesians eph ephes'], ['PHP', 'philippians phil php pp'], ['COL', 'colossians col co'],
  ['1TH', '1thessalonians 1thess 1thes 1th'], ['2TH', '2thessalonians 2thess 2thes 2th'], ['1TI', '1timothy 1tim 1ti 1tm'],
  ['2TI', '2timothy 2tim 2ti 2tm'], ['TIT', 'titus tit ti'], ['PHM', 'philemon philem phm pm'], ['HEB', 'hebrews heb he'],
  ['JAS', 'james jas jam jm'], ['1PE', '1peter 1pet 1pe 1pt'], ['2PE', '2peter 2pet 2pe 2pt'], ['1JN', '1john 1jn 1jo 1joh'],
  ['2JN', '2john 2jn 2jo 2joh'], ['3JN', '3john 3jn 3jo 3joh'], ['JUD', 'jude jud jd'], ['REV', 'revelation revelations rev re rv apocalypse'],
];
const BOOK_ALIASES = new Map();
for (const [code, names] of BOOKS) for (const n of names.split(' ')) BOOK_ALIASES.set(n, code);
const BOOK_NAMES = Object.fromEntries(BOOKS.map(([code, names]) => [code, names.split(' ')[0]]));

// "1 Cor 13:4-7", "Psalm 23", "John 3:16–4:2", "II Kings 2:11" → { book, c1, v1, c2, v2 }
export function parseReference(ref) {
  const s = String(ref || '').trim().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const m = /^((?:[1-3]|i{1,3})\s*)?([A-Za-z][A-Za-z .]*?)\.?\s+(\d+)(?::(\d+))?(?:\s*-\s*(\d+)(?::(\d+))?)?$/i.exec(s);
  if (!m) return null;
  const num = m[1] ? { i: '1', ii: '2', iii: '3' }[m[1].trim().toLowerCase()] || m[1].trim() : '';
  const key = (num + m[2]).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(\d)of/, '$1');
  const book = BOOK_ALIASES.get(key) || BOOK_ALIASES.get(key.replace(/s$/, ''));
  if (!book) return null;
  const c1 = Number(m[3]);
  const v1 = m[4] ? Number(m[4]) : null;
  let c2 = c1;
  let v2 = v1;
  if (m[5]) {
    if (m[6]) {
      c2 = Number(m[5]);
      v2 = Number(m[6]);
    } else if (v1 !== null) v2 = Number(m[5]);
    else c2 = Number(m[5]); // "Psalm 1-2"
  }
  if (c2 < c1 || (c2 === c1 && v1 !== null && v2 < v1)) return null;
  return { book, c1, v1, c2, v2 };
}

const titleCase = (s) => s.replace(/^(\d)/, '$1 ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
export function formatReference(p) {
  let name = p.book === 'SNG' ? 'Song of Solomon' : titleCase(BOOK_NAMES[p.book]);
  if (p.book === 'PSA' && p.c1 === p.c2) name = 'Psalm';
  if (p.v1 === null) return p.c2 !== p.c1 ? `${name} ${p.c1}-${p.c2}` : `${name} ${p.c1}`;
  if (p.c2 !== p.c1) return `${name} ${p.c1}:${p.v1}-${p.c2}:${p.v2}`;
  return p.v2 !== p.v1 ? `${name} ${p.c1}:${p.v1}-${p.v2}` : `${name} ${p.c1}:${p.v1}`;
}

// ---------- sources ----------
async function fromBibleApi(reference, id) {
  const res = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${id}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.verses) throw new Error(data?.error || 'Couldn’t find that passage. Check the reference, e.g. John 3:16-17.');
  const text = data.verses.map((v) => `${v.verse} ${v.text.replace(/\s+/g, ' ').trim()}`).join(' ');
  return { reference: data.reference, text };
}

// Verse content is a mix of strings and objects: { text }, { noteId }, { lineBreak }, { heading }…
function verseText(content) {
  return (content || [])
    .map((x) => (typeof x === 'string' ? x : x && typeof x.text === 'string' ? x.text : x && x.lineBreak ? ' ' : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?’”)])/g, '$1')
    .trim();
}

async function fromHelloAO(reference, id) {
  const p = parseReference(reference);
  if (!p) throw new Error('Couldn’t read that reference. Try something like John 3:16-17 or Psalm 23.');
  if (p.c2 - p.c1 > 3) throw new Error('That’s a long passage. Look it up a few chapters at a time.');
  const parts = [];
  for (let c = p.c1; c <= p.c2; c++) {
    const res = await fetch(`https://bible.helloao.org/api/${encodeURIComponent(id)}/${p.book}/${c}.json`);
    if (!res.ok) throw new Error(res.status === 404 ? 'This translation doesn’t have that book or chapter.' : 'The Bible service didn’t answer. Try again in a moment.');
    const data = await res.json();
    const verses = (data?.chapter?.content || []).filter((x) => x && x.type === 'verse');
    for (const v of verses) {
      const n = Number(v.number);
      if (c === p.c1 && p.v1 !== null && n < p.v1) continue;
      if (c === p.c2 && p.v2 !== null && n > p.v2) continue;
      const t = verseText(v.content);
      if (t) parts.push(p.c2 !== p.c1 && n === 1 && c !== p.c1 ? `${c}:${n} ${t}` : `${n} ${t}`);
    }
  }
  if (!parts.length) throw new Error('Couldn’t find those verses. Check the chapter and verse numbers.');
  return { reference: formatReference(p), text: parts.join(' ') };
}

export function lookUpBible(reference, version) {
  return version.src === 'helloao' ? fromHelloAO(reference, version.id) : fromBibleApi(reference, version.id);
}

// The full list from bible.helloao.org, for "More translations…".
let catalog = null;
export async function loadCatalog() {
  if (catalog) return catalog;
  const res = await fetch('https://bible.helloao.org/api/available_translations.json');
  if (!res.ok) throw new Error('Couldn’t load the list of translations. Try again in a moment.');
  const data = await res.json();
  catalog = (data?.translations || [])
    .map((t) => ({
      id: t.id,
      label: t.shortName || t.id,
      name: t.englishName || t.name || t.id,
      language: t.languageEnglishName || t.languageName || t.language || '',
    }))
    .filter((t) => t.id);
  return catalog;
}
