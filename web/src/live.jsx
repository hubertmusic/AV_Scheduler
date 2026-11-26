// Working on a page together: Church Admin meetings and service plans. While the page is open it
// says who else has it open (and what they're editing), reloads when someone changes something, and
// offers the call link. The call itself happens in WhatsApp (or Zoom, Meet…); Crew Call keeps the link.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './lib.js';
import { Avatar, useApp } from './ui.jsx';
import './live.css';

const EVERY = 3000; // check for changes this often while the page is in front

// ---- unsaved edits on the page: a reload waits for them (it would wipe what you typed) ----
const drafts = new Map(); // key → true
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());
const snapshot = () => [...drafts.keys()].join(',');
export function useDraft(key, dirty) {
  useEffect(() => {
    if (dirty) drafts.set(key, true);
    else drafts.delete(key);
    emit();
    return () => {
      drafts.delete(key);
      emit();
    };
  }, [key, dirty]);
}
export function useDrafts() {
  const s = useSyncExternalStore(
    (f) => (listeners.add(f), () => listeners.delete(f)),
    snapshot,
    snapshot
  );
  return s ? s.split(',') : [];
}

// Keeps a page fresh: reports that I'm here (and what I'm editing), and reloads when it changed.
// hold: don't reload now (unsaved edits); `behind` says a change is waiting, and it loads once hold ends.
export function useLive({ url, v, reload, writing = '', hold = false }) {
  const [here, setHere] = useState([]);
  const [behind, setBehind] = useState(false);
  const state = useRef({});
  state.current = { v, writing, hold, reload };
  useEffect(() => {
    if (!url) return;
    let t;
    let live = true;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const s = state.current;
          const r = await api(`${url}${s.writing ? `?writing=${s.writing}` : ''}`, { background: true });
          if (!live) return;
          setHere(r.here);
          // Following along with others (reading, not typing) shouldn't sign you out
          if (r.here.length > 1) window.dispatchEvent(new Event('cc:active'));
          if (r.v !== state.current.v) {
            if (state.current.hold) setBehind(true);
            else {
              setBehind(false);
              await state.current.reload();
            }
          } else setBehind(false);
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
  }, [url]);
  // Edits saved or undone: catch up on what others changed meanwhile
  useEffect(() => {
    if (!hold && behind) {
      setBehind(false);
      reload();
    }
  }, [hold, behind, reload]);
  return { here, behind };
}

const WRITING = {
  minutes: 'writing the minutes',
  agenda: 'editing the agenda',
  motion: 'recording a motion',
  order: 'editing the order of service',
  notes: 'editing the sermon notes',
  songs: 'editing songs',
  announcements: 'editing the announcements',
  scriptures: 'adding Bible texts',
  inputs: 'editing the input list',
};

// Who has the page open right now
export function HereBar({ here, what = 'this page' }) {
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
        {others.length ? `${others.map((p) => p.name.split(' ')[0]).join(', ')} ${others.length === 1 ? 'has' : 'have'} ${what} open with you` : `Only you have ${what} open right now`}
        {busy.map((p) => (
          <span key={p.id} className="lm-busy">
            {' '}
            · {p.name.split(' ')[0]} is {WRITING[p.writing] || 'editing'}
          </span>
        ))}
      </span>
    </div>
  );
}

// Someone else changed the page while you have unsaved edits
export function BehindNote({ onLoad }) {
  return (
    <div className="lm-conflict row-wrap" role="status">
      <span className="grow">Someone else just changed this. Save or undo your edits and their changes appear; or load them now and lose what you haven’t saved.</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onLoad}>
        Load their changes
      </button>
    </div>
  );
}

const hostOf = (link) => {
  try {
    return new URL(link).hostname;
  } catch {
    return '';
  }
};
export const isWhatsApp = (link) => /(^|\.)(whatsapp\.com|wa\.me)$/i.test(hostOf(link));
export const serviceOf = (link) => {
  const h = hostOf(link);
  if (/^call\.whatsapp\.com$/i.test(h)) return 'WhatsApp call';
  if (isWhatsApp(link)) return 'WhatsApp group';
  if (/zoom\.us$/i.test(h)) return 'Zoom';
  if (/meet\.google\.com$/i.test(h)) return 'Google Meet';
  if (/teams\./i.test(h)) return 'Teams';
  if (/facetime/i.test(h)) return 'FaceTime';
  return 'the call';
};

export function CallLinkHelp() {
  return (
    <p className="muted small">
      In WhatsApp, open <strong>Calls</strong>, tap <strong>Create call link</strong>, pick voice or video, and copy the link. Up to 32 people can join from it, and the same link works every time. The WhatsApp group’s invite link, or a Zoom, Google Meet, Teams or FaceTime link, works too.
    </p>
  );
}

// Join the call (opens WhatsApp); whoever can edit sets the link.
// onSave(link) resolves truthy when saved.
export function CallBar({ link, canEdit, onSave, follow = 'the agenda and minutes', addBlurb }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(link || '');
  const save = async (next) => {
    if (await onSave(next)) setEditing(false);
  };
  const group = app.team.groupLink;
  return (
    <section className="lm-call" aria-label="Call">
      {link && !editing ? (
        <div className="row-wrap">
          <a className={`btn ${isWhatsApp(link) ? 'btn-green' : 'btn-primary'} lm-join`} href={link} target="_blank" rel="noopener noreferrer">
            <span aria-hidden="true">📞</span> Join the call
          </a>
          <span className="muted small">
            Opens {serviceOf(link)}. Keep this page open to follow {follow} together.
          </span>
          {canEdit && (
            <button type="button" className="link-btn small" onClick={() => (setValue(link), setEditing(true))}>
              Change link
            </button>
          )}
        </div>
      ) : editing ? (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            save(value.trim());
          }}
        >
          <label className="field">
            <span>Call link</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://call.whatsapp.com/video/…" />
          </label>
          <CallLinkHelp />
          <div className="row-wrap">
            <button type="submit" className="btn btn-primary btn-sm">
              Save link
            </button>
            {link && (
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
          {canEdit && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => (setValue(''), setEditing(true))}>
              <span aria-hidden="true">📞</span> Add a call link
            </button>
          )}
          {app.team.callLink ? (
            <a className="btn btn-ghost btn-sm" href={app.team.callLink} target="_blank" rel="noopener noreferrer">
              Join the {app.team.name} call
            </a>
          ) : (
            group && (
              <a className="btn btn-ghost btn-sm" href={group} target="_blank" rel="noopener noreferrer">
                Open the {app.team.name} WhatsApp group
              </a>
            )
          )}
          {canEdit && addBlurb && <span className="muted small">{addBlurb}</span>}
        </div>
      )}
    </section>
  );
}

// A WhatsApp button for one person: opens your chat with them, where the call buttons are.
// (WhatsApp doesn't let other apps start the call itself.)
export function WhatsAppPerson({ name, phone, className = 'btn btn-ghost btn-sm', label = 'WhatsApp' }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return (
    <a className={className} href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" title={`Opens your WhatsApp chat with ${name}. Tap the phone or video button there to call.`} aria-label={`WhatsApp ${name}`}>
      <WaIcon /> {label}
    </a>
  );
}
export function WaIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3z" />
    </svg>
  );
}
