# Plan: Container Formats — Question Set & Interactive Book

## Overview

Add three output container modes to the Review & Edit page:
- **Column** (current default — flat H5P.Column wrapping all questions)
- **Question Set** (H5P.QuestionSet — scored quiz with progress dots)
- **Interactive Book** (H5P.InteractiveBook — chapter-based book; each chapter is Column or QuestionSet)

Interactive Book adds a **Chapter Editor panel** where users can reorder questions, rename chapters, and set per-chapter container type.

---

## Key findings from reference packages

### Interactive Book structure
```
H5P.InteractiveBook 1.13
  chapters: [
    {
      library: "H5P.Column 1.20",       ← always Column at chapter level
      params: {
        content: [
          // option A — direct content items (Column mode)
          { content: { library: "H5P.MultiChoice 1.16", params: {...} } },

          // option B — one QuestionSet wrapper (QuestionSet mode)
          { content: { library: "H5P.QuestionSet 1.21", params: { questions: [...] } } }
        ]
      },
      metadata: { title: "Chapter Name" }
    }
  ]
```

### Question Set structure (standalone)
```json
{
  "introPage": { "showIntroPage": false },
  "progressType": "dots",
  "passPercentage": 50,
  "questions": [ /* H5P question objects */ ],
  "texts": { "prevButton": "←", "nextButton": "→", ... }
}
```

### Standalone-only types (cannot go inside QS or IB chapters)
`branching-scenario`, `documentation-tool` — already in `standaloneTypes` in h5pExportService.js.
When these exist alongside an IB/QS export, they are downloaded as separate H5P files inside a ZIP.

---

## Part 1 — Data Model

### `routes/create/models/Quiz.js`

Add two new fields:

```js
containerMode: {
  type: String,
  enum: ['column', 'question-set', 'interactive-book'],
  default: 'column'
},
chapters: [{
  title: { type: String, default: '' },
  questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  containerType: { type: String, enum: ['column', 'question-set'], default: 'column' },
  passPercentage: { type: Number, default: 50 }
}]
```

### Backend API — extend existing updateQuiz

`PATCH /api/create/quizzes/:id` already exists. Extend it to accept:
- `containerMode: string`
- `chapters: Chapter[]`

No new endpoint needed; just add these fields to the validator and controller.

---

## Part 2 — H5P Libraries

### Copy from reference package

```
cp -r /Users/fanhaocheng/tlef-create/H5P/macroeconomics-interactive-book/H5P.InteractiveBook-1.13 \
      /Users/fanhaocheng/tlef-create/tlef-create/routes/create/h5p-libs/

cp -r /Users/fanhaocheng/tlef-create/H5P/macroeconomics-interactive-book/H5P.QuestionSet-1.21 \
      /Users/fanhaocheng/tlef-create/tlef-create/routes/create/h5p-libs/

cp -r /Users/fanhaocheng/tlef-create/H5P/macroeconomics-interactive-book/H5P.Column-1.20 \
      /Users/fanhaocheng/tlef-create/tlef-create/routes/create/h5p-libs/
# (replace existing H5P.Column-1.18 or add alongside it)
```

Also copy any missing sub-dependencies (H5P.Row, H5P.Nil, etc.) as needed.

### `routes/create/config/h5pLibraryRegistry.js`

Add:
```js
'H5P.InteractiveBook': { majorVersion: 1, minorVersion: 13, dirName: 'H5P.InteractiveBook-1.13' },
'H5P.QuestionSet':     { majorVersion: 1, minorVersion: 21, dirName: 'H5P.QuestionSet-1.21' },
```

Update `getNeededLibraries()` — both modes need all the individual question type libraries that their chapters contain (resolved dynamically at export time from the questions in each chapter).

---

## Part 3 — H5P Export Service

**File:** `routes/create/services/h5pExportService.js`

### 3a. New top-level branch in `createH5PPackage()`

```js
const { containerMode = 'column', chapters = [] } = quiz;

if (containerMode === 'question-set') {
  return buildQuestionSetExport(questions, quiz);
}
if (containerMode === 'interactive-book') {
  return buildInteractiveBookExport(questions, chapters, quiz);
}
// else: existing Column path (unchanged)
```

### 3b. `buildQuestionSetExport(questions, quiz)`

- Filter out standalone questions → export them as separate H5P files
- Build `H5P.QuestionSet 1.21` params from remaining questions
- If standalones exist → return a ZIP with multiple `.h5p` files
- Otherwise → return single `.h5p`

### 3c. `buildInteractiveBookExport(questions, chapters, quiz)`

