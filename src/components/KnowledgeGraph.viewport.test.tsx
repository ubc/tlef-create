import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { CoverageMap } from '../services/api';
import KnowledgeGraph from './KnowledgeGraph';

const mocks = vi.hoisted(() => ({
  fitView: vi.fn()
}));

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrow-closed' },
  MiniMap: () => null,
  Position: { Left: 'left', Right: 'right' },
  ReactFlow: ({
    children,
    onInit
  }: {
    children: ReactNode;
    onInit?: (instance: { fitView: typeof mocks.fitView }) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onInit?.({ fitView: mocks.fitView })}>
        Initialize graph
      </button>
      {children}
    </div>
  ),
  useNodesState: <T,>(initialNodes: T[]) => [initialNodes, vi.fn(), vi.fn()]
}));

const coverageMap: CoverageMap = {
  quizId: 'quiz-1',
  generatedAt: new Date(0).toISOString(),
  materials: [],
  summary: {
    topicCount: 1,
    learningObjectiveCount: 1,
    linkedQuestionCount: 0,
    uncoveredLearningObjectiveCount: 1
  },
  topics: [{
    id: 'topic-1',
    label: 'Evidence',
    sourceReferences: [],
    linkedLearningObjectiveIds: ['lo-1'],
    linkedQuestionIds: [],
    subtopics: [{
      id: 'subtopic-1',
      label: 'Interpretation',
      learningObjective: {
        id: 'lo-1',
        text: 'Interpret evidence.',
        order: 0,
        subpoints: [],
        sourceReferences: []
      },
      sourceReferences: [],
      linkedQuestions: [],
      coverageStatus: 'needs-questions'
    }]
  }],
  uncoveredLearningObjectiveIds: ['lo-1']
};

describe('KnowledgeGraph viewport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('fits all nodes when a previously hidden graph becomes visible', async () => {
    const { rerender } = render(
      <KnowledgeGraph coverageMap={coverageMap} isVisible={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Initialize graph' }));
    expect(mocks.fitView).not.toHaveBeenCalled();

    rerender(<KnowledgeGraph coverageMap={coverageMap} isVisible />);

    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledWith({
      padding: 0.25,
      maxZoom: 0.95,
      duration: 0
    }));
  });

  it('fits the viewport when Show complete map is selected', async () => {
    render(<KnowledgeGraph coverageMap={coverageMap} isVisible />);
    fireEvent.click(screen.getByRole('button', { name: 'Initialize graph' }));

    await waitFor(() => expect(mocks.fitView).toHaveBeenCalled());
    mocks.fitView.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Show complete map/i }));

    expect(mocks.fitView).toHaveBeenCalledWith({
      padding: 0.25,
      maxZoom: 0.95,
      duration: 250
    });
  });
});
