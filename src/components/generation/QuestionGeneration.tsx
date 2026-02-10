import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Save, Wand2 } from 'lucide-react';
import { RootState, AppDispatch } from '../../store';
import { fetchQuestions, setQuestionsGenerating, setQuestionsForQuiz } from '../../store/slices/questionSlice';
import { selectQuestionsByQuiz } from '../../store/selectors';
import { questionsApi, quizApi, plansApi, Question } from '../../services/api';
import { API_URL } from '../../config/api';
import { usePubSub } from '../../hooks/usePubSub';
import { useSSE } from '../../hooks/useSSE';
import { QuestionGenerationProps, PlanItem, AIConfig, StreamingState } from './generationTypes';
import ModeToggle from './ModeToggle';
import PlanEditor from './PlanEditor';
import AIConfigPanel from './AIConfigPanel';
import AILoadingAnimation from './AILoadingAnimation';
import StreamingProgress from './StreamingProgress';
import PromptAnalysisSection from './PromptAnalysisSection';
import '../../styles/components/QuestionGeneration.css';

const QuestionGeneration = ({ learningObjectives, assignedMaterials, quizId, onQuestionsGenerated }: QuestionGenerationProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const questions = useSelector((state: RootState) => selectQuestionsByQuiz(state, quizId));
  const { showNotification } = usePubSub('QuestionGeneration');

  // Plan mode state
  const [planMode, setPlanMode] = useState<'manual' | 'ai-auto'>('manual');
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [aiConfig, setAIConfig] = useState<AIConfig>({
    totalQuestions: Math.max(30, learningObjectives.length), // At least 1 per LO
    approach: 'support',
    additionalInstructions: ''
  });

  // UI state
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Streaming state
  const [streamingState, setStreamingState] = useState<StreamingState>({
    isStreaming: false,
    sessionId: null,
    questionsInProgress: new Map(),
    completedQuestions: [],
    totalQuestions: 0,
    batchStarted: false
  });

  // SSE connection
  const sseUrl = streamingState.sessionId ? `${API_URL}/api/create/streaming/questions/${streamingState.sessionId}` : null;
  const { disconnect } = useSSE(sseUrl, {
    onConnected: () => {},
    onBatchStarted: (data: { totalQuestions?: number }) => {
      setStreamingState(prev => ({
        ...prev,
        batchStarted: true,
        totalQuestions: data.totalQuestions || 0
      }));
    },
    onQuestionProgress: (questionId: string, data: { type?: string; status?: string }) => {
      setStreamingState(prev => {
        const newInProgress = new Map(prev.questionsInProgress);
        const existing = newInProgress.get(questionId) || {
          questionId,
          type: 'unknown',
          progress: 'Starting...',
          chunks: []
        };

        newInProgress.set(questionId, {
          ...existing,
          type: data.type || existing.type,
          progress: data.status === 'started' ? 'Generating...' : existing.progress
        });

        return { ...prev, questionsInProgress: newInProgress };
      });
    },
    onTextChunk: (questionId: string, chunk: string) => {
      setStreamingState(prev => {
        const newInProgress = new Map(prev.questionsInProgress);
        const existing = newInProgress.get(questionId) || {
          questionId,
          type: 'unknown',
          progress: 'Generating...',
          chunks: []
        };

        newInProgress.set(questionId, {
          ...existing,
          chunks: [...existing.chunks, chunk],
          progress: 'Streaming text...'
        });

        return { ...prev, questionsInProgress: newInProgress };
      });
    },
    onQuestionComplete: (questionId: string, question: Question) => {
      setStreamingState(prev => {
        const newInProgress = new Map(prev.questionsInProgress);
        newInProgress.delete(questionId);

        // Only add to completed if it's not an error
        const isError = (question as { error?: boolean }).error;
        const completedQuestions = isError 
          ? prev.completedQuestions 
          : [...prev.completedQuestions, question];

        return {
          ...prev,
          questionsInProgress: newInProgress,
          completedQuestions
        };
      });
    },
    onBatchComplete: (summary: { totalGenerated?: number; totalFailed?: number }) => {
      console.log('[QuestionGeneration] onBatchComplete called with:', summary);
      dispatch(setQuestionsGenerating({ generating: false, quizId }));
      reloadQuestions();

      const successCount = summary.totalGenerated || streamingState.completedQuestions.length;
      const failureCount = summary.totalFailed || 0;
      
      if (failureCount > 0) {
        showNotification('warning', 'Generation Completed with Errors',
          `Generated ${successCount} questions successfully, ${failureCount} failed.`);
      } else {
        showNotification('success', 'Questions Generated',
          `Successfully generated ${successCount} questions!`);
      }

      if (onQuestionsGenerated) {
        setTimeout(() => { onQuestionsGenerated(); }, 3000);
      }

      setStreamingState(prev => ({ ...prev, isStreaming: false, batchStarted: false }));
    },
    onError: (questionId: string, errorMessage: string) => {
      console.error('SSE error:', questionId, errorMessage);
      showNotification('error', 'Generation Error', `Error: ${errorMessage}`);
    },
    onHeartbeat: () => {}
  });

  // Restore settings on mount
  useEffect(() => {
    const restoreSettings = async () => {
      try {
        const { quiz } = await quizApi.getQuiz(quizId);
        if (quiz.settings?.planItems && quiz.settings.planItems.length > 0) {
          const items: PlanItem[] = quiz.settings.planItems.map(item => ({
            id: crypto.randomUUID(),
            type: item.type,
            learningObjectiveId: item.learningObjective,
            count: item.count
          }));
          setPlanItems(items);
        } else {
          // Initialize with default plan
          initializeDefaultPlan();
        }

        if (quiz.settings?.planMode) {
          setPlanMode(quiz.settings.planMode);
        }

        if (quiz.settings?.aiConfig) {
          setAIConfig(quiz.settings.aiConfig);
        }
      } catch (error) {
        console.error('Failed to restore settings:', error);
        initializeDefaultPlan();
      }
    };

    restoreSettings();
  }, [quizId]);

  const initializeDefaultPlan = () => {
    if (learningObjectives.length > 0) {
      const defaultItems: PlanItem[] = learningObjectives.map(lo => ({
        id: crypto.randomUUID(),
        type: 'multiple-choice',
        learningObjectiveId: lo._id,
        count: 3
      }));
      setPlanItems(defaultItems);
    }
  };

  const reloadQuestions = async () => {
    try {
      const result = await questionsApi.getQuestions(quizId);
      if (result?.questions) {
        dispatch(setQuestionsForQuiz({ quizId, questions: result.questions }));
      }
    } catch (error) {
      console.error('Failed to reload questions:', error);
    }
  };

  // Save plan
  const handleSavePlan = async () => {
    setIsSaving(true);
    try {
      // Get current quiz to merge settings
      const { quiz } = await quizApi.getQuiz(quizId);

      await quizApi.updateQuiz(quizId, {
        settings: {
          ...quiz.settings, // Keep existing settings
          planMode,
          planItems: planItems.map(item => ({
            type: item.type,
            learningObjective: item.learningObjectiveId,
            count: item.count
          })),
          aiConfig
        }
      });
      setHasUnsavedChanges(false);
      showNotification('success', 'Plan Saved', 'Your plan has been saved successfully');
    } catch (error) {
      console.error('Failed to save plan:', error);
      showNotification('error', 'Save Failed', 'Failed to save plan');
    } finally {
      setIsSaving(false);
    }
  };

  // Generate AI plan
  const handleGenerateAIPlan = async () => {
    // Validate before sending
    const minQuestions = learningObjectives.length;
    if (aiConfig.totalQuestions < minQuestions || aiConfig.totalQuestions > 100) {
      showNotification('error', 'Invalid Input', `Please enter a number between ${minQuestions} and 100`);
      return;
    }

    setIsGeneratingPlan(true);
    try {
      console.log('Generating AI plan with:', { quizId, totalQuestions: aiConfig.totalQuestions, approach: aiConfig.approach });

      const result = await plansApi.generateAIPlan(
        quizId,
        aiConfig.totalQuestions,
        aiConfig.approach,
        aiConfig.additionalInstructions || undefined
      );

      const items: PlanItem[] = result.planItems.map(item => ({
        id: crypto.randomUUID(),
        type: item.type,
        learningObjectiveId: learningObjectives[item.learningObjectiveIndex]._id,
        count: item.count
      }));

      setPlanItems(items);
      setHasUnsavedChanges(true);
      showNotification('success', 'Plan Generated', 'AI has generated a plan. Review and edit it below.');
    } catch (error) {
      console.error('Failed to generate AI plan:', error);
      showNotification('error', 'Generation Failed', 'Failed to generate AI plan');
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  // Generate questions
  const handleGenerateQuestions = async () => {
    // Save plan first
    await handleSavePlan();

    // Convert planItems to questionConfigs
    const questionConfigs = planItems.flatMap(item => {
      const lo = learningObjectives.find(lo => lo._id === item.learningObjectiveId);
      return Array(item.count).fill(null).map(() => ({
        questionType: item.type,
        difficulty: 'moderate',
        learningObjective: lo?.text || '',
        learningObjectiveId: item.learningObjectiveId
      }));
    });

    // Start streaming generation
    try {
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      setStreamingState({
        isStreaming: true,
        sessionId,
        questionsInProgress: new Map(),
        completedQuestions: [],
        totalQuestions: questionConfigs.length,
        batchStarted: false
      });

      dispatch(setQuestionsGenerating({ generating: true, quizId }));

      const response = await fetch(`${API_URL}/api/create/streaming/generate-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Important: Send cookies for SAML session
        body: JSON.stringify({
          quizId,
          sessionId,
          questionConfigs,
          useRealLLM: true,
          saveToDatabase: true
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start question generation');
      }

      showNotification('info', 'Generation Started', 'Question generation has started...');
    } catch (error) {
      console.error('Failed to start generation:', error);
      showNotification('error', 'Generation Failed', 'Failed to start question generation');
      setStreamingState(prev => ({ ...prev, isStreaming: false }));
      dispatch(setQuestionsGenerating({ generating: false, quizId }));
    }
  };

  // Regenerate questions (delete and regenerate)
  const handleRegenerateQuestions = async () => {
    if (!window.confirm('This will delete all existing questions and generate new ones. Continue?')) {
      return;
    }

    setIsRegenerating(true);
    try {
      // Delete existing questions
      for (const question of questions) {
        await questionsApi.deleteQuestion(question._id);
      }
      dispatch(setQuestionsForQuiz({ quizId, questions: [] }));

      // Generate new questions
      await handleGenerateQuestions();
    } catch (error) {
      console.error('Failed to regenerate questions:', error);
      showNotification('error', 'Regeneration Failed', 'Failed to regenerate questions');
    } finally {
      setIsRegenerating(false);
    }
  };

  // Handle plan mode change - auto-save before switching
  const handleModeChange = async (newMode: 'manual' | 'ai-auto') => {
    // Auto-save if there are unsaved changes
    if (hasUnsavedChanges) {
      await handleSavePlan();
    }
    setPlanMode(newMode);
  };

  // Handle plan items change
  const handlePlanItemsChange = (items: PlanItem[]) => {
    setPlanItems(items);
    setHasUnsavedChanges(true);
  };

  // Render
  const hasQuestions = questions.length > 0;
  const totalPlannedQuestions = planItems.reduce((sum, item) => sum + item.count, 0);

  // Show streaming progress
  if (streamingState.isStreaming) {
    return (
      <div className="question-generation">
        <StreamingProgress
          streamingState={streamingState}
          connectionStatus="connected"
          onStopGeneration={() => {
            disconnect();
            setStreamingState(prev => ({ ...prev, isStreaming: false }));
            dispatch(setQuestionsGenerating({ generating: false, quizId }));
          }}
        />
      </div>
    );
  }

  // Show results view if questions exist
  if (hasQuestions) {
    // Calculate distribution from generated questions
    const typeDistribution = questions.reduce((acc, q) => {
      acc[q.type] = (acc[q.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (
      <div className="question-generation">
        <div className="generation-results">
          <div className="results-header">
            <h3>Questions Generated</h3>
            <p>{questions.length} questions have been generated and are ready for review</p>
          </div>

          {/* Generation Summary */}
          <div className="generation-summary-compact">
            <div className="summary-cards-compact">
              <div className="summary-card-compact">
                <h5>Question Distribution</h5>
                <div className="stats-compact">
                  {Object.entries(typeDistribution).map(([type, count]) => (
                    <div key={type} className="stat-compact">
                      <span className="stat-label-compact">{type}</span>
                      <span className="stat-value-compact">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="summary-card-compact">
                <h5>Plan Summary</h5>
                <div className="stats-compact">
                  <div className="stat-compact">
                    <span className="stat-label-compact">Total Questions</span>
                    <span className="stat-value-compact">{questions.length}</span>
                  </div>
                  <div className="stat-compact">
                    <span className="stat-label-compact">Learning Objectives</span>
                    <span className="stat-value-compact">{learningObjectives.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Prompt Analysis */}
          <PromptAnalysisSection questions={questions} learningObjectives={learningObjectives} />

          <div className="results-actions">
            <button
              onClick={handleRegenerateQuestions}
              disabled={isRegenerating}
              className="btn btn-secondary"
            >
              {isRegenerating ? 'Regenerating...' : 'Regenerate All Questions'}
            </button>
          </div>

          <div className="results-info">
            <p>
              Switch to the <strong>Review & Edit</strong> tab to view and edit your generated questions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show generation form
  return (
    <div className="question-generation">
      <div className="generation-header">
        <h2>Generate Questions</h2>
        <p className="generation-subtitle">
          Create a plan for your quiz questions by choosing a mode and configuring the distribution
        </p>
      </div>

      {learningObjectives.length === 0 ? (
        <div className="generation-empty">
          <p>Please add learning objectives before generating questions.</p>
        </div>
      ) : (
        <>
          <ModeToggle
            mode={planMode}
            onChange={handleModeChange}
            disabled={streamingState.isStreaming}
          />

          {planMode === 'ai-auto' && (
            <>
              <AIConfigPanel
                aiConfig={aiConfig}
                onConfigChange={(config) => {
                  setAIConfig(config);
                  setHasUnsavedChanges(true);
                }}
                onGeneratePlan={handleGenerateAIPlan}
                isGenerating={isGeneratingPlan}
                learningObjectives={learningObjectives}
              />

              {isGeneratingPlan && <AILoadingAnimation />}
            </>
          )}

          {(planMode === 'manual' || planItems.length > 0) && !isGeneratingPlan && (
            <PlanEditor
              planItems={planItems}
              learningObjectives={learningObjectives}
              onPlanItemsChange={handlePlanItemsChange}
              readOnly={streamingState.isStreaming}
            />
          )}

          {planItems.length > 0 && !isGeneratingPlan && (
            <div className="generation-actions">
              <div className="actions-left">
                <button
                  onClick={handleSavePlan}
                  disabled={isSaving || !hasUnsavedChanges}
                  className="btn btn-secondary"
                >
                  <Save size={18} />
                  {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save Plan' : 'Plan Saved'}
                </button>
              </div>

              <div className="actions-right">
                <button
                  onClick={handleGenerateQuestions}
                  disabled={streamingState.isStreaming || totalPlannedQuestions === 0}
                  className="btn btn-primary"
                >
                  <Wand2 size={18} />
                  Generate {totalPlannedQuestions} Questions
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default QuestionGeneration;