```
For each chapter:
  questionObjects = questions filtered by chapter.questionIds
  standalones, normals = partition by standaloneTypes

  if chapter.containerType === 'question-set':
    chapterContent = [ { content: { library: 'H5P.QuestionSet 1.21', params: buildQSParams(normals) } } ]
  else:
    chapterContent = normals.map(q => convertQuestionToH5P(q))  ← reuse existing function

  chapterNode = {
    library: 'H5P.Column 1.20',
    params: { content: chapterContent },
    metadata: { title: chapter.title }
  }

Collect all standalones → separate H5P files
Build H5P.InteractiveBook params with all chapterNodes
Return ZIP: one interactive-book.h5p + one per-standalone .h5p
```

### 3d. Library resolution for export ZIP

The h5p.json `preloadedDependencies` for IB must list every library used across all chapters. Collect the full set dynamically from the questions included.

---

## Part 4 — Frontend: Container Mode Selector

**File:** `src/components/review/ReviewEdit.tsx`

Add near the export buttons:

```
[ Column ]  [ Question Set ]  [ Interactive Book ]   ← 3-way toggle
```

- On change: PATCH `{ containerMode }` to backend
- When `interactive-book`: show "Edit Chapters" button next to toggle
- State: `containerMode` loaded from `currentQuiz.containerMode`

---

## Part 5 — Chapter Editor Panel

**New file:** `src/components/review/ChapterEditorPanel.tsx`

A slide-in panel (right side, ~380px wide) triggered by "Edit Chapters" button.

### Header area
```
[ By Question Type ]  [ By Learning Objective ]   ← default sort buttons
```
- "By Question Type" → auto-generate chapters grouped by `question.type`, chapter title = display name of type (e.g. "Multiple Choice", "True / False")
- "By LO" → auto-generate chapters grouped by `question.learningObjectiveId`, chapter title = LO text (truncated)
- Both just set local state; user must click Save to persist

### Chapter list (per chapter)
```
▶ Chapter 1: Multiple Choice          [Column ▼] [✕]
   ├─ ⠿ Question text preview...
   ├─ ⠿ Question text preview...
   └─ ⠿ Question text preview...
   [Pass %: 50]  ← shown only when Column▼ = Question Set
```
- Chapter title: inline editable `<input>`
- Container type: dropdown `column | question-set`
- Pass %: number input, visible only when containerType = 'question-set'
- Questions: draggable list (react-beautiful-dnd or native HTML5 drag)
- ✕ button: remove chapter (questions go to an "Unassigned" pool at bottom)
- [+ Add Chapter] button at bottom

### Unassigned pool
Questions not in any chapter appear here. User drags them into chapters.

### Footer
```
[Cancel]  [Save Chapters]
```
Save → PATCH `{ chapters, containerMode: 'interactive-book' }` to backend.

---

## Part 6 — Export ZIP for Mixed Content

When the export contains standalone questions alongside an IB or QS:

**UI:** Show a notice in ReviewEdit:
> "X questions (branching scenario, documentation tool) will be exported as separate H5P files."

**Backend:** Return a ZIP file instead of a single `.h5p`:
- `interactive-book.h5p`
- `branching-scenario-1.h5p`
- `documentation-tool-1.h5p`

The existing export download mechanism needs to handle ZIP (check `Content-Type: application/zip`).

---

## Part 7 — Question Set Settings (optional, editable)

If the user chooses Question Set mode (either standalone or per-chapter), show a small settings popover:
- Pass percentage (0–100, default 50)
- Disable backwards navigation (checkbox)
- Randomize questions (checkbox)

These are stored per-chapter in `chapters[].passPercentage` and two extra boolean fields, or at quiz level for standalone QS mode.

---

## Execution Order

| Step | What | Files |
|------|------|-------|
| 1 | Add `containerMode` + `chapters` to Quiz model | `models/Quiz.js`, `validator.js`, `questionController.js` (or quizController) |
| 2 | Copy H5P library dirs + register in registry | `h5p-libs/`, `h5pLibraryRegistry.js` |
| 3 | Build `buildQuestionSetExport()` in export service | `h5pExportService.js` |
| 4 | Build `buildInteractiveBookExport()` in export service | `h5pExportService.js` |
| 5 | Container mode selector UI in ReviewEdit | `ReviewEdit.tsx` |
| 6 | ChapterEditorPanel component | `ChapterEditorPanel.tsx` (new) |
| 7 | Wire panel to ReviewEdit (open/close, save) | `ReviewEdit.tsx` |
| 8 | ZIP download support for mixed exports | `ReviewEdit.tsx`, `api.ts` |
| 9 | Question Set settings UI (pass%, randomize) | `ChapterEditorPanel.tsx`, `ReviewEdit.tsx` |

---

## Open Questions

1. **Unassigned questions in IB**: If the user has questions not placed in any chapter, should export be blocked or should they auto-append to the last chapter?
2. **Column 1.18 vs 1.20**: The reference IB uses Column 1.20. Do we replace the existing 1.18 in h5p-libs, or run both?
3. **Drag library**: The project currently has no drag-and-drop library. Use HTML5 native `draggable` attribute, or add `@dnd-kit/core` (lightweight)?
