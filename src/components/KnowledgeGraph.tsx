import { useEffect, useMemo, useState } from 'react';
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
import {
  BookOpen,
  ExternalLink,
  FileText,
  HelpCircle,
  ListTree,
  RotateCcw,
  Search,
  Target
} from 'lucide-react';
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

// Exported for graph-contract regression tests.
// eslint-disable-next-line react-refresh/only-export-components
export function buildGraph(coverageMap: CoverageMap) {
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

// Exported for graph-contract regression tests.
// eslint-disable-next-line react-refresh/only-export-components
export function focusedGraph(nodes: KnowledgeNode[], edges: Edge[], questionId?: string) {
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

function FullKnowledgeGraph({
  initialNodes,
  edges,
  visibleKinds,
  compact,
  onPreviewReference
}: {
  initialNodes: KnowledgeNode[];
  edges: Edge[];
  visibleKinds: KnowledgeNodeKind[];
  compact: boolean;
  onPreviewReference: (reference: SourceReference) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<KnowledgeNode>(initialNodes);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const relationTypes = useMemo(
    () => [...new Set(edges.map(edge => String(edge.label || '')).filter(Boolean))],
    [edges]
  );
  const [activeKinds, setActiveKinds] = useState(() => new Set(visibleKinds));
  const [activeRelations, setActiveRelations] = useState(() => new Set(relationTypes));

  useEffect(() => {
    setNodes(initialNodes);
    setSelectedNodeId(null);
    setFocusNodeId(null);
  }, [initialNodes, setNodes]);

  useEffect(() => setActiveKinds(new Set(visibleKinds)), [visibleKinds]);
  useEffect(() => setActiveRelations(new Set(relationTypes)), [relationTypes]);

  const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const focusNeighborhood = useMemo(() => {
    if (!focusNodeId) return null;
    const ids = new Set([focusNodeId]);
    edges.forEach(edge => {
      if (!activeRelations.has(String(edge.label || ''))) return;
      if (edge.source === focusNodeId) ids.add(edge.target);
      if (edge.target === focusNodeId) ids.add(edge.source);
    });
    return ids;
  }, [activeRelations, edges, focusNodeId]);
  const selectedNeighborhood = useMemo(() => {
    if (!selectedNodeId) return null;
    const ids = new Set([selectedNodeId]);
    edges.forEach(edge => {
      if (!activeRelations.has(String(edge.label || ''))) return;
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    });
    return ids;
  }, [activeRelations, edges, selectedNodeId]);

  const displayedNodes = nodes.map(node => {
    const hidden = !activeKinds.has(node.data.kind)
      || Boolean(focusNeighborhood && !focusNeighborhood.has(node.id));
    const isDimmed = Boolean(selectedNeighborhood && !selectedNeighborhood.has(node.id));
    return {
      ...node,
      hidden,
      style: {
        ...node.style,
        opacity: isDimmed ? 0.16 : 1,
        transition: 'opacity 160ms ease'
      }
    };
  });
  const visibleNodeIds = new Set(displayedNodes.filter(node => !node.hidden).map(node => node.id));
  const displayedEdges = edges.map(edge => {
    const relation = String(edge.label || '');
    const isConnected = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId;
    return {
      ...edge,
      hidden: !activeRelations.has(relation)
        || !visibleNodeIds.has(edge.source)
        || !visibleNodeIds.has(edge.target),
      animated: Boolean(selectedNodeId && isConnected),
      style: {
        ...edge.style,
        strokeWidth: selectedNodeId && isConnected ? 2.8 : 1.4,
        opacity: selectedNodeId && !isConnected ? 0.1 : 0.9
      },
      labelStyle: {
        ...edge.labelStyle,
        fill: selectedNodeId && !isConnected ? 'transparent' : '#dbeafe'
      },
      labelBgStyle: {
        ...edge.labelBgStyle,
        fill: '#0b2838',
        fillOpacity: selectedNodeId && !isConnected ? 0 : 0.88
      }
    };
  });
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const selectedEdges = selectedNode
    ? edges.filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id)
    : [];

  const selectSearchResult = (value: string) => {
    setSearchQuery(value);
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;
    const match = nodes.find(node => (
      `${node.data.eyebrow} ${node.data.label} ${node.data.meta || ''}`.toLowerCase().includes(normalized)
    ));
    if (match) {
      setSelectedNodeId(match.id);
      setFocusNodeId(null);
    }
  };

  const resetView = () => {
    setSelectedNodeId(null);
    setFocusNodeId(null);
    setSearchQuery('');
    setActiveKinds(new Set(visibleKinds));
    setActiveRelations(new Set(relationTypes));
  };

  return (
    <div className={`knowledge-graph-shell knowledge-explorer-shell${compact ? ' is-compact' : ''}`}>
      <aside className="knowledge-focused-sidebar knowledge-explorer-sidebar">
        <section>
          <h5>Explore Coverage</h5>
          <label className="knowledge-search">
            <Search size={14} />
            <input
              value={searchQuery}
              onChange={event => selectSearchResult(event.target.value)}
              placeholder="Search nodes"
            />
          </label>
          <p className="knowledge-explorer-help">Drag nodes to arrange the map. Select a node to inspect it; double-click to isolate its direct connections.</p>
        </section>

        <section>
          <h5>Node Labels</h5>
          <div className="knowledge-kind-filters">
            {visibleKinds.map(kind => {
              const count = nodes.filter(node => node.data.kind === kind).length;
              return (
                <button
                  key={kind}
                  type="button"
                  className={activeKinds.has(kind) ? 'is-active' : ''}
                  onClick={() => setActiveKinds(previous => {
                    const next = new Set(previous);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    return next;
                  })}
                >
                  <i style={{ background: NODE_COLORS[kind] }} />
                  <span>{kind}</span>
                  <small>{count}</small>
                </button>
              );
            })}
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
          <section className="knowledge-explorer-selection">
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
            {selectedNode.data.kind === 'evidence' && selectedNode.data.reference?.materialId && (
              <button
                type="button"
                className="knowledge-source-button"
                onClick={() => onPreviewReference(selectedNode.data.reference as SourceReference)}
              >
                <ExternalLink size={14} /> Open cited source
              </button>
            )}
          </section>
        )}

        <button type="button" className="knowledge-reset-button" onClick={resetView}>
          <RotateCcw size={14} /> Show complete map
        </button>
      </aside>

      <div className="knowledge-graph-canvas knowledge-explorer-canvas">
        <ReactFlow
          nodes={displayedNodes}
          edges={displayedEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: compact ? 1.1 : 0.95 }}
          minZoom={0.12}
          maxZoom={2.2}
          nodesConnectable={false}
          onPaneClick={() => setSelectedNodeId(null)}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onNodeDoubleClick={(_, node) => {
            setSelectedNodeId(node.id);
            setFocusNodeId(previous => previous === node.id ? null : node.id);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="rgba(148, 163, 184, 0.24)" />
          <Controls showInteractive={false} />
          {!compact && (
            <MiniMap
              pannable
              zoomable
              nodeColor={node => NODE_COLORS[(node.data as KnowledgeNodeData).kind]}
              maskColor="rgba(9, 31, 45, 0.72)"
            />
          )}
        </ReactFlow>
      </div>
    </div>
  );
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
  if (graph.nodes.length === 0) {
    return <div className="knowledge-graph-empty">No linked evidence is available for this question yet.</div>;
  }

  const visibleKinds = (['material', 'evidence', 'objective', 'subpoint', 'question'] as KnowledgeNodeKind[])
    .filter(kind => graph.nodes.some(node => node.data.kind === kind));

  if (focusQuestionId) {
    return (
      <>
        <FullKnowledgeGraph
          initialNodes={graph.nodes}
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
    <>
      <FullKnowledgeGraph
        initialNodes={graph.nodes}
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
