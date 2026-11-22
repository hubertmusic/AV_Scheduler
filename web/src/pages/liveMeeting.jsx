// The live meeting page: while a meeting is open, everyone on it sees who else is here, which agenda
// item is being discussed, and the minutes, motions and action items as they're written. The call
// itself happens in WhatsApp (or Zoom, Meet…): the meeting keeps a call link people tap to join.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib.js';
import { Avatar, useApp } from '../ui.jsx';
import './liveMeeting.css';

const EVERY = 3000; // check for changes this often while the page is in front

// Keeps a meeting fresh: reports that I'm here (and what I'm writing), and reloads when it changed
export function useLive(m, reload, writing) {
  const [here, setHere] = useState([]);
  const v = useRef(m?.v);
  v.current = m?.v;
  const w = useRef(writing);
  w.current = writing;
  useEffect(() => {
    if (!m?.id) return;
    let t;
    let live = true;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await api(`/office/events/${m.id}/live${w.current ? `?writing=${w.current}` : ''}`, { background: true });
          if (!live) return;
          setHere(r.here);
          // Following a meeting with others (reading, not typing) shouldn't sign you out
          if (r.here.length > 1) window.dispatchEvent(new Event('cc:active'));
          if (r.v !== v.current) await reload();
        } catch {
          /* try again next time */
        }
      }
      if (live) t = setTimeout(tick, EVERY);
    };
    tick();
    const wake = () => {
      clearTimeout(t);
      tick();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      live = false;
      clearTimeout(t);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [m?.id, reload]);
  return here;
}

const WRITING = { minutes: 'writing the minutes', agenda: 'editing the agenda', motion: 'recording a motion' };

// Who has the meeting open right now
export function HereBar({ here }) {
  const { me } = useApp();
  if (!here.length) return null;
  const others = here.filter((p) => p.id !== me.id);
  const busy = others.filter((p) => p.writing);
  return (
    <div className="lm-here" role="status" aria-live="polite">
      <span className="lm-live">
        <span className="lm-dot" aria-hidden="true" /> Live
      </span>
      <span className="lm-faces" aria-hidden="true">
        {here.slice(0, 8).map((p) => (
          <span key={p.id} className="lm-face" title={p.id === me.id ? 'You' : p.name}>
            <Avatar name={p.name} size={28} tone={p.id === me.id ? 'accent' : 'light'} />
          </span>
        ))}
      </span>
      <span className="small">
        {others.length ? `${others.map((p) => p.name.split(' ')[0]).join(', ')} ${others.length === 1 ? 'has' : 'have'} this meeting open with you` : 'Only you have this meeting open right now'}
        {busy.map((p) => (
          <span key={p.id} className="lm-busy">
            {' '}
            · {p.name.split(' ')[0]} is {WRITING[p.writing]}
          </span>
        ))}
      </span>
    </div>
  );
}

const isWhatsApp = (link) => /(^|\.)(whatsapp\.com|wa\.me)$/i.test(hostOf(link));
const hostOf = (link) => {
  try {
    return new URL(link).hostname;
  } catch {
    return '';
  }
};
const serviceOf = (link) => {
  const h = hostOf(link);
  if (/call\.whatsapp\.com/i.test(h) || /whatsapp\.com\/call/i.test(link)) return 'WhatsApp call';
  if (isWhatsApp(link)) return 'WhatsApp group';
  if (/zoom\.us$/i.test(h)) return 'Zoom';
  if (/meet\.google\.com$/i.test(h)) return 'Google Meet';
  if (/teams\./i.test(h)) return 'Teams';
  if (/facetime/i.test(h)) return 'FaceTime';
  return 'the call';
};

// Join the call (opens WhatsApp), and for whoever plans the meeting, set the link
export function CallBar({ m, act }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState(m.callLink || '');
  const save = async (value) => {
    const out = await act(() => api(`/office/events/${m.id}/call`, { method: 'PUT', body: { link: value } }), value ? 'Call link saved' : 'Call link removed');
    if (out) setEditing(false);
  };
  const group = app.team.groupLink;
  return (
    <section className="lm-call" aria-label="Call">
      {m.callLink && !editing ? (
        <div className="row-wrap">
          <a className={`btn ${isWhatsApp(m.callLink) ? 'btn-green' : 'btn-primary'} lm-join`} href={m.callLink} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">📞</span> Join the call
          </a>
          <span className="muted small">
            Opens {serviceOf(m.callLink)}. Keep this page open to follow the agenda and minutes together.
          </span>
          {m.canAgenda && (
            <button type="button" className="link-btn small" onClick={() => (setLink(m.callLink), setEditing(true))}>
              Change link
            </button>
          )}
        </div>
      ) : editing ? (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save(link.trim());
          }}
        >
          <label className="field">
            <span>Call link</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://call.whatsapp.com/video/…" />
          </label>
          <p className="muted small">
            In WhatsApp, open <strong>Calls</strong>, tap <strong>Create call link</strong>, pick voice or video, and copy the link. Up to 32 people can join from it. The church WhatsApp group’s invite link, or a Zoom, Google Meet, Teams or FaceTime link, works too.
          </p>
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary btn-sm">
              Save link
            </button>
            {m.callLink && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => save('')}>
                Remove it
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="row-wrap">
          {m.canAgenda && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => (setLink(''), setEditing(true))}>
              <span aria-hidden="true">📞</span> Add a call link
            </button>
          )}
          {group && (
            <a className="btn btn-ghost btn-sm" href={group} target="_blank" rel="noopener noreferrer">
              Open the {app.team.name} WhatsApp group
            </a>
          )}
          <span className="muted small">{m.canAgenda ? 'Meeting by phone or video? Add a WhatsApp call link and everyone gets a Join button here and in the agenda.' : 'No call link for this meeting.'}</span>
        </div>
      )}
    </section>
  );
}
