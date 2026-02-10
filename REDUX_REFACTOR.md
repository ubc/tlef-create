# Redux State Management Refactor

## Problem

The frontend had fragmented state management with multiple issues:

1. **No centralized question state** - Questions lived in local `useState` across `QuestionGeneration.tsx` and `ReviewEdit.tsx`, causing data inconsistency between views.
2. **Global single boolean for generation status** - `questionsGenerating` was a single `boolean` in `planSlice`, meaning only one quiz could track generation at a time. Switching quizzes during generation lost the state.
3. **`window.store` hack** - `LearningObjectives.tsx` used `isQuestionsGenerating()` which read `window.store.getState()` directly, bypassing React's reactivity system.
4. **`appSlice` dead code** - `appSlice` duplicated course/quiz data that was never synced with the backend.
5. **Direct API calls scattered everywhere** - Each component independently called `questionsApi` with no shared cache.

## What Changed

### New Files

| File | Purpose |
|------|---------|
| `src/store/slices/questionSlice.ts` | Redux slice for per-quiz question management. Thunks: `fetchQuestions`, `deleteQuestion`, `updateQuestion`, `deleteAllQuestions`. Reducers: `setQuestionsForQuiz`, `addQuestionForQuiz`, `clearQuestionsForQuiz`. |
| `src/store/selectors.ts` | Memoizable selectors: `selectQuestionsByQuiz`, `selectQuestionsLoading`, `selectIsGenerating`, `selectGenerationStatus`. |

### Modified Files

#### `src/store/slices/planSlice.ts`
- Replaced `questionsGenerating: boolean` + `questionGenerationStartTime` + `currentQuizId` with `generationStatusByQuiz: Record<string, GenerationStatus>`.
- `setQuestionsGenerating` now takes `{ generating, quizId, totalQuestions? }` and writes to a per-quiz map.
- Added `clearGenerationStatus` reducer.

#### `src/store/index.ts`
- Added `questionSlice` to the store's reducer config.

#### `src/store/middleware/pubsubMiddleware.ts`
- Made `quizId` required in `SetQuestionsGeneratingPayload`.
- Removed `store.getState()` call for question count.

#### `src/components/LearningObjectives.tsx`
- Removed `isQuestionsGenerating()` function (the `window.store` hack).
- Replaced all 6 call sites with `useSelector` + `selectIsGenerating(state, quizId)`.
- Removed debug `useEffect` and test button.

#### `src/components/QuestionGeneration.tsx`
- Replaced local `questions` / `setQuestions` / `hasExistingQuestions` useState with Redux `selectQuestionsByQuiz`.
- `loadExistingQuestions()` replaced with `dispatch(fetchQuestions(quizId))`.
- `handleDeleteExistingQuestions` uses `deleteAllQuestions` thunk.
- `handleGoBackToPlan` uses `setQuestionsForQuiz`.
- `onBatchComplete` SSE callback dispatches to Redux.
- PubSub subscriptions (`OBJECTIVES_DELETED`, `QUESTIONS_DELETED`) dispatch `fetchQuestions`.

#### `src/components/ReviewEdit.tsx`
- Added `useDispatch<AppDispatch>()` and `useSelector` with `selectQuestionsByQuiz`.
- Replaced direct `questionsApi.getQuestions()` load with `dispatch(fetchQuestions(quizId))`.
- Added `useEffect` to sync `reduxQuestions` -> local `questions` state (preserving `isEditing` UI flag).
- PubSub subscriptions (`QUESTION_GENERATION_COMPLETED`, `OBJECTIVES_DELETED`) now dispatch `fetchQuestions` instead of calling API directly.
- `deleteQuestion` renamed to `handleDeleteQuestion`, uses Redux `deleteQuestion` thunk + immediate local state update.
- **30+ editing functions unchanged** - They continue using local `setQuestions(questions.map(...))` for in-memory edits. Only `saveQuestion` persists to backend. This is intentional: editing is transient UI state, Redux holds the source of truth from the database.

## Data Flow (After Refactor)

```
Database (MongoDB)
    |
    v
Redux questionSlice (source of truth, per-quiz)
    |
    v  useEffect sync
Local useState in ReviewEdit (adds isEditing flag)
    |
    v  30+ editing functions mutate local state
saveQuestion() -> questionsApi.updateQuestion() -> Redux re-fetches
```

## Remaining Recommended Optimizations

### 1. Clean Up `appSlice` Dead Code
`src/store/slices/appSlice.ts` stores `courses`, `activeCourse`, `activeQuiz` etc. but this data is never synced with the backend - it's always fetched fresh via API calls in components. Either:
- Remove `appSlice` entirely and rely on component-level fetching.
- Or make it the real source of truth by wiring it to backend API thunks.

### 2. ReviewEdit.tsx Splitting (2600+ lines)
The file is far too large. Recommended split:

```
src/components/review/
  ReviewEdit.tsx              - Main container, state management (~150 lines)
  QuestionCard.tsx            - Single question display/edit (~200 lines)
  QuestionEditForm.tsx        - Edit form for a question (~200 lines)
  ManualQuestionForm.tsx      - Manual question creation form (~150 lines)
  InteractiveQuestionView.tsx - Interactive preview mode (~200 lines)
  questionEditHandlers.ts     - All 30+ editing functions extracted as pure functions
  reviewTypes.ts              - ExtendedQuestion, form state types
```

### 3. QuestionGeneration.tsx Splitting (1400+ lines)
```
src/components/generation/
  QuestionGeneration.tsx      - Main container (~150 lines)
  ApproachSelector.tsx        - Pedagogical approach cards (~100 lines)
  CustomFormulaEditor.tsx     - Custom formula configuration (~150 lines)
  StreamingProgress.tsx       - SSE streaming progress display (~150 lines)
  useStreamingGeneration.ts   - SSE + streaming state hook (~200 lines)
  generationTypes.ts          - Types for streaming, formula, etc.
```

### 4. Persist Pedagogical Approach Config to Database
Currently saved to `localStorage` with 24-hour expiry. Should be stored in the quiz document or a separate config collection so it persists across devices/sessions.

### 5. SSE State Tied to Component Lifecycle
If user navigates away from `QuestionGeneration` during streaming, the SSE connection drops and progress is lost. Options:
- Move SSE management to a Redux middleware or a global hook.
- Use a service worker for background SSE.
- At minimum, persist `sessionId` so reconnection is possible.

### 6. `saveQuestion` in ReviewEdit Should Sync Back to Redux
Currently `saveQuestion` calls `questionsApi.updateQuestion` and updates local state only. It should also dispatch `updateQuestion` thunk or `setQuestionsForQuiz` so Redux stays in sync without a full re-fetch.

### 7. Remove PubSub/Redux Overlap
Several events (`QUESTION_GENERATION_COMPLETED`, `OBJECTIVES_DELETED`) are published via PubSub and then consumed by components to dispatch Redux actions. This could be simplified by handling these events directly in Redux middleware, eliminating the PubSub middleman for Redux-managed state.
