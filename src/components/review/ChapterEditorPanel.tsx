import { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Plus, GripVertical, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { ExtendedQuestion } from './reviewTypes';
import { LearningObjectiveData } from '../generation/generationTypes';
import '../../styles/components/ChapterEditorPanel.css';

const STANDALONE_TYPES = new Set(['branching-scenario']);

const QUESTION_TYPE_LABELS: Record<string, string> = {
  'multiple-choice': 'Multiple Choice',
  'true-false': 'True/False',
  'flashcard': 'Flashcard',
  'summary': 'Summary',
  'discussion': 'Discussion',
  'matching': 'Matching',
  'ordering': 'Ordering',
  'cloze': 'Fill in the Blank',
  'mark-the-words': 'Mark the Words',
  'single-choice-set': 'Single Choice Set',
  'essay': 'Essay',
  'free-text': 'Free Text',
  'open-ended': 'Open Ended',
  'simple-multi-choice': 'Simple Multi Choice',
  'sort-paragraphs': 'Sort Paragraphs',
  'crossword': 'Crossword',
  'dictation': 'Dictation',
  'arithmetic-quiz': 'Arithmetic Quiz',
  'branching-scenario': 'Branching Scenario',
  'documentation-tool': 'Documentation Tool',
};

export interface Chapter {
  id: string;
  title: string;
  questionIds: string[];
  containerType: 'column' | 'question-set';
  passPercentage: number;
  disableBackwardsNavigation: boolean;
  randomizeQuestions: boolean;
}

interface ChapterEditorPanelProps {
  quizId: string;
  questions: ExtendedQuestion[];
  learningObjectives: LearningObjectiveData[];
  initialChapters: Array<{
    _id?: string;
    title: string;
    questionIds: string[];
    containerType: 'column' | 'question-set';
    passPercentage: number;
    disableBackwardsNavigation: boolean;
    randomizeQuestions: boolean;
  }>;
  onClose: () => void;
  onSaved: (chapters: Chapter[]) => void;
  showNotification: (type: string, title: string, message: string) => void;
}

// ── Sortable question row ─────────────────────────────────────────────────────

function SortableQuestionRow({ id, question }: { id: string; question: ExtendedQuestion | undefined }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="chapter-question-row">
      <span className="drag-handle" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </span>
      <span className="chapter-question-text">
        {question ? question.questionText?.slice(0, 80) || `[${QUESTION_TYPE_LABELS[question.type] || question.type}]` : '(removed)'}
      </span>
      <span className="chapter-question-type">
        {question ? (QUESTION_TYPE_LABELS[question.type] || question.type) : ''}
      </span>
    </div>
  );
}

// ── Single chapter card ────────────────────────────────────────────────────────

