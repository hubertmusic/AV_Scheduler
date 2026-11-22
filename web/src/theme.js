// Team looks. Each team (AV, Praise, Church Admin…) picks a colour theme, fonts and a text size in
// Team setup; everyone sees that look while they're on that team's side. The API keeps the same
// lists in api/src/lib/theme.js.

// bar: the top bar; accent: active tab, badges, section marks; ground: the page behind the cards;
// headInk: page titles. ink/soft/bright are worked out from accent unless given.
export const PRESETS = {
  console: {
    label: 'Console',
    blurb: 'Navy and signal teal, like the booth at night',
    bar: '#132235',
    accent: '#0d7d8c',
    accentInk: '#075e69',
    accentSoft: '#dcf1f3',
    accentBright: '#3fbfcf',
    ground: '#eef1f5',
    headInk: '#132235',
    head: 'plexcond',
  },
  sanctuary: {
    label: 'Sanctuary',
    blurb: 'Deep plum and candle gold',
    bar: '#35193f',
    accent: '#9a5b07',
    accentInk: '#774504',
    accentSoft: '#f6ead6',
    accentBright: '#e2a640',
    ground: '#f5f2f6',
    headInk: '#35193f',
    head: 'serif',
  },
  boardroom: {
    label: 'Boardroom',
    blurb: 'Forest green, calm and businesslike',
    bar: '#18382e',
    accent: '#1f7a5c',
    accentInk: '#145440',
    accentSoft: '#dcefe6',
    accentBright: '#4cb38a',
    ground: '#f0f3f1',
    headInk: '#18382e',
    head: 'bitter',
  },
  crimson: {
    label: 'Crimson',
    blurb: 'Burgundy with a warm red',
    bar: '#3f1119',
    accent: '#b3262f',
    accentInk: '#8c1d25',
    accentSoft: '#fbe6e7',
    accentBright: '#e5646c',
    ground: '#f6f2f2',
    headInk: '#3f1119',
    head: 'serif',
  },
  classic: {
    label: 'Classic',
    blurb: 'The original charcoal and orange',
    bar: '#17191c',
    accent: '#b8430f',
    accentInk: '#8a3209',
    accentSoft: '#fbe9df',
    accentBright: '#e07a45',
    ground: '#f4f3ef',
    headInk: '#17191c',
    head: 'same',
  },
  contrast: {
    label: 'High contrast',
    blurb: 'Black and white with strong blue, easiest to read',
    bar: '#000000',
    accent: '#0038a8',
    accentInk: '#002a80',
    accentSoft: '#e1e8fb',
    accentBright: '#5b87ff',
    ground: '#ffffff',
    headInk: '#000000',
    head: 'same',
    line: '#8a8f98',
    muted: '#33373d',
  },
};
export const PRESET_KEYS = Object.keys(PRESETS);

// Fonts a team can pick (fonts.js serves them; a browser only downloads the ones in use)
export const FONTS = {
  plex: { label: 'IBM Plex Sans', family: "'IBM Plex Sans'" },
  atkinson: { label: 'Atkinson Hyperlegible (very easy to read)', family: "'Atkinson Hyperlegible'" },
  source: { label: 'Source Sans 3', family: "'Source Sans 3'" },
  lexend: { label: 'Lexend (wide and friendly)', family: "'Lexend'" },
  nunito: { label: 'Nunito Sans (soft and round)', family: "'Nunito Sans'" },
  system: { label: 'This device’s own font', family: '' },
};
export const HEAD_FONTS = {
  same: { label: 'Same as the text', family: '' },
  plexcond: { label: 'IBM Plex Sans Condensed (tall and technical)', family: "'IBM Plex Sans Condensed'" },
  serif: { label: 'Source Serif (classic serif)', family: "'Source Serif 4'" },
  bitter: { label: 'Bitter (sturdy slab serif)', family: "'Bitter'" },
  lexend: { label: 'Lexend (wide and friendly)', family: "'Lexend'" },
};
export const SIZES = [
  [0.94, 'Smaller'],
  [1, 'Normal'],
  [1.1, 'Larger'],
  [1.2, 'Largest'],
];
const SYSTEM = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// ---- colour helpers ----
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
// Darken a colour until white text on it is readable (badges, active marks)
function readableOnWhite(hex) {
  let c = hex;
  for (let i = 0; i < 12 && contrast(c, '#ffffff') < 4.5; i++) c = mix(c, '#000000', 0.12);
  return c;
}

// Everything the page needs for a team's theme: CSS variables and the text size
export function themeTokens(theme = {}) {
  const p = PRESETS[theme.preset] || PRESETS.classic;
  const vars = {};
  let { accent, accentInk, accentSoft, accentBright } = p;
  if (theme.accent) {
    accent = readableOnWhite(theme.accent);
    accentInk = mix(accent, '#000000', 0.25);
    accentSoft = mix(theme.accent, '#ffffff', 0.86);
    accentBright = mix(theme.accent, '#ffffff', 0.25);
  }
  const bar = theme.bar || p.bar;
  const light = lum(bar) > 0.35; // a pale bar gets dark text
  Object.assign(vars, {
    '--accent': accent,
    '--accent-ink': accentInk,
    '--accent-soft': accentSoft,
    '--accent-bright': accentBright,
    '--ground': p.ground,
    '--bar': bar,
    '--bar-ink': light ? '#17191c' : '#ffffff',
    '--bar-sub': light ? mix(bar, '#000000', 0.55) : mix(bar, '#ffffff', 0.68),
    '--bar-raise': light ? mix(bar, '#000000', 0.07) : mix(bar, '#ffffff', 0.09),
    '--bar-line': light ? mix(bar, '#000000', 0.2) : mix(bar, '#ffffff', 0.22),
    '--head-ink': theme.bar && !light ? bar : p.headInk,
    // Main buttons and "selected" marks: the bar colour, or the accent's dark shade on a pale bar
    '--primary': light ? accentInk : bar,
    '--primary-hover': light ? mix(accentInk, '#000000', 0.15) : mix(bar, '#ffffff', 0.12),
  });
  if (p.line) vars['--line'] = p.line;
  if (p.muted) vars['--muted'] = p.muted;
  const font = FONTS[theme.font] || FONTS.plex;
  const head = HEAD_FONTS[theme.head || p.head] || HEAD_FONTS.same;
  vars['--sans'] = font.family ? `${font.family}, ${SYSTEM}` : SYSTEM;
  vars['--head'] = head.family ? `${head.family}, ${vars['--sans']}` : 'var(--sans)';
  return { vars, size: SIZES.some(([n]) => n === theme.size) ? theme.size : 1 };
}

// Put a theme on the page; returns a function that takes it off again
export function applyTheme(theme) {
  const { vars, size } = themeTokens(theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.setProperty('--zoom', String(size));
  root.dataset.preset = theme.preset || 'classic';
  const meta = document.querySelector('meta[name="theme-color"]');
  const before = meta?.getAttribute('content');
  meta?.setAttribute('content', vars['--bar']);
  return () => {
    for (const k of [...Object.keys(vars), '--zoom']) root.style.removeProperty(k);
    delete root.dataset.preset;
    if (meta && before) meta.setAttribute('content', before);
  };
}
