// "Who's serving": every team's line-up for one service, with a call and WhatsApp button for each
// person and each team's head leader, so anyone can reach the right person (slides, songs, sound…).
import { useEffect, useState } from 'react';
import { api, firstName, fmtDay, fmtTime, prettyPhone, waLink } from './lib.js';
import { Icon, Modal, useApp } from './ui.jsx';

function Reach({ person, about }) {
  if (!person?.phone) return null;
  const text = `Hi ${firstName(person.name)}, ${about ? `about ${about}: ` : ''}`;
  return (
    <span className="lu-reach">
      <a className="icon-btn icon-btn-sm" href={`tel:+${person.phone}`} aria-label={`Call ${person.name}`} title={`Call ${prettyPhone(person.phone)}`}>
        <Icon name="phone" size={16} />
      </a>
      <a className="icon-btn icon-btn-sm lu-wa" href={waLink(person.phone, text)} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${person.name}`} title="WhatsApp">
        <Icon name="chat" size={16} />
      </a>
    </span>
  );
}

export function Lineup({ eventId, title }) {
  const app = useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setD(null);
    api(`/events/${eventId}/lineup`).then(setD, (e) => setError(e.message));
  }, [eventId]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <p className="muted small">Loading who’s serving…</p>;
  const about = title || `${d.event.title} (${fmtDay(d.event.date)})`;
  if (!d.teams.length) return <p className="muted small">No positions are set for this service yet.</p>;
  return (
    <div className="lu">
      {d.teams.map((t) => (
        <section key={t.key} className="lu-team" aria-label={t.name}>
          <div className="lu-head">
            <h3>{t.name}</h3>
            {t.groupLink && (
              <a className="btn btn-outline btn-sm" href={t.groupLink} target="_blank" rel="noopener noreferrer">
                Team chat
              </a>
            )}
          </div>
          {t.slots.length > 0 ? (
            <ul className="lu-list">
              {t.slots.map((s) => (
                <li key={s.position + (s.shadow ? '+s' : '')} className={s.person ? '' : 'lu-open'}>
                  <span className="lu-pos">
                    {s.label}
                    {s.shadow ? ' (learning)' : ''}
                  </span>
                  <span className="lu-name">
                    {s.person ? (
                      <>
                        {s.person.id === app.me.id ? <strong>You</strong> : s.person.name}
                        {s.confirmed && <span className="lu-ok" title="Confirmed"> ✓</span>}
                      </>
                    ) : (
                      <span className="muted">Open</span>
                    )}
                  </span>
                  {s.person && s.person.id !== app.me.id && <Reach person={s.person} about={about} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Nobody scheduled from this team.</p>
          )}
          {t.leaders.filter((l) => l.id !== app.me.id).length > 0 && (
            <div className="lu-leaders small">
              {t.leaders
                .filter((l) => l.id !== app.me.id)
                .map((l) => (
                  <span key={l.id} className="lu-leader">
                    <span className="muted">Head leader:</span> {l.name}
                    <Reach person={l} about={about} />
                  </span>
                ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

// A button that opens the line-up in a dialog
export function LineupButton({ event, className = 'btn btn-outline btn-sm', label = 'Who’s serving' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Icon name="group" size={16} /> {label}
      </button>
      {open && (
        <Modal title={`Who’s serving · ${event.title}`} onClose={() => setOpen(false)} wide>
          <p className="muted small">
            {fmtDay(event.date)} · {fmtTime(event.start)}. Reach anyone here about songs, slides, sound or anything else for this service.
          </p>
          <Lineup eventId={event.id} />
        </Modal>
      )}
    </>
  );
}
