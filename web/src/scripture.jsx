import { useEffect, useMemo, useState } from 'react';
import { loadCatalog, lookUpBible, LOOKUP_VERSIONS, PASTE_VERSIONS, rememberVersion, savedExtraVersions } from './bible.js';
import { Modal } from './ui.jsx';

// Reference, version, Look up and the text: used on service plans and guest upload pages.
// value: { reference, version, text } — version is the label shown with the text (KJV, BSB, NIV…).
export function BibleFields({ value, onChange, refPlaceholder = 'e.g. John 4:13-14', rows = 4 }) {
  const [extras, setExtras] = useState(savedExtraVersions);
  const [looking, setLooking] = useState(false);
  const [hint, setHint] = useState('');
  const [picking, setPicking] = useState(false);
  const [typing, setTyping] = useState(false);

  const lookupList = useMemo(() => {
    const seen = new Set(LOOKUP_VERSIONS.map((v) => v.label));
    return [...LOOKUP_VERSIONS, ...extras.filter((v) => !seen.has(v.label))];
  }, [extras]);
  const current = lookupList.find((v) => v.label === value.version);
  const isPaste = PASTE_VERSIONS.includes(value.version);
  const custom = !current && !isPaste;

  const set = (patch) => onChange({ ...value, ...patch });
  const choose = (e) => {
    const v = e.target.value;
    setHint('');
    if (v === '__more') return setPicking(true);
    if (v === '__other') {
      setTyping(true);
      return set({ version: '' });
    }
    setTyping(false);
    set({ version: v.slice(2) });
  };

  const lookUp = async () => {
    if (!current) {
      setHint(`${value.version || 'This version'} can’t be looked up automatically${isPaste ? ' (it’s copyrighted)' : ''}. Paste the text below.`);
      return;
    }
    setLooking(true);
    setHint('');
    try {
      const r = await lookUpBible(value.reference, current);
      set({ reference: r.reference, text: r.text });
    } catch (e) {
      setHint(e.message);
    } finally {
      setLooking(false);
    }
  };

  const selectValue = current ? `L:${current.label}` : isPaste ? `P:${value.version}` : '__custom';

  return (
    <>
      <div className="row-wrap fields-3">
        <label className="field field-wide">
          <span>Reference</span>
          <input required value={value.reference} onChange={(e) => set({ reference: e.target.value })} placeholder={refPlaceholder} />
        </label>
        <label className="field">
          <span>Version</span>
          <select value={selectValue} onChange={choose}>
            <optgroup label="Look up automatically">
              {lookupList.map((v) => (
                <option key={v.label} value={`L:${v.label}`}>
                  {v.label} — {v.name}
                </option>
              ))}
              <option value="__more">More translations…</option>
            </optgroup>
            <optgroup label="Paste the text (copyrighted)">
              {PASTE_VERSIONS.map((v) => (
                <option key={v} value={`P:${v}`}>
                  {v}
                </option>
              ))}
              <option value="__other">Another version…</option>
            </optgroup>
            {custom && <option value="__custom">{value.version ? `Other: ${value.version}` : 'Other'}</option>}
          </select>
        </label>
        <button type="button" className="btn btn-outline self-end" onClick={lookUp} disabled={!value.reference || looking || !current} title={current ? `Look up in ${current.name}` : 'Paste this version’s text below'}>
          {looking ? 'Looking up…' : 'Look up'}
        </button>
      </div>
      {(custom || typing) && (
        <label className="field">
          <span>Version name</span>
          <input autoFocus={typing} value={value.version} onChange={(e) => set({ version: e.target.value })} placeholder="e.g. NRSVUE, The Clear Word" />
        </label>
      )}
      <label className="field">
        <span>Text</span>
        <textarea rows={rows} value={value.text} onChange={(e) => set({ text: e.target.value })} placeholder={current ? `Press Look up for the ${current.label} text, or paste it` : 'Paste the text here'} />
      </label>
      {hint && <div className="small danger">{hint}</div>}
      {picking && (
        <TranslationPicker
          onClose={() => setPicking(false)}
          onPick={(t) => {
            rememberVersion(t);
            setExtras(savedExtraVersions());
            setPicking(false);
            setTyping(false);
            set({ version: t.label });
          }}
        />
      )}
    </>
  );
}

function TranslationPicker({ onClose, onPick }) {
  const [all, setAll] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('English');
  useEffect(() => {
    loadCatalog().then(setAll, (e) => setError(e.message));
  }, []);
  const languages = useMemo(() => [...new Set((all || []).map((t) => t.language).filter(Boolean))].sort((a, b) => (a === 'English' ? -1 : b === 'English' ? 1 : a.localeCompare(b))), [all]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (all || [])
      .filter((t) => !lang || t.language === lang)
      .filter((t) => !term || `${t.label} ${t.name} ${t.id}`.toLowerCase().includes(term))
      .slice(0, 80);
  }, [all, q, lang]);

  return (
    <Modal title="More translations" onClose={onClose} wide>
      <div className="stack">
        <p className="muted small">
          From the free Bible service at bible.helloao.org. Most are public domain or free to use, but some carry their own license, so check before projecting a translation you’re unsure of. The ones you pick are remembered on this device.
        </p>
        {error && <div className="error" role="alert">{error}</div>}
        {!all && !error && <div className="loading-inline">Loading translations…</div>}
        {all && (
          <>
            <div className="row-wrap fields-2">
              <label className="field">
                <span>Language</span>
                <select value={lang} onChange={(e) => setLang(e.target.value)}>
                  <option value="">All languages</option>
                  {languages.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Search</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or abbreviation" />
              </label>
            </div>
            {shown.length === 0 && <p className="muted small">No translations match.</p>}
            <ul className="preview-list">
              {shown.map((t) => (
                <li key={t.id}>
                  <button type="button" className="preview-pick" onClick={() => onPick(t)}>
                    <span className="grow col">
                      <strong>{t.label}</strong>
                      <span className="muted small">
                        {t.name}
                        {t.language && t.language !== 'English' ? ` · ${t.language}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
