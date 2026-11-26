// Chat dock: who's online and your chats in the bottom-right corner, with chat windows that open
// beside it (full screen on a phone), the way Facebook chat used to work.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib.js';
import { Avatar, Modal, useApp } from './ui.jsx';
import './chat.css';
import { WaIcon } from './live.jsx';

const EMOJI = ['🎚️', '🎤', '🎹', '🎸', '🥁', '📽️', '💡', '🎥', '🎶', '🙏', '⛪', '📣', '☕', '🎄', '⭐', '❤️'];
const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'];
const FAST = 4000; // check-in while Crew Call is in front
const SLOW = 25000; // …and while it's in a background tab
const MAX_WINDOWS = 3;
const PANEL_W = 350; // the list of chats, with its gap
const WIN_W = 330; // one chat window, with its gap
const BAR_W = 150; // the Chat button they line up beside

// The window's width, kept up to date when an iPad turns or a window is resized
function useViewportWidth() {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return w;
}

const ago = (at) => {
  if (!at) return '';
  const s = (Date.now() - new Date(at)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const lastSeenText = (p) => (p.status === 'online' ? 'Online' : p.status === 'away' ? 'Away' : p.lastSeen ? `Last seen ${ago(p.lastSeen)}${ago(p.lastSeen) === 'now' ? '' : ' ago'}` : 'Not on Crew Call yet');
const timeOf = (at) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// Links in a message become tappable; everything else stays plain text
function Linked({ text }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer">
        {p}
      </a>
    ) : (
      p
    )
  );
}

function RoomIcon({ room, people, size = 36 }) {
  if (room.kind === 'direct') {
    const p = people.find((x) => x.id === room.with);
    return (
      <span className="ch-av" style={{ width: size, height: size }}>
        <Avatar name={room.name} size={size} />
        {p && <span className={`ch-dot ch-${p.status}`} aria-label={lastSeenText(p)} />}
      </span>
    );
  }
  return (
    <span className={`ch-room-ic ch-c-${room.color || 'blue'}`} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {room.emoji || (room.kind === 'team' ? '👥' : room.name.slice(0, 1).toUpperCase())}
    </span>
  );
}

