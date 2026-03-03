# TLEF-CREATE Feature Ideas & Product Roadmap

> Brainstorm date: 2026-02-26
> Status: Ideation — prioritize and spec out individually before implementation

---

## Current Product Snapshot

| Capability | Status |
|---|---|
| 8 question types (MC, TF, flashcard, matching, ordering, cloze, summary, discussion) | Done |
| AI generation from materials (RAG + LLM) | Done |
| H5P export + real H5P preview | Done |
| PDF export (questions / answers / combined) | Done |
| Chat Mode (AI-guided conversational workflow) | Spec'd |
| LMS integration | None |
| Quiz import | None |
| Collaboration | None |
| Analytics | None |
| Question bank | None |

---

## Tier 1 — High Impact, Core Differentiators

### 1.1 Quiz Import & Convert

**Pain point**: Educators have years of existing quizzes in Word, PDF, Google Forms, Canvas, Quizlet. Asking them to recreate from scratch is a non-starter.

**Feature**:
- Drag in a Word/PDF exam → AI extracts question structure (type, stem, options, answer)
- Structured extraction via LLM (question text → JSON schema) → batch `Question.create()`
- Support formats: `.docx`, `.pdf`, `.txt`, plain paste
- Future: Quizlet CSV import, Canvas QTI XML import

**Why it matters**: Turns the adoption pitch from "create new content" to "bring your existing content and make it better." Drastically lowers the barrier to first value.

**Technical path**: Reuse material upload pipeline + new LLM prompt strategy for structured extraction. Output maps to existing Question model.

**Effort estimate**: Medium (new prompt engineering + parsing layer, reuse existing upload/question infra)

---

### 1.2 AI Quality Dashboard

**Pain point**: Educators generate 20 questions but can't tell if they're pedagogically sound — Bloom's coverage? Difficulty balance? Ambiguous wording?

**Feature**:
```
Quiz Quality Report
├── Bloom's Taxonomy Coverage (bar chart)
│   Remember ████████░░ (3)
│   Understand ██████████ (4)
│   Apply ██████░░░░ (2)
│   Analyze ████░░░░░░ (1)
│   Evaluate ░░░░░░░░░░ (0) ⚠️
│   Create ░░░░░░░░░░ (0) ⚠️
├── Difficulty Distribution (easy/medium/hard pie chart)
├── Potential Issues
│   ⚠️ Q3: "All of the above" — weak distractor
│   ⚠️ Q7: Negative phrasing — may confuse
│   ⚠️ Q12: Only 2 distractors — add more
│   ✅ No duplicate concepts detected
├── Content Coverage Map (material sections vs questions)
└── [Fix Issues Automatically] button
```

**Why it matters**: Elevates the tool from "question generator" to "teaching design consultant." No competitor does this well. Makes instructors feel the tool understands pedagogy, not just content.

**Technical path**: Bloom's keyword matching (client-side) + LLM deep review for ambiguity/distractor quality. New tab in Review & Edit or standalone page.

