import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';

// ─── Layout constants ──────────────────────────────────────────────────────
const NODE_W    = 160;
const NODE_H    = 54;
const NODE_RX   = 8;
const ALT_R     = 15;
const PAD_X     = 48;
const PAD_TOP   = 24;
const SLOT_W    = 190;
const CANVAS_H  = 420;
const LINE_CHARS = 19;

const INTRO_TO_BQ = 88;
const BQ_STEP     = 155;
const BQ_TO_ALT   = BQ_STEP / 2;

const C_INTRO = '#111827';
const C_BQ    = '#1d4ed8';
const C_ALT   = '#6b7280';
const C_END   = '#dc2626';
const C_LINE  = '#d1d5db';

// ─── Types ─────────────────────────────────────────────────────────────────
interface AltData {
  text: string;
  nextContentId: number;
  feedback?: string | null;
}
interface NodeData {
  index: number;
  question: string | null;
  alternatives: AltData[];
}
interface LayoutAlt {
  label: string;
  text: string;
  isTerminal: boolean;
  feedback: string | null;
  cx: number;
  child: LayoutNode | null;
}
interface LayoutNode {
  index: number;
  question: string | null;
  bqDepth: number;
  cx: number;
  alts: LayoutAlt[];
}
interface PopupData {
  title: string;
  body: string;
  feedback?: string | null;
}
interface Props {
  introText: string;
  nodes: NodeData[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function wrapLines(s: string | null | undefined, n: number): [string, string | null] {
  if (!s) return ['', null];
  if (s.length <= n) return [s, null];
  const br = s.lastIndexOf(' ', n);
  if (br > 2) {
    const rest = s.slice(br + 1);
    return [s.slice(0, br), rest.length > n ? rest.slice(0, n - 1) + '…' : rest];
  }
  return [s.slice(0, n - 1) + '…', null];
}

function bqCY(depth: number): number {
  if (depth === 0) return PAD_TOP + NODE_H / 2;
  return PAD_TOP + NODE_H / 2 + INTRO_TO_BQ + (depth - 1) * BQ_STEP;
}
function altCY(d: number): number { return bqCY(d) + BQ_TO_ALT; }

// ─── Subtree width ──────────────────────────────────────────────────────────
function subtreeW(idx: number, nm: Map<number, NodeData>, vis: Set<number> = new Set()): number {
  if (vis.has(idx)) return SLOT_W;
  vis.add(idx);
  const n = nm.get(idx);
  if (!n) return SLOT_W;
  if (idx === 0) return subtreeW(1, nm, vis);
  const alts = n.alternatives ?? [];
  if (!alts.length) return SLOT_W;
  return alts.reduce((s, a) => s + (a.nextContentId === -1 ? SLOT_W : subtreeW(a.nextContentId, nm, new Set(vis))), 0);
}

// ─── Layout builder ─────────────────────────────────────────────────────────
function buildLayout(idx: number, nm: Map<number, NodeData>, depth: number, sx: number, vis: Set<number> = new Set()): LayoutNode {
  if (vis.has(idx)) return { index: idx, question: null, bqDepth: depth, cx: sx + NODE_W / 2, alts: [] };
  vis.add(idx);
  const node = nm.get(idx) ?? { index: idx, question: null, alternatives: [] };

  if (idx === 0) {
    const child = nm.has(1) ? buildLayout(1, nm, depth + 1, sx, new Set(vis)) : null;
    const cx = child?.cx ?? sx + NODE_W / 2;
    return { index: 0, question: null, bqDepth: depth, cx, alts: [{ label: '', text: '', isTerminal: false, feedback: null, cx, child }] };
  }

  let curX = sx;
  const alts: LayoutAlt[] = (node.alternatives ?? []).map((alt, i) => {
    if (alt.nextContentId === -1) {
      const cx = curX + SLOT_W / 2; curX += SLOT_W;
      return { label: `A${i + 1}`, text: alt.text, isTerminal: true, feedback: alt.feedback ?? null, cx, child: null };
    }
    const w = subtreeW(alt.nextContentId, nm, new Set(vis));
    const child = buildLayout(alt.nextContentId, nm, depth + 1, curX, new Set(vis));
    curX += w;
    return { label: `A${i + 1}`, text: alt.text, isTerminal: false, feedback: null, cx: child.cx, child };
  });

  const cx = alts.length ? (alts[0].cx + alts[alts.length - 1].cx) / 2 : sx + NODE_W / 2;
  return { index: idx, question: node.question, bqDepth: depth, cx, alts };
}

function maxDepthOf(l: LayoutNode): number {
  let m = l.bqDepth;
  for (const a of l.alts) if (a.child) m = Math.max(m, maxDepthOf(a.child));
  return m;
}

// ─── SVG elements ────────────────────────────────────────────────────────────
type OnClick = (d: PopupData) => void;

function buildElements(layout: LayoutNode, introText: string, els: React.ReactElement[], ctr: { n: number }, onClick: OnClick): void {
  const k = () => ctr.n++;
  const cy = bqCY(layout.bqDepth);
  const isIntro = layout.index === 0;
  const rawLabel = isIntro ? introText : (layout.question ?? '');
  const isEmpty = !isIntro && !rawLabel.trim();
  const displayLabel = isEmpty ? '(No question)' : rawLabel;
  const [l1, l2] = wrapLines(displayLabel, LINE_CHARS);
  const nx = layout.cx - NODE_W / 2;
  const ny = cy - NODE_H / 2;

  els.push(
    <g key={k()} style={{ cursor: 'pointer' }} onClick={() => onClick({ title: isIntro ? 'Introduction' : 'Branching Question', body: isEmpty ? 'This node has no question text. Try regenerating.' : rawLabel })}>
      <rect x={nx} y={ny} width={NODE_W} height={NODE_H} rx={NODE_RX} fill={isIntro ? C_INTRO : C_BQ} opacity={isEmpty ? 0.55 : 1} />
      {isIntro && <text x={nx + 9} y={ny + 11} fill="rgba(255,255,255,0.4)" fontSize={8} fontFamily="system-ui,sans-serif">T</text>}
      {isEmpty && <text x={nx + NODE_W - 10} y={ny + 13} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={12} fontFamily="system-ui,sans-serif">⚠</text>}
      {l2 ? (
        <>
          <text x={layout.cx} y={cy - 6} textAnchor="middle" fill={isEmpty ? 'rgba(255,255,255,0.7)' : 'white'} fontSize={11} fontWeight={isEmpty ? 400 : 600} fontStyle={isEmpty ? 'italic' : 'normal'} fontFamily="system-ui,sans-serif">{l1}</text>
          <text x={layout.cx} y={cy + 9} textAnchor="middle" fill={isEmpty ? 'rgba(255,255,255,0.7)' : 'white'} fontSize={11} fontWeight={isEmpty ? 400 : 600} fontStyle={isEmpty ? 'italic' : 'normal'} fontFamily="system-ui,sans-serif">{l2}</text>
        </>
      ) : (
        <text x={layout.cx} y={cy + 4} textAnchor="middle" fill={isEmpty ? 'rgba(255,255,255,0.7)' : 'white'} fontSize={11} fontWeight={isEmpty ? 400 : 600} fontStyle={isEmpty ? 'italic' : 'normal'} fontFamily="system-ui,sans-serif">{l1}</text>
      )}
    </g>
  );

  for (const alt of layout.alts) {
    if (alt.label === '') {
      if (alt.child) {
        const ccy = bqCY(alt.child.bqDepth);
        els.push(<line key={k()} x1={layout.cx} y1={cy + NODE_H / 2} x2={alt.child.cx} y2={ccy - NODE_H / 2} stroke={C_LINE} strokeWidth={1.5} />);
        buildElements(alt.child, introText, els, ctr, onClick);
      }
      continue;
    }
    const acy = altCY(layout.bqDepth);
    els.push(<line key={k()} x1={layout.cx} y1={cy + NODE_H / 2} x2={alt.cx} y2={acy - ALT_R} stroke={C_LINE} strokeWidth={1.5} />);
    els.push(
      <g key={k()} style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); onClick({ title: alt.label, body: alt.text, feedback: alt.feedback }); }}>
        <circle cx={alt.cx} cy={acy} r={ALT_R} fill={alt.isTerminal ? C_END : C_ALT} />
        <text x={alt.cx} y={acy + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight={700} fontFamily="system-ui,sans-serif">{alt.label}</text>
      </g>
    );
    if (!alt.isTerminal && alt.child) {
      const ccy = bqCY(alt.child.bqDepth);
      els.push(<line key={k()} x1={alt.cx} y1={acy + ALT_R} x2={alt.child.cx} y2={ccy - NODE_H / 2} stroke={C_LINE} strokeWidth={1.5} />);
      buildElements(alt.child, introText, els, ctr, onClick);
    }
  }
}

