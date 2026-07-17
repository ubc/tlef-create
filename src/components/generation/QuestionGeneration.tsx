import { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Save, Wand2 } from 'lucide-react';
import { RootState, AppDispatch } from '../../store';
import { fetchQuestions, setQuestionsGenerating, setQuestionsForQuiz } from '../../store/slices/questionSlice';
import { updateQuizLocally } from '../../store/slices/quizSlice';
import { selectQuestionsByQuiz } from '../../store/selectors';
import { ApiError, questionsApi, quizApi, plansApi, Question } from '../../services/api';
import { API_URL } from '../../config/api';
import { usePubSub } from '../../hooks/usePubSub';
import { useSSE } from '../../hooks/useSSE';
import { QuestionGenerationProps, PlanItem, AIConfig, StreamingState } from './generationTypes';
import {
  DeliveryTarget,
  TargetFormat,
  DELIVERY_TARGETS,
  getDefaultFormatForDeliveryTarget,
  getDeliveryTargetForFormat,
  getFallbackQuestionType,
  getFormatsForDeliveryTarget,
  getUnsupportedQuestionTypesForTarget,
  isQuestionTypeAllowedForTarget,
  normalizeQuestionTypeForTarget
} from '../../constants/questionTypeCapabilities';
import ModeToggle from './ModeToggle';
import PlanEditor from './PlanEditor';
import AIConfigPanel from './AIConfigPanel';
import AIPlanGenerationTrace from './AIPlanGenerationTrace';
import StreamingProgress from './StreamingProgress';
import PromptAnalysisSection from './PromptAnalysisSection';
import CoursePromptSettings from '../CoursePromptSettings';
import FeatureCoachmark from '../onboarding/FeatureCoachmark';
import { useFeatureOnboarding } from '../../hooks/useFeatureOnboarding';
import '../../styles/components/QuestionGeneration.css';

type GenerationView = 'plan' | 'results';
type GenerationMode = 'add' | 'replace';

function getSaveErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : 'Failed to save plan';
  }

  if (Array.isArray(error.details)) {
    const firstDetail = error.details.find(detail => (
      detail && typeof detail === 'object' && typeof detail.message === 'string'
    ));
    if (firstDetail && typeof firstDetail === 'object' && typeof firstDetail.message === 'string') {
      return firstDetail.message;
    }
  }

  return error.message || 'Failed to save plan';
}

type QuestionBudgetSummary = {
  method: string;
  approach: 'support' | 'assess' | 'gamify';
  total: number;
  allocations: Array<{
    learningObjectiveIndex: number;
    count: number;
    subpointCount: number;
    bloomLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
    rationale: string;
  }>;
};

