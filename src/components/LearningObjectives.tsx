import React, { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Sparkles, Edit, Plus, Trash2, RotateCcw, X, Link2 } from 'lucide-react';
import { RootState, AppDispatch, store } from '../store';
import {
  fetchObjectives,
  generateObjectives,
  classifyObjectives,
  saveObjectives,
  updateObjective,
  deleteObjective,
  clearObjectives,
  regenerateSingleObjective,
  deleteAllObjectives,
  enrichObjectives
} from '../store/slices/learningObjectiveSlice';
import { clearQuestionsForQuiz, fetchQuestions } from '../store/slices/questionSlice';
import RegeneratePromptModal from './RegeneratePromptModal';
import { usePubSub } from '../hooks/usePubSub';
import { PUBSUB_EVENTS, QuestionGenerationStartedPayload, QuestionGenerationCompletedPayload, QuestionGenerationFailedPayload } from '../services/pubsubService';
import { pubsubService } from '../services/pubsubService';
import { selectIsGenerating } from '../store/selectors';
import { LearningObjectiveData } from './generation/generationTypes';
import SourceReferencePreviewModal from './SourceReferencePreviewModal';
import CoursePromptSettings from './CoursePromptSettings';
import AIPlanGenerationTrace from './generation/AIPlanGenerationTrace';
import { BloomLevel, Question, questionsApi, SourceReference } from '../services/api';
import { API_URL } from '../config/api';
import { useSSE } from '../hooks/useSSE';
import { useFeatureOnboarding } from '../hooks/useFeatureOnboarding';
import {
  buildLinkedQuestionRegenerationPrompt,
  getQuestionsLinkedToObjective,
  regenerateQuestionsSequentially,
} from '../utils/learningObjectiveQuestions';
import FeatureCoachmark from './onboarding/FeatureCoachmark';
import '../styles/components/LearningObjectives.css';

interface LearningObjectivesProps {
  assignedMaterials: string[];
  objectives: LearningObjectiveData[];
  onObjectivesChange: (objectives: LearningObjectiveData[]) => void;
  quizId: string;
  courseId?: string;
  onNavigateNext?: () => void;
}

interface ObjectiveDraft {
  text: string;
  bloomLevel: BloomLevel | '';
  subpoints: string[];
}

const BLOOM_LEVEL_OPTIONS: Array<{ value: BloomLevel | ''; label: string }> = [
  { value: '', label: 'Not specified' },
  { value: 'remember', label: 'Remember' },
  { value: 'understand', label: 'Understand' },
  { value: 'apply', label: 'Apply' },
  { value: 'analyze', label: 'Analyze' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'create', label: 'Create' }
];

const createEmptyObjectiveDraft = (): ObjectiveDraft => ({
  text: '',
  bloomLevel: '',
  subpoints: ['']
});

function formatWorkflowMessage(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const record = value as { message?: unknown; status?: unknown; metadata?: unknown };
    if (typeof record.message === 'string' && record.message.trim()) return record.message;
    if (typeof record.status === 'string' && record.status.trim()) return record.status;
    return JSON.stringify(record);
  }
  return fallback;
}

