# Learning Objective Pipeline and Page Reference Plan

## Problem Statement

Learning-objective generation is currently driven by a single semantic-retrieval query. That works for finding locally relevant evidence, but it is not reliable for discovering the complete structure of a document. A six-page lecture note with nine explicit sections can therefore produce only three or four objectives when the retrieved chunks overrepresent a few sections.

PDF references also stop at an internal chunk number. The page boundary is discarded before chunking, so instructors cannot connect an objective or question back to a stable page in the source material.

## Product Outcomes

1. Generate a complete, non-overlapping LO set that covers the major instructional structure of all assigned materials.
2. Preserve useful subpoints under each main LO and use them later when planning and generating questions.
3. Store PDF page numbers on every indexed chunk and every generated source reference.
4. Log retrieval rank, chunk identifier, page, section, and similarity score in the backend while keeping similarity scores out of the instructor UI.
5. Let instructors click a source reference to preview the cited page and highlighted evidence context.
6. Prove that course-level learning-objective prompt overrides are loaded and applied during generation.

## Pipeline Design

### Stage 1: Page-aware ingestion

- Parse PDFs page by page instead of flattening the document before chunking.
- Chunk within page boundaries and preserve `pageNumber`, `pageStart`, `pageEnd`, `sectionTitle`, and `chunkIndex` in Qdrant metadata.
- Cache page count and parser version on the Material record.
- Keep DOCX, URL, and text materials compatible by using section/chunk references without page numbers.

### Stage 2: Material inventory

- Build an exhaustive inventory from all selected material chunks when the total context is small enough.
- For large knowledge bases, retrieve coverage using multiple queries (outline/headings, concepts, procedures/examples, and assessment evidence) and deduplicate by material/chunk.
- Group chunks by source section and page before sending context to the LLM.
- Treat lecture/reference materials as concept sources and problem sets as assessment-evidence sources.

### Stage 3: Outline-first LO generation

- Ask the LLM to return both a `sourceOutline` and the final `objectives`.
- Require each major source section to map to exactly one main LO or to a named subpoint of another LO.
- Allow adjacent sections to merge when they assess one durable capability, but require the model to report that mapping.
- Keep user instructions and the course-level LO prompt as constraints, not as replacements for source grounding.

### Stage 4: Coverage gate and repair

- Validate the generated JSON locally for missing section mappings, duplicate objectives, empty subpoints, and unsupported mappings.
- If coverage is incomplete, run one repair prompt containing only the inventory, current objectives, and missing sections.
- Save coverage diagnostics with the generation metadata so later quiz planning can use LO subpoints and source mappings.

### Stage 5: Page reference preview

- Add an authenticated endpoint that serves the original material inline.
- Add a reference-detail endpoint that returns the cited chunk, page, section, and neighboring chunks.
- Replace internal `Chunk N` labels in the instructor UI with `Page N` when a page is available.
- Clicking a reference opens a modal with the PDF at the cited page and the exact evidence excerpt beside it.

### Stage 6: Prompt override verification

- Log prompt type, effective source (`course`, `user`, or `system`), override version, and prompt length.
- Persist that source/version in LO generation metadata.
- Add a small visible source indicator in the course prompt editor; never expose hidden system messages or API credentials.

## Compatibility and Migration

- Existing references without page metadata continue to display `Section` or `Chunk`.
- Existing materials must be reprocessed once to gain page-aware vector metadata.
- Existing quizzes, objectives, and questions remain valid.
- The first implementation uses the existing `pdftotext` page separators and falls back to the current parser if page extraction is unavailable.

## Acceptance Tests

1. `week3-lecture-notes.pdf` produces an inventory containing all nine numbered sections.
2. Auto LO generation maps all nine sections to an LO or LO subpoint; no section is silently omitted.
3. `week3-problem-set.pdf` contributes assessment evidence without forcing one LO per question.
4. Backend logs show every selected retrieval result with rank, page, section, chunk index, and similarity percentage.
5. Generated LO references show page numbers, and clicking one opens the matching PDF page plus cited excerpt.
6. Saving a course-level LO prompt results in generation logs and metadata identifying `course` as the active prompt source.
7. Old source references without pages still render and remain clickable when the material file exists.

## Implementation Order

1. Add page-aware ingestion and metadata fields.
2. Add exhaustive/multi-query inventory retrieval and diagnostics.
3. Add outline mapping plus coverage repair to LO generation.
4. Persist page/source/prompt metadata.
5. Add authenticated material/reference preview APIs.
6. Add the reference modal and page-first labels in the frontend.
7. Run syntax checks, frontend build, and a focused sample-document verification.

## Implementation Status

Implemented on 2026-07-16.

- Page-aware PDF parsing and Qdrant metadata are implemented.
- The LO inventory identifies explicit source sections and separates instructional content from assessment evidence.
- Auto count guidance is derived from the instructional section count.
- The LO prompt returns exact source-section IDs and runs a coverage repair pass when required sections are missing.
- LO subpoints now feed repeated-question slice planning and question-specific RAG queries.
- Retrieval diagnostics log rank, chunk, page, section, and similarity percentage in the backend only.
- LO and Review & Edit references show page-first labels and open a cited-page preview modal.
- Course prompt defaults now have one shared source, and generation logs/persists the effective prompt source and version.
- Existing PDFs expose a Course Materials refresh action backed by `POST /api/create/materials/:materialId/reprocess` to replace legacy vector metadata without re-uploading the file.

Sample verification result:

- `week3-lecture-notes.pdf`: 9/9 major instructional sections detected, including three supporting friction subsections.
- `week3-problem-set.pdf`: Part A, Part B, and Part C detected as assessment-evidence sections.
- Suggested auto LO count for the sample: 7, with an allowed evidence-based range of 6-9.
