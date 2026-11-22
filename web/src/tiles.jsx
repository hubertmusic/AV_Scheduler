// Tiles people can rearrange: drag a tile by its handle (mouse, finger or pen), or focus the handle
// and use the arrow keys. Each person's order is saved to their account, so it follows them to any
// device. In "View as" the order can be tried but isn't saved.
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

// items: [{ id, title, node }] in their usual order. Put <TileHandle /> inside each node.
export function Tiles({ page, items, className = '' }) {
  const app = useApp();
  const ids = items.map((x) => x.id);
  const idsKey = ids.join(',');
  const savedOf = () => app.me.layout?.[page] || [];
  const [order, setOrder] = useState(() => arrange(savedOf(), ids));
  const [drag, setDrag] = useState(null);
  const [said, setSaid] = useState('');
  const nodes = useRef(new Map());
  const handles = useRef(new Map());
  const before = useRef(null); // tile positions just before a move, to slide them into place
  const focusAfter = useRef(null);
  const lastSwap = useRef(null);
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

  const snap = () => {
    before.current = new Map([...nodes.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
  };
  const move = (id, to) => {
    setOrder((o) => {
      const from = o.indexOf(id);
      const t = Math.max(0, Math.min(o.length - 1, to));
      if (from < 0 || from === t) return o;
      snap();
      const n = [...o];
      n.splice(from, 1);
      n.splice(t, 0, id);
      return n;
    });
  };

  // Slide tiles from where they were to where they are now
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

  const titleOf = (id) => items.find((x) => x.id === id)?.title || id;
  const handleProps = (id) => ({
    ref: (el) => (el ? handles.current.set(id, el) : handles.current.delete(id)),
    'aria-label': `Move ${titleOf(id)}`,
    'aria-describedby': 'tiles-help',
    'aria-pressed': drag === id || undefined,
    title: 'Drag to move, or use the arrow keys',
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startDrag(id);
    },
    onKeyDown: (e) => {
      const i = order.indexOf(id);
      const to = { ArrowUp: i - 1, ArrowLeft: i - 1, ArrowDown: i + 1, ArrowRight: i + 1, Home: 0, End: order.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      if (to < 0 || to >= order.length || to === i) return;
      focusAfter.current = id;
      const next = [...order];
      next.splice(i, 1);
      next.splice(to, 0, id);
      snap();
      setOrder(next);
      setSaid(`${titleOf(id)} moved to place ${to + 1} of ${order.length}.`);
      save(next);
    },
  });
  // While dragging, follow the pointer on the whole window: the tile itself moves around the page
  const orderRef = useRef(order);
  orderRef.current = order;
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
      if (target === lastSwap.current) return; // don't flip back and forth over a tile of another size
      lastSwap.current = target;
      move(id, orderRef.current.indexOf(target));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      document.body.classList.remove('tiles-dragging');
      // the order after the last move has rendered
      requestAnimationFrame(() => {
        const o = orderRef.current;
        if (same(o, start)) return;
        setSaid(`${titleOf(id)} is now in place ${o.indexOf(id) + 1} of ${o.length}.`);
        save(o);
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  useEffect(() => () => document.body.classList.remove('tiles-dragging'), []);

  const custom = !same(order, ids);
  const reset = () => {
    snap();
    setOrder(ids);
    setSaid('Tiles are back in their usual order.');
    save(ids);
  };

  return (
    <>
      <div className={`tiles ${className}`}>
        {order.map((id) => {
          const item = items.find((x) => x.id === id);
          if (!item) return null;
          return (
            <div key={id} data-tile={id} className={`tile${drag === id ? ' tile-drag' : ''}`} ref={(el) => (el ? nodes.current.set(id, el) : nodes.current.delete(id))}>
              <TileCtx.Provider value={handleProps(id)}>{item.node}</TileCtx.Provider>
            </div>
          );
        })}
      </div>
      <p className="tiles-foot muted small">
        <span id="tiles-help">Drag a tile by its <span aria-hidden="true">⠿</span> handle to arrange them your way, or focus the handle and use the arrow keys. Your layout is saved to your account.</span>
        {custom && (
          <button type="button" className="link-btn small" onClick={reset}>
            Put them back in the usual order
          </button>
        )}
      </p>
      <div className="sr-only" role="status" aria-live="polite">
        {said}
      </div>
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
