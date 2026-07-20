# Getting Started with CREATE

CREATE helps instructors turn course materials into evidence-grounded learning objects. A learning object is stored internally as a quiz, but the instructor workflow is broader than a conventional quiz: it includes materials, learning objectives, an AI Blueprint, generated activities, review, coverage inspection, and export.

## Core concepts

- **Course:** the container for shared materials, prompt settings, and learning objects.
- **Learning object:** the item you design and export. It has its own assigned materials, learning objectives, blueprint, questions, and coverage map.
- **Assigned material:** a course material selected as evidence for one learning object.
- **Learning objective (LO):** a measurable outcome, optionally divided into assessable subpoints and connected to source evidence.
- **AI Blueprint:** an editable plan that allocates question types, counts, difficulty, Bloom level, focus areas, and rationale before generation.
- **Question:** a generated or manually created activity that can be reviewed, traced to evidence, and exported.

## Create and open quizzes

The course page lists saved learning objects in the **Quizzes** section using their editable names. Select **Add Quiz** to create another quiz; this button remains available when the course already has one or more quizzes. A newly created quiz appears in the course list and left sidebar immediately. Open a quiz to assign materials, define learning objectives, generate questions, review coverage, and export.

## Recommended end-to-end workflow

1. From the Dashboard, create a course for the subject or teaching context.
2. Open the course and add PDF or DOCX files, approved URLs, or pasted text.
3. In Quizzes, select Add Quiz, open it, and assign only the relevant course materials.
4. Generate learning objectives from the materials, paste existing objectives, or add them manually.
5. Review the objectives and their subpoints, Bloom levels, and references before continuing.
6. Open Generate Questions, choose a delivery target, format, teaching purpose, and automatic or fixed question count.
7. Generate the AI Blueprint. Inspect every row and edit the count, type, focus, or difficulty where necessary.
8. Generate questions. Progress is streamed while batches are created.
9. Use Review & Edit to verify correctness, answer options, feedback, evidence, and ordering.
10. Use Coverage Map to find missing or duplicated coverage, then export to the required destination.

## Workflow gates

The tabs are intentionally sequenced. Materials must be assigned before grounded objectives can be generated; learning objectives are required before a blueprint can be generated; and questions are required before export. When a later tab is unavailable, return to the previous tab and complete the missing prerequisite.

## Saving and returning later

Courses, learning objects, assigned materials, objectives, plans, and generated questions are stored on the server. Most edits save through the action that created them. Wait for the success message before leaving a page after a write operation. A generated export is a separate downloaded file; later edits do not update a file that was already downloaded.

## Using CREATE Guide

CREATE Guide is the floating AI help chat available throughout the signed-in application. Ask about the page you are viewing, a workflow decision, question compatibility, exports, or troubleshooting. Its answers are grounded in this manual and include source cards. Selecting a source opens this Help Center and highlights the cited section.

On first use, a short tutorial highlights the round chat button in the bottom-right corner. Select **Try CREATE Guide** to open the chat immediately, dismiss the tutorial to keep the button closed, or select **Skip tutorials** to stop all quick-tour prompts. You can replay it later from **User Account → Restart Feature Tutorials**.

CREATE Guide is read-only. It cannot click controls, change a course, regenerate a question, delete data, or see information that is not included in its help sources and the current page context.

## If the guide and interface disagree

The interface and current saved data take precedence. First refresh the page and check the relevant section of this manual. If the difference persists, submit a report from **User Account → Report Issues** and include the page, action, expected result, and actual result.
