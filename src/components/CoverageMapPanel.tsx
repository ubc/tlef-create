import { lazy, Suspense, useEffect, useState } from 'react';
import { coverageMapApi, CoverageMap } from '../services/api';
import '../styles/components/CoverageMapPanel.css';

const KnowledgeGraph = lazy(() => import('./KnowledgeGraph'));

interface CoverageMapPanelProps {
  quizId: string;
  refreshKey?: string;
  onNavigateToGeneration?: () => void;
}

const CoverageMapPanel = ({ quizId, refreshKey, onNavigateToGeneration }: CoverageMapPanelProps) => {
  const [coverageMap, setCoverageMap] = useState<CoverageMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');

  useEffect(() => {
    const loadCoverageMap = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await coverageMapApi.getQuizCoverageMap(quizId);
        setCoverageMap(result);
      } catch (err) {
        console.error('Failed to load coverage map:', err);
        setError(err instanceof Error ? err.message : 'Failed to load coverage map');
      } finally {
        setLoading(false);
      }
    };

    loadCoverageMap();
  }, [quizId, refreshKey]);

  if (loading) {
    return (
      <div className="coverage-map-panel">
        <div className="coverage-map-empty">Building coverage map...</div>
      </div>
    );
  }

  if (error || !coverageMap) {
    return (
      <div className="coverage-map-panel">
        <div className="coverage-map-empty">
          {error || 'Coverage map is not available yet.'}
        </div>
      </div>
    );
  }

  return (
    <div className="coverage-map-panel">
      <div className="coverage-map-header">
        <div>
          <h3>Knowledge Coverage Map</h3>
          <p>Review how learning objectives, generated questions, and material evidence connect.</p>
        </div>
        <div className="coverage-map-actions">
          <div className="coverage-view-toggle" aria-label="Coverage map view">
            <button
              type="button"
              className={viewMode === 'graph' ? 'is-active' : ''}
              onClick={() => setViewMode('graph')}
            >
              Graph
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'is-active' : ''}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
          {onNavigateToGeneration && (
            <button type="button" className="btn btn-primary" onClick={onNavigateToGeneration}>
              Generate Questions
            </button>
          )}
        </div>
        <div className="coverage-map-stats">
          <span><strong>{coverageMap.summary.topicCount}</strong> topics</span>
          <span><strong>{coverageMap.summary.learningObjectiveCount}</strong> LOs</span>
          <span><strong>{coverageMap.summary.linkedQuestionCount}</strong> linked questions</span>
          <span><strong>{coverageMap.summary.uncoveredLearningObjectiveCount}</strong> uncovered LOs</span>
        </div>
      </div>

      {viewMode === 'graph' ? (
        <Suspense fallback={<div className="coverage-map-empty">Loading interactive graph...</div>}>
          <KnowledgeGraph coverageMap={coverageMap} />
        </Suspense>
      ) : (
      <div className="coverage-topic-list">
        {coverageMap.topics.map(topic => (
          <section key={topic.id} className="coverage-topic-card">
            <div className="coverage-topic-title">
              <h4>{topic.label}</h4>
              <span>{topic.linkedQuestionIds.length} question{topic.linkedQuestionIds.length === 1 ? '' : 's'}</span>
            </div>

            <div className="coverage-subtopic-list">
              {topic.subtopics.map(subtopic => {
                const primarySource = subtopic.sourceReferences[0];

                return (
                  <div key={subtopic.id} className="coverage-subtopic-row">
                    <div className="coverage-subtopic-main">
                      <div className="coverage-subtopic-status" data-status={subtopic.coverageStatus}>
                        {subtopic.coverageStatus === 'covered' ? 'Covered' : 'Needs questions'}
                      </div>
                      <h5>LO {subtopic.learningObjective.order + 1}: {subtopic.learningObjective.text}</h5>
                      <p>{subtopic.label}</p>
                      {primarySource?.excerpt && (
                        <blockquote>{primarySource.excerpt}</blockquote>
                      )}
                    </div>

                    <div className="coverage-subtopic-meta">
                      {primarySource && (
                        <div>
                          <strong>Evidence</strong>
                          <span>{primarySource.materialName || primarySource.sourceFile || 'Course material'}</span>
                          {typeof primarySource.pageNumber === 'number' ? (
                            <small>Page {primarySource.pageNumber}</small>
                          ) : typeof primarySource.chunkIndex === 'number' ? (
                            <small>Chunk {primarySource.chunkIndex + 1}</small>
                          ) : null}
                        </div>
                      )}
                      <div>
                        <strong>Questions</strong>
                        <span>{subtopic.linkedQuestions.length}</span>
                        {subtopic.linkedQuestions.slice(0, 2).map(question => (
                          <small key={question.id}>{question.type}: {question.focusArea || question.difficulty || 'planned coverage'}</small>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      )}
    </div>
  );
};

export default CoverageMapPanel;
