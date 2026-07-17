import { RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  useNodesState
} from '@xyflow/react';
import { BookOpen, FileText, Focus, HelpCircle, ListTree, Target } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import { CoverageMap, SourceReference } from '../services/api';
import SourceReferencePreviewModal from './SourceReferencePreviewModal';
import '../styles/components/KnowledgeGraph.css';

type KnowledgeNodeKind = 'material' | 'evidence' | 'objective' | 'subpoint' | 'question';

interface KnowledgeNodeData extends Record<string, unknown> {
  kind: KnowledgeNodeKind;
  eyebrow: string;
  label: string;
  meta?: string;
  status?: 'covered' | 'needs-questions';
  reference?: SourceReference;
  isFocused?: boolean;
}

type KnowledgeNode = Node<KnowledgeNodeData, 'knowledge'>;

const NODE_COLORS: Record<KnowledgeNodeKind, string> = {
  material: '#c59b57',
  evidence: '#3f9d68',
  objective: '#2878b5',
  subpoint: '#2f8795',
  question: '#e05252'
};

const NODE_ICONS = {
  material: BookOpen,
  evidence: FileText,
  objective: Target,
  subpoint: ListTree,
  question: HelpCircle
};

function KnowledgeNodeBubble({ data, selected }: NodeProps<KnowledgeNode>) {
  const Icon = NODE_ICONS[data.kind];
  const canPreview = data.kind === 'evidence' && Boolean(data.reference?.materialId);

  return (
    <article
      className={`knowledge-node knowledge-node-${data.kind}${selected ? ' is-selected' : ''}${data.isFocused ? ' is-focused' : ''}${canPreview ? ' is-previewable' : ''}`}
      title={canPreview ? 'Open the cited source' : `${data.eyebrow}: ${data.label}`}
    >
      <Handle type="target" position={Position.Left} />
      <span className="knowledge-node-icon"><Icon size={16} /></span>
      <span className="knowledge-node-eyebrow">{data.eyebrow}</span>
      <strong>{data.label}</strong>
      {data.meta && <small>{data.meta}</small>}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

const nodeTypes = { knowledge: KnowledgeNodeBubble };

function referenceKey(reference: SourceReference) {
  return [
    reference.materialId || reference.materialName || reference.sourceFile || 'unknown',
    reference.pageNumber ?? 'no-page',
    reference.chunkIndex ?? 'no-chunk',
    reference.excerpt?.slice(0, 80) || 'no-excerpt'
  ].join('::');
}

function shortText(value = '', limit = 86) {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

function normalizedWords(value = '') {
  return new Set(value.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

function overlapScore(left = '', right = '') {
  const leftWords = normalizedWords(left);
  const rightWords = normalizedWords(right);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  return [...leftWords].filter(word => rightWords.has(word)).length / Math.min(leftWords.size, rightWords.size);
}

function buildGraph(coverageMap: CoverageMap) {
  const nodes: KnowledgeNode[] = [];
  const edges: Edge[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const evidenceNodes = new Map<string, KnowledgeNode>();
  const materialNodeIds = new Map<string, string>();
  let evidenceIndex = 0;

  const addNode = (node: KnowledgeNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };

  const addEdge = (source: string, target: string, label: string, color: string, dashed = false) => {
    const id = `${source}-${target}-${label}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({
      id,
      source,
      target,
      label,
      type: 'default',
      style: { stroke: color, strokeWidth: 1.35, strokeDasharray: dashed ? '5 5' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      labelStyle: { fill: '#64748b', fontSize: 9, fontWeight: 700 },
      labelBgStyle: { fill: 'rgba(255,255,255,0.88)' },
      labelBgPadding: [4, 2]
    });
  };

  coverageMap.materials.forEach(material => {
    const id = `material-${material.id}`;
    materialNodeIds.set(material.id, id);
    materialNodeIds.set(material.name.toLowerCase(), id);
    addNode({
      id,
      type: 'knowledge',
      position: { x: 0, y: 0 },
      data: {
        kind: 'material',
        eyebrow: material.type?.toUpperCase() || 'MATERIAL',
        label: shortText(material.name, 55),
        meta: 'Material'
      }
    });
  });

  const ensureEvidenceNode = (reference: SourceReference) => {
    const key = referenceKey(reference);
    const existing = evidenceNodes.get(key);
    if (existing) return existing;

    const location = typeof reference.pageNumber === 'number'
      ? `Page ${reference.pageNumber}`
      : reference.section || 'Evidence';
    const sourceName = reference.materialName || reference.sourceFile || 'Course material';
    const node: KnowledgeNode = {
      id: `evidence-${++evidenceIndex}`,
      type: 'knowledge',
      position: { x: 0, y: 0 },
      data: {
        kind: 'evidence',
        eyebrow: location,
        label: shortText(reference.excerpt || reference.section || 'Referenced passage'),
        meta: shortText(sourceName, 34),
        reference
      }
    };
    addNode(node);
    evidenceNodes.set(key, node);

    const materialId = reference.materialId
      ? materialNodeIds.get(reference.materialId)
      : materialNodeIds.get(sourceName.toLowerCase());
    if (materialId) addEdge(materialId, node.id, 'contains', '#94a3b8');
    return node;
  };

  coverageMap.topics.forEach(topic => {
    topic.subtopics.forEach(subtopic => {
      const lo = subtopic.learningObjective;
      const loNodeId = `objective-${lo.id}`;
      addNode({
        id: loNodeId,
        type: 'knowledge',
        position: { x: 0, y: 0 },
        data: {
          kind: 'objective',
          eyebrow: `LO ${lo.order + 1}`,
          label: shortText(lo.text, 105),
          meta: lo.bloomLevel || topic.label,
          status: subtopic.coverageStatus
        }
      });

      const objectiveReferences = lo.sourceReferences?.length
        ? lo.sourceReferences
        : subtopic.sourceReferences;
      objectiveReferences.forEach(reference => {
        const evidenceNode = ensureEvidenceNode(reference);
        addEdge(evidenceNode.id, loNodeId, 'supports', NODE_COLORS.objective);
      });

      const subpointNodes = (lo.subpoints || []).map((subpoint, index) => {
        const id = `subpoint-${lo.id}-${index}`;
        addNode({
          id,
          type: 'knowledge',
          position: { x: 0, y: 0 },
          data: {
            kind: 'subpoint',
            eyebrow: `Focus ${index + 1}`,
            label: shortText(subpoint, 72),
            meta: `LO ${lo.order + 1}`
          }
        });
        addEdge(loNodeId, id, 'includes', NODE_COLORS.subpoint);
        return { id, text: subpoint };
      });

      subtopic.linkedQuestions.forEach(question => {
        const questionNodeId = `question-${question.id}`;
        addNode({
          id: questionNodeId,
          type: 'knowledge',
          position: { x: 0, y: 0 },
          data: {
            kind: 'question',
            eyebrow: question.type.replace(/-/g, ' ').toUpperCase(),
            label: shortText(question.text, 105),
            meta: [question.difficulty, question.bloomLevel].filter(Boolean).join(' · ')
          }
        });
        addEdge(loNodeId, questionNodeId, 'assesses', NODE_COLORS.question);

        const questionFocus = [question.subObjective, question.plannedSlice, question.focusArea]
          .filter(Boolean)
          .join(' ');
        const bestSubpoint = subpointNodes
          .map(subpoint => ({ ...subpoint, score: overlapScore(questionFocus, subpoint.text) }))
          .sort((a, b) => b.score - a.score)[0];
        if (bestSubpoint?.score >= 0.15) {
          addEdge(bestSubpoint.id, questionNodeId, 'focuses', NODE_COLORS.subpoint, true);
        } else if (questionFocus) {
          const focusNodeId = `question-focus-${question.id}`;
          addNode({
            id: focusNodeId,
            type: 'knowledge',
            position: { x: 0, y: 0 },
            data: {
              kind: 'subpoint',
              eyebrow: 'Question focus',
              label: shortText(questionFocus, 72),
              meta: `LO ${lo.order + 1}`
            }
          });
          addEdge(focusNodeId, questionNodeId, 'focuses', NODE_COLORS.subpoint, true);
        }

        (question.sourceReferences || []).forEach(reference => {
          const evidenceNode = ensureEvidenceNode(reference);
          addEdge(evidenceNode.id, questionNodeId, 'grounds', NODE_COLORS.evidence, true);
        });
      });
    });
  });

  return { nodes, edges };
}

function focusedGraph(nodes: KnowledgeNode[], edges: Edge[], questionId?: string) {
  if (!questionId) return { nodes, edges };
  const focusId = `question-${questionId}`;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  if (!nodeById.has(focusId)) return { nodes: [], edges: [] };

  const edgeLabel = (edge: Edge) => String(edge.label || '');
  const objectiveEdges = edges
    .filter(edge => edge.target === focusId && edgeLabel(edge) === 'assesses')
    .slice(0, 1);
  const focusEdges = edges
    .filter(edge => edge.target === focusId && edgeLabel(edge) === 'focuses')
    .slice(0, 1);
  const evidenceEdges = edges
    .filter(edge => edge.target === focusId && edgeLabel(edge) === 'grounds')
    .sort((left, right) => {
      const leftScore = Number(nodeById.get(left.source)?.data.reference?.relevanceScore || 0);
      const rightScore = Number(nodeById.get(right.source)?.data.reference?.relevanceScore || 0);
      return rightScore - leftScore;
    })
    .slice(0, 3);
  const evidenceIds = new Set(evidenceEdges.map(edge => edge.source));
  const materialEdges = edges.filter(edge => (
    evidenceIds.has(edge.target) && edgeLabel(edge) === 'contains'
  ));
  const selectedEdges = [...objectiveEdges, ...focusEdges, ...evidenceEdges, ...materialEdges]
    .map(edge => ({
      ...edge,
      zIndex: 3,
      style: {
        ...edge.style,
        strokeWidth: edgeLabel(edge) === 'grounds' ? 2.6 : 2.2,
        opacity: 0.9
      }
    }));
  const keep = new Set([
    focusId,
    ...selectedEdges.flatMap(edge => [edge.source, edge.target])
  ]);

  return {
    nodes: nodes
      .filter(node => keep.has(node.id))
      .map(node => ({ ...node, data: { ...node.data, isFocused: node.id === focusId } })),
    edges: selectedEdges
  };
}

function focusedLayout(nodes: KnowledgeNode[], edges: Edge[], questionId: string) {
  const focusId = `question-${questionId}`;
  const evidenceNodes = nodes.filter(node => node.data.kind === 'evidence');
  const materialNodes = nodes.filter(node => node.data.kind === 'material');
  const objectiveNode = nodes.find(node => node.data.kind === 'objective');
  const subpointNode = nodes.find(node => node.data.kind === 'subpoint');

  const evidencePositions = evidenceNodes.map((node, index) => ({
    id: node.id,
    x: 330,
    y: 155 + index * 190
  }));
  const evidencePositionById = new Map(evidencePositions.map(position => [position.id, position]));
  const materialPositions = materialNodes.map((node, index) => {
    const connectedEvidence = edges
      .filter(edge => edge.source === node.id)
      .map(edge => evidencePositionById.get(edge.target))
      .filter(Boolean) as Array<{ id: string; x: number; y: number }>;
    const averageY = connectedEvidence.length
      ? connectedEvidence.reduce((sum, position) => sum + position.y, 0) / connectedEvidence.length
      : 220 + index * 170;
    return { id: node.id, x: 70, y: averageY };
  });
  const fixedPositions = new Map([
    [focusId, { x: 760, y: 320 }],
    ...(objectiveNode ? [[objectiveNode.id, { x: 525, y: 115 }] as const] : []),
    ...(subpointNode ? [[subpointNode.id, { x: 530, y: 555 }] as const] : []),
    ...evidencePositions.map(position => [position.id, { x: position.x, y: position.y }] as const),
    ...materialPositions.map(position => [position.id, { x: position.x, y: position.y }] as const)
  ]);

  return nodes.map(node => ({
    ...node,
    position: fixedPositions.get(node.id) || { x: 520, y: 320 }
  }));
}

function nodeProperties(node: KnowledgeNode) {
  const reference = node.data.reference;
  return [
    ['Type', node.data.kind],
    ['Label', node.data.label],
    ['Context', node.data.eyebrow],
    ['Meta', node.data.meta],
    ['Material', reference?.materialName || reference?.sourceFile],
    ['Page', typeof reference?.pageNumber === 'number' ? String(reference.pageNumber) : undefined],
    ['Section', reference?.section]
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;
}

function useMeasuredRelations(
  containerRef: RefObject<HTMLDivElement>,
  nodeRefs: RefObject<Map<string, HTMLElement>>,
  nodes: KnowledgeNode[],
  edges: Edge[],
  activeRelations: Set<string>
) {
  const [paths, setPaths] = useState<Array<{ id: string; label: string; color: string; path: string }>>([]);

  useLayoutEffect(() => {
    const calculate = () => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const nextPaths = edges.flatMap(edge => {
        const label = String(edge.label || '');
        if (!activeRelations.has(label)) return [];
        const sourceElement = nodeRefs.current.get(edge.source);
        const targetElement = nodeRefs.current.get(edge.target);
        if (!sourceElement || !targetElement) return [];

        const source = sourceElement.getBoundingClientRect();
        const target = targetElement.getBoundingClientRect();
        const sourceX = source.left - containerRect.left + source.width / 2;
        const sourceY = source.top - containerRect.top + source.height / 2;
        const targetX = target.left - containerRect.left + target.width / 2;
        const targetY = target.top - containerRect.top + target.height / 2;
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const sourceRadius = Math.min(source.width, source.height) / 2;
        const targetRadius = Math.min(target.width, target.height) / 2;
        const startX = sourceX + (dx / distance) * sourceRadius;
        const startY = sourceY + (dy / distance) * sourceRadius;
        const endX = targetX - (dx / distance) * (targetRadius + 6);
        const endY = targetY - (dy / distance) * (targetRadius + 6);
        const curve = Math.min(180, Math.max(70, Math.abs(endX - startX) * 0.42));
        const path = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;

        return [{
          id: edge.id,
          label,
          color: String(edge.style?.stroke || '#64748b'),
          path
        }];
      });
      setPaths(nextPaths);
    };

    calculate();
    const resizeObserver = new ResizeObserver(calculate);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    nodeRefs.current.forEach(element => resizeObserver.observe(element));
    window.addEventListener('resize', calculate);
    const timer = window.setTimeout(calculate, 120);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', calculate);
      window.clearTimeout(timer);
    };
  }, [activeRelations, containerRef, edges, nodeRefs, nodes]);

  return paths;
}

function FocusedNodeBubble({
  node,
  selected,
  registerNode,
  onSelect
}: {
  node: KnowledgeNode;
  selected: boolean;
  registerNode: (id: string) => (element: HTMLElement | null) => void;
  onSelect: (node: KnowledgeNode) => void;
}) {
  const Icon = NODE_ICONS[node.data.kind];
  const canPreview = node.data.kind === 'evidence' && Boolean(node.data.reference?.materialId);

  return (
    <button
      ref={registerNode(node.id)}
      type="button"
      className={`knowledge-node knowledge-focused-node knowledge-node-${node.data.kind}${node.data.isFocused ? ' is-focused' : ''}${selected ? ' is-selected' : ''}${canPreview ? ' is-previewable' : ''}`}
      onClick={() => onSelect(node)}
      title={canPreview ? 'Open the cited source' : `${node.data.eyebrow}: ${node.data.label}`}
    >
      <span className="knowledge-node-icon"><Icon size={16} /></span>
      <span className="knowledge-node-eyebrow">{node.data.eyebrow}</span>
      <strong>{node.data.label}</strong>
      {node.data.meta && <small>{node.data.meta}</small>}
    </button>
  );
}

function FocusedKnowledgeGraph({
  nodes,
  edges,
  visibleKinds,
  compact,
  onPreviewReference
}: {
  nodes: KnowledgeNode[];
  edges: Edge[];
  visibleKinds: KnowledgeNodeKind[];
  compact: boolean;
  onPreviewReference: (reference: SourceReference) => void;
}) {
  const markerPrefix = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const relationTypes = useMemo(() => [...new Set(edges.map(edge => String(edge.label || '')).filter(Boolean))], [edges]);
  const [activeRelations, setActiveRelations] = useState(() => new Set(relationTypes));
  const [selectedNodeId, setSelectedNodeId] = useState(nodes.find(node => node.data.kind === 'question')?.id || nodes[0]?.id);

  useEffect(() => {
    setActiveRelations(new Set(relationTypes));
  }, [relationTypes]);

  useEffect(() => {
    setSelectedNodeId(nodes.find(node => node.data.kind === 'question')?.id || nodes[0]?.id);
  }, [nodes]);

  const paths = useMeasuredRelations(containerRef, nodeRefs, nodes, edges, activeRelations);
  const selectedNode = nodes.find(node => node.id === selectedNodeId) || nodes[0];
  const selectedEdges = selectedNode
    ? edges.filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id)
    : [];

  const registerNode = (id: string) => (element: HTMLElement | null) => {
    if (element) {
      nodeRefs.current.set(id, element);
    } else {
      nodeRefs.current.delete(id);
    }
  };

  const positionedNodes = nodes.map((node, index) => {
    const sameKindIndex = nodes.filter(candidate => candidate.data.kind === node.data.kind).findIndex(candidate => candidate.id === node.id);
    const evidencePositions = [
      { left: '29%', top: '16%' },
      { left: '29%', top: '42%' },
      { left: '29%', top: '68%' }
    ];
    const positionByKind: Record<KnowledgeNodeKind, { left: string; top: string }> = {
      material: { left: '8%', top: '43%' },
      evidence: evidencePositions[sameKindIndex] || { left: '29%', top: `${22 + sameKindIndex * 18}%` },
      objective: { left: '55%', top: '17%' },
      subpoint: { left: '55%', top: '67%' },
      question: { left: '81%', top: '43%' }
    };
    return { node, style: positionByKind[node.data.kind] || { left: '50%', top: `${35 + index * 8}%` } };
  });

  return (
    <div className={`knowledge-graph-shell knowledge-focused-shell${compact ? ' is-compact' : ''}`}>
      <aside className="knowledge-focused-sidebar">
        <section>
          <h5>Node Labels</h5>
          <div className="knowledge-filter-grid">
            {visibleKinds.map(kind => (
              <span key={kind}><i style={{ background: NODE_COLORS[kind] }} />{kind}</span>
            ))}
          </div>
        </section>
        <section>
          <h5>Relationship Types</h5>
          <div className="knowledge-relation-filters">
            {relationTypes.map(type => (
              <button
                key={type}
                type="button"
                className={activeRelations.has(type) ? 'is-active' : ''}
                onClick={() => setActiveRelations(previous => {
                  const next = new Set(previous);
                  if (next.has(type)) next.delete(type);
                  else next.add(type);
                  return next;
                })}
              >
                {type}
              </button>
            ))}
          </div>
        </section>
        {selectedNode && (
          <section>
            <h5>Selected Node</h5>
            <div className="knowledge-selected-properties">
              {nodeProperties(selectedNode).map(([key, value]) => (
                <p key={key}><strong>{key}:</strong> {value}</p>
              ))}
            </div>
            {selectedEdges.length > 0 && (
              <div className="knowledge-selected-edges">
                {selectedEdges.map(edge => (
                  <span key={edge.id}>{String(edge.label || 'related')}</span>
                ))}
              </div>
            )}
          </section>
        )}
      </aside>

      <div className="knowledge-focused-canvas" ref={containerRef}>
        <svg className="knowledge-focused-svg" aria-hidden="true">
          <defs>
            {paths.map(path => (
              <marker
                key={path.id}
                id={`${markerPrefix}-${path.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={path.color} />
              </marker>
            ))}
          </defs>
          {paths.map(path => (
            <path
              key={path.id}
              className="knowledge-focused-relation"
              d={path.path}
              stroke={path.color}
              markerEnd={`url(#${markerPrefix}-${path.id.replace(/[^a-zA-Z0-9_-]/g, '-')})`}
            />
          ))}
        </svg>
        {positionedNodes.map(({ node, style }) => (
          <div key={node.id} className="knowledge-focused-node-position" style={style}>
            <FocusedNodeBubble
              node={node}
              selected={selectedNodeId === node.id}
              registerNode={registerNode}
              onSelect={(selected) => {
                setSelectedNodeId(selected.id);
                const reference = selected.data.reference as SourceReference | undefined;
                if (reference?.materialId) onPreviewReference(reference);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function hashValue(value: string) {
  return [...value].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

function forceLayout(nodes: KnowledgeNode[], edges: Edge[], focusQuestionId?: string) {
  if (nodes.length === 0) return nodes;
  const focusId = focusQuestionId ? `question-${focusQuestionId}` : null;
  const state = nodes.map((node, index) => {
    const seed = Math.abs(hashValue(node.id));
    const angle = ((seed % 360) / 180) * Math.PI;
    const radius = focusId ? 210 + (index % 4) * 70 : 150 + (seed % 520);
    return {
      id: node.id,
      x: node.id === focusId ? 0 : Math.cos(angle) * radius,
      y: node.id === focusId ? 0 : Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      pinned: node.id === focusId
    };
  });
  const byId = new Map(state.map(item => [item.id, item]));

  for (let tick = 0; tick < 220; tick += 1) {
    for (let leftIndex = 0; leftIndex < state.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < state.length; rightIndex += 1) {
        const left = state[leftIndex];
        const right = state[rightIndex];
        const dx = right.x - left.x || 0.01;
        const dy = right.y - left.y || 0.01;
        const distanceSquared = Math.max(900, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(4.5, 24000 / distanceSquared);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        if (!left.pinned) { left.vx -= fx; left.vy -= fy; }
        if (!right.pinned) { right.vx += fx; right.vy += fy; }
      }
    }

    edges.forEach(edge => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return;
      const dx = target.x - source.x || 0.01;
      const dy = target.y - source.y || 0.01;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = focusId ? 230 : 205;
      const force = (distance - desired) * 0.012;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      if (!source.pinned) { source.vx += fx; source.vy += fy; }
      if (!target.pinned) { target.vx -= fx; target.vy -= fy; }
    });

    state.forEach(item => {
      if (item.pinned) return;
      item.vx += -item.x * 0.0035;
      item.vy += -item.y * 0.0035;
      item.vx *= 0.76;
      item.vy *= 0.76;
      item.x += item.vx;
      item.y += item.vy;
    });
  }

  return nodes.map(node => {
    const layout = byId.get(node.id)!;
    return { ...node, position: { x: layout.x + 720, y: layout.y + 520 } };
  });
}

interface KnowledgeGraphProps {
  coverageMap: CoverageMap;
  focusQuestionId?: string;
  compact?: boolean;
}

export default function KnowledgeGraph({ coverageMap, focusQuestionId, compact = false }: KnowledgeGraphProps) {
  const [selectedReference, setSelectedReference] = useState<SourceReference | null>(null);
  const graph = useMemo(() => {
    const complete = buildGraph(coverageMap);
    const filtered = focusedGraph(complete.nodes, complete.edges, focusQuestionId);
    return {
      nodes: focusQuestionId
        ? focusedLayout(filtered.nodes, filtered.edges, focusQuestionId)
        : forceLayout(filtered.nodes, filtered.edges),
      edges: filtered.edges
    };
  }, [coverageMap, focusQuestionId]);
  const [nodes, setNodes, onNodesChange] = useNodesState<KnowledgeNode>(graph.nodes);

  useEffect(() => setNodes(graph.nodes), [graph.nodes, setNodes]);

  if (graph.nodes.length === 0) {
    return <div className="knowledge-graph-empty">No linked evidence is available for this question yet.</div>;
  }

  const visibleKinds = (['material', 'evidence', 'objective', 'subpoint', 'question'] as KnowledgeNodeKind[])
    .filter(kind => graph.nodes.some(node => node.data.kind === kind));

  if (focusQuestionId) {
    return (
      <>
        <FocusedKnowledgeGraph
          nodes={graph.nodes}
          edges={graph.edges}
          visibleKinds={visibleKinds}
          compact={compact}
          onPreviewReference={setSelectedReference}
        />
        {selectedReference && (
          <SourceReferencePreviewModal
            reference={selectedReference}
            onClose={() => setSelectedReference(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className={`knowledge-graph-shell${compact ? ' is-compact' : ''}`}>
      <div className="knowledge-graph-legend" aria-label="Knowledge graph legend">
        {visibleKinds.map(kind => (
          <span key={kind}><i style={{ background: NODE_COLORS[kind] }} />{kind}</span>
        ))}
        <small><Focus size={12} /> Drag nodes or select evidence to inspect its source.</small>
      </div>
      <div className="knowledge-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.28, maxZoom: compact ? 1.15 : 1 }}
          minZoom={0.15}
          maxZoom={2.2}
          nodesConnectable={false}
          onNodeClick={(_, node) => {
            const reference = node.data.reference as SourceReference | undefined;
            if (reference?.materialId) setSelectedReference(reference);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#cbd5e1" />
          <Controls showInteractive={false} />
          {!compact && (
            <MiniMap
              pannable
              zoomable
              nodeColor={node => NODE_COLORS[(node.data as KnowledgeNodeData).kind]}
              maskColor="rgba(248, 250, 252, 0.78)"
            />
          )}
        </ReactFlow>
      </div>
      {selectedReference && (
        <SourceReferencePreviewModal
          reference={selectedReference}
          onClose={() => setSelectedReference(null)}
        />
      )}
    </div>
  );
}
