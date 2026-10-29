import { useMemo, useState } from 'react';
import { roleLabel } from '../lib.js';
import { Avatar, Modal } from '../ui.jsx';

// Admin only: see the app exactly as one person sees it. Nothing is saved while previewing.

export function PreviewBanner({ me, onSwitch, onExit }) {
  return (
    <div className="preview-banner" role="status">
      <span className="preview-dot" aria-hidden="true" />
      <span className="grow">
        Viewing as <strong>{me.name}</strong> · {roleLabel(me)}
        <span className="preview-sub">This is exactly what they see. Nothing you do here is saved.</span>
      </span>
      <button type="button" className="btn btn-sm btn-ghost-light" onClick={onSwitch}>
        Switch person
      </button>
      <button type="button" className="btn btn-sm btn-light" onClick={onExit}>
        Exit preview
      </button>
    </div>
  );
}

export function PreviewPicker({ roster, current, onClose, onPick }) {
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = roster
      .filter((p) => p.role !== 'admin')
      .filter((p) => !term || p.name.toLowerCase().includes(term) || (p.email || '').toLowerCase().includes(term));
    return [
      { title: 'Team leaders', people: list.filter((p) => p.role === 'leader') },
      { title: 'Crew', people: list.filter((p) => p.role !== 'leader') },
    ].filter((g) => g.people.length);
  }, [roster, q]);

  return (
    <Modal title="View as…" onClose={onClose}>
      <div className="stack">
        <p className="muted small">Pick someone to see Crew Call exactly as they see it: their tabs, their shifts and what they’re allowed to do. You can look around, but nothing is saved.</p>
        <label className="field">
          <span>Find a person</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
        </label>
        {groups.length === 0 && <p className="muted small">{roster.length > 1 ? 'No one matches that.' : 'Add people on Team & roles first.'}</p>}
        {groups.map((g) => (
          <div key={g.title} className="stack-xs">
            <div className="label-sm">{g.title}</div>
            <ul className="preview-list">
              {g.people.map((p) => (
                <li key={p.id}>
                  <button type="button" className="preview-pick" onClick={() => onPick({ id: p.id, name: p.name })} aria-current={current?.id === p.id || undefined}>
                    <Avatar name={p.name} size={32} />
                    <span className="grow col">
                      <strong>{p.name}</strong>
                      <span className="muted small">
                        {roleLabel(p)}
                        {!p.active ? ' · turned off' : ''}
                      </span>
                    </span>
                    {current?.id === p.id && <span className="chip">Viewing</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
