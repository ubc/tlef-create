# Prompt Workflow And Coverage Map Plan

## Purpose

This plan defines the upstream workflow for improving CREATE's AI quality before quiz blueprint generation and question generation.

The goal is to solve the original product problems:

- repeated question variants
- broad learning objectives not being sliced into smaller assessable targets
- unclear connection between materials, learning objectives, and generated questions
- weak user control over prompts
- no visible source references for generated questions

This plan connects several related ideas into one architecture:

- Coverage-first workflow
- Auto LO generation
- Quiz blueprint generation
- Question generation with history
- Prompt library and prompt validation
- Teacher-visible references

## Product Principle

CREATE should first answer the instructor's coverage questions:

- What knowledge is present in the uploaded materials?
- Which topics and subtopics are covered?
- Which learning objectives map to those topics?
- Which generated questions assess which LOs?
- Which generated questions are grounded in which material evidence?

Only after this coverage layer exists should CREATE generate or regenerate questions.

## Recommended Workflow

```text
Uploaded materials
  -> Material profiling
  -> Coverage map
  -> Auto LO generation
  -> LO review and editing
  -> Quiz blueprint
  -> Question generation with history
  -> Teacher review with source references
```

## Stage 1: Material Profiling

### Goal

Classify each uploaded material so CREATE knows how to use it.

### Example Material Types

- lecture notes
- slides
- textbook chapter
- problem set
- solution key
- syllabus
- reading
- lab handout
- exam review

### Why This Matters

Different materials should influence generation differently.

Lecture notes should be treated as:

- concept source
- terminology source
- explanation source

Problem sets should be treated as:

- assessment style signal
- application pattern signal
- misconception signal
- difficulty signal

Solution keys should be treated carefully:

- useful for reasoning patterns
- useful for expected answer format
- risky if copied too closely

## Stage 2: Knowledge Coverage Map

### Goal

Build a coverage-first map before generating questions.

This does not need to be a full visual graph in the first version.

The first version should be a structured coverage map:

- topics
- subtopics
- source chunks
- suggested learning objectives
- existing question coverage

### Recommended First UI

Use a coverage table or tree instead of a complex graph.

Example layout:

```text
Topic
  Subtopic
    Source evidence
    Linked LOs
    Generated questions
```

### Why Not Start With Full Graph Visualization

A full knowledge graph is expensive and easy to overbuild.

The first value for instructors is not the graph shape. The first value is confidence:

- what is covered
- what is missing
- what has evidence
- what has questions

## Stage 3: Auto LO Generation

### Current Problem

The user currently has to choose the number of learning objectives.

This can be the wrong interaction model because the user may not know how many LOs the material naturally supports.

### Recommended Behavior

CREATE should generate a complete suggested LO set from the material coverage map.

The user should then be able to:

- edit
- delete
- merge
- split
- regenerate
- add manually

### LO Generation Inputs

The LO generator should use:

- material coverage map
- material type classification
- topic/subtopic structure
- Bloom level targets
- course-level prompt preset
- instructor custom instructions

### LO Generation Output

Each LO should ideally include:

- LO text
- topic
- subtopic
- Bloom level
- source references
- confidence
- rationale

## Stage 4: Quiz Blueprint

This stage is covered in detail by:

- [quiz-blueprint-planning-unification-plan.md](/Users/fanhaocheng/tlef/tlef-create/docs/plans/quiz-blueprint-planning-unification-plan.md)

The important connection is:

- the blueprint should consume the coverage map and reviewed LOs
- the blueprint should not start from isolated question type choices
- the blueprint should let the LLM recommend question count, question type mix, difficulty mix, and Bloom distribution

## Stage 5: Question Generation With History

### Current Problem

If CREATE generates multiple questions from one LO, the questions can be too similar.

Example failure:

- five generated questions all focus on methane
- or five generated questions ask the same broad CO2/CH4/N2O question with different distractors

### Recommended Behavior

Question generation should use compact quiz history.

Do not pass unlimited full question text forever.

Instead, generate a short history summary.

Example:

```text
Existing questions cover:
- CH4 anthropogenic sources, agriculture/livestock focus
- CO2 fossil fuel combustion focus
- N2O fertilizer/agriculture focus

Avoid:
- repeating "primary anthropogenic source of methane"
- reusing the same answer option pattern
- asking another question focused only on CH4 unless specifically requested
```

