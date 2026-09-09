import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CoverageMapPanel from './CoverageMapPanel';

const mocks = vi.hoisted(() => ({
  getQuizCoverageMap: vi.fn()
}));

vi.mock('../services/api', () => ({
  coverageMapApi: { getQuizCoverageMap: mocks.getQuizCoverageMap }
}));

vi.mock('./KnowledgeGraph', () => ({
  default: () => <div>Knowledge graph</div>
}));

const coverageMap = {
  summary: {
    topicCount: 0,
    learningObjectiveCount: 0,
    linkedQuestionCount: 0,
    uncoveredLearningObjectiveCount: 0
  },
  topics: []
};

describe('CoverageMapPanel loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuizCoverageMap.mockResolvedValue(coverageMap);
  });

  it('does not request a coverage map while the hidden tab is mounted', () => {
    render(<CoverageMapPanel quizId="quiz-1" isActive={false} />);

    expect(mocks.getQuizCoverageMap).not.toHaveBeenCalled();
  });

  it('does not request a coverage map before learning objectives exist', () => {
    render(<CoverageMapPanel quizId="quiz-1" isActive canBuild={false} />);

    expect(screen.getByText(/Create at least one learning objective/)).toBeInTheDocument();
    expect(mocks.getQuizCoverageMap).not.toHaveBeenCalled();
  });

  it('loads the map when the user opens an eligible Coverage Map tab', async () => {
    render(<CoverageMapPanel quizId="quiz-1" isActive canBuild />);

    await waitFor(() => expect(mocks.getQuizCoverageMap).toHaveBeenCalledWith('quiz-1'));
  });
});
