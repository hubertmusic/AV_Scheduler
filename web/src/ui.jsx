import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { initials, prettyPhone, waLink } from './lib.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const PATHS = {
  chevL: <path d="M15 6l-6 6 6 6" />,
  chevR: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chat: <path d="M4 19l1.5-4A7.5 7.5 0 1 1 9 18.5L4 19z" />,
  cal: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  doc: (
    <>
      <path d="M5 4h10l4 4v12H5z" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  group: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M18 19a5 5 0 0 0-2.5-4.3" />
    </>
  ),
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
};

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Avatar({ name, size = 32, tone = 'dark' }) {
  return (
    <span className={`avatar avatar-${tone}`} style={{ width: size, height: size, flex: `0 0 ${size}px`, fontSize: size < 30 ? 11 : 12 }}>
      {initials(name)}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Tap-to-send WhatsApp: opens WhatsApp with the message filled in; the sender taps Send.
export function WaSheet({ title, text: initialText, recipients = [], groupLink, onClose }) {
  const [text, setText] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked; the textarea is still selectable */
    }
  };
  return (
    <Modal title={title} onClose={onClose} wide>
      <label className="field">
        <span>Message</span>
        <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} className="mono" />
      </label>
      {recipients.length > 0 && (
        <div className="stack-sm">
          <div className="label-sm">Send to each person</div>
          <ul className="wa-list">
            {recipients.map((r) => (
              <li key={(r.link ? 'g' : 'p') + (r.id || r.name)}>
                {r.link ? (
                  <span className="avatar avatar-green" style={{ width: 30, height: 30, flex: '0 0 30px' }} aria-hidden="true">
                    <Icon name="group" size={16} />
                  </span>
                ) : (
                  <Avatar name={r.name} size={30} tone="light" />
                )}
                <span className="grow">
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.sub || (r.link ? 'WhatsApp group chat' : r.phone ? prettyPhone(r.phone) : 'No phone on file')}</span>
                </span>
                {r.link ? (
                  <a className="btn btn-green" href={r.link} target="_blank" rel="noopener noreferrer" onClick={copy}>
                    Copy &amp; open
                  </a>
                ) : r.phone ? (
                  <a className="btn btn-green" href={waLink(r.phone, text)} target="_blank" rel="noopener noreferrer">
                    Open chat
                  </a>
                ) : (
                  <span className="muted small">—</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="row-wrap">
        <a className={`btn ${recipients.length ? 'btn-outline' : 'btn-green'}`} href={waLink('', text)} target="_blank" rel="noopener noreferrer">
          {recipients.length ? 'Share to a group…' : 'Open in WhatsApp'}
        </a>
        {groupLink && (
          <a className="btn btn-outline" href={groupLink} target="_blank" rel="noopener noreferrer" onClick={copy}>
            Copy &amp; open crew group
          </a>
        )}
        <button type="button" className="btn btn-ghost" onClick={copy}>
          {copied ? 'Copied' : 'Copy text'}
        </button>
      </div>
      <p className="muted small">
        WhatsApp opens with this message ready; you tap Send. WhatsApp doesn’t let apps pre-fill a group chat, so “Copy &amp; open” copies the message for you to paste. “Share to a group” lets you pick any chat.
      </p>
    </Modal>
  );
}

// Drag-and-drop (or tap to choose) uploader with a progress bar.
export function DropZone({ onFiles, maxMB = 80, label = 'Drop files here', hint, multiple = true, accept }) {
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const handle = async (list) => {
    const files = [...list];
    if (!files.length) return;
    const tooBig = files.filter((f) => f.size > maxMB * 1024 * 1024);
    if (tooBig.length) {
      setError(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over ${maxMB} MB. AirDrop or email bigger videos instead.`);
      return;
    }
    setError('');
    setProgress(0);
    try {
      await onFiles(files, setProgress);
    } catch (e) {
      setError(e.message);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className={`drop ${over ? 'drop-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (progress === null) handle(e.dataTransfer.files);
      }}
    >
      {progress === null ? (
        <>
          <strong>{label}</strong>
          <span className="muted small">{hint || `Photos, videos, audio, slides, documents — up to ${maxMB} MB each`}</span>
          <label className="btn btn-outline">
            Choose {multiple ? 'files' : 'a file'}
            <input ref={inputRef} type="file" multiple={multiple} accept={accept} className="sr-only" onChange={(e) => handle(e.target.files)} />
          </label>
        </>
      ) : (
        <div className="stack-sm grow-w" role="status">
          <strong>Uploading… {Math.round(progress * 100)}%</strong>
          <div className="meter-track wide">
            <div className="meter-fill" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function StatusChip({ status }) {
  const label = { pending: 'Pending', approved: 'Approved', denied: 'Denied', cancelled: 'Cancelled' }[status] || status;
  return <span className={`chip chip-${status}`}>{label}</span>;
}