**Effort estimate**: Medium (Bloom's analysis is lightweight; LLM review prompt + UI)

---

### 1.3 Quiz Variants — Anti-Cheat Multi-Version

**Pain point**: 3 sections of the same course need 3 different exams. Manually creating variants is tedious and error-prone.

**Feature**:
- **Variant A**: Same questions, shuffled option order
- **Variant B**: AI generates equivalent questions (same LO, different wording/scenario/numbers)
- **Variant C**: Same LO, different question type (MC → TF → Cloze)
- Export as separate H5P packages or one randomized Question Set
- Side-by-side comparison view of variants

**Why it matters**: Solves a universal pain point that AI is uniquely good at. "30 seconds to generate 3 versions of a midterm" is a genuine wow moment.

**Technical path**: Variant A = shuffle (trivial). Variant B/C = new LLM prompt: "Given this question, generate an equivalent that tests the same concept with different context." Reuse existing `convertQuestionToH5P`.

**Effort estimate**: Low–Medium (prompt engineering + new "Variants" UI panel)

---

## Tier 2 — Strong Value Add

### 2.1 Cross-Quiz Question Bank

**Pain point**: After 3 semesters, an instructor has generated 200+ questions across 6 quizzes. Finding and reusing good ones is impossible.

**Feature**:
- All generated questions auto-indexed into a personal Question Bank
- Semantic search by topic, concept, LO text
- Filter by type, difficulty, course, date, usage count
- "Pull from Bank" when creating a new quiz — search and add existing questions
- Usage tracking: how many times each question has been used, in which quizzes

**Why it matters**: Transforms the product from a "one-shot tool" into an "appreciating asset." The more you use it, the more valuable your library becomes. This is the strongest retention mechanism possible.

**Technical path**: Already have Qdrant for RAG. Generate embeddings for each Question, store in a new `question-bank` collection. Frontend: new Question Bank page + "Add to Quiz" flow.

**Effort estimate**: Medium (embedding pipeline + new search UI + "add to quiz" integration)

---

### 2.2 LMS Direct Publish (Canvas / Moodle)

**Pain point**: Export H5P → download → open Canvas → navigate to assignment → upload → configure → repeat for every edit. 5 minutes of tedium per quiz update.

**Feature**:
- "Publish to Canvas" button alongside Export
- OAuth2 flow to connect Canvas account (one-time setup)
- Auto-create Canvas Assignment + upload H5P
- "Re-publish" after edits — one-click update
- Future: Moodle support via similar REST API

**Why it matters**: Eliminates the last-mile friction that makes instructors dread updating quizzes. Turns a 5-minute manual process into 1 second.

**Technical path**: Canvas REST API supports file upload + assignment creation. New `canvasIntegrationService.js` backend + OAuth flow + "Publish" button in export section.

**Effort estimate**: High (OAuth integration, Canvas API, error handling, token management)

---

### 2.3 Multimedia Source Support

**Pain point**: A lot of teaching happens via lecture recordings and YouTube videos, not just PDFs and docs.

**Feature**:
- Paste a YouTube URL → auto-transcribe via Whisper API
- Upload lecture recording (mp3/mp4) → transcribe → use as material
- Timestamps preserved: each generated question links back to the specific moment in the video
- "Watch the relevant clip" link on each question for student study

**Why it matters**: Unlocks an entirely new content source that text-only tools can't touch. Particularly valuable for flipped classrooms.

**Technical path**: Whisper API / yt-dlp for transcription. Transcripts feed into existing RAG pipeline. Store timestamp metadata alongside chunks.

**Effort estimate**: Medium (transcription service + timestamp tracking)

---

### 2.4 Study Guide Auto-Generation

**Pain point**: Students want study materials, not just quizzes. Instructors don't have time to create both.

**Feature**:
- "Generate Study Guide" button alongside Export
- AI creates a structured study document from the same materials:
  - Key concepts per learning objective
  - Summary paragraphs
  - "Try this" practice prompts
  - Links back to source material sections
- Export as PDF or Markdown
- Complements the quiz: "Here's what to study, and here's how to test yourself"

**Why it matters**: Doubles the value of uploaded materials. Instructors get two outputs (quiz + study guide) from one input (materials). Students love it.

**Technical path**: New LLM prompt chain using existing RAG context. New export format alongside H5P/PDF.

**Effort estimate**: Low–Medium (mostly prompt engineering + PDF template)

---

## Tier 3 — Innovative / Exploratory

### 3.1 Smart Distractor Generation

**Feature**: When generating MC questions, AI specifically crafts distractors based on **common student misconceptions** rather than random wrong answers.

- Analyzes the topic to identify typical mistakes students make
- Generates distractors that test real understanding vs surface recall
- Tags each distractor with the misconception it targets
- "This student chose B — they likely confused X with Y"

**Why it matters**: The quality of distractors is what separates a good MC question from a trivial one. This makes auto-generated questions rival hand-crafted ones.

---

### 3.2 Content Coverage Map

**Feature**: Visual heatmap showing which parts of the uploaded material are covered by questions and which are gaps.

```
Chapter 1: Introduction ████████████ (8 questions)
Chapter 2: Core Concepts █████████░░ (6 questions)
Chapter 3: Applications  ███░░░░░░░░ (2 questions) ⚠️ Under-covered
Chapter 4: Case Studies  ░░░░░░░░░░░ (0 questions) ⚠️ No coverage
```

- Click on a gap → "Generate 3 questions for Chapter 4"
- Ensures comprehensive assessment

**Why it matters**: Addresses a real concern: "Did I cover everything?" Currently requires manual cross-referencing.

---

### 3.3 Collaborative Quiz Authoring

**Feature**: Invite TAs or co-instructors to collaboratively build a quiz.

- Share a quiz with edit permissions via email/link
- Real-time presence indicators (who's editing what)
- Comment/suggest mode: TA suggests a question change, instructor approves
- Activity log: who added/edited/deleted what

**Why it matters**: Large courses have 5-10 TAs who all contribute to assessments. Currently no tool bridges the gap between "solo authoring" and "LMS quiz editor."

**Effort**: High (auth model changes, real-time sync, permission system)

---

### 3.4 Spaced Repetition Export (Anki)

**Feature**: Export flashcards and Q&A pairs as Anki decks (.apkg format).

- Auto-convert flashcard and MC questions into Anki cards
- Include difficulty tags for Anki's algorithm
- Students import into Anki for long-term retention study

**Why it matters**: Anki has millions of active users. Being the bridge between "instructor creates content" and "student studies with spaced repetition" is a unique value chain.

---

### 3.5 Multi-Language Quiz Generation

**Feature**: Generate quizzes in multiple languages from the same source material.

- "Translate this quiz to French" → AI translates all questions, options, feedback
- Maintains correct answers and question structure
- Side-by-side bilingual preview
- Useful for multilingual programs

---

### 3.6 Rubric Auto-Generation

**Feature**: For discussion and essay questions, auto-generate grading rubrics.

- AI creates criteria, performance levels, and point allocations
- Aligned to the learning objective
- Export as PDF rubric alongside the quiz
- Rubric preview in the Review tab

---

### 3.7 Quiz Difficulty Simulation

**Feature**: Before deploying, simulate how a class of N students might perform.

- AI estimates expected score distribution based on question characteristics
- Identifies questions that are "too easy" (>95% predicted correct) or "too hard" (<20%)
- Suggests rebalancing: "Replace Q7 (predicted 98% correct) with a harder variant"

---

### 3.8 Source Citation on Every Question

**Feature**: Each generated question automatically links back to the exact passage/page in the source material.

- "This question was generated from Material X, page 3, paragraph 2"
- Click to highlight the source passage
- Useful for: verifying accuracy, student study references, academic integrity

**Technical path**: RAG already retrieves relevant chunks with metadata. Store the chunk reference on each Question document.

---

### 3.9 Voice-Based Quiz Creation

**Feature**: "Create 5 multiple choice questions about photosynthesis, medium difficulty"

- Voice input in Chat Mode
- Natural language commands for quick quiz creation
- Useful for instructors who think out loud

---

### 3.10 Template Marketplace

**Feature**: Community library of quiz templates.

- "Intro to Psychology — Midterm Template (30 MC + 5 Essay)"
- Instructors can publish anonymized quiz structures
- Others can fork and customize with their own materials
- Rating system for templates

---

## Priority Matrix

| Feature | Impact | Effort | Differentiation | Priority |
|---|:---:|:---:|:---:|:---:|
| Quiz Import & Convert | High | Medium | Medium | **1** |
| AI Quality Dashboard | High | Medium | Very High | **2** |
| Quiz Variants | High | Low | High | **3** |
| Question Bank | High | Medium | Medium | **4** |
| Study Guide Generation | Medium | Low | High | **5** |
| Content Coverage Map | Medium | Low | High | **6** |
| Smart Distractors | Medium | Low | Very High | **7** |
| Source Citation | Medium | Low | Medium | **8** |
| Multimedia Sources | High | Medium | High | **9** |
| LMS Direct Publish | Very High | High | Medium | **10** |
| Rubric Generation | Medium | Low | Medium | **11** |
| Spaced Repetition / Anki | Medium | Medium | High | **12** |
| Multi-Language | Medium | Medium | Medium | **13** |
| Difficulty Simulation | Medium | Medium | Very High | **14** |
| Collaborative Authoring | High | Very High | Medium | **15** |
| Voice Creation | Low | Medium | Low | **16** |
| Template Marketplace | Medium | High | Medium | **17** |

---

## Recommended Implementation Sequence

### Phase A — Quick Wins (1-2 weeks each)
1. Quiz Variants (low effort, high wow factor)
2. Study Guide Generation (reuse existing RAG, new prompt)
3. Smart Distractors (enhance existing MC generation prompt)
4. Source Citation (store RAG chunk refs on Question model)

### Phase B — Core Differentiators (2-4 weeks each)
5. Quiz Import & Convert (new parsing pipeline)
6. AI Quality Dashboard (Bloom's analysis + LLM review)
7. Content Coverage Map (visualization of RAG coverage)
8. Question Bank (Qdrant embedding + search UI)

### Phase C — Platform Features (4-8 weeks each)
9. Multimedia Sources (Whisper integration)
10. LMS Direct Publish (Canvas OAuth + API)
11. Rubric Generation + Anki Export
12. Multi-Language Support

### Phase D — Advanced (future)
13. Difficulty Simulation
14. Collaborative Authoring
15. Template Marketplace
