// Flow-chart boards (Planning tab): boxes, sticky notes, decisions and team members joined by
// lines. Shared by the admin and all team leaders. Saves on its own a moment after each change.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { applyEdgeChanges, applyNodeChanges, Background, ConnectionMode, Controls, Handle, MarkerType, MiniMap, NodeResizer, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ago, api } from '../lib.js';
import { Avatar, Empty, useApp } from '../ui.jsx';

const COLORS = ['plain', 'yellow', 'blue', 'green', 'orange', 'red', 'purple'];
const COLOR_NAME = { plain: 'White', yellow: 'Yellow', blue: 'Blue', green: 'Green', orange: 'Orange', red: 'Red', purple: 'Purple' };
const ADD = [
  ['box', 'Box', 'Step'],
  ['note', 'Sticky note', 'Idea…'],
  ['decision', 'Decision', 'Question?'],
  ['text', 'Text', 'Label'],
];

const BoardCtx = createContext(null);
let seq = 0;
const newId = (p) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;

// server <-> canvas
const toFlowNode = (n) => ({
  id: n.id,
  type: n.type,
  position: { x: n.x, y: n.y },
  data: { label: n.label, color: n.color, personId: n.personId },
  ...(n.w ? { width: n.w, height: n.h || undefined } : {}),
});
const toFlowEdge = (e) => ({
  id: e.id,
  source: e.source,
  target: e.target,
  // Lines saved without sides run from the bottom of one box to the top of the next
  sourceHandle: e.sourceHandle || 'b',
  targetHandle: e.targetHandle || 't',
  label: e.label || undefined,
  markerEnd: e.arrow === false ? undefined : { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  data: { arrow: e.arrow !== false },
});
const fromFlow = (nodes, edges) => ({
  nodes: nodes.map((n) => ({
    id: n.id,
    type: n.type,
    x: Math.round(n.position.x),
    y: Math.round(n.position.y),
    w: n.width ? Math.round(n.width) : null,
    h: n.height ? Math.round(n.height) : null,
    label: n.data.label || '',
    color: n.data.color || 'plain',
    personId: n.data.personId || null,
  })),
  edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null, label: e.label || '', arrow: e.data?.arrow !== false })),
});

// ---------- nodes ----------
function Handles() {
  return (
    <>
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />
    </>
  );
}

function Label({ id, data, placeholder }) {
  const { editing, setEditing, setLabel } = useContext(BoardCtx);
  const [text, setText] = useState(data.label);
  const ref = useRef(null);
  useEffect(() => setText(data.label), [data.label, editing]);
  // The canvas focuses a node when it's selected, so take focus back for typing
  useEffect(() => {
    if (editing !== id) return;
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [editing, id]);
  if (editing !== id) return <div className="fc-label">{data.label || <span className="fc-placeholder">{placeholder}</span>}</div>;
  const done = () => {
    setLabel(id, text);
    setEditing(null);
  };
  return (
    <textarea
      ref={ref}
      className="fc-edit nodrag nowheel"
      autoFocus
      value={text}
      aria-label="Text"
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(null);
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          done();
        }
      }}
    />
  );
}

