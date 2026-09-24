export interface StudioBrief {
  library: string;
  templateContentId: string;
  instructions: string;
  query: string;
  kind?: 'single' | 'collection';
  layout?: 'column' | 'question-set' | 'interactive-book';
  questionType?: string;
  selectedQuestionTypes?: string[];
  promptConversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  promptSuggestion?: string;
  promptOffer?: boolean;
  promptHelperVersion?: 2;
  sourceMode?: 'none' | 'course';
  courseId?: string;
  sourceQuizId?: string;
  materialIds?: string[];
  objectiveIds?: string[];
  questionPlan?: Array<{ questionType: string; count: number }>;
}

export const emptyStudioBrief: StudioBrief = { library: '', templateContentId: '', instructions: '', query: '', kind: 'single', layout: 'column', questionType: '', selectedQuestionTypes: [], promptConversation: [], promptSuggestion: '', promptOffer: false, promptHelperVersion: 2, courseId: '', sourceQuizId: '', materialIds: [], objectiveIds: [], questionPlan: [] };

export function studioBriefKey(ownerId: string, quizId?: string, contentId = 'new') {
  return `create-studio-brief:${JSON.stringify([ownerId, quizId || '', contentId])}`;
}

export function readStudioBrief(key: string, fallback: StudioBrief = emptyStudioBrief): StudioBrief {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (value && ['library', 'templateContentId', 'instructions', 'query'].every(field => typeof value[field] === 'string')) {
      return { ...emptyStudioBrief, library: value.library, templateContentId: value.templateContentId, instructions: value.instructions.slice(0, 12000), query: value.query,
        kind: ['collection', 'same-type', 'mixed'].includes(value.kind) ? 'collection' : 'single',
        layout: ['column', 'question-set', 'interactive-book'].includes(value.layout) ? value.layout : 'column',
        questionType: typeof value.questionType === 'string' ? value.questionType : '',
        selectedQuestionTypes: Array.isArray(value.selectedQuestionTypes)
          ? [...new Set(value.selectedQuestionTypes.filter((type: unknown) => typeof type === 'string'))].slice(0, 8) as string[]
          : value.kind === 'same-type' && typeof value.questionType === 'string' && value.questionType ? [value.questionType] : [],
        promptConversation: Array.isArray(value.promptConversation) ? value.promptConversation.filter((message: { role?: unknown; content?: unknown }) =>
          (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string' && message.content.length <= 1000).slice(-12) : [],
        promptSuggestion: value.promptHelperVersion === 2 && typeof value.promptSuggestion === 'string' ? value.promptSuggestion.slice(0, 12000) : '',
        promptOffer: value.promptHelperVersion === 2 && value.promptOffer === true,
        sourceMode: value.sourceMode === 'course' || value.sourceMode === 'none' ? value.sourceMode : undefined,
        courseId: typeof value.courseId === 'string' ? value.courseId : '',
        sourceQuizId: typeof value.sourceQuizId === 'string' ? value.sourceQuizId : '',
        materialIds: Array.isArray(value.materialIds) ? value.materialIds.filter((id: unknown) => typeof id === 'string').slice(0, 20) : [],
        objectiveIds: Array.isArray(value.objectiveIds) ? value.objectiveIds.filter((id: unknown) => typeof id === 'string').slice(0, 8) : [],
        questionPlan: Array.isArray(value.questionPlan) ? value.questionPlan.filter((row: { questionType?: unknown; count?: unknown }) => typeof row?.questionType === 'string' && Number.isInteger(row.count)).slice(0, 8) : [] };
    }
  } catch { /* A blocked or full browser store must not prevent authoring. */ }
  return { ...fallback };
}

export function writeStudioBrief(key: string, brief: StudioBrief) {
  try { sessionStorage.setItem(key, JSON.stringify(brief)); }
  catch { /* Keep the live form usable when browser storage is unavailable. */ }
}
