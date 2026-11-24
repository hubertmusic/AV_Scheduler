// Things people can rearrange: drag by the handle (mouse, finger or pen), or focus the handle and
// use the arrow keys. Tiles saves each person's order to their account (it follows them to any
// device; in "View as" it can be tried but isn't saved). Sortable is the dragging on its own, for
// lists whose order is kept elsewhere (the signage playlist).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, previewing } from './lib.js';
import { useApp } from './ui.jsx';
import './tiles.css';

const TileCtx = createContext(null);

// Saved order first, then any tiles it doesn't mention yet in their usual place
function arrange(saved, ids) {
  const known = (saved || []).filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !known.includes(id));
  const out = [...known];
  for (const id of rest) {
    // keep a new tile next to the one it usually follows
    const before = ids[ids.indexOf(id) - 1];
    const at = before ? out.indexOf(before) + 1 : 0;
    out.splice(at, 0, id);
  }
  return out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The dragging itself, for any list or grid whose order the parent keeps.
// order: ids in order; onChange(next): show a new order now; onDone(next, id): a move finished
// (save it). renderItem(id) draws one item; put <TileHandle /> inside it.
export function Sortable({ order, onChange, onDone, renderItem, titleOf = (id) => id, className = '', itemClass = 'tile', helpId = 'tiles-help' }) {
  const [drag, setDrag] = useState(null);
  const [said, setSaid] = useState('');
  const nodes = useRef(new Map());
  const handles = useRef(new Map());
  const before = useRef(null); // positions just before a move, to slide things into place
  const focusAfter = useRef(null);
  const lastSwap = useRef(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  const snap = () => {
    before.current = new Map([...nodes.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
  };
  const moveTo = (id, to) => {
    const o = orderRef.current;
    const from = o.indexOf(id);
    const t = Math.max(0, Math.min(o.length - 1, to));
    if (from < 0 || from === t) return o;
    snap();
    const n = [...o];
    n.splice(from, 1);
    n.splice(t, 0, id);
    orderRef.current = n;
    onChange(n);
    return n;
  };

  // Slide items from where they were to where they are now
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (focusAfter.current) {
      handles.current.get(focusAfter.current)?.focus({ preventScroll: false });
      focusAfter.current = null;
    }
    if (!was || calm()) return;
    for (const [id, el] of nodes.current) {
      const a = was.get(id);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.getBoundingClientRect(); // apply before animating back
      el.style.transition = 'transform 180ms ease';
      el.style.transform = '';
    }
  }, [order]);

  const handleProps = (id) => ({
    ref: (el) => (el ? handles.current.set(id, el) : handles.current.delete(id)),
    'aria-label': `Move ${titleOf(id)}`,
    'aria-describedby': helpId,
    'aria-pressed': drag === id || undefined,
    title: 'Drag to move, or use the arrow keys',
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startDrag(id);
    },
    onKeyDown: (e) => {
      const o = orderRef.current;
      const i = o.indexOf(id);
      const to = { ArrowUp: i - 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowRight: i + 1, Home: 0, End: o.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      if (to < 0 || to >= o.length || to === i) return;
      focusAfter.current = id;
      const next = moveTo(id, to);
      setSaid(`${titleOf(id)} moved to place ${to + 1} of ${o.length}.`);
      onDone?.(next, id);
    },
  });
  // While dragging, follow the pointer on the whole window: the item itself moves around the page
  const startDrag = (id) => {
    const start = orderRef.current;
    lastSwap.current = null;
    setDrag(id);
    document.body.classList.add('tiles-dragging');
    const onMove = (e) => {
      const edge = 70; // scroll the page when dragging near the top or bottom
      if (e.clientY < edge) window.scrollBy(0, -14);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-tile]')?.dataset.tile;
      if (!target || !nodes.current.has(target)) return;
      if (target === id) {
        lastSwap.current = null;
        return;
      }
      if (target === lastSwap.current) return; // don't flip back and forth over an item of another size
      lastSwap.current = target;
      moveTo(id, orderRef.current.indexOf(target));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      document.body.classList.remove('tiles-dragging');
      requestAnimationFrame(() => {
        const o = orderRef.current;
        if (same(o, start)) return;
        setSaid(`${titleOf(id)} is now in place ${o.indexOf(id) + 1} of ${o.length}.`);
        onDone?.(o, id);
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  useEffect(() => () => document.body.classList.remove('tiles-dragging'), []);

  return (
    <>
      <div className={className}>
        {order.map((id) => (
          <div key={id} data-tile={id} className={`${itemClass}${drag === id ? ' tile-drag' : ''}`} ref={(el) => (el ? nodes.current.set(id, el) : nodes.current.delete(id))}>
            <TileCtx.Provider value={handleProps(id)}>{renderItem(id)}</TileCtx.Provider>
          </div>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {said}
      </div>
    </>
  );
}

// items: [{ id, title, node }] in their usual order. Put <TileHandle /> inside each node.
// Each person's order is saved to their account (page: which page's tiles).
export function Tiles({ page, items, className = '' }) {
  const app = useApp();
  const ids = items.map((x) => x.id);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(() => arrange(app.me.layout?.[page] || [], ids));
  const saveTimer = useRef(null);
  const warned = useRef(false);

  // New tiles (or ones that went away) since the order was saved
  useEffect(() => {
    setOrder((o) => arrange(o, idsKey.split(',')));
  }, [idsKey]);

  const save = useCallback(
    (next) => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const usual = idsKey.split(',');
        const value = same(next, usual) ? null : next;
        if (previewing()) {
          if (!warned.current) app.toast('In a preview you can try a layout, but it isn’t saved.');
          warned.current = true;
          return;
        }
        try {
          const r = await api(`/account/layout/${page}`, { method: 'PUT', body: { order: value }, background: true });
          app.me.layout = r.layout; // keep this session's copy current without reloading everything
        } catch (e) {
          app.toast(`Layout not saved: ${e.message}`);
        }
      }, 500);
    },
    [app, page, idsKey]
  );
  const byId = (id) => items.find((x) => x.id === id);
  const custom = !same(order, ids);
  return (
    <>
      <Sortable order={order.filter(byId)} onChange={setOrder} onDone={save} renderItem={(id) => byId(id).node} titleOf={(id) => byId(id)?.title || id} className={`tiles ${className}`} />
      <p className="tiles-foot muted small">
        <span id="tiles-help">Drag a tile by its <span aria-hidden="true">⠿</span> handle to arrange them your way, or focus the handle and use the arrow keys. Your layout is saved to your account.</span>
        {custom && (
          <button
            type="button"
            className="link-btn small"
            onClick={() => {
              setOrder(ids);
              save(ids);
            }}
          >
            Put them back in the usual order
          </button>
        )}
      </p>
    </>
  );
}

// The grip a tile is dragged by; place it in the tile's header
export function TileHandle() {
  const props = useContext(TileCtx);
  if (!props) return null;
  return (
    <button type="button" className="tile-handle" {...props}>
      <svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true">
        {[4, 10, 16].map((y) => [4, 10].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.7" fill="currentColor" />))}
      </svg>
    </button>
  );
}