const LearningObjectives = ({ assignedMaterials, objectives, onObjectivesChange, quizId, courseId, onNavigateNext }: LearningObjectivesProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const { objectives: reduxObjectives, loading, generating, classifying, enriching, error } = useSelector((state: RootState) => state.learningObjective);
  const questionsGenerating = useSelector((state: RootState) => selectIsGenerating(state, quizId));
  const questionsByQuiz = useSelector((state: RootState) => state.question.questionsByQuiz);
  
  // PubSub hook for event subscriptions
  const { subscribe, showNotification, publish } = usePubSub('LearningObjectives');
  
  const [textInput, setTextInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isCreatingObjective, setIsCreatingObjective] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState<ObjectiveDraft>(createEmptyObjectiveDraft);
  const [enrichingObjectiveId, setEnrichingObjectiveId] = useState<string | null>(null);
  const [manualObjectives, setManualObjectives] = useState<string[]>([]);
  const [newObjective, setNewObjective] = useState('');
  const [enrichManualAfterSave, setEnrichManualAfterSave] = useState(true);
  const [showNavigation, setShowNavigation] = useState(false);
  const [targetObjectiveCount, setTargetObjectiveCount] = useState<number | ''>(''); // Allow empty input
  const [autoRecommendObjectiveCount, setAutoRecommendObjectiveCount] = useState(true);
  const [previewReference, setPreviewReference] = useState<SourceReference | null>(null);
  const [loWorkflowSessionId, setLoWorkflowSessionId] = useState<string | null>(null);
  const [loWorkflowSteps, setLoWorkflowSteps] = useState<Array<{
    status: string;
    message: unknown;
    metadata?: Record<string, unknown>;
  }>>([]);
  const [loStreamText, setLoStreamText] = useState('');
  const [loStreamModel, setLoStreamModel] = useState<string | null>(null);
  const navigationRef = useRef<HTMLDivElement>(null);
  const newObjectiveRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const loTraceRef = useRef<HTMLDivElement>(null);
  const objectiveResultsRef = useRef<HTMLDivElement>(null);

  // Regenerate modal state
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [objectiveToRegenerate, setObjectiveToRegenerate] = useState<{ index: number; text: string } | null>(null);

  // Regenerate All modal state
  const [regenerateAllModalOpen, setRegenerateAllModalOpen] = useState(false);
  const [regenerateAllLoading, setRegenerateAllLoading] = useState(false);

  // Delete confirmation modal state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    show: boolean;
    index: number;
    objectiveId: string;
    questionCount: number;
  } | null>(null);
  const [deleteAllConfirmation, setDeleteAllConfirmation] = useState<{
    show: boolean;
    questionCount: number;
  } | null>(null);
  const [dontShowDeleteWarning, setDontShowDeleteWarning] = useState(() => {
    return localStorage.getItem('dontShowDeleteLOWarning') === 'true';
  });

  // Use Redux objectives if available, otherwise fallback to props
  const currentObjectives = reduxObjectives.length > 0 ? reduxObjectives.map(obj => obj.text) : objectives.map(obj => obj.text);
  const displayedObjectives = isCreatingObjective ? [...currentObjectives, ''] : currentObjectives;
  const enrichmentTutorialObjectiveIndex = currentObjectives.findIndex((_, index) => (
    Boolean((reduxObjectives[index] || objectives[index])?._id)
    && (reduxObjectives[index] || objectives[index])?.generationMetadata?.isAIGenerated !== true
  ));
  const objectivesTutorial = useFeatureOnboarding('learning-objectives', currentObjectives.length > 0);
  const enrichmentTutorial = useFeatureOnboarding(
    'objective-enrichment',
    assignedMaterials.length > 0 && enrichmentTutorialObjectiveIndex >= 0
  );
  const isGenerating = generating || classifying;
  const loWorkflowUrl = loWorkflowSessionId ? `${API_URL}/api/create/streaming/questions/${loWorkflowSessionId}` : null;
  const objectivesMissingDetails = reduxObjectives.filter(objective => {
    const metadata = objective.generationMetadata;
    return metadata?.isAIGenerated !== true
      && (!metadata?.subpoints?.length || !metadata?.sourceReferences?.length);
  });
  const commandText = textInput.trim();
  const objectiveLikeLineCount = commandText
    .split('\n')
    .filter(line => /^(?:[-*\d.)\s]*)?(students?\s+will|learners?\s+will|understand|analyze|apply|evaluate|create|explain|describe|identify|calculate|compare|demonstrate)\b/i.test(line.trim()))
    .length;
  const detectedCommandIntent = commandText && (/learning objectives?:|^lo\s*\d+/im.test(commandText) || objectiveLikeLineCount >= 2)
    ? 'Import pasted learning objectives'
    : 'Generate from assigned materials';

  useSSE(loWorkflowUrl, {
    onQuestionProgress: (_questionId, data: { status?: string; message?: unknown; metadata?: Record<string, unknown> }) => {
      if (!data?.status) return;
      setLoWorkflowSteps(previous => {
        const next = previous.filter(step => step.status !== data.status);
        return [...next, {
          status: data.status || 'progress',
          message: formatWorkflowMessage(data.message, data.status || 'Working...'),
          metadata: data.metadata
        }].slice(-8);
      });
    },
    onTextChunk: (questionId, chunk, metadata) => {
      if (questionId !== 'learning-objectives' || !chunk) return;
      setLoStreamText(previous => previous + chunk);
      if (metadata?.model) setLoStreamModel(metadata.model);
    },
    onTextReset: questionId => {
      if (questionId === 'learning-objectives') setLoStreamText('');
    },
    onQuestionComplete: () => {
      setLoWorkflowSteps(previous => [...previous, {
        status: 'complete',
        message: 'Learning objectives are ready.'
      }].slice(-8));
      window.setTimeout(() => setLoWorkflowSessionId(null), 1200);
    },
    onBatchComplete: () => {
      window.setTimeout(() => setLoWorkflowSessionId(null), 1200);
    },
    onError: (_questionId, errorMessage) => {
      setLoWorkflowSteps(previous => [...previous, {
        status: 'error',
        message: formatWorkflowMessage(errorMessage, 'Learning objective generation failed.')
      }].slice(-8));
      window.setTimeout(() => setLoWorkflowSessionId(null), 1800);
    }
  });

  // Load objectives when component mounts
  useEffect(() => {
    if (quizId) {
      dispatch(fetchObjectives(quizId));
    }
  }, [quizId, dispatch]);

  // Sync Redux objectives with parent component
  useEffect(() => {
    if (reduxObjectives.length > 0) {
      const objectiveData: LearningObjectiveData[] = reduxObjectives.map((obj, idx) => ({
        _id: obj._id,
        text: obj.text,
        order: obj.order !== undefined ? obj.order : idx,
        generationMetadata: obj.generationMetadata
      }));
      onObjectivesChange(objectiveData);
    }
  }, [reduxObjectives, onObjectivesChange]);

  // Subscribe to PubSub events for question generation
  useEffect(() => {
    // Subscribe to generation started event
    const startToken = subscribe<QuestionGenerationStartedPayload>(
      PUBSUB_EVENTS.QUESTION_GENERATION_STARTED,
      (data) => {
        showNotification(
          'info',
          'Question Generation Started',
          'Please wait while questions are being generated...',
          5000
        );
      }
    );

    // Subscribe to generation completed event
    const completeToken = subscribe<QuestionGenerationCompletedPayload>(
      PUBSUB_EVENTS.QUESTION_GENERATION_COMPLETED,
      (data) => {
        showNotification(
          'success',
          'Question Generation Completed',
          'Successfully generated questions!',
          4000
        );
      }
    );

    // Subscribe to generation failed event
    const failToken = subscribe<QuestionGenerationFailedPayload>(
      PUBSUB_EVENTS.QUESTION_GENERATION_FAILED,
      (data) => {
        console.error('Question generation failed:', data);
        showNotification(
          'error',
          'Question Generation Failed',
          `Failed to generate questions: ${data.error}`,
          6000
        );
      }
    );

    // Cleanup subscriptions on unmount
    return () => {
      pubsubService.unsubscribe(startToken);
      pubsubService.unsubscribe(completeToken);
      pubsubService.unsubscribe(failToken);
    };
  }, [subscribe, showNotification]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (editingIndex !== null && editTextareaRef.current) {
      editTextareaRef.current.focus();
    }
  }, [editingIndex]);

  useEffect(() => {
    if (!loWorkflowSessionId) return;

    const scrollTimer = window.setTimeout(() => {
      loTraceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    return () => window.clearTimeout(scrollTimer);
  }, [loWorkflowSessionId]);

  // Effect to handle navigation appearance with smooth scroll
  useEffect(() => {
    const shouldShowNav = currentObjectives.length > 0;

    if (shouldShowNav && !showNavigation) {
      // Show navigation section
      setShowNavigation(true);

      // Scroll to navigation section after it appears
      setTimeout(() => {
        if (navigationRef.current) {
          navigationRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'start'
          });
        }
      }, 300); // Delay to allow render
    } else if (!shouldShowNav && showNavigation) {
      // Hide navigation section
      setShowNavigation(false);
    }
  }, [currentObjectives.length, showNavigation]);

  const handleClassifyObjectives = async (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      try {
        await dispatch(classifyObjectives({ quizId, text: textInput }));
        setTextInput('');
      } catch (error) {
        console.error('Failed to classify objectives:', error);
      }
    }
  };

  const parseManualObjectiveInput = (value: string) => value
    .split(/\n+/)
    .map(line => line
      .replace(/^\s*(?:[-*•]|\d+[.)]|LO\s*\d+\s*:?)\s*/i, '')
      .trim()
    )
    .filter(Boolean);

  const handleAddManualObjective = () => {
    const parsedObjectives = parseManualObjectiveInput(newObjective);
    if (parsedObjectives.length > 0) {
      const existing = new Set([
        ...manualObjectives,
        ...currentObjectives
      ].map(objective => objective.trim().toLowerCase()));
      const nextObjectives = parsedObjectives.filter(objective => !existing.has(objective.toLowerCase()));
      setManualObjectives([...manualObjectives, ...nextObjectives]);
      setNewObjective('');
    }
  };

  const handleRemoveManualObjective = (index: number) => {
    setManualObjectives(manualObjectives.filter((_, i) => i !== index));
  };

  const handleSaveManualObjectives = async () => {
    if (manualObjectives.length > 0) {
      let savedObjectives: LearningObjectiveData[] = [];
      try {
        const objectivesData = manualObjectives.map((text, index) => ({
          text,
          order: index
        }));
        savedObjectives = await dispatch(saveObjectives({ quizId, objectives: objectivesData })).unwrap();
        setManualObjectives([]);
        showNotification(
          'success',
          'Learning Objectives Saved',
          `${savedObjectives.length} learning objective${savedObjectives.length === 1 ? '' : 's'} saved.`,
          4000
        );
      } catch (error) {
        console.error('Failed to save manual objectives:', error);
        showNotification(
          'error',
          'Learning Objective Save Failed',
          error instanceof Error ? error.message : 'Failed to save learning objectives.',
          6000
        );
        return;
      }

      if (enrichManualAfterSave && assignedMaterials.length > 0 && savedObjectives.length > 0) {
        try {
          await dispatch(enrichObjectives({
            quizId,
            objectiveIds: savedObjectives.map(objective => objective._id)
          })).unwrap();
          showNotification(
            'success',
            'Objectives Linked to Materials',
            'CREATE added subpoints and source references to the saved objectives.',
            5000
          );
        } catch (error) {
          console.error('Manual objectives were saved, but enrichment failed:', error);
          await dispatch(fetchObjectives(quizId));
          showNotification(
            'warning',
            'Objectives Saved, AI Linking Pending',
            'The new objectives were saved and existing objectives were preserved. Use AI Link Missing to retry adding subpoints and material references.',
            7000
          );
        }
      }
    }
  };

  const handleEnrichMissingObjectives = async () => {
    if (objectivesMissingDetails.length === 0) return;
    try {
      await dispatch(enrichObjectives({
        quizId,
        objectiveIds: objectivesMissingDetails.map(objective => objective._id)
      })).unwrap();
      showNotification(
        'success',
        'Objectives Enriched',
        'CREATE added subpoints and material references to objectives that needed details.',
        5000
      );
    } catch (error) {
      console.error('Failed to enrich objectives:', error);
      await dispatch(fetchObjectives(quizId));
      showNotification(
        'error',
        'Objective Enrichment Failed',
        error instanceof Error
          ? error.message
          : 'No objective metadata was changed. Verify that assigned materials have completed processing and contain previewable text, then retry.',
        6000
      );
    }
  };

  const handleEnrichObjective = async (objectiveId: string, index: number) => {
    if (assignedMaterials.length === 0) {
      showNotification(
        'warning',
        'Materials Required',
        'Assign at least one processed material before enriching this learning objective.'
      );
      return;
    }

    setEnrichingObjectiveId(objectiveId);
    try {
      await dispatch(enrichObjectives({ quizId, objectiveIds: [objectiveId] })).unwrap();
      showNotification(
        'success',
        `LO ${index + 1} Enriched`,
        'CREATE added AI-generated metadata and source evidence while preserving instructor-entered Bloom level and subpoints.',
        5000
      );
    } catch (error) {
      console.error(`Failed to enrich objective ${objectiveId}:`, error);
      await dispatch(fetchObjectives(quizId));
      showNotification(
        'error',
        `LO ${index + 1} Enrichment Failed`,
        error instanceof Error
          ? error.message
          : 'Verify that assigned materials have completed processing and contain previewable text, then retry.',
        6000
      );
    } finally {
      setEnrichingObjectiveId(null);
    }
  };

  const handleGenerateObjectives = async (promptOverride?: string) => {
    if (assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first.');
      return;
    }

    const count = typeof targetObjectiveCount === 'number' ? targetObjectiveCount : parseInt(targetObjectiveCount.toString());
    
    if (!autoRecommendObjectiveCount && (Number.isNaN(count) || count < 1 || count > 20)) {
      alert('Please enter a number between 1 and 20 for learning objectives.');
      return;
    }

    try {
      const replaceExisting = currentObjectives.length > 0;
      if (replaceExisting) {
        const questionCount = (questionsByQuiz[quizId] || []).length;
        const shouldReplace = window.confirm(
          `Generate from Materials will replace the existing ${currentObjectives.length} learning objective(s).` +
          (questionCount > 0
            ? `\n\nThis will also delete ${questionCount} question(s) linked to the current learning objectives.`
            : '') +
          '\n\nDo you want to continue?'
        );

        if (!shouldReplace) {
          return;
        }
      }

      const workflowSessionId = `lo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      setLoWorkflowSteps([]);
      setLoStreamText('');
      setLoStreamModel(null);
      setLoWorkflowSessionId(workflowSessionId);

      await dispatch(generateObjectives({
        quizId, 
        materialIds: assignedMaterials, 
        targetCount: autoRecommendObjectiveCount ? undefined : count,
        customPrompt: promptOverride?.trim() || undefined,
        replaceExisting,
        sessionId: workflowSessionId
      })).unwrap();

      window.setTimeout(() => {
        objectiveResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);

      if (replaceExisting) {
        dispatch(clearQuestionsForQuiz(quizId));
      }
    } catch (error) {
      console.error('Failed to generate objectives:', error);
    }
  };

  const handleSmartObjectiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isGenerating) {
      return;
    }

    if (detectedCommandIntent === 'Import pasted learning objectives') {
      await handleClassifyObjectives(e);
      return;
    }

    await handleGenerateObjectives(commandText);
  };

  const handleEditObjective = (index: number) => {
    // Guard: Prevent editing while questions are being generated
    if (questionsGenerating) {
      showNotification('warning', 'Action Blocked', 'Cannot modify learning objectives while questions are being generated.');
      return;
    }
    
    const objectiveData = reduxObjectives[index] || objectives[index];
    const metadata = objectiveData?.generationMetadata;
    setIsCreatingObjective(false);
    setEditingIndex(index);
    setObjectiveDraft({
      text: currentObjectives[index],
      bloomLevel: (metadata?.bloomLevel || '') as BloomLevel | '',
      subpoints: metadata?.subpoints?.length ? [...metadata.subpoints] : ['']
    });
  };

  const handleCancelObjectiveEdit = () => {
    setEditingIndex(null);
    setIsCreatingObjective(false);
    setObjectiveDraft(createEmptyObjectiveDraft());
  };

  const handleAddDraftSubpoint = () => {
    setObjectiveDraft(previous => ({
      ...previous,
      subpoints: [...previous.subpoints, '']
    }));
  };

  const handleUpdateDraftSubpoint = (index: number, value: string) => {
    setObjectiveDraft(previous => ({
      ...previous,
      subpoints: previous.subpoints.map((subpoint, subpointIndex) =>
        subpointIndex === index ? value : subpoint
      )
    }));
  };

  const handleRemoveDraftSubpoint = (index: number) => {
    setObjectiveDraft(previous => {
      const remaining = previous.subpoints.filter((_, subpointIndex) => subpointIndex !== index);
      return {
        ...previous,
        subpoints: remaining.length > 0 ? remaining : ['']
      };
    });
  };

  const getLinkedQuestionRegenerationChoice = async (
    objectiveId: string,
    action: 'edit' | 'regenerate'
  ) => {
    let quizQuestions = questionsByQuiz[quizId] || [];
    try {
      const latest = await questionsApi.getQuestions(quizId);
      quizQuestions = latest.questions;
    } catch (error) {
      console.warn('Could not refresh linked questions before updating the objective:', error);
    }

    const linkedQuestions = getQuestionsLinkedToObjective(quizQuestions, objectiveId);
    if (linkedQuestions.length === 0) {
      return { linkedQuestions, regenerate: false };
    }

    return {
      linkedQuestions,
      regenerate: window.confirm(buildLinkedQuestionRegenerationPrompt(linkedQuestions.length, action))
    };
  };

  const regenerateLinkedQuestions = async (linkedQuestions: Question[]) => {
    if (linkedQuestions.length === 0) return;

    showNotification(
      'info',
      'Regenerating Linked Questions',
      `Updating ${linkedQuestions.length} question${linkedQuestions.length === 1 ? '' : 's'} to match the revised learning objective.`
    );

    const result = await regenerateQuestionsSequentially(
      linkedQuestions,
      async question => {
        try {
          await questionsApi.regenerateQuestion(
            question._id,
            'The linked learning objective was revised. Regenerate this question so its assessed content, answer, and explanation align with the current objective.'
          );
        } catch (error) {
          console.error(`Failed to regenerate linked question ${question._id}:`, error);
          throw error;
        }
      }
    );

    await dispatch(fetchQuestions(quizId));

    if (result.failed.length > 0) {
      showNotification(
        'warning',
        'Some Questions Need Attention',
        `${result.succeeded.length} question${result.succeeded.length === 1 ? '' : 's'} regenerated; ${result.failed.length} failed. Retry the failed questions from Review & Edit.`
      );
      return;
    }

    showNotification(
      'success',
      'Linked Questions Regenerated',
      `${result.succeeded.length} question${result.succeeded.length === 1 ? '' : 's'} now match the revised learning objective.`
    );
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null || !objectiveDraft.text.trim()) {
      showNotification('warning', 'Learning Objective Required', 'Enter the learning objective before saving.');
      return;
    }

    const subpoints = objectiveDraft.subpoints
      .map(subpoint => subpoint.trim())
      .filter(Boolean);

    try {
      if (isCreatingObjective) {
        await dispatch(saveObjectives({
          quizId,
          objectives: [{
            text: objectiveDraft.text.trim(),
            order: currentObjectives.length,
            bloomLevel: objectiveDraft.bloomLevel,
            subpoints
          }]
        })).unwrap();
        showNotification('success', 'Learning Objective Added', 'The learning objective and its manual details were saved.');
      } else {
        const objectiveData = reduxObjectives[editingIndex] || objectives[editingIndex];
        if (!objectiveData?._id) {
          throw new Error('The learning objective is still loading. Please retry in a moment.');
        }
        const questionImpact = await getLinkedQuestionRegenerationChoice(objectiveData._id, 'edit');
        await dispatch(updateObjective({
          id: objectiveData._id,
          text: objectiveDraft.text.trim(),
          bloomLevel: objectiveDraft.bloomLevel,
          subpoints
        })).unwrap();
        if (questionImpact.regenerate) {
          await regenerateLinkedQuestions(questionImpact.linkedQuestions);
        }
        showNotification('success', 'Learning Objective Updated', 'The learning objective and its manual details were saved.');
      }
      handleCancelObjectiveEdit();
    } catch (error) {
      console.error('Failed to save objective:', error);
      showNotification(
        'error',
        'Learning Objective Save Failed',
        error instanceof Error ? error.message : 'Failed to save the learning objective.'
      );
    }
  };

  const handleDeleteObjective = async (index: number) => {
    // Guard: Prevent deletion while questions are being generated
    if (questionsGenerating) {
      showNotification('warning', 'Action Blocked', 'Cannot modify learning objectives while questions are being generated.');
      return;
    }
    
    try {
      // If using Redux objectives, delete via Redux
      if (reduxObjectives.length > 0 && reduxObjectives[index]) {
        const objective = reduxObjectives[index];
        
        // If objective doesn't have an _id, it's a new unsaved objective
        // Delete it directly without confirmation
        if (!objective._id) {
          const remainingObjectives = reduxObjectives
            .filter((_, i) => i !== index)
            .map(obj => obj.text);
          onObjectivesChange(remainingObjectives);
          
          // Also clear editing state if we're deleting the one being edited
          if (editingIndex === index) {
            handleCancelObjectiveEdit();
          }
          return;
        }
        
        const objectiveId = objective._id;
        
        // If user has chosen "don't show again", delete directly with confirmation
        if (dontShowDeleteWarning) {
          await dispatch(deleteObjective({ id: objectiveId, confirmed: true })).unwrap();
          
          // After deletion, update parent component with remaining objectives
          const remainingObjectives = reduxObjectives
            .filter((_, i) => i !== index)
            .map(obj => obj.text);
          onObjectivesChange(remainingObjectives);
          
          // Publish event to notify other components
          publish(PUBSUB_EVENTS.OBJECTIVES_DELETED, {
            quizId,
            deletedObjective: objective.text,
            remainingCount: remainingObjectives.length,
            timestamp: Date.now()
          });
          return;
        }
        
        // Otherwise, try to delete (will get confirmation requirement if there are questions)
        const result = await dispatch(deleteObjective({ id: objectiveId, confirmed: false }));
        
        // Check if confirmation is required
        if (result.type === 'learningObjective/deleteObjective/rejected' && result.payload) {
          const payload = result.payload as { requiresConfirmation?: boolean; objectiveId?: string; questionCount?: number; message?: string };
          if (payload.requiresConfirmation) {
            // Show confirmation dialog
            setDeleteConfirmation({
              show: true,
              index,
              objectiveId: payload.objectiveId || objectiveId,
              questionCount: payload.questionCount || 0
            });
            return;
          }
        }
        
        // If no confirmation needed, update parent component
        const remainingObjectives = reduxObjectives
          .filter((_, i) => i !== index)
          .map(obj => obj.text);
        onObjectivesChange(remainingObjectives);
        
        // Publish event to notify other components
        publish(PUBSUB_EVENTS.OBJECTIVES_DELETED, {
          quizId,
          deletedObjective: objective.text,
          remainingCount: remainingObjectives.length,
          timestamp: Date.now()
        });
      } else {
        // Otherwise, delete from local state and save to backend
        const updatedObjectives = currentObjectives.filter((_, i) => i !== index);
        const objectivesData = updatedObjectives.map((text, i) => ({ text, order: i }));
        await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        onObjectivesChange(updatedObjectives);
        
        // Publish event to notify other components
        publish(PUBSUB_EVENTS.OBJECTIVES_DELETED, {
          quizId,
          deletedObjective: currentObjectives[index],
          remainingCount: updatedObjectives.length,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('Failed to delete objective:', error);
      // Fallback to local state only
      const updatedObjectives = currentObjectives.filter((_, i) => i !== index);
      onObjectivesChange(updatedObjectives);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmation) return;
    
    try {
      // Delete with confirmation
      await dispatch(deleteObjective({ 
        id: deleteConfirmation.objectiveId, 
        confirmed: true 
      })).unwrap();
      
      // Update parent component
      const remainingObjectives = reduxObjectives
        .filter((_, i) => i !== deleteConfirmation.index)
        .map(obj => obj.text);
      onObjectivesChange(remainingObjectives);
      
      // Publish event to notify other components
      const deletedObjective = reduxObjectives[deleteConfirmation.index];
      publish(PUBSUB_EVENTS.OBJECTIVES_DELETED, {
        quizId,
        deletedObjective: deletedObjective.text,
        remainingCount: remainingObjectives.length,
        timestamp: Date.now()
      });
      
      // Close dialog
      setDeleteConfirmation(null);
    } catch (error) {
      console.error('Failed to delete objective:', error);
      setDeleteConfirmation(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const handleDontShowAgainChange = (checked: boolean) => {
    setDontShowDeleteWarning(checked);
    localStorage.setItem('dontShowDeleteLOWarning', checked.toString());
  };

  const handleAddNewObjective = () => {
    // Guard: Prevent adding while questions are being generated
    if (questionsGenerating) {
      showNotification('warning', 'Action Blocked', 'Cannot modify learning objectives while questions are being generated.');
      return;
    }
    
    setIsCreatingObjective(true);
    setEditingIndex(currentObjectives.length);
    setObjectiveDraft(createEmptyObjectiveDraft());

    window.setTimeout(() => {
      newObjectiveRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      editTextareaRef.current?.focus();
    }, 100);
  };

  const handleRegenerateAll = () => {
    // Guard: Prevent regeneration while questions are being generated
    if (questionsGenerating) {
      showNotification('warning', 'Action Blocked', 'Cannot modify learning objectives while questions are being generated.');
      return;
    }
    
    if (currentObjectives.length === 0) {
      alert('No learning objectives to regenerate.');
      return;
    }

    if (!assignedMaterials || assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first to regenerate learning objectives.');
      return;
    }

    // Open the regenerate all modal
    setRegenerateAllModalOpen(true);
  };

  const handleRegenerateAllWithPrompt = async (customPrompt?: string) => {
    setRegenerateAllLoading(true);

    try {
      const manualTargetCount = typeof targetObjectiveCount === 'number'
        ? targetObjectiveCount
        : Number.parseInt(targetObjectiveCount.toString(), 10);

      await dispatch(generateObjectives({
        quizId, 
        materialIds: assignedMaterials, 
        targetCount: autoRecommendObjectiveCount || Number.isNaN(manualTargetCount)
          ? undefined
          : manualTargetCount,
        customPrompt: customPrompt?.trim() || undefined,
        replaceExisting: true
      })).unwrap();

      window.setTimeout(() => {
        objectiveResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);

      dispatch(clearQuestionsForQuiz(quizId));
      setRegenerateAllModalOpen(false);
    } catch (error) {
      console.error('Failed to regenerate all objectives:', error);
      alert('Failed to regenerate learning objectives. Please try again.');
    } finally {
      setRegenerateAllLoading(false);
    }
  };

  const handleDeleteAll = () => {
    // Guard: Prevent deletion while questions are being generated
    if (questionsGenerating) {
      showNotification('warning', 'Action Blocked', 'Cannot modify learning objectives while questions are being generated.');
      return;
    }

    const questionCount = (questionsByQuiz[quizId] || []).length;
    setDeleteAllConfirmation({ show: true, questionCount });
  };

  const handleConfirmDeleteAll = async () => {
    try {
      await dispatch(deleteAllObjectives(quizId));
      // Also clear questions from Redux so the UI updates immediately without a page refresh
      dispatch(clearQuestionsForQuiz(quizId));
      onObjectivesChange([]);
    } catch (error) {
      console.error('Failed to delete all objectives:', error);
      dispatch(clearObjectives());
      onObjectivesChange([]);
    } finally {
      setDeleteAllConfirmation(null);
    }
  };

  const handleCancelDeleteAll = () => {
    setDeleteAllConfirmation(null);
  };

  const openRegenerateModal = (index: number) => {
    // Guard: Prevent regeneration while questions are being generated
    if (questionsGenerating) {
      showNotification('warning', 'Action Blocked', 'Cannot modify learning objectives while questions are being generated.');
      return;
    }
    
    if (!assignedMaterials || assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first to regenerate learning objectives.');
      return;
    }

    const currentObjective = currentObjectives[index];
    setObjectiveToRegenerate({ index, text: currentObjective });
    setRegenerateModalOpen(true);
  };

  const handleRegenerateSingle = async (customPrompt?: string) => {
    if (!objectiveToRegenerate) return;

    const { index } = objectiveToRegenerate;
    setRegenerateLoading(true);

    try {
      // If using Redux objectives, regenerate via Redux action
      if (reduxObjectives.length > 0 && reduxObjectives[index]) {
        const objectiveId = reduxObjectives[index]._id;
        const questionImpact = await getLinkedQuestionRegenerationChoice(objectiveId, 'regenerate');
        await dispatch(regenerateSingleObjective({
          id: objectiveId,
          customPrompt: customPrompt?.trim() || undefined
        })).unwrap();
        if (questionImpact.regenerate) {
          await regenerateLinkedQuestions(questionImpact.linkedQuestions);
        }
      } else {
        // Fallback: regenerate all and take first result (for local state objectives)
        const generatedObjectives = await dispatch(generateObjectives({ quizId, materialIds: assignedMaterials, targetCount: 1 }));

        if (generatedObjectives.payload && Array.isArray(generatedObjectives.payload) && generatedObjectives.payload.length > 0) {
          const updatedObjectives = [...currentObjectives];
          updatedObjectives[index] = generatedObjectives.payload[0].text;

          const objectivesData = updatedObjectives.map((text: string, i: number) => ({ text, order: i }));
          await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        }
      }

      setRegenerateModalOpen(false);
      setObjectiveToRegenerate(null);
    } catch (error) {
      console.error('Failed to regenerate objective:', error);
      showNotification(
        'error',
        'Learning Objective Regeneration Failed',
        error instanceof Error
          ? error.message
          : 'Failed to regenerate the learning objective. Please try again.',
        7000
      );
    } finally {
      setRegenerateLoading(false);
    }
  };

  const closeRegenerateModal = () => {
    setRegenerateModalOpen(false);
    setObjectiveToRegenerate(null);
  };

  if (assignedMaterials.length === 0) {
    return (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Learning Objectives</h3>
            <p className="card-description">
              Please assign materials to this quiz first before setting learning objectives.
            </p>
          </div>
        </div>
    );
  }

  return (
    <>
      <div className="learning-objectives">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Learning Objectives</h3>
            <p className="card-description">
              Define what students should achieve after completing this quiz
            </p>
          </div>

          {courseId && (
            <div className="step-prompt-settings">
              <CoursePromptSettings courseId={courseId} defaultPromptType="learning-objectives" />
            </div>
          )}

          {(loWorkflowSessionId || loWorkflowSteps.length > 0) && (
            <div ref={loTraceRef}>
              <AIPlanGenerationTrace
                isGenerating={generating}
                steps={loWorkflowSteps.map((step, index) => ({
                  ...step,
                  status: formatWorkflowMessage(step.status, `step-${index}`),
                  message: formatWorkflowMessage(step.message, 'Working...')
                }))}
                streamedText={loStreamText}
                model={loStreamModel}
                eyebrow="AI Learning Objectives"
                activeTitle="Building your learning objectives"
                completeTitle="Learning objectives are ready"
                errorTitle="Learning objective generation stopped"
                emptyOutputText="Preparing the material inventory and instructional structure..."
              />
            </div>
          )}

          {currentObjectives.length === 0 && (
              <div className="objectives-setup">
                <form onSubmit={handleSmartObjectiveSubmit} className="objective-command-box">
                  <div className="objective-command-header">
                    <div>
                      <h4>Tell CREATE What You Want</h4>
                      <p>
                        Paste existing learning objectives, add instructions, or leave this blank to generate a complete LO set from the assigned materials.
                      </p>
                    </div>
                    <div className="objective-intent-pill">
                      {detectedCommandIntent}
                    </div>
                  </div>

                  {isGenerating ? (classifying ? (
                      <div className="generating-state">
                        <div className="loading-spinner"></div>
                        <p>Processing your text to identify learning objectives...</p>
                      </div>
                  ) : null) : (
                      <>
                        <textarea
                            className="textarea objective-command-textarea"
                            placeholder={`Examples:
- Leave this blank to generate a complete learning objective set from the uploaded materials.
- Generate complete learning objectives from the uploaded materials.
- Focus on the most important concepts, skills, and common misconceptions in the materials.
- I already have these LOs: Students will be able to...
- Make the objectives measurable and aligned with Bloom's taxonomy.`}
                            rows={7}
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                        />

                        <div className="objective-command-controls">
                          <label className="auto-objective-count-toggle">
                            <input
                              type="checkbox"
                              checked={autoRecommendObjectiveCount}
                              onChange={(e) => setAutoRecommendObjectiveCount(e.target.checked)}
                              disabled={detectedCommandIntent === 'Import pasted learning objectives'}
                            />
                            Let CREATE recommend the number of learning objectives
                          </label>

                          <div className="objective-target-count">
                            <label htmlFor="objectiveCount" className="input-label">
                              Optional target number:
                            </label>
                            <input
                              id="objectiveCount"
                              type="number"
                              min="1"
                              max="20"
                              value={targetObjectiveCount}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === '') {
                                  setTargetObjectiveCount('');
                                } else {
                                  const numValue = parseInt(value);
                                  if (!isNaN(numValue)) {
                                    setTargetObjectiveCount(numValue);
                                  }
                                }
                              }}
                              className="input number-input"
                              placeholder={autoRecommendObjectiveCount ? 'Auto' : 'Enter number'}
                              disabled={autoRecommendObjectiveCount || detectedCommandIntent === 'Import pasted learning objectives'}
                            />
                          </div>
                        </div>

                        <small className="input-hint objective-command-hint">
                          {detectedCommandIntent === 'Import pasted learning objectives'
                            ? 'CREATE detected pasted objectives and will cleanly import them.'
                            : 'CREATE will use your instructions as guidance while staying grounded in the uploaded materials.'}
                        </small>

                        <div className="form-actions">
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={
                              !autoRecommendObjectiveCount &&
                              detectedCommandIntent !== 'Import pasted learning objectives' &&
                              (
                                targetObjectiveCount === '' ||
                                (typeof targetObjectiveCount === 'number' && (targetObjectiveCount < 1 || targetObjectiveCount > 20))
                              )
                            }
                          >
                            <Sparkles size={16} />
                            {detectedCommandIntent === 'Import pasted learning objectives'
                              ? 'Import Learning Objectives'
                              : commandText
                                ? 'Generate with Instructions'
                                : 'Generate Complete Learning Objectives'}
                          </button>
                        </div>
                      </>
                  )}
                </form>

                <div className="manual-section manual-section-compact">
                  <div className="manual-form">
                    <div className="manual-section-header">
                      <h4>Add Manually</h4>
                      <p>Paste one or more learning objectives. Put each objective on a separate line.</p>
                    </div>

                    <div className="objective-input-group">
                      <textarea
                          className="textarea"
                          placeholder="Students will be able to explain key concepts...