function BoxNode({ id, data, selected }) {
  return (
    <div className={`fc-node fc-box fc-${data.color || 'plain'}`}>
      <NodeResizer isVisible={selected} minWidth={90} minHeight={44} />
      <Handles />
      <Label id={id} data={data} placeholder="Step" />
    </div>
  );
}
function NoteNode({ id, data, selected }) {
  return (
    <div className={`fc-node fc-note fc-${data.color === 'plain' ? 'yellow' : data.color || 'yellow'}`}>
      <NodeResizer isVisible={selected} minWidth={110} minHeight={70} />
      <Handles />
      <Label id={id} data={data} placeholder="Idea…" />
    </div>
  );
}
function DecisionNode({ id, data, selected }) {
  return (
    <div className={`fc-node fc-decision fc-${data.color || 'plain'}`}>
      <NodeResizer isVisible={selected} minWidth={120} minHeight={80} keepAspectRatio />
      <div className="fc-diamond" aria-hidden="true" />
      <Handles />
      <Label id={id} data={data} placeholder="Question?" />
    </div>
  );
}
function TextNode({ id, data, selected }) {
  return (
    <div className={`fc-node fc-text${selected ? ' fc-text-on' : ''}`}>
      <Handles />
      <Label id={id} data={data} placeholder="Label" />
    </div>
  );
}
function PersonNode({ id, data }) {
  const app = useApp();
  const { editing } = useContext(BoardCtx);
  const p = app.person(data.personId);
  const levels = p ? [...(p.leads || []).map((k) => `${app.posLabel(k)} · Lead`), ...p.positions.filter((k) => !(p.leads || []).includes(k)).map((k) => app.posLabel(k)), ...(p.trainee || []).map((k) => `${app.posLabel(k)} · learning`)] : [];
  return (
    <div className={`fc-node fc-person fc-${data.color || 'plain'}`}>
      <Handles />
      <div className="fc-person-top">
        <Avatar name={p?.name || '?'} size={28} />
        <strong>{p?.name || 'Former member'}</strong>
      </div>
      {levels.length > 0 && <div className="fc-person-pos">{levels.join(' · ')}</div>}
      {(data.label || editing === id) && <Label id={id} data={data} placeholder="Note" />}
    </div>
  );
}
const nodeTypes = { box: BoxNode, note: NoteNode, decision: DecisionNode, text: TextNode, person: PersonNode };