### History Summary Should Include

- covered learning objectives
- covered focus areas
- covered topics and subtopics
- used question stems
- used scenarios
- used misconception targets
- used answer option patterns

### Why Summary Is Better Than Raw History

Raw history can become long, expensive, and noisy.

A compact summary gives the LLM the important constraints:

- what is already covered
- what to avoid
- where coverage is still missing

## Stage 6: Teacher-Visible References

### Product Decision

CREATE users are instructors, not students.

Therefore references should be visible in the teacher review interface by default.

### Recommended Question Reference Fields

Each generated question should eventually store:

- material id
- material name
- source file
- chunk index
- page number if available
- short evidence excerpt
- relevance score if available
- why this source supports the question

### Review UI Should Show

For each question:

- Based on
- Evidence
- Chunk or page reference
- Why this question was generated
- Linked LO
- Bloom level
- focus area

## Prompt Library

### Goal

Instructors should be able to see and customize prompts course by course.

CREATE should provide safe defaults while allowing instructor control.

### Recommended Model

Use:

- named prompt presets
- automatic version history
- course-level overrides
- reset to system default

### Why Named Presets

Named presets are easier for instructors to understand.

Examples:

- Default CREATE Prompt
- CS Problem-Solving Prompt
- Exam Review Prompt
- Concept Check Prompt
- Case-Based Learning Prompt

### Why Automatic Version History

Version history protects instructors from breaking their own prompt.

It allows:

- restore previous version
- compare versions later
- safely experiment

## Prompt Validation

Prompt validation should exist, but the first version should be lightweight.

### Static Validation

Block only critical failures.

Examples:

- missing required variables
- empty prompt
- invalid template syntax

Important required variables may include:

- `{{materialsContext}}`
- `{{learningObjectives}}`
- `{{questionHistory}}`

The exact required variables should depend on prompt type.

### LLM Validation

LLM validation should produce warnings, not hard blocks, unless there is a serious issue.

It should check:

- prompt clarity
- missing grounding requirements
- missing output schema instructions
- possible prompt injection vulnerability
- instructions that conflict with CREATE's system behavior
- instructions that encourage ungrounded generation

### Recommended Behavior

Use severity levels:

- blocking error
- warning
- suggestion

Only blocking errors should prevent save.

## Prompt Types To Manage

CREATE has multiple prompt surfaces.

Prompt library should not assume there is only one prompt.

Recommended prompt categories:

- material profiling prompt
- coverage map prompt
- LO generation prompt
- quiz blueprint prompt
- question generation prompt
- question validation prompt
- history summary prompt
- export formatting prompt if needed later

## Data Model Direction

This is a conceptual model, not a final implementation schema.

### Coverage Map

```ts
type CoverageMap = {
  quizId: string;
  materials: CoverageMaterial[];
  topics: CoverageTopic[];
  generatedAt: string;
};
```

### Coverage Topic

```ts
type CoverageTopic = {
  id: string;
  label: string;
  subtopics: CoverageSubtopic[];
  sourceRefs: SourceReference[];
  linkedLearningObjectiveIds: string[];
  linkedQuestionIds: string[];
};
```

### Source Reference

```ts
type SourceReference = {
  materialId: string;
  materialName: string;
  sourceFile?: string;
  chunkIndex?: number;
  pageNumber?: number;
  excerpt: string;
  relevanceScore?: number;
};
```

### Question Metadata

```ts
type QuestionGroundingMetadata = {
  focusArea?: string;
  bloomLevel?: string;
  pedagogicalIntent?: string;
  sourceReferences: SourceReference[];
  generationRationale?: string;
  historyAvoidanceNotes?: string[];
};
```

## Relationship To Existing Plans

This plan is the upstream parent plan for:

- [prompt-improvement-plan.md](/Users/fanhaocheng/tlef/tlef-create/docs/plans/prompt-improvement-plan.md)
- [intelligent-question-generation-workflow-plan.md](/Users/fanhaocheng/tlef/tlef-create/docs/plans/intelligent-question-generation-workflow-plan.md)
- [lo-slice-planning-plan.md](/Users/fanhaocheng/tlef/tlef-create/docs/plans/lo-slice-planning-plan.md)
- [quiz-blueprint-planning-unification-plan.md](/Users/fanhaocheng/tlef/tlef-create/docs/plans/quiz-blueprint-planning-unification-plan.md)