export function ChatDock() {
  const app = useApp();
  const [data, setData] = useState(null);
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('chats');
  const [q, setQ] = useState('');
  const [wins, setWins] = useState([]); // [{ id, min }]
  const [msgs, setMsgs] = useState({}); // roomId → { list, more, loaded }
  const [modal, setModal] = useState(null); // { kind: 'new' } | { kind: 'edit', room }
  const [showArchived, setShowArchived] = useState(false);
  const since = useRef(null);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const vw = useViewportWidth();
  const phone = vw <= 640;
  // As many chat windows as fit beside the list (an iPad in portrait has room for one)
  const roomFor = (withPanel) => Math.floor((vw - 32 - BAR_W - (withPanel ? PANEL_W : 0)) / WIN_W);
  const fit = phone ? 1 : Math.max(panel ? 0 : 1, Math.min(MAX_WINDOWS, roomFor(panel)));
  const tight = !phone && roomFor(true) < 1; // an iPad in portrait: a chat and the list don't fit side by side
  // Esc closes the list of chats
  useEffect(() => {
    if (!panel) return undefined;
    const esc = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.backdrop [role="dialog"]')) setPanel(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [panel]);
  // On a phone the chat fills the screen; keep the page behind it from scrolling
  const fullScreen = phone && (panel || wins.some((w) => !w.min));
  useEffect(() => {
    document.documentElement.classList.toggle('ch-lock', fullScreen);
    return () => document.documentElement.classList.remove('ch-lock');
  }, [fullScreen]);

  const merge = useCallback((roomId, list, prepend = false) => {
    setMsgs((m) => {
      const cur = m[roomId]?.list || [];
      const by = new Map(cur.map((x) => [x.id, x]));
      for (const x of list) by.set(x.id, x);
      const all = [...by.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
      return { ...m, [roomId]: { ...(m[roomId] || {}), list: all, more: prepend ? m[roomId]?.more : m[roomId]?.more } };
    });
  }, []);

  // The regular check-in: who's online, my rooms, and new messages in open windows
  const sync = useCallback(async () => {
    const open = winsRef.current.map((w) => w.id).join(',');
    const away = document.hidden ? '1' : '0';
    try {
      const d = await api(`/chat/sync?away=${away}${open ? `&open=${open}` : ''}${since.current ? `&since=${encodeURIComponent(since.current)}` : ''}`, { background: true });
      since.current = d.now;
      setData(d);
      const byRoom = {};
      for (const m of d.messages) (byRoom[m.room] ||= []).push(m);
      for (const [r, list] of Object.entries(byRoom)) merge(r, list);
    } catch {
      /* offline for a moment: try again next time */
    }
  }, [merge]);
  useEffect(() => {
    let t;
    let live = true;
    const loop = async () => {
      await sync();
      if (live) t = setTimeout(loop, document.hidden ? SLOW : FAST);
    };
    loop();
    const wake = () => {
      clearTimeout(t);
      loop();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      live = false;
      clearTimeout(t);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [sync]);

  const unread = (data?.rooms || []).filter((r) => !r.archived).reduce((n, r) => n + r.unread, 0);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '');
    document.title = unread ? `(${unread > 9 ? '9+' : unread}) ${base}` : base;
  }, [unread]);

  const openRoom = useCallback(
    async (id) => {
      setWins((w) => {
        const rest = w.filter((x) => x.id !== id);
        return [...rest, { id, min: false }].slice(phone ? -1 : -MAX_WINDOWS);
      });
      if (phone || tight) setPanel(false);
      if (!msgs[id]?.loaded) {
        try {
          const r = await api(`/chat/rooms/${id}/messages`);
          setMsgs((m) => ({ ...m, [id]: { list: r.messages, more: r.more, loaded: true } }));
        } catch (e) {
          app.toast(e.message);
        }
      }
      api(`/chat/rooms/${id}/seen`, { method: 'POST', background: true }).catch(() => {});
      sync();
    },
    [msgs, phone, tight, app, sync]
  );
  const openPerson = async (personId) => {
    try {
      const r = await api('/chat/direct', { method: 'POST', body: { userId: personId } });
      await sync();
      openRoom(r.id);
    } catch (e) {
      app.toast(e.message);
    }
  };
  const close = (id) => {
    setWins((w) => w.filter((x) => x.id !== id));
    if (phone) setPanel(true); // on a phone, back to the list of chats
  };
  const toggleMin = (id) => setWins((w) => w.map((x) => (x.id === id ? { ...x, min: !x.min } : x)));
  const forget = (id) => setMsgs((m) => {
    const next = { ...m };
    delete next[id];
    return next;
  });

  // Archive (just for me; it comes back when someone writes) or bring it back
  const archive = async (room, archived = true) => {
    try {
      await api(`/chat/rooms/${room.id}/archive`, { method: 'POST', body: { archived } });
      if (archived) close(room.id);
      app.toast(archived ? 'Archived. It comes back if someone writes.' : 'Back in your chats');
      sync();
    } catch (e) {
      app.toast(e.message);
    }
  };
  // Delete for me: the messages so far disappear for me only
  const clearForMe = async (room) => {
    const who = room.kind === 'direct' ? `${room.name} still has them, unless they delete it too.` : 'Everyone else still has them.';
    if (!window.confirm(`Delete “${room.name}” for you? Its messages so far disappear for you. ${who}`)) return;
    try {
      await api(`/chat/rooms/${room.id}/clear`, { method: 'POST' });
      close(room.id);
      forget(room.id);
      app.toast('Chat deleted for you');
      sync();
    } catch (e) {
      app.toast(e.message);
    }
  };
  // Delete a group for everyone (only whoever started it)
  const deleteGroup = async (room) => {
    if (!window.confirm(`Delete “${room.name}” for everyone? All its messages are removed for all ${room.members.length} people. This can’t be undone.`)) return;
    try {
      await api(`/chat/rooms/${room.id}`, { method: 'DELETE' });
      close(room.id);
      forget(room.id);
      app.toast('Group deleted');
      sync();
    } catch (e) {
      app.toast(e.message);
    }
  };
  const leaveGroup = async (room) => {
    if (!window.confirm(`Leave “${room.name}”? You won’t see its messages any more.`)) return;
    try {
      await api(`/chat/rooms/${room.id}/leave`, { method: 'POST' });
      close(room.id);
      forget(room.id);
      sync();
    } catch (e) {
      app.toast(e.message);
    }
  };

  if (!data) return null;
  const people = data.people.filter((p) => p.id !== data.me);
  const online = people.filter((p) => p.status !== 'offline').length;
  const s = q.trim().toLowerCase();
  const sorted = [...data.rooms].sort((a, b) => new Date(b.last?.at || b.lastAt || 0) - new Date(a.last?.at || a.lastAt || 0));
  const archivedCount = sorted.filter((r) => r.archived).length;
  // Searching looks through archived chats too
  const rooms = sorted.filter((r) => (s ? r.name.toLowerCase().includes(s) : showArchived ? r.archived : !r.archived));
  const viewingArchived = showArchived && !s;
  const order = { online: 0, away: 1, offline: 2 };
  const list = people.filter((p) => !s || p.name.toLowerCase().includes(s)).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const roomOf = (id) => data.rooms.find((r) => r.id === id);

  return (
    <div className="ch-dock no-print">
      <div className="ch-windows">
        {(fit > 0 ? wins.slice(-fit) : []).map((w) => {
          const room = roomOf(w.id);
          if (!room) return null;
          return (
            <ChatWindow
              key={w.id}
              room={room}
              me={data.me}
              people={data.people}
              state={msgs[w.id]}
              min={w.min}
              phone={phone}
              onMin={() => toggleMin(w.id)}
              onClose={() => close(w.id)}
              onExit={() => {
                setWins((x) => x.filter((y) => y.id !== w.id));
                setPanel(false);
              }}
              onSent={(m) => merge(w.id, [m])}
              onSeen={() => api(`/chat/rooms/${w.id}/seen`, { method: 'POST', background: true }).catch(() => {})}
              onOlder={async () => {
                const first = msgs[w.id]?.list?.[0];
                const r = await api(`/chat/rooms/${w.id}/messages${first ? `?before=${first.id}` : ''}`);
                setMsgs((m) => ({ ...m, [w.id]: { list: [...r.messages, ...(m[w.id]?.list || [])], more: r.more, loaded: true } }));
              }}
              onEdit={() => setModal({ kind: 'edit', room })}
              onArchive={(on) => archive(room, on)}
              onClear={() => clearForMe(room)}
              onDeleteGroup={() => deleteGroup(room)}
              onLeave={() => leaveGroup(room)}
              onRemoved={(id) => setMsgs((m) => ({ ...m, [w.id]: { ...m[w.id], list: m[w.id].list.map((x) => (x.id === id ? { ...x, deleted: true, text: '' } : x)) } }))}
            />
          );
        })}
      </div>

      {panel && (
        <section className="ch-panel" aria-label="Chat">
          <header className="ch-panel-head">
            <div className="seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={tab === 'chats'} onClick={() => setTab('chats')}>
                Chats{unread ? ` (${unread > 9 ? '9+' : unread})` : ''}
              </button>
              <button type="button" aria-pressed={tab === 'people'} onClick={() => setTab('people')}>
                People ({online} online)
              </button>
            </div>
            <button type="button" className="icon-btn" aria-label="Close chat" onClick={() => setPanel(false)}>
              ✕
            </button>
          </header>
          <div className="ch-panel-tools">
            <input type="search" placeholder={tab === 'chats' ? 'Search chats' : 'Search people'} aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setModal({ kind: 'new' })}>
              New group
            </button>
          </div>
          <div className="ch-list">
            {tab === 'chats' && viewingArchived && (
              <div className="ch-archived-head">
                <button type="button" className="link-btn small" onClick={() => setShowArchived(false)}>
                  ‹ Chats
                </button>
                <span className="muted small">Archived chats come back when someone writes.</span>
              </div>
            )}
            {tab === 'chats' ? (
              rooms.length ? (
                rooms.map((r) => (
                  <button key={r.id} type="button" className={`ch-item ${r.unread ? 'ch-unread' : ''}`} onClick={() => openRoom(r.id)}>
                    <RoomIcon room={r} people={data.people} />
                    <span className="ch-item-main">
                      <span className="ch-item-top">
                        <span className="ch-name">{r.name}</span>
                        <span className="ch-time">{ago(r.last?.at)}</span>
                      </span>
                      <span className="ch-snip">
                        {r.last ? (r.last.system ? r.last.text : `${r.last.mine ? 'You' : r.kind === 'direct' ? '' : r.last.name}${r.last.mine || r.kind !== 'direct' ? ': ' : ''}${r.last.text}`) : r.kind === 'team' ? 'Everyone on the team' : 'No messages yet'}
                      </span>
                    </span>
                    {r.archived && s && <span className="tag">Archived</span>}
                    {r.unread > 0 && <span className="ch-badge">{r.unread > 9 ? '9+' : r.unread}</span>}
                  </button>
                ))
              ) : (
                <p className="muted small ch-empty">{s ? 'No chats match.' : viewingArchived ? 'Nothing archived.' : 'No chats yet. Tap someone on People to start one.'}</p>
              )
            ) : null}
            {tab === 'chats' && !s && !viewingArchived && archivedCount > 0 && (
              <button type="button" className="ch-item ch-archived-link" onClick={() => setShowArchived(true)}>
                <span className="ch-archive-ic" aria-hidden="true">🗄</span>
                <span className="ch-item-main">
                  <span className="ch-name">Archived</span>
                  <span className="ch-snip">{archivedCount === 1 ? '1 chat' : `${archivedCount} chats`}</span>
                </span>
              </button>
            )}
            {tab === 'chats' ? null : (
              list.map((p) => (
                <div key={p.id} className="ch-person">
                  <button type="button" className="ch-item" onClick={() => openPerson(p.id)} title={`Chat with ${p.name}`}>
                    <span className="ch-av">
                      <Avatar name={p.name} size={36} />
                      <span className={`ch-dot ch-${p.status}`} />
                    </span>
                    <span className="ch-item-main">
                      <span className="ch-name">{p.name}</span>
                      <span className="ch-snip">
                        {lastSeenText(p)}
                        {p.teams.length ? ` · ${p.teams.join(', ')}` : ''}
                      </span>
                    </span>
                  </button>
                  {p.phone && <WaLink person={p} />}
                </div>
              ))
            )}
          </div>
        </section>
      )}

      <button type="button" className={`ch-bar ${panel ? 'ch-bar-on' : ''}`} aria-expanded={panel} onClick={() => setPanel(!panel)}>
        <span aria-hidden="true">💬</span> Chat
        <span className="ch-bar-online">
          <span className="ch-dot ch-online ch-dot-inline" /> {online}
        </span>
        {unread > 0 && <span className="ch-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {modal && (
        <GroupModal
          people={people}
          room={modal.kind === 'edit' ? modal.room : null}
          me={data.me}
          onClose={() => setModal(null)}
          onDone={async (id, left) => {
            setModal(null);
            if (left) close(left);
            await sync();
            if (id) openRoom(id);
          }}
        />
      )}
    </div>
  );
}