// ---------- board list + editor ----------
export default function Boards() {
  const app = useApp();
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  const loadList = useCallback(async () => {
    const rows = await api('/boards').catch(() => []);
    setList(rows);
    setOpenId((cur) => (cur && rows.some((b) => b.id === cur) ? cur : rows[0]?.id || null));
  }, []);
  useEffect(() => {
    loadList();
  }, [loadList]);

  const create = async (template) => {
    setCreating(true);
    try {
      const b = await api('/boards', { method: 'POST', body: { title: template === 'week' ? 'Week kickoff' : 'New board', template } });
      await loadList();
      setOpenId(b.id);
    } catch (e) {
      app.toast(e.message);
    }
    setCreating(false);
  };

  return (
    <div className="split">
      <aside className="side-col stack">
        <div className="row-wrap">
          <button type="button" className="btn btn-primary btn-sm" disabled={creating} onClick={() => create('blank')}>
            New board
          </button>
          <button type="button" className="btn btn-outline btn-sm" disabled={creating} onClick={() => create('week')}>
            Week kickoff
          </button>
        </div>
        <p className="small muted">Shared by you and all team leaders. Changes save on their own.</p>
        {list && list.length === 0 && <Empty>No boards yet. Start one for this week’s ideas.</Empty>}
        <div className="plan-list">
          {(list || []).map((b) => (
            <button key={b.id} type="button" className={`plan-item ${openId === b.id ? 'plan-item-on' : ''}`} onClick={() => setOpenId(b.id)}>
              <strong>{b.title}</strong>
              <span className="small muted">
                {b.size} item{b.size === 1 ? '' : 's'} · {b.updatedBy ? `${b.updatedBy}, ` : ''}
                {ago(b.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="main-col">
        {openId ? (
          <ReactFlowProvider key={openId}>
            <BoardEditor id={openId} onListChanged={loadList} />
          </ReactFlowProvider>
        ) : (
          list === null && <div className="loading-inline">Loading…</div>
        )}
      </div>
    </div>
  );
}

function BoardEditor({ id, onListChanged }) {
  const app = useApp();
  const flow = useReactFlow();
  const wrapRef = useRef(null);
  const [board, setBoard] = useState(null);
  const [title, setTitle] = useState('');
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('saved'); // saved | waiting | saving | error
  const [pickPerson, setPickPerson] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rev = useRef(0);
  const savedSnap = useRef('');
  const timer = useRef(null);
  const saving = useRef(false);

  const apply = useCallback((b) => {
    setBoard(b);
    setTitle(b.title);
    rev.current = b.rev;
    const n = b.nodes.map(toFlowNode);
    const e = b.edges.map(toFlowEdge);
    setNodes(n);
    setEdges(e);
    savedSnap.current = JSON.stringify({ title: b.title, ...fromFlow(n, e) });
    setStatus('saved');
  }, []);

  useEffect(() => {
    api(`/boards/${id}`).then(apply, (e) => app.toast(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, apply]);

  const save = useCallback(async () => {
    if (saving.current) return;
    const body = { title: title.trim() || 'Untitled board', ...fromFlow(nodes, edges) };
    const snap = JSON.stringify(body);
    if (snap === savedSnap.current) return setStatus('saved');
    saving.current = true;
    setStatus('saving');
    try {
      const b = await api(`/boards/${id}`, { method: 'PUT', body: { ...body, rev: rev.current } });
      rev.current = b.rev;
      savedSnap.current = snap;
      setBoard((cur) => ({ ...cur, updatedAt: b.updatedAt, updatedBy: b.updatedBy, title: b.title }));
      setStatus('saved');
      onListChanged();
    } catch (e) {
      if (/changed this board/.test(e.message)) {
        app.toast(e.message);
        api(`/boards/${id}`).then(apply);
      } else {
        setStatus('error');
        app.toast(e.message);
      }
    }
    saving.current = false;
  }, [id, title, nodes, edges, board?.title, apply, app, onListChanged]);

  // Save a moment after the last change
  useEffect(() => {
    if (!board) return;
    const snap = JSON.stringify({ title: title.trim() || 'Untitled board', ...fromFlow(nodes, edges) });
    if (snap === savedSnap.current) return;
    setStatus('waiting');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 900);
    return () => clearTimeout(timer.current);
  }, [nodes, edges, title, board, save]);

  // Don't lose a last edit when leaving the page
  useEffect(() => {
    const warn = (e) => {
      if (status === 'waiting' || status === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  const onNodesChange = useCallback((ch) => setNodes((ns) => applyNodeChanges(ch, ns)), []);
  const onEdgesChange = useCallback((ch) => setEdges((es) => applyEdgeChanges(ch, es)), []);
  const onConnect = useCallback((c) => {
    if (c.source === c.target) return;
    setEdges((es) => [...es, toFlowEdge({ id: newId('e'), ...c, label: '', arrow: true })]);
  }, []);

  const setLabel = useCallback((nid, label) => setNodes((ns) => ns.map((n) => (n.id === nid ? { ...n, data: { ...n.data, label: label.slice(0, 500) } } : n))), []);
  const ctx = useMemo(() => ({ editing, setEditing, setLabel }), [editing, setLabel]);

  const center = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    const p = r ? flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const jitter = () => Math.round((Math.random() - 0.5) * 60);
    return { x: Math.round(p.x - 80 + jitter()), y: Math.round(p.y - 30 + jitter()) };
  };
  const addNode = (type, label = '', extra = {}) => {
    const nid = newId('n');
    const at = center();
    document.activeElement?.blur?.(); // so typing goes into the new box, not the button
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id: nid, type, position: at, data: { label, color: type === 'note' ? 'yellow' : 'plain', personId: null, ...extra }, selected: true }]);
    setEditing(type === 'person' ? null : nid);
  };
  const addPerson = (pid) => {
    if (!pid) return;
    addNode('person', '', { personId: pid });
    setPickPerson('');
  };

  const selNodes = nodes.filter((n) => n.selected);
  const selEdges = edges.filter((e) => e.selected);
  const recolor = (c) => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, color: c } } : n)));
  const removeSelected = () => {
    const gone = new Set(selNodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) => es.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)));
  };
  const edgeLabel = (text) => setEdges((es) => es.map((e) => (e.selected ? { ...e, label: text.slice(0, 120) || undefined } : e)));
  const edgeArrow = (on) => setEdges((es) => es.map((e) => (e.selected ? { ...e, data: { ...e.data, arrow: on }, markerEnd: on ? { type: MarkerType.ArrowClosed, width: 18, height: 18 } : undefined } : e)));

  const del = async () => {
    try {
      await api(`/boards/${id}`, { method: 'DELETE' });
      app.toast('Board deleted');
      onListChanged();
    } catch (e) {
      app.toast(e.message);
    }
  };

  if (!board) return <div className="loading-inline">Loading…</div>;
  const canDelete = app.me.role === 'admin' || board.createdById === app.me.id;
  const statusText = { saved: board.updatedBy ? `Saved · ${board.updatedBy}, ${ago(board.updatedAt)}` : 'Saved', waiting: 'Unsaved changes…', saving: 'Saving…', error: 'Couldn’t save. Retrying on your next change.' }[status];
  const people = app.people.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <BoardCtx.Provider value={ctx}>
      <section className="card stack fc-card" aria-label="Board">
        <div className="fc-head">
          <input className="fc-title" aria-label="Board name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <span className={`small ${status === 'error' ? 'danger' : 'muted'}`} role="status">
            {statusText}
          </span>
        </div>
        <div className="fc-toolbar" role="toolbar" aria-label="Add to the board">
          {ADD.map(([type, label, text]) => (
            <button key={type} type="button" className="btn btn-outline btn-sm" onClick={() => addNode(type, type === 'note' ? '' : text)}>
              + {label}
            </button>
          ))}
          <select className="fc-person-pick" aria-label="Add a team member" value={pickPerson} onChange={(e) => addPerson(e.target.value)}>
            <option value="">+ Team member…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {(selNodes.length > 0 || selEdges.length > 0) && (
          <div className="fc-toolbar fc-selbar">
            {selNodes.length > 0 && (
              <>
                <span className="small muted">Color</span>
                {COLORS.map((c) => (
                  <button key={c} type="button" className={`fc-swatch fc-${c}`} aria-label={COLOR_NAME[c]} title={COLOR_NAME[c]} onClick={() => recolor(c)} />
                ))}
                {selNodes.length === 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(selNodes[0].id)}>
                    {selNodes[0].type === 'person' ? 'Add a note' : 'Edit text'}
                  </button>
                )}
              </>
            )}
            {selEdges.length === 1 && selNodes.length === 0 && (
              <>
                <input className="fc-edge-label" aria-label="Line label" placeholder="Label on the line (e.g. Yes)" value={selEdges[0].label || ''} maxLength={120} onChange={(e) => edgeLabel(e.target.value)} />
                <label className="check small">
                  <input type="checkbox" checked={selEdges[0].data?.arrow !== false} onChange={(e) => edgeArrow(e.target.checked)} />
                  <span>Arrow</span>
                </label>
              </>
            )}
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={removeSelected}>
              Delete
            </button>
          </div>
        )}
        <div className="fc-canvas" ref={wrapRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={(_, n) => setEditing(n.id)}
            onPaneClick={() => setEditing(null)}
            connectionMode={ConnectionMode.Loose}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
            minZoom={0.2}
            maxZoom={2.5}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="fc-minimap" />
          </ReactFlow>
          {nodes.length === 0 && <div className="fc-empty">Add a box or sticky note to start. Drag from the dots on its edges to draw a line to another one.</div>}
        </div>
        <div className="row-wrap fc-foot">
          <span className="small muted">Double-click to edit text · drag from the dots to connect · select and press Delete to remove</span>
          {canDelete &&
            (confirmDelete ? (
              <span className="row-wrap">
                <button type="button" className="btn btn-danger btn-sm" onClick={del}>
                  Delete this board
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
                Delete board…
              </button>
            ))}
        </div>
      </section>
    </BoardCtx.Provider>
  );
}
