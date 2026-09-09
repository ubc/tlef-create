# Getting Started with CREATE

CREATE helps instructors turn course materials into evidence-grounded quizzes and exportable learning activities. The Course Home calls each saved activity a **Quiz**; its workflow includes assigned materials, learning objectives, an AI Blueprint, generated questions, review, coverage inspection, and export.

## Core concepts

- **Course:** the container for shared materials, prompt settings, and quizzes.
- **Quiz:** the item you design and export. It has its own assigned materials, learning objectives, blueprint, questions, and coverage map.
- **Assigned material:** a course material selected as evidence for one quiz.
- **Learning objective (LO):** a measurable outcome, optionally divided into assessable subpoints and connected to source evidence.
- **AI Blueprint:** an editable plan that allocates question types, counts, difficulty, Bloom level, focus areas, and rationale before generation.
- **Question:** a generated or manually created activity that can be reviewed, traced to evidence, and exported.

## Dashboard and recommended work

The Dashboard keeps the summary cards for **Active Courses**, **Total Quizzes**, **Questions Generated**, and **Estimated Time Saved**. The time-saving value is an estimate based on five minutes per generated question.

After at least one course exists, the Dashboard replaces the static setup tutorial with live information from saved work:

- **Continue where you left off** selects the most recently active course and shows one specific next action, its Quiz step, and a direct button to the correct page.
- **Needs attention** shows up to three unfinished or blocked items, such as a failed course material, a course with no ready source, or a Quiz that still needs materials, objectives, generation, or review.
- **Your courses** shows each course's ready material count, Quiz and question totals, last activity, and a link to its current recommended action.

The short three-step introduction appears only when no course exists. Select **Create Your First Course** to open the same course-creation flow as **Create Course** in the sidebar. Dashboard recommendations are shortcuts based on saved progress; they do not change content automatically.

Existing questions remain reviewable even if an older progress flag is missing or a course material later fails. **Course materials are processing** means the source is already uploaded; use **View Progress** instead of uploading duplicates. Statistics use current Quiz/question lists when available, and material processing refreshes automatically while the Dashboard is open. **No other tasks to show** excludes the current suggested next step; it does not certify that all content has been reviewed.

## Create and open Quizzes

The Course Home keeps the numbered setup guide, Course Materials, and **Quizzes** inside one workspace. Course Materials appear before Quizzes because successfully processed sources are the prerequisite for grounded generation. Select **Add Quiz** to create another item. Each quiz card shows its current step and next recommended action, and a newly created Quiz appears in the course list and left sidebar immediately.

Selecting Course details, Course materials, or Quizzes changes both the highlighted section and the guidance panel. The guidance updates again when uploads finish, fail, or become ready, so a completed upload should offer **Continue to Quizzes** instead of continuing to ask for the first material.

## Recommended end-to-end workflow

Course setup has three numbered stages:

1. **Course details:** name the shared workspace.
2. **Course materials:** add PDF or DOCX files, approved URLs, or pasted text. Materials may be added later, but grounded AI generation requires processed sources.
3. **Quizzes:** create one or more activities from the shared course content.

Each Quiz then has five numbered steps:

1. **Materials:** assign only the course sources relevant to this object.
2. **Learning Objectives:** generate from evidence, paste existing objectives, or add them manually.
3. **Blueprint & Generate:** choose ASSESS, SUPPORT, or GAMIFY, compare visual layout cards, review the AI Blueprint, and generate questions.
4. **Review:** verify correctness, answer options, feedback, evidence, and ordering.
5. **Preview & Export:** experience the final activity and export it to H5P, PDF, Markdown, or Canvas.

**Coverage Map** is a quality tool rather than a required final step. Open it after objectives exist and again after generation to find missing or duplicated coverage without losing your place in the five-step workflow.

## Numbered navigation and workflow gates

The numbered navigation shows the current step, completed work, useful counts, and unavailable steps. A green check means the saved prerequisite is complete; a black circle and underline identify the page currently open; a lock means required content is still missing; and an attention state identifies work that should be reviewed.

Materials must be assigned before grounded objectives can be generated, learning objectives are required before the Blueprint, and at least one question is required before Preview & Export. When a later step is unavailable, read its status and return to the named prerequisite. Normal unfinished work is not an error.

Step 1 is complete only when all assigned materials have finished processing. **Checking or processing sources** means they are not ready yet; a failed material needs attention. Existing objectives and questions can still be opened for inspection if their materials are later unassigned. Moving between numbered Quiz steps updates the URL, and the browser's Back and Forward buttons return to the matching step, including Materials.

## Saving and returning later

Courses, quizzes, assigned materials, objectives, plans, and generated questions are stored on the server. Most edits save through the action that created them. Wait for the success message before leaving a page after a write operation. A generated export is a separate downloaded file; later edits do not update a file that was already downloaded.

## Using CREATE Guide

CREATE Guide is the floating AI help chat available throughout the signed-in application. Ask about the page you are viewing, a workflow decision, question compatibility, exports, or troubleshooting. Its answers are grounded in this manual and include source cards. Selecting a source opens this Help Center and highlights the cited section.

On first use, a short tutorial highlights the round chat button in the bottom-right corner. Select **Try CREATE Guide** to open the chat immediately, dismiss the tutorial to keep the button closed, or select **Skip tutorials** to stop all quick-tour prompts. You can replay it later from **User Account → Restart Feature Tutorials**.

CREATE Guide is read-only. It cannot click controls, change a course, regenerate a question, delete data, or see information that is not included in its help sources and the current page context.

## If the guide and interface disagree

The interface and current saved data take precedence. First refresh the page and check the relevant section of this manual. If the difference persists, submit a report from **User Account → Report Issues** and include the page, action, expected result, and actual result.
