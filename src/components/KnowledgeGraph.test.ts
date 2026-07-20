import { describe, expect, it } from 'vitest';
import { CoverageMap } from '../services/api';
import { buildGraph, focusedGraph } from './KnowledgeGraph';

const coverageMap: CoverageMap = {
  quizId: 'quiz-1',
  generatedAt: new Date(0).toISOString(),
  materials: [{ id: 'material-1', name: 'Mechanics notes', type: 'pdf', processingStatus: 'completed' }],
  summary: {
    topicCount: 1,
    learningObjectiveCount: 1,
    linkedQuestionCount: 1,
    uncoveredLearningObjectiveCount: 0
  },
  topics: [{
    id: 'topic-1',
    label: 'Forces',
    sourceReferences: [],
    linkedLearningObjectiveIds: ['lo-1'],
    linkedQuestionIds: ['question-1'],
    subtopics: [{
      id: 'subtopic-1',
      label: 'Friction',
      learningObjective: {
        id: 'lo-1',
        text: 'Calculate friction forces on an inclined plane.',
        order: 0,
        bloomLevel: 'apply',
        subpoints: ['Distinguish static and kinetic friction.'],
        sourceReferences: [{
          materialId: 'material-1',
          materialName: 'Mechanics notes',
          pageNumber: 4,
          excerpt: 'Static friction acts before sliding and kinetic friction acts during sliding.'
        }]
      },
      sourceReferences: [],
      linkedQuestions: [{
        id: 'question-1',
        type: 'multiple-choice',
        text: 'Which force acts before the block begins sliding?',
        order: 0,
        difficulty: 'moderate',
        focusArea: 'Distinguish static and kinetic friction.',
        sourceReferences: [{
          materialId: 'material-1',
          materialName: 'Mechanics notes',
          pageNumber: 4,
          excerpt: 'Static friction acts before sliding and kinetic friction acts during sliding.'
        }]
      }],
      coverageStatus: 'covered'
    }]
  }],
  uncoveredLearningObjectiveIds: []
};

describe('KnowledgeGraph relationships', () => {
  it('builds visible coverage edges from material to question', () => {
    const graph = buildGraph(coverageMap);
    const labels = new Set(graph.edges.map(edge => String(edge.label)));

    expect(labels).toEqual(new Set(['contains', 'supports', 'includes', 'assesses', 'focuses', 'grounds']));
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.source))).toBe(true);
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.target))).toBe(true);
  });

  it('keeps the connected evidence neighborhood for a single question', () => {
    const graph = buildGraph(coverageMap);
    const focused = focusedGraph(graph.nodes, graph.edges, 'question-1');

    expect(focused.nodes.some(node => node.id === 'question-question-1')).toBe(true);
    expect(focused.edges.some(edge => edge.label === 'grounds')).toBe(true);
    expect(focused.edges.some(edge => edge.label === 'contains')).toBe(true);
  });
});
