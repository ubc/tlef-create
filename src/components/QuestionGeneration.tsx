import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Wand2, Settings, Zap, Gamepad2, GraduationCap, CheckCircle, Edit, Loader } from 'lucide-react';
import { RootState, AppDispatch } from '../store';
import { store } from '../store';
import { generatePlan, fetchPlans, approvePlan, setCurrentPlan, setQuestionsGenerating } from '../store/slices/planSlice';
import { questionsApi, Question } from '../services/api';
import { API_URL } from '../config/api';
import { usePubSub } from '../hooks/usePubSub';
import { PUBSUB_EVENTS } from '../services/pubsubService';
import { useSSE } from '../hooks/useSSE';
import AdvancedEditModal from './AdvancedEditModal';
import '../styles/components/QuestionGeneration.css';

interface QuestionGenerationProps {
  learningObjectives: string[];
  assignedMaterials: string[];
  quizId: string;
  onQuestionsGenerated?: () => void;
}

type PedagogicalApproach = 'support' | 'assess' | 'gamify' | 'custom';

interface QuestionTypeConfig {
  type: string;
  count: number;
  percentage: number;
  scope: 'per-lo' | 'whole-quiz'; // New: scope for each question type
  editMode: 'count' | 'percentage'; // New: editing mode
}

interface CustomFormula {
  questionTypes: QuestionTypeConfig[];
  totalQuestions: number;
  totalPerLO: number; // Questions per LO
  totalWholeQuiz: number; // Additional questions for whole quiz
}

