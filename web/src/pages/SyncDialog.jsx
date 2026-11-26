import { useState } from 'react';
import { fmtDay } from '../lib.js';
import { Modal } from '../ui.jsx';

// "Sync with template": choose which services to update and which to take off this weekend.
export default function SyncDialog({ differs, extra, onClose }) {
  const [upd, setUpd] = useState(() => new Set(differs.map((d) => d.id)));
  // Pre-tick removals that are safe or clearly wanted: turned off in the template, or no one placed yet.
  const [rem, setRem] = useState(() => new Set(extra.filter((e) => e.turnedOff || !e.placed).map((e) => e.id)));
  const flip = (set, setter, id) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };
  const day = (d) => fmtDay(d).split(',')[0];
  const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

  return (
    <Modal title="Sync with template" onClose={() => onClose(null)} wide>
      <div className="stack">
        {extra.length > 0 && (
          <fieldset className="fieldset stack-sm">
            <legend>Not in your template</legend>
            <p className="muted small">These are on this weekend but have been removed or turned off in the template. Ticked ones come off this weekend, with their crew, plan and requests.</p>
            {extra.map((e) => (
              <label key={e.id} className="sync-row">
                <input type="checkbox" checked={rem.has(e.id)} onChange={() => flip(rem, setRem, e.id)} />
                <span className="grow col">
                  <strong>
                    {e.title} · {day(e.date)}
                  </strong>
                  <span className="muted small">
                    {e.kind === 'soundcheck' ? 'Sound check · ' : ''}
                    {e.turnedOff ? 'Turned off in the template' : 'Not in the template'}
                    {e.placed ? '' : ' · no one placed yet'}
                  </span>
                  {e.placed > 0 && <span className="small danger">{people(e.placed)} placed will be taken off</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {differs.length > 0 && (
          <fieldset className="fieldset stack-sm">
            <legend>Changed in your template</legend>
            <p className="muted small">Ticked ones are updated to match the template.</p>
            {differs.map((d) => (
              <label key={d.id} className="sync-row">
                <input type="checkbox" checked={upd.has(d.id)} onChange={() => flip(upd, setUpd, d.id)} />
                <span className="grow col">
                  <strong>
                    {d.title} · {day(d.date)}
                  </strong>
                  <span className="muted small">{d.changed.join(', ')} changed</span>
                  {d.placedOnDropped > 0 && <span className="small danger">{people(d.placedOnDropped)} on removed positions will be taken off</span>}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="row-wrap">
          <button type="button" className="btn btn-primary" onClick={() => onClose({ syncIds: [...upd], remove: [...rem] })} disabled={!upd.size && !rem.size}>
            {rem.size && upd.size ? `Remove ${rem.size} and update ${upd.size}` : rem.size ? `Remove ${rem.size} from this weekend` : upd.size ? `Update ${upd.size}` : 'Nothing selected'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(null)}>
            Leave as is
          </button>
        </div>
      </div>
    </Modal>
  );
}
