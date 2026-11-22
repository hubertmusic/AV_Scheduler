// Team looks: which presets, fonts and text sizes a team can pick (web/src/theme.js draws them).
// Kept as plain lists here so the API only stores values the app knows how to show.
export const PRESETS = ['console', 'sanctuary', 'boardroom', 'crimson', 'classic', 'contrast'];
export const FONTS = ['plex', 'atkinson', 'source', 'lexend', 'nunito', 'system'];
export const HEAD_FONTS = ['same', 'plexcond', 'serif', 'bitter', 'lexend'];
export const SIZES = [0.94, 1, 1.1, 1.2];
export const HEX = /^#[0-9a-f]{6}$/i;
// Each kind of team starts with its own look
export const DEFAULT_PRESET = { av: 'console', music: 'sanctuary', office: 'boardroom', other: 'classic' };

export const themeView = (t) => {
  const th = t.theme || {};
  return {
    preset: PRESETS.includes(th.preset) ? th.preset : DEFAULT_PRESET[t.kind] || 'classic',
    accent: HEX.test(th.accent || '') ? th.accent.toLowerCase() : '',
    bar: HEX.test(th.bar || '') ? th.bar.toLowerCase() : '',
    font: FONTS.includes(th.font) ? th.font : '',
    head: HEAD_FONTS.includes(th.head) ? th.head : '',
    size: SIZES.includes(th.size) ? th.size : 1,
  };
};

// Check a { preset, accent, bar, font, head, size } from the client; throws a message on bad input
export function readTheme(b, current = {}) {
  if (!b || typeof b !== 'object') throw new Error('Pick a look for the team.');
  const out = { ...current };
  if (b.preset !== undefined) {
    if (!PRESETS.includes(b.preset)) throw new Error('Pick one of the colour themes.');
    out.preset = b.preset;
  }
  for (const k of ['accent', 'bar']) {
    if (b[k] === undefined) continue;
    const v = String(b[k] || '').trim();
    if (v && !HEX.test(v)) throw new Error('Colours look like #1f7a5c.');
    out[k] = v.toLowerCase();
  }
  if (b.font !== undefined) {
    if (b.font && !FONTS.includes(b.font)) throw new Error('Pick one of the fonts.');
    out.font = b.font || '';
  }
  if (b.head !== undefined) {
    if (b.head && !HEAD_FONTS.includes(b.head)) throw new Error('Pick one of the heading fonts.');
    out.head = b.head || '';
  }
  if (b.size !== undefined) {
    const n = Number(b.size);
    if (!SIZES.includes(n)) throw new Error('Pick a text size.');
    out.size = n;
  }
  return out;
}