const QuestionGeneration = ({ learningObjectives, assignedMaterials, quizId, onQuestionsGenerated }: QuestionGenerationProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const { currentPlan, activePlan, loading, generating, error } = useSelector((state: RootState) => state.plan);
  const { showNotification, publish, subscribe, unsubscribe } = usePubSub('QuestionGeneration');
  
  // Question generation state management
  const [approach, setApproach] = useState<PedagogicalApproach>('support');
  const [questionsPerLO, setQuestionsPerLO] = useState(3);
  const [showAdvancedEdit, setShowAdvancedEdit] = useState(false);
  const [isUserEditingApproach, setIsUserEditingApproach] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasExistingQuestions, setHasExistingQuestions] = useState(false);
  
  // Streaming state
  const [streamingState, setStreamingState] = useState<{
    isStreaming: boolean;
    sessionId: string | null;
    questionsInProgress: Map<string, { questionId: string; type: string; progress: string; chunks: string[] }>;
    completedQuestions: Question[];
    totalQuestions: number;
    batchStarted: boolean;
  }>({
    isStreaming: false,
    sessionId: null,
    questionsInProgress: new Map<string, { questionId: string; type: string; progress: string; chunks: string[] }>(),
    completedQuestions: [],
    totalQuestions: 0,
    batchStarted: false
  });
  const [customFormula, setCustomFormula] = useState<CustomFormula>(() => {
    // Initialize with default support approach distribution
    return {
      questionTypes: [
        { type: 'multiple-choice', count: 1, percentage: 35, scope: 'per-lo', editMode: 'count' },
        { type: 'true-false', count: 1, percentage: 20, scope: 'per-lo', editMode: 'count' },
        { type: 'flashcard', count: 1, percentage: 25, scope: 'per-lo', editMode: 'count' },
        { type: 'discussion', count: 0, percentage: 10, scope: 'per-lo', editMode: 'count' },
        { type: 'summary', count: 0, percentage: 10, scope: 'per-lo', editMode: 'count' }
      ],
      totalQuestions: 3,
      totalPerLO: 3,
      totalWholeQuiz: 0
    };
  });
  
  // SSE URL for streaming - use test endpoint (no auth required for EventSource limitation)
  const sseUrl = streamingState.sessionId ? `${API_URL}/api/create/streaming/test-sse/${streamingState.sessionId}` : null;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalJustSaved, setModalJustSaved] = useState(false);
  
  
  // SSE connection for streaming
  const { connectionStatus, isConnected, error: sseError, disconnect } = useSSE(sseUrl, {
    onConnected: () => {
      console.log('🔗 SSE connected successfully');
    },
    onBatchStarted: (data: any) => {
      console.log('🚀 Batch started:', data);
      setStreamingState(prev => ({
        ...prev,
        batchStarted: true,
        totalQuestions: data.totalQuestions || 0
      }));
    },
    onQuestionProgress: (questionId: string, data: any) => {
      console.log('📊 Question progress:', questionId, data);
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
          type: data.type || existing.type, // Update type if provided
          progress: data.status === 'started' ? 'Generating...' : existing.progress
        });

        return {
          ...prev,
          questionsInProgress: newInProgress
        };
      });
    },
    onTextChunk: (questionId: string, chunk: string, metadata: any) => {
      console.log('📝 Text chunk:', questionId, chunk.substring(0, 50) + '...');
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
        
        return {
          ...prev,
          questionsInProgress: newInProgress
        };
      });
    },
    onQuestionComplete: (questionId: string, question: any) => {
      console.log('✅ Question completed:', questionId, question);
      setStreamingState(prev => {
        const newInProgress = new Map(prev.questionsInProgress);
        newInProgress.delete(questionId);
        
        const newCompletedQuestions = [...prev.completedQuestions, question];
        console.log('📝 Updated completed questions:', newCompletedQuestions.length, newCompletedQuestions);
        
        return {
          ...prev,
          questionsInProgress: newInProgress,
          completedQuestions: newCompletedQuestions
        };
      });
    },
    onBatchComplete: (summary: any) => {
      console.log('🎉 Batch completed:', summary);
      
      // Dispatch Redux action to set questionsGenerating to false
      console.log('✅ QuestionGeneration - Dispatching setQuestionsGenerating(false) - Batch complete');
      dispatch(setQuestionsGenerating({ generating: false, quizId }));
      
      // Publish completion event so other components can react
      const eventData = {
        quizId,
        questionsGenerated: summary.totalGenerated || 0,
        timestamp: Date.now()
      };
      console.log('📢 QuestionGeneration - Publishing QUESTION_GENERATION_COMPLETED event:', eventData);
      publish(PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED, eventData);
      
      setStreamingState(prev => {
        // For test mode with DB save, use the completed questions from streaming
        // For production, reload questions from database
        if (summary.realLLMTestWithDB) {
          // Test mode with DB save: display the completed questions from streaming
          console.log('🔧 Setting questions from streaming state:', prev.completedQuestions);
          setQuestions(prev.completedQuestions);
          setHasExistingQuestions(prev.completedQuestions.length > 0);
        } else {
          // Production mode: reload questions from database
          console.log('🔧 Loading questions from database for quiz:', quizId);
          loadExistingQuestions(quizId);
        }
        
        showNotification('success', 'Questions Generated', 
          `Successfully generated ${summary.totalGenerated || prev.completedQuestions.length} questions with streaming!`);
        
        // Auto-redirect to Review & Edit page after questions are generated
        // Give more time for database save to complete
        if (onQuestionsGenerated) {
          setTimeout(() => {
            onQuestionsGenerated();
          }, 3000); // Give user 3 seconds to see completion and ensure DB save
        }
        
        return {
          ...prev,
          isStreaming: false,
          batchStarted: false
        };
      });
    },
    onError: (questionId: string, errorMessage: string, errorType: string) => {
      console.error('🚨 SSE error:', questionId, errorMessage, errorType);
      showNotification('error', 'Generation Error', `Error generating question ${questionId}: ${errorMessage}`);
    },
    onHeartbeat: () => {
      // Silent heartbeat
    }
  });

  // Auto-complete batch if all questions are done (fallback for when batch-complete event is not received)
  useEffect(() => {
    const { batchStarted, totalQuestions, completedQuestions, questionsInProgress, isStreaming } = streamingState;

    // Only trigger if batch has started and is still streaming
    if (!batchStarted || !isStreaming) {
      return;
    }

    // Debug logging
    console.log('🔍 Auto-completion check:', {
      completed: completedQuestions.length,
      total: totalQuestions,
      inProgress: questionsInProgress.size,
      inProgressIds: Array.from(questionsInProgress.keys())
    });

    // Check if all questions are completed via SSE
    const allCompleted = completedQuestions.length >= totalQuestions && questionsInProgress.size === 0;

    // Also check if we've received enough completed events
    const allQuestionsReceived = completedQuestions.length >= totalQuestions;

    if ((allCompleted || allQuestionsReceived) && totalQuestions > 0) {
      console.log('✅ All questions completed via SSE - auto-triggering batch complete');
      console.log(`📊 Final stats: ${completedQuestions.length}/${totalQuestions} completed, ${questionsInProgress.size} in progress`);

      // Dispatch Redux action to set questionsGenerating to false
      dispatch(setQuestionsGenerating({ generating: false, quizId }));

      // Reload questions from database
      loadExistingQuestions(quizId);

      showNotification('success', 'Questions Generated',
        `Successfully generated ${completedQuestions.length} questions!`);

      // Auto-redirect to Review & Edit page
      if (onQuestionsGenerated) {
        setTimeout(() => {
          onQuestionsGenerated();
        }, 3000);
      }

      // Update state
      setStreamingState(prev => ({
        ...prev,
        isStreaming: false,
        batchStarted: false,
        questionsInProgress: new Map() // Clear in-progress questions
      }));
    }
  }, [streamingState.completedQuestions.length, streamingState.questionsInProgress.size, streamingState.batchStarted, streamingState.totalQuestions]);

  // Fallback: Poll database to check if all questions are saved (in case SSE events are lost due to 502)
  useEffect(() => {
    const { batchStarted, totalQuestions, isStreaming, sessionId } = streamingState;

    if (!batchStarted || !isStreaming || !sessionId) {
      return;
    }

    // Poll database every 3 seconds to check for completion
    const pollInterval = setInterval(async () => {
      console.log('🔄 Polling database for question count...');

      try {
        const result = await questionsApi.getQuestions(quizId);

        // Safety check: ensure result and questions array exist
        if (!result || !result.questions || !Array.isArray(result.questions)) {
          console.warn('⚠️ Invalid response from getQuestions:', result);
          return;
        }

        const savedCount = result.questions.length;

        console.log(`📊 Database check: ${savedCount}/${totalQuestions} questions saved`);

        // If all questions are saved to database, trigger completion
        if (savedCount >= totalQuestions && totalQuestions > 0) {
          console.log('✅ All questions found in database - triggering completion via polling');

          // Load the questions
          setQuestions(result.questions);
          setHasExistingQuestions(true);

          showNotification('success', 'Questions Generated',
            `Successfully generated ${savedCount} questions!`);

          // Auto-redirect
          if (onQuestionsGenerated) {
            setTimeout(() => {
              onQuestionsGenerated();
            }, 3000);
          }

          // Stop streaming
          setStreamingState(prev => ({
            ...prev,
            isStreaming: false,
            batchStarted: false,
            questionsInProgress: new Map()
          }));

          // Clear the interval
          clearInterval(pollInterval);
        }
      } catch (error) {
        console.error('❌ Error polling database:', error);
        // Don't spam errors - silently continue polling
      }
    }, 3000); // Poll every 3 seconds

    // Cleanup interval on unmount or when streaming stops
    return () => {
      clearInterval(pollInterval);
    };
  }, [streamingState.batchStarted, streamingState.isStreaming, streamingState.sessionId, streamingState.totalQuestions]);

  // Load existing plans and restore quiz-specific settings when component mounts
  useEffect(() => {
    if (quizId) {
      dispatch(fetchPlans(quizId));
      // Restore quiz-specific settings from localStorage
      restoreQuizSettings(quizId);
      // Load existing questions if any
      loadExistingQuestions(quizId);
    }
  }, [quizId, dispatch]);

  // Subscribe to objectives deleted event to reload questions
  useEffect(() => {
    console.log('🎯 QuestionGeneration - Setting up PubSub subscription for quizId:', quizId);
    
    const objectivesDeletedToken = subscribe(
      PUBSUB_EVENTS.OBJECTIVES_DELETED,
      (data: any) => {
        console.log('🎯 QuestionGeneration - Received OBJECTIVES_DELETED event:', data);
        if (data.quizId === quizId) {
          console.log('🎯 QuestionGeneration - LO deleted, reloading questions');
          loadExistingQuestions(quizId);
        }
      }
    );

    // Subscribe to questions deleted event to reload questions
    const questionsDeletedToken = subscribe(
      PUBSUB_EVENTS.QUESTIONS_DELETED,
      (data: any) => {
        console.log('🎯 QuestionGeneration - Received QUESTIONS_DELETED event:', data);
        if (data.quizId === quizId) {
          console.log('🎯 QuestionGeneration - Question deleted, reloading questions');
          loadExistingQuestions(quizId);
        }
      }
    );

    return () => {
      console.log('🎯 QuestionGeneration - Unsubscribing from OBJECTIVES_DELETED and QUESTIONS_DELETED');
      unsubscribe(objectivesDeletedToken);
      unsubscribe(questionsDeletedToken);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  // NOTE: Removed cleanup effect that was resetting questionsGenerating on unmount
  // This was causing issues when switching tabs - the generation should continue
  // and the state will be reset when generation completes (in onBatchComplete or error handlers)

  // Load existing questions for the quiz
  const loadExistingQuestions = async (quizId: string) => {
    try {
      const result = await questionsApi.getQuestions(quizId);

      // Safety check: ensure result and questions array exist
      if (!result || !result.questions || !Array.isArray(result.questions)) {
        console.warn('⚠️ Invalid response from getQuestions:', result);
        setQuestions([]);
        setHasExistingQuestions(false);
        return;
      }

      if (result.questions.length > 0) {
        console.log('📝 Loaded existing questions:', result.questions.length);
        setQuestions(result.questions);
        setHasExistingQuestions(true);
        // Questions loaded successfully
      } else {
        console.log('📝 No questions found, clearing state');
        setQuestions([]);
        setHasExistingQuestions(false);
      }
    } catch (error) {
      console.error('Failed to load existing questions:', error);
      setQuestions([]);
      setHasExistingQuestions(false);
    }
  };

  // Save quiz-specific settings to localStorage
  const saveQuizSettings = (quizId: string) => {
    const settings = {
      approach,
      questionsPerLO,
      showAdvancedEdit,
      customFormula,
      timestamp: Date.now()
    };
    localStorage.setItem(`quiz-settings-${quizId}`, JSON.stringify(settings));
    console.log('💾 Saved quiz settings for:', quizId, settings);
  };


  // Helper function for prompt analysis
  const getPromptAnalysis = () => {
    const methodUsage = questions.reduce((acc, question) => {
      const metadata = question.generationMetadata;
      const method = metadata?.generationMethod || 'template-based';
      acc[method] = (acc[method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const promptsByLO = learningObjectives.map((lo) => {
      const loQuestions = questions.filter(q => {
        const loText = typeof q.learningObjective === 'string' ? q.learningObjective : (q.learningObjective as any)?.text;
        return loText === lo;
      });
      
      return {
        objective: lo.substring(0, 50) + (lo.length > 50 ? '...' : ''),
        questionCount: loQuestions.length,
        prompts: loQuestions.map(q => ({
          questionNumber: q.order + 1,
          type: q.type,
          prompt: q.generationMetadata?.generationPrompt || `Generate ${q.type} question for: ${lo}`,
          subObjective: q.generationMetadata?.subObjective || 'General knowledge application',
          focusArea: q.generationMetadata?.focusArea || 'general knowledge',
          complexity: q.generationMetadata?.complexity || 'medium',
          method: q.generationMetadata?.generationMethod || 'template-based'
        }))
      };
    });

    return { methodUsage, promptsByLO };
  };

  // Restore quiz-specific settings from localStorage
  const restoreQuizSettings = (quizId: string) => {
    try {
      const saved = localStorage.getItem(`quiz-settings-${quizId}`);
      if (saved) {
        const settings = JSON.parse(saved);
        console.log('🔄 Restoring quiz settings from localStorage for:', quizId, settings);
        
        // Only restore if settings are recent (within 24 hours)
        const isRecent = Date.now() - settings.timestamp < 24 * 60 * 60 * 1000;
        if (isRecent) {
          // Set a flag to prevent the restoration from being overridden immediately
          setIsUserEditingApproach(true);
          
          setApproach(settings.approach || 'support');
          setQuestionsPerLO(settings.questionsPerLO || 3);
          setShowAdvancedEdit(settings.showAdvancedEdit || false);
          if (settings.customFormula) {
            setCustomFormula(settings.customFormula);
          }
          
          // Reset the flag after restoration is complete
          setTimeout(() => setIsUserEditingApproach(false), 200);
        }
      }
    } catch (error) {
      console.error('Failed to restore quiz settings:', error);
    }
  };

  // Restore custom formula when currentPlan changes
  // Database plan takes priority over localStorage settings
  useEffect(() => {
    if (currentPlan && currentPlan.customFormula && !isUserEditingApproach) {
      console.log('🔄 Restoring custom formula from database plan:', currentPlan.customFormula);
      setCustomFormula({
        questionTypes: currentPlan.customFormula.questionTypes || [],
        totalQuestions: currentPlan.customFormula.totalQuestions || 3,
        totalPerLO: currentPlan.customFormula.totalPerLO || 3,
        totalWholeQuiz: currentPlan.customFormula.totalWholeQuiz || 0
      });
      
      // Set the approach and questionsPerLO from the plan  
      setApproach(currentPlan.approach);
      setQuestionsPerLO(currentPlan.questionsPerLO);
      
      // Show advanced edit if custom formula exists
      if (currentPlan.customFormula.questionTypes && currentPlan.customFormula.questionTypes.length > 0) {
        setShowAdvancedEdit(true);
      }
      
      // Update localStorage with the plan data to keep them in sync
      saveQuizSettings(quizId);
    } else if (isUserEditingApproach) {
      console.log('⏭️ Skipping plan restoration - user is editing approach');
    }
  }, [currentPlan, isUserEditingApproach, quizId]);


  const pedagogicalApproaches = [
    {
      id: 'support' as PedagogicalApproach,
      title: 'Support Learning',
      description: 'Flashcards and summaries to help students memorize and understand',
      icon: GraduationCap,
    },
    {
      id: 'assess' as PedagogicalApproach,
      title: 'Assess Learning', 
      description: 'Classic assessment questions to test student comprehension',
      icon: Zap,
    },
    {
      id: 'gamify' as PedagogicalApproach,
      title: 'Gamify Learning',
      description: 'Interactive and engaging questions to make learning fun',
      icon: Gamepad2,
    },
    {
      id: 'custom' as PedagogicalApproach,
      title: 'Custom Formula',
      description: 'Define your own mix of question types and quantities',
      icon: Settings,
    }
  ];

  // Plan generation handlers
  const handleGeneratePlan = async () => {
    try {
      const effectiveQuestionsPerLO = approach === 'custom' ? customFormula.totalPerLO : questionsPerLO;
      
      // Prepare the plan generation data
      const planData: any = {
        quizId,
        approach,
        questionsPerLO: effectiveQuestionsPerLO
      };
      
      // Add custom formula for advanced settings
      if (approach === 'custom' || showAdvancedEdit) {
        planData.customFormula = {
          questionTypes: customFormula.questionTypes,
          totalPerLO: customFormula.totalPerLO,
          totalWholeQuiz: customFormula.totalWholeQuiz,
          totalQuestions: (learningObjectives.length * customFormula.totalPerLO) + customFormula.totalWholeQuiz
        };
      }
      
      // Save current settings before generating plan
      saveQuizSettings(quizId);
      
      // Reset user editing flag before generating plan
      setIsUserEditingApproach(false);
      
      await dispatch(generatePlan(planData));
      showNotification('success', 'Plan Generated', 'Generation plan created successfully with your custom settings');
    } catch (error) {
      console.error('Failed to generate plan:', error);
      showNotification('error', 'Plan Generation Failed', 'Failed to generate plan');
    }
  };

  // Delete existing questions before regeneration
  const handleDeleteExistingQuestions = async () => {
    try {
      console.log('🗑️ Deleting existing questions before regeneration...');
      const result = await questionsApi.deleteAllQuestions(quizId);
      console.log(`✅ Deleted ${result.deletedCount} existing questions`);
      
      // Clear local questions state
      setQuestions([]);
      setHasExistingQuestions(false);
      
      return result.deletedCount;
    } catch (error) {
      console.error('Failed to delete existing questions:', error);
      throw error;
    }
  };

  // Reset plan to allow user to change approach and regenerate
  const handleGoBackToPlan = () => {
    // Reset the plan state to show plan generation UI again
    dispatch(setCurrentPlan(null));
    
    // Clear questions to ensure we go back to plan phase
    setQuestions([]);
    setHasExistingQuestions(false);
    
    // Enable user editing mode
    setIsUserEditingApproach(true);
    
    showNotification('info', 'Plan Reset', 'You can now modify your approach and generate a new plan.');
  };

  // Direct question generation with streaming
  const handleDirectGenerateQuestions = async (isRegeneration = false) => {
    try {
      setIsRegenerating(isRegeneration);
      
      // Dispatch Redux action to set questionsGenerating to true
      console.log('🚀 QuestionGeneration - Dispatching setQuestionsGenerating(true) for quizId:', quizId);
      console.log('🚀 QuestionGeneration - Current Redux state BEFORE dispatch:', store.getState().plan.questionsGenerating);
      
      dispatch(setQuestionsGenerating({ 
        generating: true, 
        quizId,
        totalQuestions: (learningObjectives.length * customFormula.totalPerLO) + customFormula.totalWholeQuiz
      }));
      
      // Use setTimeout to check state after Redux has processed the action
      setTimeout(() => {
        console.log('🚀 QuestionGeneration - Current Redux state AFTER dispatch (async check):', store.getState().plan.questionsGenerating);
      }, 0);
      
      // Small delay to ensure state propagates
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Delete existing questions if this is a regeneration
      if (isRegeneration && hasExistingQuestions) {
        await handleDeleteExistingQuestions();
        showNotification('info', 'Questions Deleted', 'Previous questions deleted. Generating new ones...');
      }
      
      // Create a plan data structure based on current approach settings
      const effectiveQuestionsPerLO = approach === 'custom' ? customFormula.totalPerLO : questionsPerLO;
      
      const planData: any = {
        quizId,
        approach,
        questionsPerLO: effectiveQuestionsPerLO
      };
      
      // Add custom formula for advanced settings
      if (approach === 'custom' || showAdvancedEdit) {
        planData.customFormula = {
          questionTypes: customFormula.questionTypes,
          totalPerLO: customFormula.totalPerLO,
          totalWholeQuiz: customFormula.totalWholeQuiz,
          totalQuestions: (learningObjectives.length * customFormula.totalPerLO) + customFormula.totalWholeQuiz
        };
      }
      
      // Save current settings
      saveQuizSettings(quizId);
      
      console.log('🎯 Starting streaming generation with plan data:', planData);
      
      // Generate plan internally without showing plan phase
      const planResult = await dispatch(generatePlan(planData));
      console.log('✅ Plan generated internally:', planResult);
      
      // Get the generated plan and approve it
      if (planResult.payload && planResult.payload._id) {
        console.log('🔄 Approving generated plan:', planResult.payload._id);
        await dispatch(approvePlan(planResult.payload._id));
        console.log('✅ Plan approved, starting streaming generation');
      } else {
        throw new Error('Failed to get plan ID after generation');
      }
      
      // Show starting state
      showNotification('info', 'Starting Generation', 'Initializing streaming question generation...');
      
      // Small delay to ensure database is updated
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Prepare question configs for streaming
      const questionConfigs = [];
      const totalQuestions = (learningObjectives.length * customFormula.totalPerLO) + customFormula.totalWholeQuiz;
      
      // Generate question configs based on the plan
      for (let i = 0; i < learningObjectives.length; i++) {
        const lo = learningObjectives[i];
        customFormula.questionTypes.forEach(qtConfig => {
          if (qtConfig.scope === 'per-lo') {
            for (let j = 0; j < qtConfig.count; j++) {
              questionConfigs.push({
                questionType: qtConfig.type,
                difficulty: 'moderate',
                learningObjectiveIndex: i,
                learningObjective: lo
              });
            }
          }
        });
      }
      
      // Add whole-quiz questions
      customFormula.questionTypes.forEach(qtConfig => {
        if (qtConfig.scope === 'whole-quiz') {
          for (let j = 0; j < qtConfig.count; j++) {
            questionConfigs.push({
              questionType: qtConfig.type,
              difficulty: 'moderate',
              scope: 'whole-quiz'
            });
          }
        }
      });
      
      console.log('📋 Generated question configs for streaming:', questionConfigs);
      
      // Generate a session ID for testing with database save
      const sessionId = `test-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Initialize streaming state with session ID for SSE connection
      setStreamingState({
        isStreaming: true,
        sessionId: sessionId, // Set immediately for SSE connection
        questionsInProgress: new Map(),
        completedQuestions: [],
        totalQuestions: questionConfigs.length,
        batchStarted: false
      });

      // CRITICAL: Wait for SSE connection to establish BEFORE starting generation
      console.log('⏳ Waiting for SSE connection to establish...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for SSE to connect
      console.log('✅ SSE connection should be ready, starting generation...');

      // Start production streaming generation
      const response = await fetch(`${API_URL}/api/create/streaming/generate-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include session cookies for authentication
        body: JSON.stringify({
          sessionId: sessionId,
          quizId: quizId,
          questionConfigs: questionConfigs // Pass the full question configs with learningObjective in each config
        })
      });

      const result = await response.json();
      console.log('📡 Streaming generation started:', result);
      
      showNotification('success', 'Streaming Started', 'Questions are being generated in real-time. Watch them appear below!');
      
    } catch (error) {
      console.error('Failed to start streaming generation:', error);
      const errorMessage = isRegeneration 
        ? 'Failed to start regeneration'
        : 'Failed to start question generation';
      showNotification('error', 'Generation Failed', errorMessage);
      
      // Dispatch Redux action to set questionsGenerating to false on error
      console.log('❌ QuestionGeneration - Dispatching setQuestionsGenerating(false) - Error occurred');
      dispatch(setQuestionsGenerating({ generating: false, quizId }));
      
      // Publish failure event so other components can react
      publish(PUBSUB_EVENTS.QUESTION_GENERATION_FAILED, {
        quizId,
        error: errorMessage,
        timestamp: Date.now()
      });
      
      // Reset streaming state on error
      setStreamingState({
        isStreaming: false,
        sessionId: null,
        questionsInProgress: new Map(),
        completedQuestions: [],
        totalQuestions: 0,
        batchStarted: false
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleGenerateQuestions = async (isRegeneration = false) => {
    if (!currentPlan) return;

    try {
      setIsRegenerating(isRegeneration);

      // Delete existing questions if this is a regeneration
      if (isRegeneration && hasExistingQuestions) {
        await handleDeleteExistingQuestions();
        showNotification('info', 'Questions Deleted', 'Previous questions deleted. Generating new ones...');
      }

      // First approve the plan
      await dispatch(approvePlan(currentPlan._id));
      console.log('✅ Plan approved, starting question generation');

      // Show generating state while maintaining plan phase
      showNotification('info', 'Generating Questions', 'AI is generating questions based on your plan...');

      // Small delay to ensure database is updated
      await new Promise(resolve => setTimeout(resolve, 500));

      // Try streaming first (for Ollama), fall back to non-streaming (for OpenAI)
      let streamingSuccess = false;
      const generatedQuestions: Question[] = [];

      try {
        console.log('🌊 Attempting streaming generation...');
        await questionsApi.generateFromPlanStream(
          quizId,
          (event: string, data: any) => {
            // Handle streaming events
            if (event === 'stream') {
              console.log('🌊 Stream chunk:', data.chunk);
              // Update UI to show streaming progress
              setStreamingState(prev => {
                const key = `${data.questionType}-${data.questionIndex}`;
                const existing = prev.questionsInProgress.get(key) || {
                  questionId: key,
                  type: data.questionType,
                  progress: '',
                  chunks: []
                };

                existing.chunks.push(data.chunk);
                existing.progress = existing.chunks.join('');

                const newMap = new Map(prev.questionsInProgress);
                newMap.set(key, existing);

                return {
                  ...prev,
                  isStreaming: true,
                  questionsInProgress: newMap
                };
              });
            } else if (event === 'question-created') {
              console.log('✅ Question created:', data.questionText);
              // Add completed question
              if (data.question) {
                generatedQuestions.push(data.question);
              }
            }
          },
          (data: any) => {
            // On complete
            console.log('🎉 Streaming generation complete:', data);
            streamingSuccess = true;
            setQuestions(generatedQuestions);
            setHasExistingQuestions(generatedQuestions.length > 0);

            const message = isRegeneration
              ? `Successfully regenerated ${generatedQuestions.length} questions with new approach!`
              : `Successfully generated ${generatedQuestions.length} questions!`;

            showNotification('success', 'Questions Generated', message);

            // Reset streaming state
            setStreamingState({
              isStreaming: false,
              sessionId: null,
              questionsInProgress: new Map(),
              completedQuestions: [],
              totalQuestions: 0,
              batchStarted: false
            });

            // Redirect to Review & Edit page after generation
            if (onQuestionsGenerated) {
              setTimeout(() => {
                onQuestionsGenerated();
              }, 1000);
            }
          },
          (error: string) => {
            // On error - fall back to non-streaming
            console.log('⚠️ Streaming failed, falling back to non-streaming:', error);
            throw new Error(error);
          }
        );
      } catch (streamError) {
        // Fallback to non-streaming generation (for OpenAI or if streaming fails)
        console.log('📦 Using non-streaming generation as fallback');
        const result = await questionsApi.generateFromPlan(quizId);
        console.log('🎉 Questions generated successfully:', result);

        // Store the generated questions
        setQuestions(result.questions);
        setHasExistingQuestions(result.questions.length > 0);

        const message = isRegeneration
          ? `Successfully regenerated ${result.questions.length} questions with new approach!`
          : `Successfully generated ${result.questions.length} questions!`;

        showNotification('success', 'Questions Generated', message);

        // Redirect to Review & Edit page after generation
        if (onQuestionsGenerated) {
          // Small delay to allow notification to show
          setTimeout(() => {
            onQuestionsGenerated();
          }, 1000);
        }
      }
    } catch (error) {
      console.error('Failed to generate questions:', error);
      const errorMessage = isRegeneration
        ? 'Failed to regenerate questions'
        : 'Failed to generate questions';
      showNotification('error', 'Question Generation Failed', errorMessage);
    } finally {
      setIsRegenerating(false);
    }
  };




  // Advanced settings handlers - moved to modal component

  // Get approach-specific question type distribution (matches backend)
  const getApproachDistribution = (approach: PedagogicalApproach, questionsPerLO: number) => {
    const distributions = {
      'support': {
        'multiple-choice': 35,
        'true-false': 20,
        'flashcard': 25,
        'discussion': 10,
        'summary': 10
      },
      'assess': {
        'multiple-choice': 50,
        'true-false': 20,
        'discussion': 20,
        'summary': 10
      },
      'gamify': {
        'matching': 30,
        'ordering': 25,
        'multiple-choice': 25,
        'flashcard': 20
      },
      'custom': {
        'multiple-choice': 35,
        'true-false': 15,
        'flashcard': 15,
        'discussion': 15,
        'summary': 10,
        'matching': 10
      }
    };

    const dist = distributions[approach] || distributions['support'];
    const questionTypes = [];
    
    Object.entries(dist).forEach(([type, percentage]) => {
      const count = Math.round((percentage / 100) * questionsPerLO);
      if (count > 0) {
        questionTypes.push({
          type,
          count,
          percentage,
          scope: 'per-lo' as const,
          editMode: 'count' as const
        });
      }
    });

    return {
      questionTypes,
      totalQuestions: questionsPerLO,
      totalPerLO: questionsPerLO,
      totalWholeQuiz: 0
    };
  };

  // Update custom formula when questionsPerLO or approach changes
  // But only if we don't have a current plan with existing custom formula AND user is not being restored
  useEffect(() => {
    console.log('🔄 Approach changed to:', approach, 'questionsPerLO:', questionsPerLO);
    console.log('🔄 Current plan exists:', !!currentPlan, 'has customFormula:', !!(currentPlan && currentPlan.customFormula));
    console.log('🔄 isUserEditingApproach:', isUserEditingApproach, 'modalJustSaved:', modalJustSaved);
    
    // Skip if modal was just saved to prevent overriding user changes
    if (modalJustSaved) {
      console.log('⏭️ Skipping formula update - modal was just saved');
      return;
    }
    
    // Skip if we have a current plan that should restore its own data, UNLESS user is actively editing
    if (currentPlan && currentPlan.customFormula && !isUserEditingApproach) {
      console.log('⏭️ Skipping formula update - using current plan data');
      return;
    }
    
    if (approach === 'custom') {
      const totalPerLO = customFormula.questionTypes.filter(qt => qt.scope === 'per-lo').reduce((sum, qt) => sum + qt.count, 0);
      setQuestionsPerLO(totalPerLO);
    } else {
      // Use approach-specific distribution (matches backend logic)
      console.log('🎯 Setting approach-specific distribution for:', approach);
      const newFormula = getApproachDistribution(approach, questionsPerLO);
      console.log('🎯 New formula:', newFormula);
      setCustomFormula(newFormula);
    }
  }, [approach, questionsPerLO, currentPlan, isUserEditingApproach, modalJustSaved]);

  // Debug advanced edit visibility
  useEffect(() => {
    console.log('🔍 Advanced edit visibility check:', {
      approach,
      showAdvancedEdit,
      shouldShow: approach === 'custom' || showAdvancedEdit,
      customFormula
    });
  }, [approach, showAdvancedEdit, customFormula]);

  // Auto-save settings when they change (but not during initial load/restoration)
  useEffect(() => {
    // Skip saving during initial component mount and plan restoration
    if (!quizId || isUserEditingApproach) return;
    
    // Add small delay to avoid saving during rapid state changes
    const timeoutId = setTimeout(() => {
      saveQuizSettings(quizId);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [approach, questionsPerLO, showAdvancedEdit, customFormula, quizId, isUserEditingApproach]);

  if (learningObjectives.length === 0) {
    return (
      <div className="question-generation">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Generate Questions</h3>
            <p className="card-description">
              Please set learning objectives first before generating questions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="question-generation">
      {questions.length === 0 && !streamingState.isStreaming ? (
        // Direct Question Generation - no plan phase
        <div className="generation-phase">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Generate Questions</h3>
              <p className="card-description">
                Configure your pedagogical approach and generate questions directly from your learning objectives
              </p>
            </div>

            {/* Approach Selection */}
            <div className="pedagogical-approaches">
              <h4>Choose Pedagogical Approach</h4>
              <div className="approaches-grid">
                {pedagogicalApproaches.map((app) => (
                  <div
                    key={app.id}
                    className={`approach-card ${approach === app.id ? 'selected' : ''}`}
                    onClick={() => {
                      console.log('🎯 Approach selected:', app.id);
                      setIsUserEditingApproach(true);
                      setApproach(app.id);
                      
                      // If Custom Formula is selected, automatically open the modal
                      if (app.id === 'custom') {
                        setTimeout(() => {
                          setIsModalOpen(true);
                        }, 150); // Small delay to allow approach to be set first
                      }
                      
                      // Reset the flag after a short delay to allow approach change to process
                      setTimeout(() => setIsUserEditingApproach(false), 100);
                    }}
                  >
                    <app.icon size={24} />
                    <h5>{app.title}</h5>
                    <p>{app.description}</p>
                    {app.id !== 'custom' && approach === app.id && (
                      <button
                        className="btn btn-outline btn-sm advanced-edit-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('🔧 Advanced Edit clicked for approach:', approach);
                          setIsUserEditingApproach(true);
                          setIsModalOpen(true);
                        }}
                      >
                        <Edit size={14} />
                        Advanced Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Settings */}
            {approach !== 'custom' && (
              <div className="generation-settings">
                <div className="setting-group">
                  <label>Questions per Learning Objective: {questionsPerLO}</label>
                  <div className="questions-counter">
                    <button
                      className="btn btn-outline counter-btn"
                      onClick={() => setQuestionsPerLO(Math.max(1, questionsPerLO - 1))}
                    >
                      -
                    </button>
                    <span className="counter-value">{questionsPerLO}</span>
                    <button
                      className="btn btn-outline counter-btn"
                      onClick={() => setQuestionsPerLO(Math.min(10, questionsPerLO + 1))}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="setting-group">
                  <label>Total Questions: {learningObjectives.length * questionsPerLO}</label>
                  <p className="setting-description">
                    Based on {learningObjectives.length} learning objectives
                  </p>
                </div>
              </div>
            )}

            {approach === 'custom' && (
              <div className="generation-settings">
                <div className="setting-group">
                  <label>Custom Formula Configuration</label>
                  <p className="setting-description">
                    Configure question types and quantities using the advanced editor below.
                  </p>
                </div>
                <div className="setting-group">
                  <label>Total Questions: {learningObjectives.length * customFormula.totalQuestions}</label>
                  <p className="setting-description">
                    {customFormula.totalQuestions} questions per learning objective × {learningObjectives.length} objectives
                  </p>
                </div>
              </div>
            )}

            {/* Advanced Edit Modal */}
            <AdvancedEditModal
              isOpen={isModalOpen}
              onClose={() => {
                setIsModalOpen(false);
                setIsUserEditingApproach(false);
                // Clear the flag after a delay to prevent overriding
                setTimeout(() => setModalJustSaved(false), 100);
              }}
              customFormula={customFormula}
              onFormulaChange={(newFormula) => {
                console.log('🔄 Formula changed in modal:', newFormula);
                setCustomFormula(newFormula);
                // Update questionsPerLO to match the formula's totalPerLO
                setQuestionsPerLO(newFormula.totalPerLO);
                // Enable showAdvancedEdit to indicate custom settings are active
                if (approach !== 'custom') {
                  setShowAdvancedEdit(true);
                }
              }}
              approach={approach}
              learningObjectivesCount={learningObjectives.length}
              onSave={() => {
                console.log('💾 Saving advanced edit changes');
                setModalJustSaved(true);
                saveQuizSettings(quizId);
                setIsUserEditingApproach(false);
              }}
            />

            {/* Direct Generate Questions Button */}
            <div className="generation-action">
              <button
                className="btn btn-primary btn-lg"
                onClick={() => {
                  console.log('🎯 Generate Questions button clicked!');
                  handleDirectGenerateQuestions();
                }}
                disabled={generating || isRegenerating || learningObjectives.length === 0 || assignedMaterials.length === 0}
              >
                {generating || isRegenerating ? (
                  <>
                    <div className="loading-spinner"></div>
                    Generating Questions...
                  </>
                ) : (
                  <>
                    <Wand2 size={18} />
                    Generate Questions
                  </>
                )}
              </button>
              
              {hasExistingQuestions && (
                <button
                  className="btn btn-warning"
                  onClick={() => handleDirectGenerateQuestions(true)}
                  disabled={generating || isRegenerating}
                >
                  <Wand2 size={16} />
                  Regenerate All Questions
                </button>
              )}
            </div>
          </div>
        </div>
      ) : streamingState.isStreaming ? (
        // Streaming Progress Phase
        <div className="streaming-phase">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <Loader className="spinning" size={20} />
                Generating Questions in Real-time
              </h3>
              <p className="card-description">
                Questions are being generated with AI streaming. Watch them appear as they're created!
              </p>
            </div>

            {/* Connection Status */}
            <div className="streaming-status">
              <div className={`connection-indicator ${connectionStatus}`}>
                <div className="status-dot"></div>
                <span>
                  {connectionStatus === 'connected' && 'Connected to streaming service'}
                  {connectionStatus === 'connecting' && 'Connecting to streaming service...'}
                  {connectionStatus === 'disconnected' && 'Disconnected from streaming service'}
                  {connectionStatus === 'error' && 'Connection error - attempting to reconnect...'}
                </span>
              </div>
            </div>

            {/* Batch Progress */}
            {streamingState.batchStarted && (
              <div className="batch-progress">
                <div className="progress-header">
                  <h4>Generation Progress</h4>
                  <span className="progress-count">
                    {streamingState.completedQuestions.length} / {streamingState.totalQuestions} completed
                  </span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ 
                      width: `${(streamingState.completedQuestions.length / streamingState.totalQuestions) * 100}%` 
                    }}
                  ></div>
                </div>
              </div>
            )}

            {/* Questions in Progress */}
            {streamingState.questionsInProgress.size > 0 && (
              <div className="questions-in-progress">
                <h4>Currently Generating</h4>
                <div className="progress-questions">
                  {Array.from(streamingState.questionsInProgress.values()).map((questionProgress) => (
                    <div key={questionProgress.questionId} className="progress-question">
                      <div className="question-header">
                        <span className="question-type">{questionProgress.type.replace('-', ' ')}</span>
                        <span className="question-status">{questionProgress.progress}</span>
                      </div>
                      {questionProgress.chunks.length > 0 && (
                        <div className="streaming-text">
                          <div className="text-preview">
                            {questionProgress.chunks.join('')}
                            <span className="cursor-blink">|</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completed Questions Preview */}
            {streamingState.completedQuestions.length > 0 && (
              <div className="completed-questions-preview">
                <h4>Recently Completed</h4>
                <div className="completed-list">
                  {streamingState.completedQuestions.slice(-3).map((question, index) => (
                    <div key={index} className="completed-question">
                      <div className="question-preview">
                        <span className="question-type">{question.type?.replace('-', ' ')}</span>
                        <span className="question-text">
                          {question.questionText?.substring(0, 100)}
                          {question.questionText?.length > 100 && '...'}
                        </span>
                        <CheckCircle size={16} className="completed-icon" />
                      </div>
                    </div>
                  ))}
                  {streamingState.completedQuestions.length > 3 && (
                    <div className="more-completed">
                      + {streamingState.completedQuestions.length - 3} more completed
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Stop Streaming Button */}
            <div className="streaming-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  disconnect();
                  setStreamingState({
                    isStreaming: false,
                    sessionId: null,
                    questionsInProgress: new Map(),
                    completedQuestions: [],
                    totalQuestions: 0,
                    batchStarted: false
                  });
                  showNotification('info', 'Generation Stopped', 'Streaming generation has been stopped.');
                }}
              >
                Stop Generation
              </button>
            </div>
          </div>
        </div>
      ) : (
        // Show Generated Questions Directly (No intermediate page)
        <div className="questions-container">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Questions Generated Successfully!</h3>
              <p className="card-description">
                Your quiz has been generated with {questions.length} questions. Review the summary below.
              </p>
            </div>
            

            {/* Prompt Analysis Section */}
            <div className="prompt-analysis">
              <h4>Generation Prompt Analysis</h4>
              <p>See exactly how each question was generated and what prompts were used:</p>
              
              <div className="prompt-tabs">
                <div className="prompt-tab-content">
                  <div className="prompts-by-lo">
                    {getPromptAnalysis().promptsByLO.map((loData, index) => (
                      <div key={index} className="lo-prompt-group">
                        <div className="lo-header">
                          <span className="lo-title">LO {index + 1}: {loData.objective}</span>
                          <span className="lo-count">{loData.questionCount} questions</span>
                        </div>
                        <div className="prompt-list">
                          {loData.prompts.map((promptData, pIndex) => (
                            <div key={pIndex} className="prompt-item">
                              <div className="prompt-header">
                                <span className="prompt-question">Q{promptData.questionNumber}</span>
                                <span className="prompt-type">{promptData.type.replace('-', ' ')}</span>
                                <span className="prompt-method">{promptData.method}</span>
                                <span className={`complexity-badge ${promptData.complexity}`}>{promptData.complexity}</span>
                              </div>
                              <div className="sub-objective">
                                <strong>Sub-Learning Objective:</strong> {promptData.subObjective}
                              </div>
                              <div className="focus-area">
                                <strong>Focus Area:</strong> <span className="focus-tag">{promptData.focusArea}</span>
                              </div>
                              <div className="prompt-text">
                                <strong>Detailed AI Prompt:</strong> {promptData.prompt}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="generation-summary">
                <h5>AI Generation Method Summary</h5>
                <div className="method-stats">
                  {Object.entries(getPromptAnalysis().methodUsage).map(([method, count]) => (
                    <div key={method} className="method-stat">
                      <span className="method-name">{method.replace('-', ' → ')}</span>
                      <span className="method-count">{count} questions</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="prompt-analysis-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    // Reset to allow approach change and regeneration
                    setQuestions([]);
                    setHasExistingQuestions(false);
                    showNotification('info', 'Settings Reset', 'You can now change your approach and regenerate questions.');
                  }}
                  disabled={loading || isRegenerating}
                >
                  <Settings size={16} />
                  Change Approach & Regenerate
                </button>
                
                {hasExistingQuestions && (
                  <button
                    className="btn btn-warning"
                    onClick={() => handleDirectGenerateQuestions(true)}
                    disabled={loading || isRegenerating}
                  >
                    <Wand2 size={16} />
                    Regenerate with Same Approach
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="card error-card">
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}
    </div>
  );
};



export default QuestionGeneration;