Students will be able to apply those concepts to a new example..."
                          rows={4}
                          value={newObjective}
                          onChange={(e) => setNewObjective(e.target.value)}
                      />
                      <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleAddManualObjective}
                          disabled={!newObjective.trim()}
                      >
                        <Plus size={16} />
                        Add Objective{parseManualObjectiveInput(newObjective).length > 1 ? 's' : ''}
                      </button>
                    </div>

                    <label className="manual-enrichment-toggle">
                      <input
                        type="checkbox"
                        checked={enrichManualAfterSave}
                        onChange={(event) => setEnrichManualAfterSave(event.target.checked)}
                        disabled={assignedMaterials.length === 0}
                      />
                      <span>
                        Use AI to add subpoints and link these objectives to assigned materials after saving
                      </span>
                    </label>

                    {manualObjectives.length > 0 && (
                        <div className="manual-objectives-preview">
                          <h5>Learning Objectives to Save ({manualObjectives.length}):</h5>
                          <div className="objectives-preview-list">
                            {manualObjectives.map((objective, index) => (
                                <div key={index} className="preview-objective">
                                  <span className="objective-number">LO {index + 1}</span>
                                  <span className="objective-text">{objective}</span>
                                  <button
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => handleRemoveManualObjective(index)}
                                      disabled={questionsGenerating}
                                      title={questionsGenerating ? 'Cannot remove while generating questions' : 'Remove objective'}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                            ))}
                          </div>
                          <div className="manual-actions">
                            <button
                                className="btn btn-primary"
                                onClick={handleSaveManualObjectives}
                                disabled={loading || enriching}
                            >
                              {enriching ? 'Linking to Materials...' : `Save ${manualObjectives.length} Objective${manualObjectives.length !== 1 ? 's' : ''}`}
                            </button>
                            <button
                                className="btn btn-outline"
                                onClick={() => setManualObjectives([])}
                                disabled={loading || enriching}
                            >
                              Clear All
                            </button>
                          </div>
                        </div>
                    )}
                  </div>
                </div>
              </div>
          )}

          {currentObjectives.length > 0 && (
              <div ref={objectiveResultsRef} className="objectives-list">
                <div className="objectives-header">
                  <h4>Learning Objectives ({displayedObjectives.length})</h4>
                  <div className="objectives-actions">
                    <button 
                      className="btn btn-outline" 
                      onClick={handleAddNewObjective}
                      disabled={questionsGenerating || enriching || editingIndex !== null}
                      title={questionsGenerating
                        ? 'Cannot add while generating questions'
                        : editingIndex !== null
                          ? 'Save or cancel the current learning objective first'
                          : 'Add new learning objective'}
                    >
                      <Plus size={16} />
                      Add New
                    </button>
                    {objectivesMissingDetails.length > 0 && assignedMaterials.length > 0 && (
                      <button
                        className="btn btn-outline"
                        onClick={handleEnrichMissingObjectives}
                        disabled={questionsGenerating || enriching}
                        title="Use AI to add subpoints and material references to objectives that need details"
                      >
                        <Link2 size={16} />
                        {enriching ? 'Linking...' : `AI Link Missing (${objectivesMissingDetails.length})`}
                      </button>
                    )}
                    <button 
                      className="btn btn-outline btn-danger" 
                      onClick={handleDeleteAll}
                      disabled={questionsGenerating || enriching}
                      title={questionsGenerating ? 'Cannot delete while generating questions' : 'Delete all learning objectives'}
                    >
                      <X size={16} />
                      Delete All
                    </button>
                    <button 
                      className="btn btn-outline" 
                      onClick={handleRegenerateAll}
                      disabled={questionsGenerating || enriching}
                      title={questionsGenerating ? 'Cannot regenerate while generating questions' : 'Regenerate all learning objectives'}
                    >
                      <RotateCcw size={16} />
                      Regenerate All
                    </button>
                  </div>
                </div>

                <div className="objectives-items">
                  {displayedObjectives.map((objective, index) => {
                    const objectiveData = reduxObjectives[index] || objectives[index];
                    const metadata = objectiveData?.generationMetadata;
                    const sourceReferences = objectiveData?.generationMetadata?.sourceReferences || [];
                    const primaryReference = sourceReferences[0];
                    const subpoints = metadata?.subpoints || [];
                    const canEnrichObjective = Boolean(objectiveData?._id)
                      && metadata?.isAIGenerated !== true;
                    const showEnrichmentTutorial = enrichmentTutorial.isActive
                      && objectivesTutorial.isCompleted
                      && index === enrichmentTutorialObjectiveIndex
                      && !questionsGenerating
                      && !enriching;

                    const enrichThisObjective = () => {
                      enrichmentTutorial.complete();
                      if (objectiveData?._id) {
                        void handleEnrichObjective(objectiveData._id, index);
                      }
                    };

                    return (
                      <div 
                        key={objectiveData?._id || `new-objective-${index}`}
                        className="objective-item"
                        ref={index === editingIndex ? newObjectiveRef : null}
                      >
                        <div className="objective-number">LO {index + 1}</div>
                        <div className="objective-content">
                          {editingIndex === index ? (
                              <div className="objective-edit">
                                <label className="objective-edit-field objective-edit-field-full">
                                  <span>Learning Objective</span>
                                  <textarea
                                      ref={editTextareaRef}
                                      className="textarea"
                                      value={objectiveDraft.text}
                                      onChange={(event) => setObjectiveDraft(previous => ({
                                        ...previous,
                                        text: event.target.value
                                      }))}
                                      placeholder="Students will be able to..."
                                      maxLength={500}
                                      rows={3}
                                  />
                                </label>

                                <div className="objective-edit-grid">
                                  <label className="objective-edit-field">
                                    <span>Bloom Level</span>
                                    <select
                                      className="input"
                                      value={objectiveDraft.bloomLevel}
                                      onChange={(event) => setObjectiveDraft(previous => ({
                                        ...previous,
                                        bloomLevel: event.target.value as BloomLevel | ''
                                      }))}
                                    >
                                      {BLOOM_LEVEL_OPTIONS.map(option => (
                                        <option key={option.label} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <div className="objective-edit-field objective-edit-field-full">
                                    <div className="objective-subpoints-editor-header">
                                      <span>Subpoints <small>(optional)</small></span>
                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm"
                                        onClick={handleAddDraftSubpoint}
                                        disabled={objectiveDraft.subpoints.length >= 20}
                                      >
                                        <Plus size={14} />
                                        Add Subpoint
                                      </button>
                                    </div>
                                    <div className="objective-subpoints-editor">
                                      {objectiveDraft.subpoints.map((subpoint, subpointIndex) => (
                                        <div key={`subpoint-${subpointIndex}`} className="objective-subpoint-input">
                                          <span>{subpointIndex + 1}</span>
                                          <input
                                            className="input"
                                            value={subpoint}
                                            onChange={(event) => handleUpdateDraftSubpoint(subpointIndex, event.target.value)}
                                            placeholder="Enter a specific skill, concept, or performance step"
                                            maxLength={500}
                                          />
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => handleRemoveDraftSubpoint(subpointIndex)}
                                            aria-label={`Remove subpoint ${subpointIndex + 1}`}
                                            title="Remove subpoint"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                    <small className="objective-edit-hint">
                                      Instructor-entered Bloom level and subpoints are preserved if you later use AI Enrich.
                                    </small>
                                  </div>
                                </div>
                                <div className="edit-actions">
                                  <button type="button" className="btn btn-secondary" onClick={handleCancelObjectiveEdit}>
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={handleSaveEdit}
                                    disabled={loading || !objectiveDraft.text.trim()}
                                  >
                                    {loading ? 'Saving...' : isCreatingObjective ? 'Add Learning Objective' : 'Save Changes'}
                                  </button>
                                </div>
                              </div>
                          ) : (
                              <div className="objective-display">
                                <div className="objective-main">
                                  {(metadata?.title || metadata?.sourceOutlineSection || metadata?.bloomLevel) && (
                                    <div className="objective-metadata-header">
                                      {metadata?.title && (
                                        <h5>{metadata.title}</h5>
                                      )}
                                      <div className="objective-metadata-tags">
                                        {metadata?.sourceOutlineSection && (
                                          <span>{metadata.sourceOutlineSection}</span>
                                        )}
                                        {metadata?.bloomLevel && (
                                          <span>{metadata.bloomLevel}</span>
                                        )}
                                        {metadata?.promptSource && (
                                          <span>
                                            Prompt: {metadata.promptSource}
                                            {metadata.promptVersion ? ` v${metadata.promptVersion}` : ''}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  <p>{objective}</p>
                                  {subpoints.length > 0 && (
                                    <ul className="objective-subpoints">
                                      {subpoints.map((subpoint, subpointIndex) => (
                                        <li key={subpointIndex}>{subpoint}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {primaryReference && (
                                    <button
                                      type="button"
                                      className="objective-source-reference"
                                      onClick={() => setPreviewReference(primaryReference)}
                                      title="Preview cited source"
                                    >
                                      <div className="objective-source-summary">
                                        <span>Based on</span>
                                        <strong>{primaryReference.materialName || primaryReference.sourceFile || 'Course material'}</strong>
                                        {typeof primaryReference.pageNumber === 'number' ? (
                                          <em>Page {primaryReference.pageNumber}</em>
                                        ) : typeof primaryReference.chunkIndex === 'number' ? (
                                          <em>Chunk {primaryReference.chunkIndex + 1}</em>
                                        ) : null}
                                      </div>
                                      {primaryReference.excerpt && (
                                        <div className="objective-source-excerpt">
                                          <strong>Evidence:</strong> {primaryReference.excerpt}
                                        </div>
                                      )}
                                    </button>
                                  )}
                                </div>
                                <div className="objective-actions">
                                  <button 
                                    className="btn btn-ghost" 
                                    onClick={() => handleEditObjective(index)}
                                    disabled={questionsGenerating || enriching}
                                    aria-label={`Edit learning objective ${index + 1}`}
                                    title={questionsGenerating ? 'Cannot edit while generating questions' : 'Edit learning objective'}
                                  >
                                    <Edit size={16} />
                                  </button>
                                  {canEnrichObjective && (
                                    <FeatureCoachmark
                                      isOpen={showEnrichmentTutorial}
                                      title="Enrich one objective with AI"
                                      description="Use the sparkle action to add source-grounded metadata and evidence while keeping the objective wording and instructor-entered Bloom level and subpoints. Assigned processed materials are required."
                                      eyebrow="AI Enrich"
                                      primaryLabel="Enrich this LO"
                                      placement="bottom-end"
                                      onPrimary={enrichThisObjective}
                                      onDismiss={enrichmentTutorial.complete}
                                      onSkip={enrichmentTutorial.skipAll}
                                    >
                                      <button
                                        type="button"
                                        className="btn btn-ghost"
                                        onClick={enrichThisObjective}
                                        disabled={questionsGenerating || enriching || assignedMaterials.length === 0 || !objectiveData?._id}
                                        aria-label={`AI enrich learning objective ${index + 1}`}
                                        title={assignedMaterials.length === 0
                                          ? 'Assign processed materials before using AI Enrich'
                                          : enrichingObjectiveId === objectiveData?._id
                                            ? 'Enriching this learning objective...'
                                            : 'Use AI to enrich this objective with metadata and source evidence'}
                                      >
                                        <Sparkles size={16} />
                                      </button>
                                    </FeatureCoachmark>
                                  )}
                                  <button 
                                    className="btn btn-ghost" 
                                    onClick={() => openRegenerateModal(index)}
                                    disabled={questionsGenerating || enriching}
                                    aria-label={`Regenerate learning objective ${index + 1}`}
                                    title={questionsGenerating ? 'Cannot regenerate while generating questions' : 'Regenerate learning objective'}
                                  >
                                    <RotateCcw size={16} />
                                  </button>
                                  <button 
                                    className="btn btn-ghost" 
                                    onClick={() => handleDeleteObjective(index)}
                                    disabled={questionsGenerating || enriching}
                                    aria-label={`Delete learning objective ${index + 1}`}
                                    title={questionsGenerating ? 'Cannot delete while generating questions' : 'Delete learning objective'}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
          )}

          {/* Navigation Section */}
          {showNavigation && (
            <div
              ref={navigationRef}
              className={`tab-navigation ${currentObjectives.length > 0 ? 'nav-visible' : 'nav-hidden'}`}
            >
              <div className="nav-content">
                <div className="nav-info">
                  <h4>Learning Objectives Set</h4>
                  <p>You have defined {currentObjectives.length} learning objective{currentObjectives.length !== 1 ? 's' : ''} for this quiz.</p>
                </div>
                <div className="nav-actions">
                  <FeatureCoachmark
                    isOpen={objectivesTutorial.isActive}
                    title="Review coverage before generating"
                    description="Each learning objective can include subpoints and source evidence. The AI Blueprint uses these details to decide question focus, type, difficulty, and count."
                    eyebrow="Learning objectives"
                    placement="top-end"
                    onPrimary={objectivesTutorial.complete}
                    onDismiss={objectivesTutorial.complete}
                    onSkip={objectivesTutorial.skipAll}
                  >
                    <button
                      className="btn btn-primary btn-nav"
                      onClick={() => {
                        objectivesTutorial.complete();
                        if (onNavigateNext) {
                          onNavigateNext();
                        } else {
                          // Fallback method
                          const tabButtons = document.querySelectorAll('button');
                          const questionsTab = Array.from(tabButtons).find(button =>
                            button.textContent?.includes('Generate Questions')
                          );
                          if (questionsTab) {
                            questionsTab.click();
                            setTimeout(() => {
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }, 200);
                          }
                        }
                      }}
                    >
                      Next: Generate Questions
                    </button>
                  </FeatureCoachmark>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Regenerate Single Objective Modal */}
        {objectiveToRegenerate && (
          <RegeneratePromptModal
            isOpen={regenerateModalOpen}
            onClose={closeRegenerateModal}
            onRegenerate={handleRegenerateSingle}
            question={{
              _id: reduxObjectives[objectiveToRegenerate.index]?._id || '',
              type: 'learning-objective',
              questionText: objectiveToRegenerate.text,
              learningObjective: {
                text: objectiveToRegenerate.text
              }
            }}
            isLoading={regenerateLoading}
            mode="learning-objective"
          />
        )}

        {/* Regenerate All Objectives Modal */}
        <RegeneratePromptModal
          isOpen={regenerateAllModalOpen}
          onClose={() => setRegenerateAllModalOpen(false)}
          onRegenerate={handleRegenerateAllWithPrompt}
          question={{
            _id: 'regenerate-all',
            type: 'learning-objective',
            questionText: `All ${currentObjectives.length} learning objectives`,
            learningObjective: {
              text: currentObjectives.join('\n')
            }
          }}
          isLoading={regenerateAllLoading}
          mode="learning-objective"
        />

        {/* Delete Confirmation Modal */}
        {deleteConfirmation?.show && (
          <div className="modal-overlay" onClick={handleCancelDelete}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Delete Learning Objective?</h3>
                <button className="btn-close" onClick={handleCancelDelete}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <p>
                  This Learning Objective has <strong>{deleteConfirmation.questionCount}</strong> question(s) associated with it.
                </p>
                <p>
                  Deleting this Learning Objective will also <strong>permanently delete all {deleteConfirmation.questionCount} question(s)</strong>.
                </p>
                <p style={{ marginTop: '16px' }}>
                  Are you sure you want to continue?
                </p>
                <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="dontShowAgain"
                    checked={dontShowDeleteWarning}
                    onChange={(e) => handleDontShowAgainChange(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="dontShowAgain" style={{ cursor: 'pointer', fontSize: '14px' }}>
                    Don't show this warning again
                  </label>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={handleCancelDelete}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleConfirmDelete}>
                  Delete Learning Objective and {deleteConfirmation.questionCount} Question(s)
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteAllConfirmation?.show && (
          <div className="modal-overlay" onClick={handleCancelDeleteAll}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Delete All Learning Objectives?</h3>
                <button className="btn-close" onClick={handleCancelDeleteAll}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <p>
                  This will permanently delete all <strong>{currentObjectives.length}</strong> learning objective(s).
                </p>
                {deleteAllConfirmation.questionCount > 0 && (
                  <p>
                    This will also <strong>permanently delete all {deleteAllConfirmation.questionCount} question(s)</strong> associated with these objectives.
                  </p>
                )}
                <p style={{ marginTop: '16px' }}>
                  Are you sure you want to continue?
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={handleCancelDeleteAll}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleConfirmDeleteAll}>
                  Delete All{deleteAllConfirmation.questionCount > 0 ? ` (${currentObjectives.length} Objectives + ${deleteAllConfirmation.questionCount} Questions)` : ` ${currentObjectives.length} Objectives`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {previewReference && (
        <SourceReferencePreviewModal
          reference={previewReference}
          onClose={() => setPreviewReference(null)}
        />
      )}
    </>
  );
};

export default LearningObjectives;