const QuestionGeneration = ({ learningObjectives, assignedMaterials, quizId, courseId, onQuestionsGenerated }: QuestionGenerationProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const questions = useSelector((state: RootState) => selectQuestionsByQuiz(state, quizId));
  const { showNotification } = usePubSub('QuestionGeneration');
  const hasUserSelectedViewRef = useRef(false);

  // Plan mode state
  const [planMode, setPlanMode] = useState<'manual' | 'ai-auto'>('manual');
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>('h5p-package');
  const [targetFormat, setTargetFormat] = useState<TargetFormat>('column');
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [aiConfig, setAIConfig] = useState<AIConfig>({
    totalQuestions: Math.max(30, learningObjectives.length), // At least 1 per LO
    autoRecommendTotalQuestions: true,
    approach: 'support',
    additionalInstructions: ''
  });

  // UI state
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planWorkflowSessionId, setPlanWorkflowSessionId] = useState<string | null>(null);
  const [planWorkflowSteps, setPlanWorkflowSteps] = useState<Array<{
    status: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>>([]);
  const [planStreamText, setPlanStreamText] = useState('');
  const [planStreamModel, setPlanStreamModel] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentView, setCurrentView] = useState<GenerationView>('plan');
  const [showGenerationModeModal, setShowGenerationModeModal] = useState(false);
  const [isPreparingGeneration, setIsPreparingGeneration] = useState(false);
  const [blueprintSummary, setBlueprintSummary] = useState<{
    recommendedTotalQuestions?: number;
    totalQuestionStrategy?: 'user-specified' | 'ai-recommended';
    totalQuestionRationale?: string;
    questionBudget?: QuestionBudgetSummary;
    promptProvenance?: {
      promptType: 'quiz-blueprint';
      source: 'course' | 'user' | 'system';
      version: number | null;
      approach: 'support' | 'assess' | 'gamify';
    };
  } | null>(null);
  const loadingAnimationRef = useRef<HTMLDivElement>(null);
  const generatedPlanEndRef = useRef<HTMLDivElement>(null);
  const streamingProgressRef = useRef<HTMLDivElement>(null);
  const generationResultsRef = useRef<HTMLDivElement>(null);
  const deliveryFormatTutorial = useFeatureOnboarding('delivery-format', learningObjectives.length > 0);
  const blueprintTutorial = useFeatureOnboarding(
    'ai-blueprint',
    planItems.length > 0 && !isGeneratingPlan && deliveryFormatTutorial.isCompleted
  );

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
  const planWorkflowUrl = planWorkflowSessionId ? `${API_URL}/api/create/streaming/questions/${planWorkflowSessionId}` : null;
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
    onTextReset: (questionId: string, metadata) => {
      setStreamingState(prev => {
        const newInProgress = new Map(prev.questionsInProgress);
        const existing = newInProgress.get(questionId);
        if (existing) {
          newInProgress.set(questionId, {
            ...existing,
            chunks: [],
            progress: metadata?.attempt
              ? `Retrying draft (attempt ${metadata.attempt})...`
              : 'Retrying draft...'
          });
        }
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
      dispatch(setQuestionsGenerating({ generating: false, quizId }));
      reloadQuestions();
      hasUserSelectedViewRef.current = true;
      setCurrentView('results');

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

  useSSE(planWorkflowUrl, {
    onQuestionProgress: (_questionId, data: { status?: string; message?: string; metadata?: Record<string, unknown> }) => {
      if (!data?.status) return;
      setPlanWorkflowSteps(previous => {
        const next = previous.filter(step => step.status !== data.status);
        return [...next, {
          status: data.status || 'progress',
          message: data.message || data.status || 'Working...',
          metadata: data.metadata
        }].slice(-8);
      });
    },
    onTextChunk: (questionId, chunk, metadata) => {
      if (questionId !== 'quiz-blueprint' || !chunk) return;
      setPlanStreamText(previous => previous + chunk);
      if (metadata?.model) setPlanStreamModel(metadata.model);
    },
    onTextReset: questionId => {
      if (questionId === 'quiz-blueprint') setPlanStreamText('');
    },
    onQuestionComplete: () => {
      setPlanWorkflowSteps(previous => [...previous, {
        status: 'complete',
        message: 'Quiz blueprint is ready.'
      }].slice(-8));
      window.setTimeout(() => setPlanWorkflowSessionId(null), 1200);
    },
    onBatchComplete: () => {
      window.setTimeout(() => setPlanWorkflowSessionId(null), 1200);
    },
    onError: (_questionId, errorMessage) => {
      setPlanWorkflowSteps(previous => [...previous, {
        status: 'error',
        message: errorMessage || 'AI plan generation failed.'
      }].slice(-8));
      window.setTimeout(() => setPlanWorkflowSessionId(null), 1800);
    }
  });

  const initializeDefaultPlan = useCallback((format: TargetFormat) => {
    const fallbackType = getFallbackQuestionType(format);
    if (learningObjectives.length > 0) {
      const defaultItems: PlanItem[] = learningObjectives.map(lo => ({
        id: crypto.randomUUID(),
        type: fallbackType,
        learningObjectiveId: lo._id,
        count: 3,
        ...(fallbackType === 'multiple-choice' && { selectionMode: 'single' as const })
      }));
      setPlanItems(defaultItems);
    }
  }, [learningObjectives]);

  // Restore settings on mount
  useEffect(() => {
    const restoreSettings = async () => {
      try {
        const { quiz } = await quizApi.getQuiz(quizId);
        const restoredTargetFormat = (quiz.settings?.targetFormat as TargetFormat | undefined) || quiz.containerMode || 'column';
        const restoredDeliveryTarget = (quiz.settings?.deliveryTarget as DeliveryTarget | undefined)
          || getDeliveryTargetForFormat(restoredTargetFormat);
        const validFormats = getFormatsForDeliveryTarget(restoredDeliveryTarget).map(format => format.value);
        const normalizedTargetFormat = validFormats.includes(restoredTargetFormat)
          ? restoredTargetFormat
          : getDefaultFormatForDeliveryTarget(restoredDeliveryTarget);

        setDeliveryTarget(restoredDeliveryTarget);
        setTargetFormat(normalizedTargetFormat);

        if (quiz.settings?.planItems && quiz.settings.planItems.length > 0) {
          const items: PlanItem[] = quiz.settings.planItems.map(item => ({
            id: crypto.randomUUID(),
            type: normalizeQuestionTypeForTarget(item.type, normalizedTargetFormat),
            learningObjectiveId: item.learningObjective || '',
            count: item.count,
            pedagogicalIntent: item.pedagogicalIntent,
            bloomLevel: item.bloomLevel,
            difficulty: item.difficulty,
            focusArea: item.focusArea,
            rationale: item.rationale,
            customPrompt: item.customPrompt,
            useCustomPromptOnly: item.useCustomPromptOnly || !item.learningObjective,
            ...(item.type === 'multiple-choice' && {
              selectionMode: item.selectionMode || 'single'
            }),
            ...(item.type === 'branching-scenario' && {
              branchingLayers: item.branchingLayers ?? 2,
              branchingChoices: item.branchingChoices ?? 2
            })
          }));
          setPlanItems(items);
        } else {
          // Initialize with default plan
          initializeDefaultPlan(normalizedTargetFormat);
        }

        if (quiz.settings?.planMode) {
          setPlanMode(quiz.settings.planMode);
        }

        if (quiz.settings?.aiConfig) {
          // Merge with defaults to ensure all fields are present
          setAIConfig({
            totalQuestions: quiz.settings.aiConfig.totalQuestions || Math.max(30, learningObjectives.length),
            autoRecommendTotalQuestions: quiz.settings.aiConfig.autoRecommendTotalQuestionsUserSet
              ? quiz.settings.aiConfig.autoRecommendTotalQuestions !== false
              : true,
            autoRecommendTotalQuestionsUserSet: !!quiz.settings.aiConfig.autoRecommendTotalQuestionsUserSet,
            approach: quiz.settings.aiConfig.approach || 'support',
            additionalInstructions: quiz.settings.aiConfig.additionalInstructions || ''
          });
        }
      } catch (error) {
        console.error('Failed to restore settings:', error);
        initializeDefaultPlan('column');
      }
    };

    restoreSettings();
  }, [initializeDefaultPlan, learningObjectives.length, quizId]);

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
  const handleSavePlan = async (): Promise<boolean> => {
    const invalidItemIndex = planItems.findIndex(item => {
      const hasLinkedObjective = learningObjectives.some(lo => lo._id === item.learningObjectiveId);
      return !hasLinkedObjective && !item.customPrompt?.trim();
    });

    if (invalidItemIndex >= 0) {
      showNotification(
        'error',
        'Plan Incomplete',
        `Plan row ${invalidItemIndex + 1} needs a learning objective or a custom prompt.`
      );
      return false;
    }

    setIsSaving(true);
    try {
      // Get current quiz to merge settings
      const { quiz } = await quizApi.getQuiz(quizId);

      // Clean aiConfig - remove empty strings and ensure proper types
      const cleanedAiConfig: {
        totalQuestions: number;
        autoRecommendTotalQuestions?: boolean;
        autoRecommendTotalQuestionsUserSet?: boolean;
        approach?: AIConfig['approach'];
        additionalInstructions?: string;
      } = {
        totalQuestions: aiConfig.totalQuestions,
        autoRecommendTotalQuestions: !!aiConfig.autoRecommendTotalQuestions,
        autoRecommendTotalQuestionsUserSet: !!aiConfig.autoRecommendTotalQuestionsUserSet
      };

      // Only include approach if it has a value
      if (aiConfig.approach && aiConfig.approach !== '') {
        cleanedAiConfig.approach = aiConfig.approach;
      }

      // Only include additionalInstructions if it has a value
      if (aiConfig.additionalInstructions && aiConfig.additionalInstructions.trim() !== '') {
        cleanedAiConfig.additionalInstructions = aiConfig.additionalInstructions.trim();
      }

      const { quiz: updatedQuiz } = await quizApi.updateQuiz(quizId, {
        containerMode: targetFormat === 'standalone' || targetFormat === 'mixed-activity' ? 'column' : targetFormat,
        settings: {
          ...quiz.settings, // Keep existing settings
          planMode,
          deliveryTarget,
          targetFormat,
          planItems: planItems.map(item => {
            const hasLinkedObjective = learningObjectives.some(lo => lo._id === item.learningObjectiveId);
            const customPrompt = item.customPrompt?.trim();

            return {
              type: item.type,
              learningObjective: hasLinkedObjective ? item.learningObjectiveId : null,
              count: item.count,
              pedagogicalIntent: item.pedagogicalIntent,
              bloomLevel: item.bloomLevel,
              difficulty: item.difficulty,
              focusArea: item.focusArea,
              rationale: item.rationale,
              ...(customPrompt && { customPrompt }),
              useCustomPromptOnly: !hasLinkedObjective,
              ...(item.type === 'multiple-choice' && {
                selectionMode: item.selectionMode || 'single'
              }),
              ...(item.type === 'branching-scenario' && {
                branchingLayers: item.branchingLayers ?? 2,
                branchingChoices: item.branchingChoices ?? 2
              })
            };
          }),
          aiConfig: cleanedAiConfig
        }
      });
      dispatch(updateQuizLocally(updatedQuiz));
      setHasUnsavedChanges(false);
      showNotification('success', 'Plan Saved', 'Your plan has been saved successfully');
      return true;
    } catch (error) {
      console.error('Failed to save plan:', error);
      showNotification('error', 'Save Failed', getSaveErrorMessage(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  // Generate AI plan
  const handleGenerateAIPlan = async () => {
    // Validate before sending
    const minQuestions = learningObjectives.length;
    if (!aiConfig.autoRecommendTotalQuestions && (aiConfig.totalQuestions < minQuestions || aiConfig.totalQuestions > 100)) {
      showNotification('error', 'Invalid Input', `Please enter a number between ${minQuestions} and 100`);
      return;
    }

    // Validate approach is selected
    if (!aiConfig.approach || !['support', 'assess', 'gamify'].includes(aiConfig.approach)) {
      showNotification('error', 'Approach Required', 'Please select a pedagogical approach');
      return;
    }

    setIsGeneratingPlan(true);
    const workflowSessionId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setPlanWorkflowSteps([]);
    setPlanStreamText('');
    setPlanStreamModel(null);
    setPlanWorkflowSessionId(workflowSessionId);
    // Scroll to loading animation after state update renders it
    setTimeout(() => {
      loadingAnimationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    let planGenerated = false;
    try {
      const fixedTotalQuestions = aiConfig.autoRecommendTotalQuestions ? undefined : aiConfig.totalQuestions;
      console.log('Generating AI plan with:', { quizId, totalQuestions: fixedTotalQuestions, approach: aiConfig.approach });

      const result = await plansApi.generateAIPlan(
        quizId,
        fixedTotalQuestions,
        aiConfig.approach,
        aiConfig.additionalInstructions || undefined,
        workflowSessionId
      );

      const items: PlanItem[] = result.planItems.map(item => ({
        id: crypto.randomUUID(),
        type: normalizeQuestionTypeForTarget(item.type, targetFormat),
        learningObjectiveId: learningObjectives[item.learningObjectiveIndex]._id,
        count: item.count,
        pedagogicalIntent: item.pedagogicalIntent || aiConfig.approach,
        bloomLevel: item.bloomLevel,
        difficulty: item.difficulty || 'moderate',
        focusArea: item.focusArea,
        rationale: item.rationale,
        ...(item.type === 'multiple-choice' && { selectionMode: 'single' as const })
      }));

      setPlanItems(items);
      setBlueprintSummary({
        recommendedTotalQuestions: result.recommendedTotalQuestions,
        totalQuestionStrategy: result.totalQuestionStrategy,
        totalQuestionRationale: result.totalQuestionRationale,
        questionBudget: result.questionBudget,
        promptProvenance: result.promptProvenance
      });
      if (result.recommendedTotalQuestions) {
        setAIConfig(prev => ({
          ...prev,
          totalQuestions: result.recommendedTotalQuestions || prev.totalQuestions
        }));
      }
      setHasUnsavedChanges(true);
      planGenerated = true;
      showNotification(
        'success',
        'Plan Generated',
        result.totalQuestionStrategy === 'ai-recommended' && result.recommendedTotalQuestions
          ? `CREATE recommended ${result.recommendedTotalQuestions} questions. Review and edit the plan below.`
          : 'AI has generated a plan. Review and edit it below.'
      );
    } catch (error) {
      console.error('Failed to generate AI plan:', error);
      showNotification('error', 'Generation Failed', 'Failed to generate AI plan');
    } finally {
      setIsGeneratingPlan(false);
      if (planGenerated) {
        window.setTimeout(() => {
          generatedPlanEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 150);
      }
    }
  };

  const buildQuestionConfigs = () => {
    return planItems.flatMap(item => {
      const lo = learningObjectives.find(lo => lo._id === item.learningObjectiveId);
      const hasLO = !!item.learningObjectiveId && !!lo;
      const loMetadata = lo?.generationMetadata;
      const blueprintContext = [
        loMetadata?.topic ? `Learning objective topic: ${loMetadata.topic}` : '',
        loMetadata?.subtopic ? `Learning objective subtopic: ${loMetadata.subtopic}` : '',
        loMetadata?.subpoints?.length ? `Learning objective subpoints to cover: ${loMetadata.subpoints.join('; ')}` : '',
        item.focusArea ? `Planned focus area: ${item.focusArea}` : '',
        item.bloomLevel ? `Target Bloom level: ${item.bloomLevel}` : '',
        item.pedagogicalIntent ? `Pedagogical intent: ${item.pedagogicalIntent}` : '',
        item.rationale ? `Blueprint rationale: ${item.rationale}` : ''
      ].filter(Boolean).join('\n');
      const mergedCustomPrompt = [
        blueprintContext,
        item.customPrompt?.trim() || ''
      ].filter(Boolean).join('\n\n');

      return Array(item.count).fill(null).map(() => ({
        questionType: item.type,
        difficulty: item.difficulty || 'moderate',
        learningObjective: lo?.text || '',
        learningObjectiveId: item.learningObjectiveId || undefined,
        pedagogicalIntent: item.pedagogicalIntent,
        bloomLevel: item.bloomLevel,
        focusArea: item.focusArea,
        planRationale: item.rationale,
        ...(item.type === 'multiple-choice' && {
          selectionMode: item.selectionMode || 'single'
        }),
        ...(!hasLO && { useCustomPromptOnly: true }),
        ...(mergedCustomPrompt && { customPrompt: mergedCustomPrompt }),
        ...(item.type === 'branching-scenario' && {
          branchingLayers: item.branchingLayers ?? 2,
          branchingChoices: item.branchingChoices ?? 2
        })
      }));
    });
  };

  const startQuestionGeneration = async () => {
    const questionConfigs = buildQuestionConfigs();

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
      window.setTimeout(() => {
        streamingProgressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

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

  const executeGeneration = async (mode: GenerationMode) => {
    setIsPreparingGeneration(true);
    try {
      const planSaved = await handleSavePlan();
      if (!planSaved) {
        return;
      }

      if (mode === 'replace') {
        for (const question of questions) {
          await questionsApi.deleteQuestion(question._id);
        }
        dispatch(setQuestionsForQuiz({ quizId, questions: [] }));
      }

      setShowGenerationModeModal(false);
      await startQuestionGeneration();
    } catch (error) {
      console.error('Failed to prepare generation:', error);
      showNotification('error', 'Generation Failed', mode === 'replace'
        ? 'Failed to replace existing questions before generation'
        : 'Failed to prepare question generation');
    } finally {
      setIsPreparingGeneration(false);
    }
  };

  // Generate questions
  const handleGenerateQuestions = async () => {
    if (hasQuestions) {
      setShowGenerationModeModal(true);
      return;
    }

    await executeGeneration('add');
  };

  // Handle plan mode change - auto-save before switching
  const handleModeChange = async (newMode: 'manual' | 'ai-auto') => {
    // Auto-save if there are unsaved changes
    if (hasUnsavedChanges) {
      const planSaved = await handleSavePlan();
      if (!planSaved) {
        return;
      }
    }
    setPlanMode(newMode);
  };

  // Handle plan items change
  const handlePlanItemsChange = (items: PlanItem[]) => {
    setPlanItems(items);
    setHasUnsavedChanges(true);
  };

  const normalizePlanItemsForFormat = (format: TargetFormat) => {
    setPlanItems(prevItems => {
      if (prevItems.length === 0) {
        return prevItems;
      }

      const fallbackType = getFallbackQuestionType(format);

      return prevItems.map(item => {
        if (isQuestionTypeAllowedForTarget(item.type, format)) {
          return item;
        }

        return {
          ...item,
          type: fallbackType,
          selectionMode: fallbackType === 'multiple-choice'
            ? (item.selectionMode || 'single')
            : undefined,
          branchingLayers: undefined,
          branchingChoices: undefined
        };
      });
    });
  };

  const confirmPlanItemCompatibilityForFormat = async (format: TargetFormat) => {
    const fallbackType = getFallbackQuestionType(format);
    const incompatiblePlanItems = planItems.filter(item => !isQuestionTypeAllowedForTarget(item.type, format));

    if (incompatiblePlanItems.length === 0) {
      return true;
    }

    const incompatibleSummary = incompatiblePlanItems
      .map(item => `${item.type} (${item.count})`)
      .join(', ');

    const shouldReplace = window.confirm(
      `This format does not support some question types in your plan.\n\n` +
      `Incompatible plan items: ${incompatibleSummary}\n\n` +
      `If you continue, these plan items will be changed to "${fallbackType}".\n\n` +
      'Do you want to continue?'
    );

    if (!shouldReplace) {
      return false;
    }

    showNotification(
      'warning',
      'Plan Updated For New Format',
      `Unsupported plan items were converted to ${fallbackType}.`
    );

    return true;
  };

  const removeIncompatibleQuestionsForFormat = async (format: TargetFormat) => {
    const unsupported = getUnsupportedQuestionTypesForTarget(
      questions.map(question => question.type),
      format
    );

    if (unsupported.length === 0) {
      return true;
    }

    const unsupportedTypeValues = new Set(unsupported.map(type => type.value));
    const incompatibleQuestions = questions.filter(question => unsupportedTypeValues.has(question.type));

    const shouldDelete = window.confirm(
      `This format does not support ${unsupported.map(type => type.label).join(', ')}.\n\n` +
      `${incompatibleQuestions.length} existing question${incompatibleQuestions.length === 1 ? '' : 's'} will be deleted if you continue.\n\n` +
      'Do you want to switch formats and remove the incompatible questions?'
    );

    if (!shouldDelete) {
      return false;
    }

    await Promise.all(incompatibleQuestions.map(question => questionsApi.deleteQuestion(question._id)));

    const remainingQuestions = questions.filter(question => !unsupportedTypeValues.has(question.type));
    dispatch(setQuestionsForQuiz({ quizId, questions: remainingQuestions }));

    showNotification(
      'warning',
      'Incompatible Questions Removed',
      `Removed ${incompatibleQuestions.length} incompatible question${incompatibleQuestions.length === 1 ? '' : 's'} for the new format.`
    );

    return true;
  };

  const handleDeliveryTargetChange = async (target: DeliveryTarget) => {
    const nextFormat = getDefaultFormatForDeliveryTarget(target);
    const canProceed = await removeIncompatibleQuestionsForFormat(nextFormat);
    if (!canProceed) {
      return;
    }
    const canUpdatePlan = await confirmPlanItemCompatibilityForFormat(nextFormat);
    if (!canUpdatePlan) {
      return;
    }
    setDeliveryTarget(target);
    setTargetFormat(nextFormat);
    normalizePlanItemsForFormat(nextFormat);
    setHasUnsavedChanges(true);
  };

  const handleTargetFormatChange = async (format: TargetFormat) => {
    const canProceed = await removeIncompatibleQuestionsForFormat(format);
    if (!canProceed) {
      return;
    }
    const canUpdatePlan = await confirmPlanItemCompatibilityForFormat(format);
    if (!canUpdatePlan) {
      return;
    }
    setTargetFormat(format);
    normalizePlanItemsForFormat(format);
    setHasUnsavedChanges(true);
  };

  // Render
  const hasQuestions = questions.length > 0;
  const totalPlannedQuestions = planItems.reduce((sum, item) => sum + item.count, 0);
  const showResultsView = currentView === 'results' && hasQuestions;

  useEffect(() => {
    if (!hasUserSelectedViewRef.current) {
      setCurrentView(hasQuestions ? 'results' : 'plan');
    }
  }, [hasQuestions]);

  useEffect(() => {
    if (!showResultsView) return;

    const scrollTimer = window.setTimeout(() => {
      generationResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    return () => window.clearTimeout(scrollTimer);
  }, [showResultsView]);

  const handleGoBackToPlan = () => {
    hasUserSelectedViewRef.current = true;
    setCurrentView('plan');
  };

  const handleShowResults = () => {
    hasUserSelectedViewRef.current = true;
    setCurrentView('results');
  };

  // Show streaming progress
  if (streamingState.isStreaming) {
    return (
      <div ref={streamingProgressRef} className="question-generation">
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
  if (showResultsView) {
    // Calculate distribution from generated questions
    const typeDistribution = questions.reduce((acc, q) => {
      acc[q.type] = (acc[q.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return (
      <div ref={generationResultsRef} className="question-generation">
        <div className="generation-results">
          <div className="results-header">
            <div>
              <h3>Questions Generated</h3>
              <p>{questions.length} questions have been generated and are ready for review</p>
            </div>
            <button
              onClick={handleGoBackToPlan}
              className="btn btn-secondary"
            >
              Back to AI Plan Configuration
            </button>
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
        {hasQuestions && (
          <div className="generation-header-actions">
            <button
              onClick={handleShowResults}
              className="btn btn-secondary"
            >
              View Generated Results
            </button>
          </div>
        )}
      </div>

      {learningObjectives.length === 0 ? (
        <div className="generation-empty">
          <p>Please add learning objectives before generating questions.</p>
        </div>
      ) : (
        <>
          {courseId && (
            <div className="step-prompt-settings">
              <CoursePromptSettings
                courseId={courseId}
                defaultPromptType={planMode === 'ai-auto' ? 'quiz-blueprint' : 'question-generation'}
                defaultApproach={aiConfig.approach}
              />
            </div>
          )}

          <ModeToggle
            mode={planMode}
            onChange={handleModeChange}
            disabled={streamingState.isStreaming}
          />

          <FeatureCoachmark
            isOpen={deliveryFormatTutorial.isActive}
            title="Choose where this learning object will be used"
            description="Delivery Target and Package Format determine which question types CREATE can generate and export. If you change them later, compatible questions are kept and CREATE will warn before removing incompatible ones."
            eyebrow="Delivery and compatibility"
            block
            onPrimary={deliveryFormatTutorial.complete}
            onDismiss={deliveryFormatTutorial.complete}
            onSkip={deliveryFormatTutorial.skipAll}
          >
            <section className="target-format-section" aria-labelledby="delivery-target-heading">
              <div className="target-format-header">
                <h3 id="delivery-target-heading">Delivery Target</h3>
                <p>Choose where this learning object will be delivered so CREATE can offer compatible question types.</p>
              </div>
              <div className="target-format-options" role="radiogroup" aria-label="Delivery target">
                {DELIVERY_TARGETS.map(target => (
                  <button
                    key={target.value}
                    type="button"
                    className={`target-format-option ${deliveryTarget === target.value ? 'active' : ''}`}
                    onClick={() => handleDeliveryTargetChange(target.value)}
                    disabled={streamingState.isStreaming}
                    aria-pressed={deliveryTarget === target.value}
                  >
                    <span className="target-format-label">{target.label}</span>
                    <span className="target-format-description">{target.description}</span>
                  </button>
                ))}
              </div>

              <div className="target-format-subsection">
                <div className="target-format-header compact">
                  <h4>{deliveryTarget === 'canvas-lti' ? 'Canvas LTI Format' : 'H5P Package Format'}</h4>
                  <p>
                    {deliveryTarget === 'canvas-lti'
                      ? 'Canvas LTI uses CREATE’s player, so it can render a broader mixed activity.'
                      : 'H5P package formats follow official H5P container compatibility.'}
                  </p>
                </div>
                <div className="target-format-options" role="radiogroup" aria-label="Target format">
                  {getFormatsForDeliveryTarget(deliveryTarget).map(format => (
                    <button
                      key={format.value}
                      type="button"
                      className={`target-format-option ${targetFormat === format.value ? 'active' : ''}`}
                      onClick={() => handleTargetFormatChange(format.value)}
                      disabled={streamingState.isStreaming || getFormatsForDeliveryTarget(deliveryTarget).length === 1}
                      aria-pressed={targetFormat === format.value}
                    >
                      <span className="target-format-label">{format.label}</span>
                      <span className="target-format-description">{format.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </FeatureCoachmark>

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

              {(isGeneratingPlan || planWorkflowSteps.length > 0) && (
                <div ref={loadingAnimationRef}>
                  <AIPlanGenerationTrace
                    isGenerating={isGeneratingPlan}
                    steps={planWorkflowSteps}
                    streamedText={planStreamText}
                    model={planStreamModel}
                  />
                </div>
              )}
            </>
          )}

          {(planMode === 'manual' || planItems.length > 0) && !isGeneratingPlan && (
            <>
              {blueprintSummary && (
                <div className="blueprint-summary-card">
                  <div>
                    <span className="blueprint-summary-kicker">Quiz Blueprint</span>
                    <h3>
                      {blueprintSummary.totalQuestionStrategy === 'ai-recommended'
                        ? `CREATE recommends ${blueprintSummary.recommendedTotalQuestions || totalPlannedQuestions} questions`
                        : `${totalPlannedQuestions} planned questions`}
                    </h3>
                    {blueprintSummary.totalQuestionRationale && (
                      <p>{blueprintSummary.totalQuestionRationale}</p>
                    )}
                    {blueprintSummary.promptProvenance && (
                      <p className="blueprint-prompt-source">
                        Prompt source: {blueprintSummary.promptProvenance.source === 'course'
                          ? `Course override${blueprintSummary.promptProvenance.version ? ` v${blueprintSummary.promptProvenance.version}` : ''}`
                          : blueprintSummary.promptProvenance.source === 'user'
                            ? 'User default'
                            : 'System default'}
                      </p>
                    )}
                    {blueprintSummary.questionBudget?.allocations.length ? (
                      <details className="blueprint-budget-details">
                        <summary>How CREATE calculated these counts</summary>
                        <div className="blueprint-budget-list">
                          {blueprintSummary.questionBudget.allocations.map(allocation => (
                            <div
                              key={allocation.learningObjectiveIndex}
                              className="blueprint-budget-item"
                            >
                              <strong>
                                LO {allocation.learningObjectiveIndex + 1}: {allocation.count} question{allocation.count === 1 ? '' : 's'}
                              </strong>
                              <span>
                                {allocation.subpointCount} subpoint{allocation.subpointCount === 1 ? '' : 's'}
                                {allocation.bloomLevel ? ` · Bloom: ${allocation.bloomLevel}` : ''}
                              </span>
                              <small>{allocation.rationale}</small>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>
              )}
              <FeatureCoachmark
                isOpen={blueprintTutorial.isActive}
                title="This is your editable AI Blueprint"
                description="Review how CREATE distributes question types and counts across learning objectives and subpoints. You can adjust any row before generation."
                eyebrow="AI Blueprint"
                block
                onPrimary={blueprintTutorial.complete}
                onDismiss={blueprintTutorial.complete}
                onSkip={blueprintTutorial.skipAll}
              >
                <PlanEditor
                  planItems={planItems}
                  learningObjectives={learningObjectives}
                  onPlanItemsChange={handlePlanItemsChange}
                  targetFormat={targetFormat}
                  readOnly={streamingState.isStreaming}
                />
              </FeatureCoachmark>
            </>
          )}

          {planItems.length > 0 && !isGeneratingPlan && (
            <div ref={generatedPlanEndRef} className="generation-actions">
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
                  disabled={streamingState.isStreaming || totalPlannedQuestions === 0 || isPreparingGeneration}
                  className="btn btn-primary"
                >
                  <Wand2 size={18} />
                  {isPreparingGeneration
                    ? 'Preparing Generation...'
                    : `Generate ${totalPlannedQuestions} Questions`}
                </button>
              </div>
            </div>
          )}

          {showGenerationModeModal && (
            <div className="modal-overlay" onClick={() => !isPreparingGeneration && setShowGenerationModeModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px', maxWidth: '560px' }}>
                <div className="modal-header">
                  <div>
                    <h3 className="modal-title">Generate More Questions?</h3>
                    <p className="modal-subtitle">
                      This quiz already has {questions.length} generated question{questions.length === 1 ? '' : 's'}.
                    </p>
                  </div>
                </div>
                <div className="modal-body">
                  <p style={{ marginTop: 0 }}>
                    Choose whether to keep the existing questions and add new ones, or replace the current set with questions from the updated plan.
                  </p>
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => executeGeneration('add')}
                      disabled={isPreparingGeneration}
                    >
                      Add New Questions
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => executeGeneration('replace')}
                      disabled={isPreparingGeneration}
                    >
                      Replace Existing Questions
                    </button>
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowGenerationModeModal(false)}
                    disabled={isPreparingGeneration}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default QuestionGeneration;