## Implementation Phases

### Phase 1: Store Source References For Generated Questions

Goal:

- make generated questions traceable to materials

Tasks:

- attach retrieved RAG chunk metadata to question generation input
- store selected source references on generated questions
- show references in review and edit

### Phase 2: Add Compact Question History Summary

Goal:

- reduce repeated questions and repeated focus areas

Tasks:

- summarize existing quiz questions before generation
- include covered focus areas and avoid list
- pass summary into question generation prompt
- store generated focus area metadata

### Phase 3: Auto LO Generation Without Required Count

Goal:

- let CREATE generate a complete suggested LO set

Tasks:

- make LO target count optional
- prompt the LLM to decide natural LO coverage
- return rationale for the LO set
- allow user edit, merge, split, delete, and regenerate

### Phase 4: Coverage Map Backend

Goal:

- create a reusable coverage representation

Tasks:

- classify materials
- extract topics and subtopics
- link topics to source chunks
- link topics to LOs and questions

### Phase 5: Coverage Map UI

Goal:

- show teachers what is covered without building a complex graph first

Tasks:

- add topic/subtopic coverage table
- show linked LOs
- show generated question coverage
- show source evidence

### Phase 6: Prompt Library

Goal:

- let teachers view and customize prompts safely

Tasks:

- expose prompt presets
- support course-level overrides
- add reset to default
- add automatic version history
- add static validation
- add LLM validation warnings

### Phase 7: Integrate Coverage With Quiz Blueprint

Goal:

- make blueprint generation coverage-aware

Tasks:

- pass coverage map into AI plan generation
- let LLM recommend question count from coverage
- generate difficulty and Bloom distribution from coverage
- warn about uncovered LOs or overrepresented topics

## Success Criteria

This work is successful if:

- teachers can see which materials support each LO and question
- LO generation no longer requires users to guess the right number of LOs
- generated questions become less repetitive because history and focus areas are tracked
- quiz blueprint generation becomes coverage-aware
- prompt customization is visible, editable, restorable, and validated
- CREATE can explain why a question was generated and what source evidence supports it

## Implementation Status

Implemented first version:

- Course-level prompt editing with reset, named versions, history, and cross-course reuse.
- Prompt validation combines blocking static checks with optional model-assisted warnings and suggestions.
- Model-assisted prompt reviews are persisted with each saved prompt version, including the provider/model used and whether AI review was available.
- All exposed prompt categories are connected to their relevant pipeline: LO/coverage extraction, blueprint planning, question generation, bounded history, and question quality instructions.
- Auto LO count mode so instructors do not need to guess LO quantity.
- Regenerate All uses Auto count by default and preserves the old LO set if model generation fails.
- Source references stored for generated LOs and questions.
- Teacher-visible source references in Learning Objectives and Review & Edit.
- PDF page metadata, chunk index, and RAG similarity are logged and preserved for source preview.
- Compact bounded question history is passed into generation; older history is compressed into coverage counts.
- A local novelty gate compares database history and the current parallel batch, then retries overly similar candidates before they are streamed or saved.
- The novelty gate now combines lexical comparison with FastEmbed cosine similarity when the embedding service is available, while retaining a lexical fallback when RAG is offline.
- LO generation creates a validated material profile before drafting objectives. The profile groups instructional sections into assessable concept/skill clusters, preserves every required source section, and recovers omitted sections deterministically.
- LO generation, pasted-text classification, and single-objective regeneration now use the authenticated user's active provider and model instead of silently falling back to the server default.
- Compact question history passed into AI blueprint planning.
- Coverage map backend endpoint: `/api/create/coverage-map/quiz/:quizId`.
- Coverage Map tab supports both list and interactive graph views.
- The graph visualizes Material -> Evidence -> LO -> Question relationships and opens cited material pages from evidence nodes.
- The graph is lazy-loaded so React Flow does not increase the initial page bundle.
- OpenAI streaming resolves each user's active provider/model and uses Responses API text-delta events for official GPT-5-family models.

Future hardening:

- Add OCR page-region coordinates so previews can highlight the exact cited paragraph, not only open the cited page.
- Add prompt comparison and explicit rollback actions; previous versions currently load as drafts before saving.
- Add a live evaluation set that scores LO section recall, citation accuracy, and semantic question duplication across supported production models.
