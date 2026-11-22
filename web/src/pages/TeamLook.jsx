// Team setup → Look: the team's colour theme, fonts and text size. The head leader or the admin
// picks it; everyone sees it on this team's side of Crew Call. Choices show across the whole app
// straight away as a preview, and are kept for everyone once saved.
import { useEffect, useState } from 'react';
import { api, unsaved } from '../lib.js';
import { useApp } from '../ui.jsx';
import { useSaver } from './Settings.jsx';
import { FONTS, HEAD_FONTS, PRESET_KEYS, PRESETS, SIZES, themeTokens } from '../theme.js';
import './teamLook.css';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clean = (t) => ({ preset: t.preset, accent: t.accent || '', bar: t.bar || '', font: t.font || '', head: t.head || '', size: t.size || 1 });

export default function TeamLook() {
  const app = useApp();
  const { team, previewTheme } = app;
  const saved = clean(team.theme || { preset: 'classic' });
  const [f, setF] = useState(saved);
  const { busy, error, run } = useSaver();
  const dirty = !same(f, saved);
  useEffect(() => {
    previewTheme(dirty ? f : null);
    if (dirty) unsaved.add('team-look');
    else unsaved.delete('team-look');
  }, [f, dirty, previewTheme]);
  // Leaving the page drops the preview
  useEffect(() => () => (previewTheme(null), unsaved.delete('team-look')), [previewTheme]);
  // After a save, start from what's saved
  const savedKey = JSON.stringify(saved);
  useEffect(() => setF(JSON.parse(savedKey)), [savedKey]);

  const p = PRESETS[f.preset] || PRESETS.classic;
  const tokens = themeTokens(f).vars;
  const set = (patch) => setF({ ...f, ...patch });
  const save = () => run(() => api(`/teams/${team.key}`, { method: 'PATCH', body: { theme: f } }), 'Look saved');

  return (
    <section className="card stack" aria-label="Look">
      <h2>Look</h2>
      <p className="muted small">How the {team.name} side of Crew Call looks for everyone on it. Other teams keep their own look. Try things out; nothing changes for anyone else until you save.</p>

      <fieldset className="tl-presets">
        <legend className="label-sm">Colour theme</legend>
        {PRESET_KEYS.map((k) => {
          const x = PRESETS[k];
          return (
            <label key={k} className={`tl-preset${f.preset === k ? ' tl-on' : ''}`}>
              <input type="radio" name="tl-preset" className="sr-only" checked={f.preset === k} onChange={() => set({ preset: k, accent: '', bar: '' })} />
              <span className="tl-swatch" aria-hidden="true" style={{ background: x.ground }}>
                <span style={{ background: x.bar }} />
                <span style={{ background: x.accentBright }} />
                <span style={{ background: x.accent }} />
              </span>
              <span className="tl-name">{x.label}</span>
              <span className="tl-blurb">{x.blurb}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="tl-colors">
        <label className="tl-color">
          <input type="color" value={f.bar || p.bar} onChange={(e) => set({ bar: e.target.value })} />
          <span>
            <span className="label-sm">Top bar</span>
            {f.bar ? (
              <button type="button" className="link-btn small" onClick={() => set({ bar: '' })}>
                Use {p.label}’s
              </button>
            ) : (
              <span className="muted small">{p.label}’s</span>
            )}
          </span>
        </label>
        <label className="tl-color">
          <input type="color" value={f.accent || p.accent} onChange={(e) => set({ accent: e.target.value })} />
          <span>
            <span className="label-sm">Highlight</span>
            {f.accent ? (
              <button type="button" className="link-btn small" onClick={() => set({ accent: '' })}>
                Use {p.label}’s
              </button>
            ) : (
              <span className="muted small">{p.label}’s</span>
            )}
          </span>
        </label>
      </div>
      {f.accent && tokens['--accent'] !== f.accent && <p className="muted small">That highlight is a little pale for white text, so badges and marks use a deeper shade of it.</p>}

      <label className="field">
        <span>Text font</span>
        <select value={f.font || 'plex'} onChange={(e) => set({ font: e.target.value === 'plex' ? '' : e.target.value })}>
          {Object.entries(FONTS).map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Headings font</span>
        <select value={f.head} onChange={(e) => set({ head: e.target.value })}>
          <option value="">{p.label}’s: {HEAD_FONTS[p.head].label.replace(/ \(.*\)$/, '')}</option>
          {Object.entries(HEAD_FONTS).map(([k, x]) => (
            <option key={k} value={k}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <div className="stack-sm">
        <span className="label-sm" id="tl-size">Text size</span>
        <div className="seg" role="group" aria-labelledby="tl-size">
          {SIZES.map(([n, l]) => (
            <button key={n} type="button" aria-pressed={f.size === n} onClick={() => set({ size: n })} style={{ fontSize: `${Math.round(14 * n)}px` }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {dirty && <p className="tl-previewing small">You’re seeing a preview. Save to use this look for everyone on the {team.name}.</p>}
      <div className="row-wrap">
        <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving…' : 'Save look'}
        </button>
        {dirty && (
          <button type="button" className="btn btn-ghost" onClick={() => setF(saved)}>
            Discard
          </button>
        )}
      </div>
    </section>
  );
}