function ChapterCard({
  chapter,
  questions,
  onUpdate,
  onDelete,
  onDragEnd,
}: {
  chapter: Chapter;
  questions: ExtendedQuestion[];
  onUpdate: (updated: Chapter) => void;
  onDelete: () => void;
  onDragEnd: (event: DragEndEvent, chapterId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const chapterQuestions = chapter.questionIds
    .map(id => questions.find(q => q._id === id))
    .filter(Boolean) as ExtendedQuestion[];

  return (
    <div className="chapter-card">
      <div className="chapter-card-header">
        <button className="chapter-collapse-btn" onClick={() => setCollapsed(c => !c)}>
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <input
          className="chapter-title-input"
          value={chapter.title}
          onChange={e => onUpdate({ ...chapter, title: e.target.value })}
          placeholder="Chapter title"
        />
        <select
          className="chapter-type-select"
          value={chapter.containerType}
          onChange={e => onUpdate({ ...chapter, containerType: e.target.value as 'column' | 'question-set' })}
        >
          <option value="column">Column</option>
          <option value="question-set">Question Set</option>
        </select>
        <button className="btn btn-ghost chapter-delete-btn" onClick={onDelete} title="Delete chapter">
          <Trash2 size={14} />
        </button>
      </div>

      {chapter.containerType === 'question-set' && !collapsed && (
        <div className="chapter-qs-settings">
          <label>
            Pass %
            <input
              type="number"
              min={0}
              max={100}
              value={chapter.passPercentage}
              onChange={e => onUpdate({ ...chapter, passPercentage: Number(e.target.value) })}
              className="chapter-pass-input"
            />
          </label>
          <label className="chapter-checkbox-label">
            <input
              type="checkbox"
              checked={chapter.randomizeQuestions}
              onChange={e => onUpdate({ ...chapter, randomizeQuestions: e.target.checked })}
            />
            Randomize
          </label>
          <label className="chapter-checkbox-label">
            <input
              type="checkbox"
              checked={chapter.disableBackwardsNavigation}
              onChange={e => onUpdate({ ...chapter, disableBackwardsNavigation: e.target.checked })}
            />
            No back
          </label>
        </div>
      )}

      {!collapsed && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={e => onDragEnd(e, chapter.id)}
        >
          <SortableContext items={chapter.questionIds} strategy={verticalListSortingStrategy}>
            <div className="chapter-questions-list">
              {chapterQuestions.length === 0 ? (
                <div className="chapter-empty">No questions — drag from Unassigned</div>
              ) : (
                chapterQuestions.map(q => (
                  <SortableQuestionRow key={q._id} id={q._id} question={q} />
                ))
              )}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="chapter-footer">
        <span className="chapter-count">{chapterQuestions.length} question{chapterQuestions.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ChapterEditorPanel({
  quizId,
  questions,
  learningObjectives,
  initialChapters,
  onClose,
  onSaved,
  showNotification,
}: ChapterEditorPanelProps) {
  const embeddableQuestions = questions.filter(q => !STANDALONE_TYPES.has(q.type));

  const initChapters = useCallback((): Chapter[] => {
    if (initialChapters.length > 0) {
      return initialChapters.map((ch, i) => ({
        id: ch._id || `ch-${i}`,
        title: ch.title,
        questionIds: ch.questionIds,
        containerType: ch.containerType,
        passPercentage: ch.passPercentage ?? 50,
        disableBackwardsNavigation: ch.disableBackwardsNavigation ?? false,
        randomizeQuestions: ch.randomizeQuestions ?? false,
      }));
    }
    return [];
  }, [initialChapters]);

  const [chapters, setChapters] = useState<Chapter[]>(initChapters);
  const [saving, setSaving] = useState(false);

  // Questions not assigned to any chapter
  const assignedIds = new Set(chapters.flatMap(ch => ch.questionIds));
  const unassigned = embeddableQuestions.filter(q => !assignedIds.has(q._id));

  // ── Auto-sort helpers ──────────────────────────────────────────────────────

  const sortByType = () => {
    const typeMap = new Map<string, string[]>();
    embeddableQuestions.forEach(q => {
      if (!typeMap.has(q.type)) typeMap.set(q.type, []);
      typeMap.get(q.type)!.push(q._id);
    });
    const newChapters: Chapter[] = Array.from(typeMap.entries()).map(([type, ids], i) => ({
      id: `ch-type-${i}`,
      title: QUESTION_TYPE_LABELS[type] || type,
      questionIds: ids,
      containerType: 'column',
      passPercentage: 50,
      disableBackwardsNavigation: false,
      randomizeQuestions: false,
    }));
    setChapters(newChapters);
  };

  const sortByLO = () => {
    const loMap = new Map<string, string[]>();
    const noLO: string[] = [];
    embeddableQuestions.forEach(q => {
      const loId = (q as any).learningObjectiveId || (q as any).learningObjective?._id;
      if (loId) {
        if (!loMap.has(loId)) loMap.set(loId, []);
        loMap.get(loId)!.push(q._id);
      } else {
        noLO.push(q._id);
      }
    });
    const newChapters: Chapter[] = [];
    let i = 0;
    loMap.forEach((ids, loId) => {
      const lo = learningObjectives.find(l => l._id === loId);
      newChapters.push({
        id: `ch-lo-${i++}`,
        title: lo?.text?.slice(0, 60) || `Learning Objective ${i}`,
        questionIds: ids,
        containerType: 'column',
        passPercentage: 50,
        disableBackwardsNavigation: false,
        randomizeQuestions: false,
      });
    });
    if (noLO.length > 0) {
      newChapters.push({
        id: `ch-lo-${i}`,
        title: 'Other',
        questionIds: noLO,
        containerType: 'column',
        passPercentage: 50,
        disableBackwardsNavigation: false,
        randomizeQuestions: false,
      });
    }
    setChapters(newChapters);
  };

  // ── Drag within a chapter ──────────────────────────────────────────────────

  const handleIntraChapterDrag = (event: DragEndEvent, chapterId: string) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setChapters(prev => prev.map(ch => {
      if (ch.id !== chapterId) return ch;
      const oldIdx = ch.questionIds.indexOf(String(active.id));
      const newIdx = ch.questionIds.indexOf(String(over.id));
      if (oldIdx === -1 || newIdx === -1) return ch;
      return { ...ch, questionIds: arrayMove(ch.questionIds, oldIdx, newIdx) };
    }));
  };

  // ── Add unassigned question to a chapter ──────────────────────────────────

  const addToChapter = (qId: string, chapterId: string) => {
    setChapters(prev => prev.map(ch => {
      if (ch.id !== chapterId) return ch;
      if (ch.questionIds.includes(qId)) return ch;
      return { ...ch, questionIds: [...ch.questionIds, qId] };
    }));
  };

  const removeFromChapter = (qId: string, chapterId: string) => {
    setChapters(prev => prev.map(ch => {
      if (ch.id !== chapterId) return ch;
      return { ...ch, questionIds: ch.questionIds.filter(id => id !== qId) };
    }));
  };

  // ── Add new chapter ────────────────────────────────────────────────────────

  const addChapter = () => {
    setChapters(prev => [...prev, {
      id: `ch-new-${Date.now()}`,
      title: `Chapter ${prev.length + 1}`,
      questionIds: [],
      containerType: 'column',
      passPercentage: 50,
      disableBackwardsNavigation: false,
      randomizeQuestions: false,
    }]);
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    // Auto-collect unassigned into a final chapter
    const currentAssigned = new Set(chapters.flatMap(ch => ch.questionIds));
    const stillUnassigned = embeddableQuestions.filter(q => !currentAssigned.has(q._id));
    let finalChapters = [...chapters];
    if (stillUnassigned.length > 0) {
      finalChapters = [...finalChapters, {
        id: `ch-unassigned`,
        title: 'Unassigned',
        questionIds: stillUnassigned.map(q => q._id),
        containerType: 'column',
        passPercentage: 50,
        disableBackwardsNavigation: false,
        randomizeQuestions: false,
      }];
      showNotification('info', 'Unassigned Questions', `${stillUnassigned.length} unassigned question(s) added to a new "Unassigned" chapter.`);
    }

    setSaving(true);
    try {
      const { quizApi } = await import('../../services/api');
      await quizApi.updateQuiz(quizId, {
        chapters: finalChapters.map(ch => ({
          title: ch.title,
          questionIds: ch.questionIds,
          containerType: ch.containerType,
          passPercentage: ch.passPercentage,
          disableBackwardsNavigation: ch.disableBackwardsNavigation,
          randomizeQuestions: ch.randomizeQuestions,
        }))
      });
      onSaved(finalChapters);
    } catch (err) {
      showNotification('error', 'Save Failed', 'Could not save chapter structure');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chapter-editor-overlay" onClick={onClose}>
      <div className="chapter-editor-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="chapter-editor-header">
          <h3>Edit Chapters</h3>
          <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Auto-sort buttons */}
        <div className="chapter-sort-row">
          <span className="chapter-sort-label">Default sort:</span>
          <button className="btn btn-outline btn-sm" onClick={sortByType}>By Question Type</button>
          <button className="btn btn-outline btn-sm" onClick={sortByLO}>By Learning Objective</button>
        </div>

        {/* Standalone warning */}
        {questions.some(q => STANDALONE_TYPES.has(q.type)) && (
          <div className="standalone-warning" style={{ margin: '0 0 12px' }}>
            <strong>Note:</strong> Branching Scenario questions cannot be placed in chapters and will be exported separately.
          </div>
        )}

        {/* Chapter list */}
        <div className="chapter-list">
          {chapters.map(ch => (
            <ChapterCard
              key={ch.id}
              chapter={ch}
              questions={questions}
              onUpdate={updated => setChapters(prev => prev.map(c => c.id === updated.id ? updated : c))}
              onDelete={() => setChapters(prev => prev.filter(c => c.id !== ch.id))}
              onDragEnd={handleIntraChapterDrag}
            />
          ))}

          <button className="btn btn-outline chapter-add-btn" onClick={addChapter}>
            <Plus size={14} /> Add Chapter
          </button>
        </div>

        {/* Unassigned pool */}
        {unassigned.length > 0 && (
          <div className="unassigned-pool">
            <div className="unassigned-header">
              Unassigned ({unassigned.length})
              <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: 6 }}>— click a question to add it to the last chapter</span>
            </div>
            {unassigned.map(q => (
              <div
                key={q._id}
                className="unassigned-question"
                onClick={() => {
                  if (chapters.length === 0) return;
                  addToChapter(q._id, chapters[chapters.length - 1].id);
                }}
              >
                <span className="chapter-question-text">{q.questionText?.slice(0, 80) || `[${QUESTION_TYPE_LABELS[q.type] || q.type}]`}</span>
                <span className="chapter-question-type">{QUESTION_TYPE_LABELS[q.type] || q.type}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="chapter-editor-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Chapters'}
          </button>
        </div>
      </div>
    </div>
  );
}