function ChatWindow({ room, me, people, state, min, phone, onMin, onClose, onExit, onSent, onSeen, onOlder, onEdit, onRemoved, onArchive, onClear, onDeleteGroup, onLeave }) {
  const app = useApp();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const off = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(false);
    };
    const esc = (e) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', off);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);
  const pick = (fn) => () => {
    setMenu(false);
    fn();
  };
  const owner = room.kind === 'group' && room.owner === me;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const input = useRef(null);
  const list = state?.list || [];
  const lastId = list[list.length - 1]?.id;
  const atBottom = useRef(true);
  // Stay at the newest message unless they scrolled up to read
  useLayoutEffect(() => {
    if (box.current && atBottom.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lastId, min]);
  useEffect(() => {
    if (!min && lastId && !document.hidden) onSeen();
  }, [lastId, min]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [text]);
  useEffect(() => {
    if (!min && !phone) input.current?.focus();
  }, [min, phone]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const m = await api(`/chat/rooms/${room.id}/messages`, { method: 'POST', body: { text: t } });
      setText('');
      atBottom.current = true;
      onSent(m);
    } catch (e) {
      app.toast(e.message);
    }
    setBusy(false);
  };
  const remove = async (m) => {
    if (!window.confirm('Remove this message for everyone?')) return;
    try {
      await api(`/chat/messages/${m.id}`, { method: 'DELETE' });
      onRemoved(m.id);
    } catch (e) {
      app.toast(e.message);
    }
  };
  const other = room.kind === 'direct' ? people.find((p) => p.id === room.with) : null;
  const sub = other ? lastSeenText(other) : room.kind === 'team' ? 'Everyone on the team' : `${room.members.length} people`;

  return (
    <section
      className={`ch-win ${min ? 'ch-min' : ''} ${phone ? 'ch-full' : ''}`}
      aria-label={`Chat: ${room.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !menu) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <header className={`ch-win-head ch-c-${room.kind === 'direct' ? 'gray' : room.color}`}>
        {phone && (
          <button type="button" className="ch-hbtn ch-back" aria-label="Back to your chats" onClick={onClose}>
            ‹
          </button>
        )}
        <button type="button" className="ch-win-title" onClick={phone ? undefined : onMin} aria-expanded={phone ? undefined : !min}>
          <RoomIcon room={room} people={people} size={28} />
          <span className="ch-win-names">
            <strong>{room.name}</strong>
            <span>{sub}</span>
          </span>
          {min && room.unread > 0 && <span className="ch-badge">{room.unread > 9 ? '9+' : room.unread}</span>}
        </button>
        {room.kind === 'direct' && !min && people.find((p) => p.id === room.with)?.phone && <WaLink person={people.find((p) => p.id === room.with)} header />}
        {room.kind === 'group' && !min && (
          <button type="button" className="ch-hbtn" aria-label="Group settings" title="Name, look and people" onClick={onEdit}>
            ⚙
          </button>
        )}
        {!min && (
          <div className="ch-menu-wrap" ref={menuRef}>
            <button type="button" className="ch-hbtn" aria-label="More: archive or delete" aria-haspopup="menu" aria-expanded={menu} title="Archive or delete" onClick={() => setMenu(!menu)}>
              ⋯
            </button>
            {menu && (
              <div className="ch-menu" role="menu">
                {room.archived ? (
                  <button type="button" role="menuitem" onClick={pick(() => onArchive(false))}>
                    Move back to chats
                  </button>
                ) : (
                  <button type="button" role="menuitem" onClick={pick(() => onArchive(true))}>
                    Archive chat
                    <span>Hides it until someone writes</span>
                  </button>
                )}
                <button type="button" role="menuitem" className="danger" onClick={pick(onClear)}>
                  Delete for me
                  <span>{room.kind === 'direct' ? 'Gone for good once you both delete it' : 'Others keep their messages'}</span>
                </button>
                {room.kind === 'group' &&
                  (owner ? (
                    <button type="button" role="menuitem" className="danger" onClick={pick(onDeleteGroup)}>
                      Delete group for everyone
                      <span>You started it, so you can</span>
                    </button>
                  ) : (
                    <button type="button" role="menuitem" className="danger" onClick={pick(onLeave)}>
                      Leave group
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        {!phone && (
          <button type="button" className="ch-hbtn" aria-label={min ? 'Open' : 'Minimize'} onClick={onMin}>
            {min ? '▴' : '–'}
          </button>
        )}
        <button type="button" className="ch-hbtn" aria-label={phone ? 'Close chat' : 'Close'} title="Close" onClick={phone ? onExit : onClose}>
          ✕
        </button>
      </header>
      {!min && (
        <>
          <div
            className="ch-msgs"
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {state?.more && (
              <button type="button" className="link-btn small ch-older" onClick={onOlder}>
                Earlier messages
              </button>
            )}
            {!state?.loaded && <p className="muted small ch-empty">Loading…</p>}
            {state?.loaded && list.length === 0 && <p className="muted small ch-empty">Say hello 👋</p>}
            {list.map((m, i) => {
              const prev = list[i - 1];
              const gap = !prev || new Date(m.at) - new Date(prev.at) > 15 * 60 * 1000;
              if (m.system)
                return (
                  <div key={m.id}>
                    {gap && <div className="ch-when">{new Date(m.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
                    <div className="ch-sys">{m.text}</div>
                  </div>
                );
              const mine = m.user === me;
              const showName = !mine && room.kind !== 'direct' && (gap || prev?.user !== m.user || prev?.system);
              return (
                <div key={m.id}>
                  {gap && <div className="ch-when">{new Date(m.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
                  <div className={`ch-msg ${mine ? 'ch-mine' : ''}`}>
                    {showName && <span className="ch-from">{m.name}</span>}
                    <div className={`ch-bubble ${m.deleted ? 'ch-gone' : ''}`} title={timeOf(m.at)}>
                      {m.deleted ? 'Message removed' : <Linked text={m.text} />}
                    </div>
                    {mine && !m.deleted && (
                      <button type="button" className="ch-x" aria-label="Remove message" onClick={() => remove(m)}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className="ch-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={input}
              rows={1}
              maxLength={2000}
              placeholder={`Message ${room.kind === 'direct' ? room.name.split(' ')[0] : room.name}`}
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function GroupModal({ people, room, me, onClose, onDone }) {
  const app = useApp();
  const editing = !!room;
  const [name, setName] = useState(room?.name || '');
  const [emoji, setEmoji] = useState(room?.emoji || '');
  const [color, setColor] = useState(room?.color || 'blue');
  const startIds = useMemo(() => (room ? room.members.map((m) => m.id).filter((x) => x !== me) : []), [room, me]);
  const [picked, setPicked] = useState(startIds);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = !room || room.owner === me;
  const s = q.trim().toLowerCase();
  const shown = people.filter((p) => !s || p.name.toLowerCase().includes(s));
  const toggle = (id) => {
    if (editing && !owner && startIds.includes(id)) return; // only the starter removes people
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        const add = picked.filter((x) => !startIds.includes(x));
        const remove = startIds.filter((x) => !picked.includes(x));
        await api(`/chat/rooms/${room.id}`, { method: 'PATCH', body: { name, emoji, color, add, ...(remove.length ? { remove } : {}) } });
        onDone(null);
      } else {
        const r = await api('/chat/groups', { method: 'POST', body: { name, emoji, color, members: picked } });
        onDone(r.id);
      }
    } catch (err) {
      app.toast(err.message);
      setBusy(false);
    }
  };
  const leave = async () => {
    if (!window.confirm(`Leave “${room.name}”? You won’t see its messages any more.`)) return;
    try {
      await api(`/chat/rooms/${room.id}/leave`, { method: 'POST' });
      onDone(null, room.id);
    } catch (err) {
      app.toast(err.message);
    }
  };
  return (
    <Modal title={editing ? 'Group settings' : 'New group chat'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="row-wrap ch-g-top">
          <span className={`ch-room-ic ch-c-${color}`} style={{ width: 48, height: 48, fontSize: 22 }} aria-hidden="true">
            {emoji || (name.trim() ? name.trim()[0].toUpperCase() : '👥')}
          </span>
          <label className="field grow">
            <span>Group name</span>
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sabbath crew, Christmas program" autoFocus={!editing} />
          </label>
        </div>
        <fieldset className="fieldset">
          <legend>Icon</legend>
          <div className="ch-emoji">
            <button type="button" className={`ch-emo ${emoji === '' ? 'ch-emo-on' : ''}`} onClick={() => setEmoji('')} aria-label="First letter of the name">
              Aa
            </button>
            {EMOJI.map((e) => (
              <button key={e} type="button" className={`ch-emo ${emoji === e ? 'ch-emo-on' : ''}`} onClick={() => setEmoji(e)} aria-label={`Icon ${e}`}>
                {e}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>Colour</legend>
          <div className="ch-colors">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`ch-swatch ch-c-${c} ${color === c ? 'ch-sw-on' : ''}`} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} />
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>
            People ({picked.length} + you){editing && !owner ? ' · you can add people; the person who started it can remove them' : ''}
          </legend>
          <input type="search" className="ch-g-search" placeholder="Find someone" aria-label="Find someone" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ch-g-people">
            {shown.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={picked.includes(p.id)} disabled={editing && !owner && startIds.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className={`ch-dot ch-${p.status} ch-dot-inline`} /> {p.name}
                {p.teams.length > 0 && <span className="muted small">{p.teams.join(', ')}</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy || !name.trim() || !picked.length}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Start the chat'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {editing && (
            <button type="button" className="btn btn-ghost danger ch-leave" onClick={leave}>
              Leave group
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

// "View as": the chat dock as that person sees it — who's online, their team chats and unread
// counts — without anything anyone wrote, or who they talk to privately. Nothing can be sent.
export function ChatPreview() {
  const app = useApp();
  const [data, setData] = useState(null);
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('chats');
  useEffect(() => {
    let live = true;
    const load = () => api('/chat/preview', { background: true }).then((d) => live && setData(d), () => {});
    load();
    const t = setInterval(load, SLOW);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!data) return null;
  const people = data.people.filter((p) => p.id !== data.me);
  const online = people.filter((p) => p.status !== 'offline').length;
  const unread = data.rooms.reduce((n, r) => n + r.unread, 0) + data.private.unread;
  const order = { online: 0, away: 1, offline: 2 };
  const list = [...people].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const privateText = [data.private.chats && `${data.private.chats} one-on-one chat${data.private.chats === 1 ? '' : 's'}`, data.private.groups && `${data.private.groups} group${data.private.groups === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
  const readOnly = () => app.toast('Chats stay private, so they don’t open in a preview.');

  return (
    <div className="ch-dock no-print">
      {panel && (
        <section className="ch-panel" aria-label="Chat (preview)">
          <header className="ch-panel-head">
            <div className="seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={tab === 'chats'} onClick={() => setTab('chats')}>
                Chats{unread ? ` (${unread > 9 ? '9+' : unread})` : ''}
              </button>
              <button type="button" aria-pressed={tab === 'people'} onClick={() => setTab('people')}>
                People ({online} online)
              </button>
            </div>
            <button type="button" className="icon-btn" aria-label="Close chat" onClick={() => setPanel(false)}>
              ✕
            </button>
          </header>
          <p className="ch-preview-note small">What people write to each other stays private, even in a preview. You see what their chat list looks like, not what’s in it.</p>
          <div className="ch-list">
            {tab === 'chats' ? (
              <>
                {data.rooms.map((r) => (
                  <button key={r.id} type="button" className={`ch-item ${r.unread ? 'ch-unread' : ''}`} onClick={readOnly}>
                    <RoomIcon room={r} people={data.people} />
                    <span className="ch-item-main">
                      <span className="ch-name">{r.name}</span>
                      <span className="ch-snip">Everyone on the team</span>
                    </span>
                    {r.unread > 0 && <span className="ch-badge">{r.unread > 9 ? '9+' : r.unread}</span>}
                  </button>
                ))}
                {privateText ? (
                  <div className="ch-item ch-private">
                    <span className="ch-room-ic ch-c-gray" style={{ width: 36, height: 36, fontSize: 16 }} aria-hidden="true">
                      🔒
                    </span>
                    <span className="ch-item-main">
                      <span className="ch-name">Plus {privateText}</span>
                      <span className="ch-snip">{data.private.unread ? `${data.private.unread > 9 ? '9+' : data.private.unread} unread · ` : ''}names and messages hidden</span>
                    </span>
                  </div>
                ) : (
                  !data.rooms.length && <p className="muted small ch-empty">No chats yet.</p>
                )}
              </>
            ) : (
              list.map((p) => (
                <button key={p.id} type="button" className="ch-item" onClick={readOnly}>
                  <span className="ch-av">
                    <Avatar name={p.name} size={36} />
                    <span className={`ch-dot ch-${p.status}`} />
                  </span>
                  <span className="ch-item-main">
                    <span className="ch-name">{p.name}</span>
                    <span className="ch-snip">
                      {lastSeenText(p)}
                      {p.teams.length ? ` · ${p.teams.join(', ')}` : ''}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      )}
      <button type="button" className={`ch-bar ${panel ? 'ch-bar-on' : ''}`} aria-expanded={panel} onClick={() => setPanel(!panel)}>
        <span aria-hidden="true">💬</span> Chat
        <span className="ch-bar-online">
          <span className="ch-dot ch-online ch-dot-inline" /> {online}
        </span>
        {unread > 0 && <span className="ch-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </div>
  );
}

// Call someone: opens your WhatsApp chat with them, where the call buttons are (WhatsApp doesn't let
// other apps start the call itself). Only for people whose number you're allowed to see.
function WaLink({ person, header = false }) {
  const digits = String(person.phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return (
    <a className={header ? 'ch-hbtn ch-wa-h' : 'ch-wa'} href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" aria-label={`Call ${person.name} on WhatsApp`} title={`Call ${person.name}: opens your WhatsApp chat with them; tap the phone or video button there`}>
      <WaIcon size={header ? 16 : 20} />
    </a>
  );
}