function buildLegendRows(layout: LayoutNode, rows: { label: string; text: string; feedback: string | null }[]): void {
  for (const a of layout.alts) {
    if (a.label && a.text) rows.push({ label: a.label, text: a.text, feedback: a.feedback });
    if (a.child) buildLegendRows(a.child, rows);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BranchingScenarioTreeView({ introText, nodes }: Props) {
  // Pan state — in SVG coordinate space
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [popup, setPopup] = useState<PopupData | null>(null);
  const dragging = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const lastMouse = useRef({ x: 0, y: 0 });

  const { svgEls, svgW, svgH, legendRows } = useMemo(() => {
    if (!nodes || nodes.length === 0) return { svgEls: [], svgW: 400, svgH: 200, legendRows: [] };
    const nm = new Map(nodes.map(n => [n.index, n]));
    const svgW = subtreeW(0, nm) + PAD_X * 2;
    const layout = buildLayout(0, nm, 0, PAD_X);
    const deepest = maxDepthOf(layout);
    const svgH = altCY(deepest) + ALT_R + PAD_TOP;
    const ctr = { n: 0 };
    const svgEls: React.ReactElement[] = [];
    buildElements(layout, introText, svgEls, ctr, d => setPopup(d));
    const legendRows: { label: string; text: string; feedback: string | null }[] = [];
    buildLegendRows(layout, legendRows);
    return { svgEls, svgW, svgH, legendRows };
  }, [nodes, introText]);

  // Reset pan when content changes
  useEffect(() => { setPan({ x: 0, y: 0 }); }, [svgW, svgH]);

  // Convert screen-space mouse delta → SVG-space delta using current CSS scale
  function screenToSvg(dx: number, dy: number): { x: number; y: number } {
    const el = svgRef.current;
    if (!el) return { x: dx, y: dy };
    const rect = el.getBoundingClientRect();
    // CSS scale applied by viewBox: svgW maps to rect.width in screen pixels
    const sx = svgW / rect.width;
    const sy = svgH / rect.height;
    return { x: dx * sx, y: dy * sy };
  }

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    const delta = screenToSvg(dx, dy);
    // Clamp: can't pan more than half the SVG size in either direction
    const maxPan = { x: svgW * 0.45, y: svgH * 0.45 };
    setPan(p => ({
      x: Math.max(-maxPan.x, Math.min(maxPan.x, p.x - delta.x)),
      y: Math.max(-maxPan.y, Math.min(maxPan.y, p.y - delta.y)),
    }));
  }, [svgW, svgH]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseUp = useCallback(() => { dragging.current = false; }, []);

  if (!nodes || nodes.length === 0) {
    return <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>No branching structure available.</div>;
  }

  // viewBox centers the tree, then pan shifts within SVG space
  const vbX = pan.x;
  const vbY = pan.y;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Canvas ── */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setPan({ x: 0, y: 0 })}
          title="Reset view"
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 10,
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
            padding: '4px 8px', fontSize: 11, color: '#374151', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
          }}
        >
          ⤢ Fit
        </button>

        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${svgW} ${svgH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            display: 'block',
            width: '100%',
            height: CANVAS_H,
            background: '#f9fafb',
            borderRadius: 8,
            cursor: dragging.current ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {svgEls}
        </svg>
      </div>

      {/* ── Click popup ── */}
      {popup && (
        <div style={{
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '14px 16px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          position: 'relative', fontSize: 13, color: '#111827', lineHeight: 1.5
        }}>
          <button onClick={() => setPopup(null)} style={{
            position: 'absolute', top: 10, right: 12, background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 16, color: '#9ca3af', lineHeight: 1, padding: 0
          }}>×</button>
          <div style={{ fontWeight: 600, fontSize: 11, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {popup.title}
          </div>
          <div style={{ fontSize: 13 }}>{popup.body}</div>
          {popup.feedback && (
            <div style={{ marginTop: 8, padding: '8px 10px', background: '#fef2f2', borderRadius: 6, color: '#dc2626', fontSize: 12 }}>
              <strong>Outcome: </strong>{popup.feedback}
            </div>
          )}
        </div>
      )}

      {/* ── Legend ── */}
      {legendRows.length > 0 && (
        <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#374151', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontWeight: 600, color: '#111827', marginBottom: 2 }}>Alternatives</div>
          {legendRows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{
                background: '#6b7280', color: 'white', borderRadius: '50%', width: 20, height: 20,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 1
              }}>{row.label}</span>
              <span>
                {row.text}
                {row.feedback && <span style={{ color: '#dc2626', marginLeft: 6 }}>→ {row.feedback.length > 60 ? row.feedback.slice(0, 59) + '…' : row.feedback}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
