import { LearningObjective, Question } from '../../services/api';

// NEW: Learning objective with full data
export interface LearningObjectiveData {
  _id: string;
  text: string;
  order: number;
  generationMetadata?: LearningObjective['generationMetadata'];
}

// UPDATED: Pass full LO objects instead of just strings
export interface QuestionGenerationProps {
  learningObjectives: LearningObjectiveData[];
  assignedMaterials: string[];
  quizId: string;
  courseId?: string;
  onQuestionsGenerated?: () => void;
}

// NEW: Plan item for manual/AI plan mode
export interface PlanItem {
  id: string;                    // UUID for React keys
  type: string;                  // question type
  learningObjectiveId: string;   // LO._id (empty string = no LO)
  count: number;
  pedagogicalIntent?: 'support' | 'assess' | 'gamify';
  bloomLevel?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  difficulty?: 'easy' | 'moderate' | 'hard';
  focusArea?: string;
  rationale?: string;
  selectionMode?: 'single' | 'multiple'; // multiple-choice only
  branchingLayers?: number;      // branching-scenario only, default 2
  branchingChoices?: number;     // branching-scenario only, default 2
  customPrompt?: string;         // used when LO is absent or as supplemental context
  useCustomPromptOnly?: boolean; // true when learningObjectiveId is empty
}

// NEW: AI configuration
export interface AIConfig {
  totalQuestions: number;
  autoRecommendTotalQuestions?: boolean;
  autoRecommendTotalQuestionsUserSet?: boolean;
  approach: 'support' | 'assess' | 'gamify';
  additionalInstructions: string;
}

// OLD: Keep for backward compatibility (will be removed after migration)
export type PedagogicalApproach = 'support' | 'assess' | 'gamify' | 'custom';

export interface QuestionTypeConfig {
  type: string;
  count: number;
  percentage: number;
  scope: 'per-lo' | 'whole-quiz';
  editMode: 'count' | 'percentage';
}

export interface CustomFormula {
  questionTypes: QuestionTypeConfig[];
  totalQuestions: number;
  totalPerLO: number;
  totalWholeQuiz: number;
}

// KEEP: Streaming state (unchanged)
export interface StreamingState {
  isStreaming: boolean;
  sessionId: string | null;
  questionsInProgress: Map<string, { questionId: string; type: string; progress: string; chunks: string[] }>;
  completedQuestions: Question[];
  totalQuestions: number;
  batchStarted: boolean;
}
