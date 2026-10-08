# H5P Studio

H5P Studio provides advanced authoring with H5P's official semantics-based editor. It is useful when the normal Review fields do not expose a content type's full H5P configuration.

## Open a Learning Object in H5P Studio

In **Preview & Export**, choose **Advanced H5P Editor**. CREATE converts the Learning Object to a native H5P document, saves it through the same Lumi storage used by the official editor, and opens it in H5P Studio. This copy becomes an independent H5P draft, so later question changes in Review are not automatically merged into it.

If an H5P draft already exists, CREATE asks whether to **Open existing draft** or **Create fresh draft**. Opening preserves its advanced manual edits. Creating fresh converts the current questions and Learning Objectives into a separate Studio draft without deleting or overwriting the earlier one. CREATE marks an existing draft as potentially out of date when the Learning Object, one of its questions, or one of its Learning Objectives changed after the draft source revision was saved.

## Create new H5P content

Open **H5P Studio** from the sidebar and choose **More Studio actions → New blank activity**. Select one of the H5P content types installed in CREATE, complete the required title and fields, and choose **Save**. The editor fields come from the selected library's H5P semantics.

The compact header identifies this page with the **Official editor** badge. **Create with AI** opens the conversational workspace; when a Studio AI task is already selected, this button reads **Return to AI workspace**. **More Studio actions** reveals **Import .h5p**, **New blank activity** and **Advanced types** on this page too.

When **Your content** contains many activities, scroll inside that list to find an older activity. The list does not push the editor down an increasingly long page. On narrow screens, the list starts collapsed. Use the arrow beside **Your content**, labelled **Show saved H5P content**, to expand or collapse it. Selecting an activity closes the list again so its editor has room.

## Upload an H5P package

Open **More Studio actions**, then choose **Import .h5p** to import an existing package. Instructor uploads may use libraries that are already installed and reviewed in CREATE. Packages that require missing or unreviewed executable libraries are rejected; ask a CREATE administrator to validate and install the required libraries first.

## Preview and download

Choose **Preview** to run an unchanged saved activity. After an edit, the button becomes **Save changes & preview**: CREATE validates and saves the changed content before opening it. If the serialized editor content still matches the saved version, CREATE skips the write, does not change the Edited time and opens the saved preview without a save notification. **Download** performs the same change check before obtaining a standard `.h5p` package; in preview mode it downloads the saved version. Choose **Back to editor** to continue authoring. If Preview is opened while the H5P runtime is still starting after a server restart, CREATE waits for that shared runtime instead of returning a broken preview.

Scroll inside the official editor's fields to work through a long activity. For a saved activity, the toolbar keeps **Save**, **Preview** or **Save changes & preview**, and **Download** visible above those fields. The Studio header also stays visible; you do not need to scroll back through the fields to reach its actions.

The preview in **Preview & Export** does not create a Studio draft. It renders the selected H5P format from the current CREATE questions through the same native document builder used by H5P Studio. A Learning Objective filter intentionally previews only that subset.

## Important editing boundary

Expand **Independent Studio draft** above the editor for the editing boundary and source link. Source-change or unavailable-source notices open automatically so they remain visible before editing.

H5P Studio stores the complete native H5P document. Advanced changes are not converted back into CREATE's normalized question records. Continue editing that advanced copy in H5P Studio and export it from there.

## Content type availability

**New blank activity** includes all 54 content types in the public H5P.org showcase checked in September 2026, plus the existing Audio type: 55 selectable types. These include activities and lesson containers, not just graded questions. Search the official editor's type picker for **Cornell Notes**, **Virtual Tour**, **Flashcards**, **Game Map**, **Complex Fill the Blanks** (shown as **Advanced Fill in the Blanks**), or the other installed types. Twitter User Feed remains unavailable.

The 19 newly added types are available for manual authoring in the official editor. They are not automatically added to **Create with AI**, **Advanced types**, the normal question-generation menu, or every lesson container. Save and preview a completed activity before using it with learners. Speech recognition, AR, and media activities need suitable browsers, permissions, and real media; Impressive Presentation is an experimental upstream type, so use Chrome and check the result carefully.

If an installed type is missing after a library update, reload Studio and open **New blank activity** again. Ask an administrator to check library assets and dependencies if its form fails to load. Library maintenance does not automatically migrate existing saved activities.

H5P Studio can author locally installed, open H5P libraries. H5P.com premium or server-backed multiplayer activities are not made available merely by embedding the editor.

CREATE's AI workflow can also generate **Guess the Answer** as a native `H5P.GuessTheAnswer 1.5` activity inside Column or Interactive Book. After generation, choose **Advanced H5P Editor** to fine-tune the official reveal label, answer, and other library fields in H5P Studio.

## Create with AI

**Create with AI** opens the conversational **Studio AI workspace**. Start with a text-only teaching idea, upload PDF/DOCX files, or reference existing course context. Course, material and Learning Objective selection are optional. If a decision is missing or conflicting, CREATE asks focused questions. Choose answers and **Confirm and continue**, or write your own response. A clear request to generate questions continues through objectives, a checked plan and question generation. If you request only objectives or ask to review a plan first, CREATE stops at that destination.

For directly generatable native types such as **Chart** or **Timeline**, you can
ask for the activity in the conversation. CREATE checks the installed type and
offers a **Native activity plan** with your teaching goals and selected source scope.
A clear request to generate the activity can continue from the checked plan
automatically. If you ask to review the plan first, choose **Accept plan & generate**
when ready. For example, add “First present a confirmable plan” or “First give
me a confirmable activity plan” to pause before purchasing activity generation.
The resulting
**Activity preview** is an independent Studio proposal. Try it and inspect its
recorded text check and sources before choosing **Accept changes**; afterward
you can open the official editor or download it. Source changes after approval
require an updated proposal. This native draft does not create or replace course
questions, and its text check cannot inspect media.

For real media templates or manual-only types, choose **More Studio actions → Advanced types**. That
opens the One activity / Question collection composer and its template tools.
An installed type still needs its actual runtime and any required saved media;
the conversation cannot bypass those requirements. Ordinary question requests
continue to use the linked course-question plan.

### Explore before building

New conversations start in **Explore teaching idea**. Discuss a teaching approach, compare activities, or ask CREATE to investigate the available course context without immediately creating objectives and a question plan. Choose **Build activity** and send your instructions when you are ready to construct an activity, or explicitly ask in chat to build a plan or generate questions. An explicit build request switches the conversation to **Build activity**, so later clarification answers and count changes continue that task. Ask to only discuss or defer generation, or switch back to **Explore teaching idea** and send a message, to return to exploration. A phase change in an existing conversation is submitted with your next message sent from the composer. **Confirm and continue** submits only the clarification answers and preserves unsent composer text, context and stage changes. Exploring a finished activity keeps its saved version available.

CREATE can take several steps within one request: list authorized materials, search their extracted text, read a text range, read existing learning objectives, inspect installed activity capabilities, and check saved teaching requirements. It reads each result before deciding what to do next. Each turn has a bounded decision budget; if it reaches the limit, the checks remain saved and you can send a follow-up. Source text cannot give CREATE permission to access another course or publish an activity.

### Add context with + or @

With a material chip attached, **based on this**, **these notes**, or **这个材料** refers to your selected materials. CREATE reads a bounded text sample before deciding how to proceed; it can read further ranges as needed. A sample does not prove full topic coverage. If the selected material is still processing or has no extracted text, CREATE should explain that source problem. You can say **you decide how many** to delegate a conservative question-count recommendation to the teaching plan, while retaining any explicit constraints.

The **+** button opens **Add to your conversation** above the message box. Choose **Upload files**, **Course**, **Materials**, or **Learning objectives**. Typing **@** in the message opens the same context tools next to the caret. Search, choose a tool, then select the course or item. Use Arrow Down to enter the list, arrow keys to move between options, and Escape to close it.

Attached context appears as icon chips above your message. Click a chip to open **Context preview**; a material also offers **Open source document**. Use its remove button to detach it from the next message. Referencing a **Course** allows CREATE to look through your materials and existing LOs in that course, and select ready materials for an initial proposal. With individual material or LO chips alone, its tools stay within those selected items. Search reads extracted text; operation details identify the material and text range actually read. Each activity uses context from one course, with up to 20 selected materials and 8 selected LOs. Choosing another course replaces the current selections. The agent’s material-selection tool is restricted to initial proposals. Before a finished activity exists, attach different materials in your next message to request a fresh proposal. For a finished activity, start another conversation to build from different materials.

Drop PDF or DOCX files onto the workspace or choose **Upload files**. Files upload automatically. Without a selected course, CREATE saves them in **Studio drafts**. Wait for upload to finish before sending; CREATE waits for processing before planning. If uploading fails, use **Retry upload** or remove the file. In an existing conversation, added context waits for your next message. Before a finished activity exists, changed context creates a fresh proposal with new source checks and follows the destination you requested. Previous course work is preserved. Start another conversation to move a finished activity to another course.

Follow-up messages retain a bounded record of the source text ranges and learning objectives CREATE actually read. CREATE checks source access and changes before using these saved checks again. A new teaching topic, chapter restriction or exclusion discards older checks that could conflict with the new scope. Course evidence remains context; it cannot change your teaching requirements. CREATE can select up to eight saved LOs for an initial proposal, and the selected LOs determine that proposal.

For an existing Learning Object with no saved questions, a new plan uses exactly the selected materials, including removal of previously assigned materials you omitted. Once the Learning Object has saved questions, its material selection must match the saved activity. Choose **New task** and create a new Learning Object to build with different materials; CREATE will explain this limit before paid planning.

### Brainstorm learning objectives in conversation

For example, start in **Explore teaching idea** and write “Help me compare ways to teach first-year mechanics.” CREATE discusses alternatives and can ask focused questions without creating a plan. Ask “Brainstorm learning objectives for this topic, without generating questions” to produce observable LOs and stop at **Learning objectives ready**. With no source material, these remain an **instructor teaching brief** with visible default assumptions; CREATE does not invent evidence or citations. Upload materials and send a message when you want a new proposal grounded in their contents.

With materials attached, CREATE follows the material → learning objectives and evidence → question plan workflow. Referenced existing LOs are copied into a new activity; their original course records and questions are preserved.

### Inspect and edit the task teaching brief

**Task teaching brief** appears in the conversation before the question plan is ready. It shows selected material names, inferred material classifications, the actual reading scope, topics, exclusions and small, editable learning objectives. Expand **Material review** to see whether classification came from file details or sampled text. **Sampled source excerpts** does not mean the entire document has been inspected.

**Teaching assumptions** identifies default or inferred learner level, purpose and difficulty when these were not supplied. Choose **Edit teaching assumptions**, change the actual fields and **Save teaching assumptions** to send those values as a follow-up. They are not pasted into the message box.

Choose **Edit learning objectives** to change the actual objective text, then **Save objectives**. During active work, **Pause and edit** first stops the active task safely and opens the editor. An objectives-only request saves the edited objectives without generating questions. A clearly authorized question request can replan and continue from the changed objectives. Changes affecting an existing activity produce a candidate version; the earlier version stays available until **Accept changes**. Questions linked to changed objectives require new checks rather than inheriting their previous verdicts.

Save or cancel changed learning objectives or teaching assumptions before
switching tasks through **New task** or **History**, or opening **Advanced
editor**. CREATE keeps the current task open so unsaved teaching brief edits are
not discarded by navigation. Opening an editor without changing its text does
not block these actions.

### Open a proposal or question set preview

Click **Learning objectives** for an objectives-only result, or **Learning objectives & teaching plan** for the question proposal, to open the side preview. Review the LO wording, source links and question mix. Expand **Question focus** under a row to see each question's distinct assessment focus. Edit fields and **Save plan**, or ask for changes in chat. When you explicitly requested questions, CREATE checks the saved plan and continues automatically. When you requested a plan for review, choose **Accept plan & generate** when ready. New context and unsaved edits must be submitted or saved first.

If plan validation reports repeated question tasks, change the actual assessment
instructions or scenario, not only the **Question focus** label. CREATE checks
for identical task instructions across rows under the same objective and type
before generating questions. Distinct tasks can still assess the same concept.

Click **Question set preview** to open checked questions as they become available. One rejected question can receive one automatic rework; it does not block the other checked questions from being saved. **Close preview** returns to the full conversation. **Questions & sources** shows evidence, **Download H5P** downloads the selected saved version, and **Open course workspace** returns to the standard workflow. No external deployment happens automatically.

Newly generated multiple-choice questions randomize answer positions in the H5P
preview and export. Correctness, hints and answer-specific feedback stay with
their option. Previously saved independent H5P drafts keep their own settings.

Generated course questions receive an AI text check of their task, saved answer
or sample response, assessment criteria, feedback and teaching requirements.
Different question types use the same review boundary; an open-ended sample
response is not treated as the only acceptable answer. **AI text check completed**
in **Questions & sources** expands the checks recorded for that question and any
declared arithmetic calculations verified by CREATE. Earlier questions without
this record do not display it. The AI can miss errors: inspect the question,
answer and learner feedback yourself. This check does not inspect images, audio
or video.

When the multiple-choice feedback writer supplies a numerical formula, CREATE
computes its result and adds the checked equation. The writer can use an
approximation sign for a rounded result. Long computed decimal results are
shortened for readability and marked **≈** when rounded; full precision is
retained for the calculation check. Incorrect exact equalities and incorrect
legacy result claims still fail the calculation check. Computing a formula does
not prove that its inputs, direction or units match the question; inspect those
along with the AI text check.

An answer, assessment, feedback, duplicate or planned-focus failure can receive
one targeted automatic rework within an attempt, followed by the same checks.
Evidence repair first looks for additional supporting excerpts within the same
approved material scope. No new draft is purchased when no new evidence is
available. A clear question request can also continue known unfinished failures
within a two-round recovery limit while retaining checked questions. Unreadable
responses, unknown save outcomes, cancellation, unavailable services and usage
limits stop with saved progress rather than purchasing blind retries.

## Revise an activity and restore a version

After linked questions are saved, you can ask to revise several question numbers,
change all questions' difficulty or type, or change the total to **1–20 questions**.
A count-only change preserves the retained questions. New questions follow the
saved learning objectives and valid type allocations; ordinary reductions work
backward through the questions while keeping each objective covered. CREATE
checks the requested scope before calling the question generator. If the count
cannot preserve the objectives, it explains the conflict and offers choices.
Only an explicit instruction to combine objectives or exclude specified
objectives permits that change. Combining objectives retains their topics and
source references and rechecks the affected questions. Reducing the count alone
does not authorize dropping teaching goals.

Each completed item and its AI responses are saved during a batch revision.
**Resume task** can reuse completed work after interruption; an unknown call
requires explicit retry. The whole result stays a proposed version until
**Accept changes**. **Keep current** preserves the earlier activity.

Describe a change in the conversation, for example “Make question 2 simpler.” A single-question revision of a linked version preserves the other questions and retrieves supporting material. You can explicitly request an available question type, easy/moderate/hard difficulty, or single/multiple-answer mode for a multiple-choice question. Unchanged properties are retained; unavailable types are refused before question generation. The proposal appears beside the conversation while the accepted version stays current. Choose **Accept changes** or **Keep current**. Switch **Viewing** to compare the previews before deciding.

Saved course-linked versions retain their objectives and question allocation in **Teaching plan**. Choose a version with **Viewing** to compare these read-only fields after an objective merge or count change. Request further revisions through the conversation.

An explicit whole-activity revision produces an **Independent Studio version**. Advanced native H5P edits are not converted back into course question records or coverage links. The **Questions & sources** view explains this boundary instead of showing stale course questions as the native revision. The earlier course teaching plan is not shown as that native version's plan. Use Preview to inspect it.

**Version history** contains accepted versions. **Restore version** creates a new version from the selected saved content; earlier versions remain available. Restoring a linked course version also restores its saved questions and plan. Restoring an independent Studio version changes the Studio activity only. Downloads or external deployments are not undone. If the course changed elsewhere, CREATE blocks replacement and preserves the proposal.

**Advanced editor** opens a saved version in the official editor. Saving a changed managed activity creates a new independent Studio version and preserves the original. An older editor or an unresolved proposal cannot overwrite the current version. Return through **Return to AI workspace** to see the new version.

The official editor can upgrade an activity to a newer installed minor version
of the same type, such as Column becoming Page. CREATE accepts a healthy upgrade
within the same major version when saving; the original version remains in
history. Changing the activity type still requires a separate activity.

### Checks for generated native proposals

CREATE checks the full native activity's text, answers, feedback and supporting
evidence before presenting a generated proposal. An unsuccessful check keeps
your current activity. Discussing a failed native attempt keeps **Resume task**
available; discussing a pending plan keeps **Accept plan & generate** available.
Changed teaching requirements need an updated plan before generation.
**Resume task** reuses saved draft and review responses
when their generation contract is still valid; an unavailable review can be
retried without purchasing the saved draft again. CREATE rechecks the selected
materials, learning objectives and current template before packaging a saved
draft and before **Accept changes**. Changed sources, a changed template or an
older review policy blocks acceptance and asks for a new proposal.

Restoring an independent historical version or saving a manual edit preserves
the content you chose; it does not claim a new AI generation check against newer
materials. Inspect its preview before using it.

## Resume a conversational workspace

Scroll inside **Conversation** to read earlier messages or reach the latest results. The workspace fits the available screen height, and the message input stays in view below the scrolling message area, including on a short screen. **Close preview** returns to the full-width conversation. On narrow screens, the preview covers the workspace; choose **Close preview** to return to the conversation and its input.

The compact header shows **H5P Studio / AI workspace**, **History**, **New task** and **More Studio actions**. Choose **New task** to start another conversation. **More Studio actions** reveals the **Import .h5p**, **New blank activity** and **Advanced types** buttons; choose the action you need.

In the sidebar, scroll the **Courses** list to reach another course. The branding, search and account controls stay visible while that list scrolls.

The conversation, task state and version history are stored on the server for the signed-in author. **History** opens recent conversations, lets you search their titles or statuses, and restores the selected task. The workspace URL also restores the selected task after refresh. Leaving the page does not stop generation. Files still waiting in the browser's attachment list are not yet saved; choose a course to upload them before leaving. **Stop task** requests cancellation of the current task and its pending follow-ups; completed work and versions remain saved.

### Queue a follow-up while CREATE works

You can continue typing during an active task. Choose **Queue message**, or press Enter, to save the instruction for the next safe task boundary. **Queued messages** shows waiting, working, completed, needs-attention and cancelled messages. They execute in submission order after the current task finishes; a queued instruction does not immediately alter questions already being generated. If a proposed revision needs your decision, first accept it or keep the current version before queued work proceeds. Up to eight messages may wait at once. Queue state survives a refresh or server restart, and retrying the same acknowledged submission does not enqueue it twice.

**Check status** reads saved progress without starting another model request. After an ambiguous network error, **Retry same request** resends the original command identifier. After an interrupted or failed run, **Resume task** explicitly retries the failed step and may use model credits. Saved generated output is reused when only H5P packaging failed. An uncertain model call is not automatically replayed after a server restart.

If material processing fails, retry it in the course Materials tab before resuming. If a task changed in another tab, refresh its status and review the latest plan or version. Save plan edits before leaving. A disconnected initial submission can be found in Task history; resubmitting the same request identifier with a different brief is rejected, so use **New task** for a different brief.

### Task steps and teaching requirements

In the conversation column, **Working for** shows elapsed time during a task; **Worked for** shows the final duration of that run, excluding time between separate requests. Expand this Task steps summary for recorded tool actions: look through course materials, read source text, check requirements, retrieve source evidence, generate and review a question, rework a rejected draft, and save results. New runs record actual operation starts and completions, their durations, and nested checks. Expand an operation for its status, time and available result summary. Older tasks retain their grouped progress steps. An operation whose completion was not recorded is not labelled as successful. These are recorded actions, not private model reasoning. **Live** means SSE updates are connected. On a lost connection, saved status checks continue; reconnecting never starts another AI request. A lost model response requires an explicit retry; saved model output can resume without repeating that decision call.

The task summary also shows recorded token usage for that same execution, alongside its elapsed time. Expand the details to inspect **Input tokens**, **Output tokens** and **Total tokens** reported by the model service. Recorded usage includes AI model calls from failed checks and automatic rework when the provider reports them, not just the final successful question. Reusing saved model output adds no new token usage unless CREATE makes another model call. A separate request has its own time and usage; **Conversation total** combines recorded usage across requests in this conversation. These counts cover AI model calls, not embedding or vector-search token counters, account-wide usage or a price estimate.

At 10,000 tokens or more, the summary uses a rounded abbreviation such as **12.3k tokens** for 12,345 tokens. The **k** means thousand; CREATE rounds to at most one decimal place and omits a trailing .0, so 10,000 appears as **10k tokens**. Expand the details for the full reported counts rather than the rounded abbreviation.

**12.3k+ tokens · recorded usage** means only part of the usage is known: the summary is a rounded recorded subtotal, not complete usage. The **+** remains when usage is partial or still pending. **Token usage pending** means a model call has not yet returned its usage report. **Token usage not recorded** covers older tasks without recorded receipts; **Token usage unavailable** means usage could not be obtained. A missing provider report or an interrupted call without a receipt is unavailable rather than zero. Recorded usage describes the receipts CREATE has saved; it cannot recover a missing provider report.

Where available, reasoning tokens are already part of output tokens, and cached input tokens are already part of input tokens. Do not add those subsets to Total tokens again. Expanding token details reads saved records and does not generate another question.

To estimate **API cost per question-generation task**, use the recorded model and separate input, output, cached-input and cache-write counts with your provider's current prices and processing tier. **Total tokens is not a dollar bill or a spending limit.** Costs include planning, question generation, checks and paid retries, even when a draft is rejected. A fixed question count does not guarantee a fixed price. For OpenAI, consult its [current API pricing](https://developers.openai.com/api/docs/pricing); account billing remains authoritative. CREATE's task receipt excludes embedding costs and does not currently enforce a dollar budget. To reduce spending, inspect **Why generation stopped** and adjust a conflicting or repetitive teaching plan before choosing **Resume task**. Use **Check status** to read saved results without starting generation.

Use **Collapse sidebar** beside CREATE to move navigation into a narrow left rail. **Expand sidebar** restores it; the preference is remembered in this browser. Mobile navigation continues to use Open menu.

The **Question set preview** card opens the right preview pane. Checked questions appear progressively as interactive H5P content; you can try them while other questions are generated or reworked. A count shows how many of the approved questions are checked. Failed drafts are excluded. The preview reports whether these are live prepared drafts or already saved course questions. After a partial result, **Open course workspace** lets you review, edit and export the checked questions immediately.

For a broad request such as “create quizzes from this material,” CREATE first checks whether it has enough information for a useful activity. **Waiting for your teaching choices** means a focused decision is still needed. Choose answers and **Confirm and continue**. Clear requests can proceed directly, and reasonable missing defaults appear in **Teaching assumptions**. Your replies remain part of the teaching requirements. An explicit request for questions authorizes the initial plan-to-generation workflow; a request to review the plan first keeps that approval step.

**Teaching requirements** shows saved topic, audience, purpose, difficulty, question count, question types, required coverage and exclusions when explicitly stated. Expand it to see the instructor wording and outstanding questions. Update requirements through chat, or change the count in Teaching plan and choose Save plan. A clear request for 15 questions is checked against the proposed total before approval. Conflicting, unsupported or infeasible counts require clarification; CREATE does not silently drop plan rows to meet them. These saved fields are interpreted from your messages and should still be reviewed.

State a total with digits or Chinese numbers from one to twenty, for example “生成十五道题” or “总共1道 Fill in the Blank（填空题）”. “再增加两题” or “再生成两道题” adds two to the saved total; checking or retrying the same submitted request does not add twice. Referring to “第十五题”, reporting existing questions, or changing selected questions' type preserves the total. To reduce the total, say “总题数减到两道”. A range such as “十二至十五道题” requires a single target before planning.

Once a plan is ready, expand **Refine teaching requirements** to choose **Learner level**, **Teaching purpose**, and **Question difficulty**. **Update proposal** sends those choices as a plan revision. A task requested for plan review waits for approval; a clearly authorized question workflow can continue from the checked revision. You can discuss other requirements in the message box, including question count and constraints.

When a message is ambiguous or its requirements conflict, CREATE can ask up to three clarification questions with selectable answers in the conversation. Every asked group needs an answer. **Select one or more.** allows several topics or requirements together; **Select one.** is used for choices that cannot be combined, such as alternative scopes. Where offered, choose **Write my own answer** and enter **Your answer**. In a multiple-selection group, you can combine listed choices with your own answer. In a single-selection group, your own answer replaces the listed choice. An empty custom answer cannot be submitted.

Choose **Confirm and continue** to submit the selected and custom answers together and continue the task directly. CREATE records one reply tied to the current clarification; your unsent chat draft remains in the message box. Selecting options alone does not submit. Empty custom answers or unanswered required groups keep confirmation disabled. You can also send a free-text reply through the message box. Only the latest assistant message offers active choices; older choices remain visible but cannot be submitted. If delivery is uncertain, **Retry same request** checks the same submission rather than sending another answer. Save unsaved plan edits before using clarification choices.

### Questions needing attention

**Why generation stopped** explains the saved cause of a stopped attempt. During active work, **Why a question needs attention** explains an item failure while other questions continue. Follow **Task steps** for the current automatic repair. **Stage** identifies the failed operation, and **Error code** identifies the problem when you need support. **Next step** gives the recovery action after the task has stopped. When several questions share the same cause, CREATE shows that explanation once with the number of affected questions. Follow the next step before choosing **Resume task**; a source or service problem may need attention before retrying can succeed.

For a native activity, **Activity check stopped** identifies a known teaching,
answer or source check that rejected the draft. Inspect its saved observations
and confirm that the installed H5P type supports the requested interaction. An
unsupported feature may require a different type or revised instructions; it
does not mean the model configuration is wrong. Unknown service errors retain a
general message without exposing provider details.

**No questions were prepared** means this attempt produced no checked questions to preview. An earlier accepted activity remains available. For an item that stops while finding supporting material, question generation and AI review have not run for that item; it is not an incorrect-answer verdict. Check the material's processing or availability as directed. If some questions passed their checks, their preview remains available and the failed items appear under **Questions needing attention**.

For **Error code: MATERIAL_INDEX_MISSING**, a clearly authorized question workflow can restore the missing index and continue within its recovery limit. Existing searchable indexes are preserved. If the task is stopped, choose **Restore material search** to restore selected material search without changing the files or generating questions; you do not need to upload again. When **Materials are searchable again. Choose Resume task to continue.** appears, choose **Resume task**.

When a batch has failed questions, **Questions needing attention** lists each affected question number and its saved diagnosis. The message distinguishes an answer flagged as incorrect or ambiguous, an instruction mismatch, incomplete option feedback, an unverifiable calculation, and an unavailable feedback review service. A review flag is a reason to inspect the draft and sources, not proof that the reviewer is always correct. Older tasks may show a general failure message because they do not contain the newer diagnosis.

A **duplicate check** failure (`QUESTION_DUPLICATE_DETECTED`) means the application's duplicate check found the draft too similar to another question in this batch or Learning Object; this is separate from the AI's answer check. Keep the approved topic and exclusions, change the row's required fact, subpoint or reasoning focus, then **Save plan** and review the updated proposal before choosing **Accept plan & generate** to explicitly retry.

For newly recorded duplicate failures, expand the question's **Application duplicate check** to see the rejected draft, which lexical or semantic similarity threshold was reached, and the available closest-question excerpt. Lexical and semantic checks may identify different closest questions. A similarity score is a reason to compare the tasks, not proof that their answers are wrong or that they assess the same reasoning. Older failures may not have saved this evidence. Review the planned reasoning step before paying to retry the same tightly constrained task.

An **AI rate limit or usage allowance** failure means the model service could not accept the request. It is not an incorrect-answer verdict. CREATE does not start a fallback question generation or automatically replay this request. Check the provider allowance or wait for its rate limit to clear before explicitly retrying. If this happens during feedback review, the unchecked question remains unpublished.

An **unreadable or invalid question** means the model output could not be parsed or did not match the question format. This is separate from an incorrect answer verdict. CREATE requests JSON output for question generation, but still validates the returned draft. A completed invalid draft does not trigger automatic fallback generation. Inspect the instructions, then choose an explicit retry to generate a new draft using additional AI credits.

Expand a failed question to inspect its topic, **Approved instructions**, **Rejected draft — not published**, and **Failure details**. A **Calculation check** identifies the explanation or option feedback, the arithmetic expression, its computed result, and the result claimed by the feedback. This check does not change the answer key. **AI review observations** are displayed separately and need instructor review. Rejected drafts and review observations are private course content visible only to the owning instructor. They are not saved in job telemetry. Older attempts may lack these details; CREATE explains that instead of inventing a diagnosis.

Choose **Discuss the failure** to compose a question for the assistant, or **Edit teaching plan** to revise a stopped batch. Question instructions, objective wording and counts can be edited. **Save plan** invalidates the previous approval; review the updated plan and choose **Accept plan & generate** when that plan is awaiting review. A clearly authorized question workflow can continue known repairable failures within its saved limit. Discussion alone does not authorize an unknown paid outcome or replace a published version. Previously checked questions remain available. **Resume task** explicitly continues a stopped attempt with the same plan.

In Studio AI, a rejected draft gets at most one **rework** within an attempt, followed by the same checks. **Feedback only** keeps the original question, options and answer key. **Answer redraft** independently solves and redrafts the task. **Instruction correction** and **Planned focus correction** preserve the approved topic and constraints. **Distinct question focus** addresses a duplicate. **Source evidence refreshed** uses newly retrieved evidence within the approved material scope. The strategy appears in Task steps, including when repair fails, and can use additional AI credits. AI review and arithmetic checking do not guarantee the entire question is correct. Quota errors, unavailable services and cancellation do not trigger automatic rework. An authorized question workflow can continue known failures for at most two further rounds while reusing checked items; a partial result remains marked incomplete. **Resume task** explicitly continues stopped work and reuses confirmed prepared questions when the plan, source snapshot and generation contract are unchanged. Reused questions are not duplicated. If source ownership or content changed, continuation stops for review. A failed status read is retried automatically without generation; **Check status** can refresh the saved result.

In the teaching plan, **Number of questions** controls the quantity. Row instructions are common constraints for one generated question; the **Question focus** list contains distinct tasks within that row. Use separate rows for different learning objectives, question types or common constraints. Changing quantity requires a matching allocation of distinct tasks rather than copying an earlier task. CREATE executes and reviews one question at a time while preserving source requirements, scenarios and exclusions.

## Advanced types

Choose **More Studio actions → Advanced types** to open the native creation form. First choose **One activity** or **Question collection**. For a collection, choose an illustrated **Column**, **Question Set**, or **Interactive Book** layout. The illustrated question-type cards allow multiple selections: choose one type for several questions of that type, or several types for a mix. Leave all cards unselected to let AI choose compatible types. Write **Teaching instructions**, including an exact total or quantities per type if needed. AI proposes a type-and-count plan that includes every selected type. Review and edit each count before choosing **Generate AI draft**. A collection can contain at most eight generated items. The saved native H5P draft opens in the official editor.

The **Advanced types** badge identifies this builder in the compact Studio header. Follow its numbered cards and scroll inside the form to reach later steps; the header stays visible. Choose **Create with AI**, or **Return to AI workspace** when a Studio AI task is selected, to open the conversation. **More Studio actions** offers the same import, blank-activity and Advanced types buttons here.

**Add course evidence** is optional. Choose **Use a course** to select or create a course and Learning Object, upload PDF/DOCX materials, select already processed materials, generate Learning Objectives from those materials, and choose up to eight existing objectives. Review or edit objective wording in the course Learning Objectives tab. A single activity may use several selected objectives; AI is asked to combine their concepts. Selected processed material excerpts and selected objective text are sent as bounded context for planning and drafting. Wait until selected materials say **Ready**.

**Teaching instructions** are required for **Use my instructions**. If you choose **Use a course**, select at least one ready material or learning objective; then you may leave Teaching instructions empty. CREATE uses a general evidence-grounded request, which you can refine before generating. A short, unfinished instruction still needs at least ten characters or can be cleared to use the course evidence. When an action is greyed out, **To continue** below the generation button and nearby guidance explain which selection, evidence, plan, or instruction is missing.

**Prompt helper** sits beside **Teaching instructions** in both One activity and Question collection. It opens a floating conversation, remembers it in this browser tab, and knows your current type, layout, selected question types, selected learning objectives and material names. It does not read full course files in this chat. Ask it what context it has, discuss goals, or answer its follow-up questions without generating a prompt. When it has enough information, it may offer **Yes, generate prompt** and **Not now**; choosing Not now keeps the conversation going. A clear instruction to create an activity or write a prompt can generate one immediately. Once generated, the editable prompt has **Use this prompt** to fill Teaching instructions and **Copy prompt** to copy it in one click for pasting elsewhere. Copying does not start generation or change the Teaching instructions field.

One activity can use any available installed native H5P type, including types that need a saved media template. Collection plans use only question types supported by the chosen H5P container. AI currently plans at most eight native collection items per request; if a larger quantity is needed, create multiple drafts or use the main Learning Object workflow. CREATE checks the generated collection against the approved type and count plan and makes one repair attempt before rejecting a mismatch.

The former **Use course materials** and **Quick activity** tabs are merged into this form. A Studio draft linked to a course appears with that course's Studio activities, but native H5P edits and generated items do not automatically create or replace CREATE Question records or alter the Review question count. When a course and Learning Object are selected, choose **Build linked course questions** to carry your task and selected materials into the course assistant. There, review its Learning Objectives and plan before generating normalized Question records and a Column Studio draft. The regular course **Generate Questions** tab also remains available for this purpose. A native AI draft does not replace or update Quiz questions.

The creation brief and selected plan remain in this browser tab when you return from the editor or refresh. Older in-progress assistant sessions can still be resumed from a saved task link. **New blank activity** and **Import .h5p** are available through **More Studio actions**.

The former **Create a draft** step bar has been removed. Edit the selected activity in the official editor, then use **Preview** or **Save changes & preview**, **Back to editor**, and **Download**. There is no extra draft step to complete.

## Quick activity

Choose **More Studio actions → Advanced types → One activity**, or **Explore AI activities** in a Quiz's Generate Questions page. This beta builder uses installed H5P semantics to create native activity parameters, rather than the smaller set of normalized Quiz question types.

A new **Quick activity** draft does not replace your Quiz questions. The generated activity is a separate Studio draft. It does not overwrite its source Quiz or template, add rows to the Quiz Blueprint, change Quiz question counts, or inherit Quiz evidence/coverage links. Continue editing and downloading the native activity in Studio. The ordinary Quiz flow remains the better choice for evidence-linked question sets and PDF/Markdown/Canvas exports.

1. Search **Find a type**, choose an illustrated card or use **Activity type** to browse installed types such as Chart, Timeline, Questionnaire, or Summary. Collection layouts have their own visual cards.
2. Enter **Teaching instructions**: audience, learning goal, source facts and preferred feedback. **Prompt helper** can draft and refine this text through conversation; choose **Use this prompt** or **Copy prompt** when it is ready. If you select course materials or objectives, Studio includes only those selected sources as context and you may leave Teaching instructions empty. Without selected course evidence, generation requires your brief and optional template.
3. Choose **Generate AI draft**. CREATE generates and validates it. The model can make one automatic repair attempt within this request. An invalid draft is not saved; your brief stays available on the current page so you can revise it and retry.
4. The saved **AI draft · Needs your review** opens in the official editor. Check accuracy, answers, accessibility and layout. Choose **Save changes & preview**, try the student interaction, then **Download** the `.h5p` package.

## Return to Quick activity

Returning from the editor to **More Studio actions → Advanced types** restores the creation shape, layout, activity type, **Teaching instructions**, selected course evidence, reviewed question plan, search and saved-activity selection in the same browser tab. These settings survive refresh and are kept separately for each activity and signed-in author. After generation, the new activity is selected as the saved starting point so you can extend your instructions and generate a separate revision. Save manual editor changes before returning if you want the next revision to include them.

The brief is stored in this browser tab, not permanently on the server. A different browser or a closed tab may not retain it. Older activities without a retained brief still select their type and saved activity automatically, but CREATE cannot reconstruct instructions that were never saved.

If you explicitly selected **Create a new activity**, returning to your saved brief keeps that selection. It does not substitute the activity currently open in the editor as a template, especially when that activity has a different type.

For **Documentation Tool**, the official editor should show **Elements** below **Heading**, including page types and **Add page**. A form showing only Title and Heading has not loaded correctly; refresh to get current editor assets. Standard pages support text and input fields, with a Document Export Page for exporting written responses. Multiple-choice quizzes are not a native page type inside Documentation Tool. If a brief asks for both Documentation Tool and multiple-choice questions, Create with AI blocks generation and suggests Question Set or Column. If the activity must export written responses to Word, keep Documentation Tool and revise the multiple-choice step to a written response. A Question Set or Column does not provide a combined Word export of learner answers.

New Documentation Tool AI drafts use a focused page structure for reading text, response fields and document export. CREATE checks the required pages and can ask the model to repair an incomplete result once. A title and heading alone are not accepted as a complete AI activity. Check the actual page contents and export interaction in Preview; structural validation cannot prove the activity meets every teaching instruction.

## AI media templates and availability

**Prepare a template in the editor** creates an empty saved draft and opens the
selected compatible type directly. It does not call the AI yet.
Add your real media, save it, then return to **More Studio actions → Advanced types → One activity** and choose that
saved template. For Dictation, provide and verify the transcript yourself; AI
does not listen to the audio. The builder currently uses Dictation 1.3.9, which
matches CREATE's installed core, rather than the newer incompatible 1.4 library.

An empty template is only a starting point. **Save changes & preview** stays in the
editor if required fields are missing. Complete the highlighted fields and add
the actual audio, image or video before trying again. A saved empty template
cannot be used to bypass the AI builder's real-media requirement.

**Save** and **Save changes & preview** wait for nested editor fields to finish loading.
If those fields cannot load, check your connection and choose **Try again**.
An unused blank subtitle row does not prevent an Interactive Video from saving;
add a real subtitle file when you want captions in the exported activity.

Types labelled **needs a saved template** require a real prepared activity. Examples include Memory Game, Image Hotspots, Interactive Video and Multimedia Choice. Choose **More Studio actions → New blank activity**, select that type, upload your actual media and save. Then return to **More Studio actions → Advanced types → One activity** and select the activity under **Saved template (required)**. You can also import an owned `.h5p` package as a template.

AI uses the saved template version, creates a separate draft and retains referenced files. It does not create new images, generate speech, watch videos or inspect images. Describe what your media shows in the brief, and inspect timing, hotspot positions and answer mappings in the editor afterward. External embeds still require a valid URL/account and the external service's permission to embed; an AI draft cannot make an unavailable service work.

Types labelled **needs maintenance** have missing compiled runtime files, missing dependencies, a newer H5P Core requirement or a retired external service. Generation is disabled and the explanation appears below the selected type. Branching Scenario is available again after a coordinated runtime, core and editor upgrade. Existing Branching versions are retained. In a new scenario, check every decision, branch destination and ending in the student preview before delivery. **Twitter User Feed** is no longer supported because the Twitter API used by its official H5P component is no longer available; changing your teaching instructions cannot repair it. Course Presentation remains available without using that retired component. The catalogue rechecks installed files; installing an editor alone does not guarantee every type can run.

## Media preview and save troubleshooting

**Preview** and **Save changes & preview** open the student preview using the full Studio workspace width. The activity list is hidden while previewing; choose **Back to editor** to switch activities. The preview height follows H5P as pages, feedback and panels expand or collapse, so long activities scroll with the page instead of being confined to a fixed-height inner window. Supported activities also offer their own fullscreen control.

If an internal **Question set preview** is blank or shows a blocked-connection or refused-to-connect message, refresh Studio and reopen the saved task or preview. This reloads the saved preview; it does not generate questions again. A preview connection problem does not require another AI generation.

Compare layout with the [official H5P examples](https://h5p.org/content-types-and-applications). Text, images, card counts and activity settings affect the appearance. A successfully saved activity still needs a visual and interaction check; a minimal test activity is not proof that every layout is correct.

If an image stays blank or a video never loads, save the activity and reopen its preview. The media must belong to the saved activity, and its files must still exist. A preview should load the same uploaded media after returning from the editor or reopening the activity; do not regenerate with AI to fix a missing file.

Image Hotspots accepts positions created by the current official editor. In **Multimedia Choice**, picture options do not require a hidden **Poster image**; audio options do require one. Complete the visible required fields before saving. For **Iframe Embedder**, the target website must allow embedding: an empty external frame may be a restriction of that website. Test with a URL that you control and know permits embedding.

AI drafts are structurally checked, not certified correct. Always test the specific activity and its downloaded package in your target H5P host before teaching with it.

## Recover a Studio generation after refresh or disconnection

If you refresh during Studio AI generation, return to **More Studio actions → Advanced types** in the same browser tab. CREATE checks the original request and opens its saved draft when ready. It does not submit another AI generation just because the browser disconnected. The request identifier and your activity brief are retained in this browser tab; the generation receipt on the server does not store your teaching instructions.

If a status lookup fails, restore your connection and choose **Check generation status**. This button checks the existing request; it does not spend additional AI credits. One Studio generation per user may run at a time, including across server instances. New attempts are also rate-limited.

A server restart or a lost task lease may interrupt generation. After the lease expires (normally within two minutes), CREATE reports the interruption. A task that runs longer than fifteen minutes is also interrupted. Check **Your content** before explicitly starting a new attempt. Restart recovery does not automatically replay your brief or promise that unfinished work will resume. Receipts expire after seven days; the saved activity remains in Your content. If you close the browser tab, find completed drafts in Your content rather than relying on the tab's recovery identifier.

## Independent Studio draft and source Quiz

The **Independent Studio draft** notice explains that Studio edits affect only that activity, not Quiz questions, learning objectives or another draft. **View source Quiz** opens the actual source recorded for the selected draft.

When the source Quiz has changed, CREATE warns you but preserves your Studio edits. Create a fresh draft if you need the latest Quiz content; nothing is silently merged or overwritten. Older drafts without a recorded source revision are labelled as unverified. If the source Quiz was deleted, the independent activity can still be edited and downloaded.


## Find Studio activities from a course

The course page now includes **H5P Studio activities**. It lists the most recent 200 activities already linked to that course. **Continue in Studio** opens the same activity for further editing; it does not copy the content or call AI. **Course source** opens the source learning object's Review tab when that source still exists.

Each card identifies a **Separate Studio version**. Studio saves currently do not update guided course questions, coverage or course exports. Use Studio's own preview and download for that native version. Activities created without a course association remain in the global Studio inventory; matching titles do not link them automatically. If the list cannot load, choose **Try again**; a failed request does not mean the course has no activities.

## Use course materials: course and teaching task

Older saved course-assistant tasks reopen here through **Resume saved course task**. New authoring starts in the unified **Create with AI** form; choose **Use a course** to include selected evidence in a separate native Studio draft, or choose **Build linked course questions** after selecting a Learning Object to continue with the assistant's reviewed plan. That linked path creates normalized questions in Review and a Column Studio draft. The main Learning Object **Generate Questions** workflow is another route to normalized course questions.

In **Course & materials**, choose a **Course** and **Learning Object**, or choose **Create a new Learning Object**. **New course → Create course** creates a course with one empty Learning Object that the assistant can reuse. The course also appears in the normal sidebar.

Use **Upload PDF or DOCX**, or select materials already in the course. Their labels reflect actual processing: **Waiting to process**, **Processing**, **Ready**, or **Processing failed**. Upload completion alone does not mean indexing is finished. Planning requires every selected material to be Ready. **Refresh materials** checks the current state; **Retry processing** retries a failed file. You can clear a selected file if you do not want it included. A task accepts up to 20 materials.

Enter **Teaching task** with the audience, learning goal, intended sequence, required scenarios and exclusions. Choose **Plan learning objectives & questions**. The assistant retrieves the selected course evidence, reuses existing objectives when available, and fills missing planning steps. The resulting learning objectives and question Blueprint are saved to the linked Learning Object. **Open course**, **Learning objectives**, and **Review saved questions** lead to those same records; you do not need to recreate them in another workflow.

The assistant uses a **Column** layout and only the question types listed in its **Question type** menu. It does not provide every native H5P capability. For example, a Documentation Tool cannot contain scored multiple-choice pages or collect answers from separate activities into one Word document. An unsupported request must be revised before generation. An existing Learning Object containing types incompatible with Column is not silently converted or stripped of those questions.

## Review and approve an assistant question plan

At **Needs your approval**, inspect **Learning objectives**, their **Source evidence**, and the **Question plan**. Edit objective wording and each row's **Row title**, **Question type**, **Number of questions**, **Question instructions**, and **Linked learning objectives**. Each row links to one objective. A task supports up to eight objectives, eight plan rows and twenty new questions in total. Counts refer to actual questions, not separate Studio packages.

**Save plan** saves edits into the same course workflow. **Discard plan edits** restores the last received saved plan. Unsaved edits are kept while checking task status; if another tab changed the saved revision, CREATE requires you to review the current plan before saving over it. Save edits before refreshing or leaving the assistant.

**Approve & generate questions** first saves the current edits, then explicitly approves question generation. A failed plan save does not approve an older plan. The checked questions are appended to the Learning Object at the end of the attempt, even if another item fails after its automatic rework. Existing saved questions are preserved.

## Watch assistant question progress and open the Studio draft

**Question progress** connects to live generation updates and shows each question moving from waiting, through drafting and validation, to prepared. While the model is writing, **Live AI draft** displays its incoming text; this text is provisional and can be reset when CREATE automatically revises a rejected attempt. The connection label reports whether live updates are connected. If that connection drops, the saved task continues on the server and periodic status checks remain active; do not start a duplicate task. **Check status** reads the durable task record without repeating generation.

When questions become ready, **Question preview** renders the actual prepared H5P content. This preview is temporary and cannot edit the source records. Prepared questions become saved course questions when the attempt finishes; failed items do not prevent checked questions from being saved. The live text is progress feedback only; the validated saved question and H5P preview remain the authoritative result.

After the batch is saved, the assistant prepares one combined Column H5P activity containing the Learning Object's existing and newly appended questions. Choose **Edit activity** to open the official Studio editor, or **Preview activity** to view its saved student experience. New results do not automatically switch your open editor. The native Studio draft is an independent version: advanced Studio edits do not rewrite course questions, objectives or the Blueprint.

You can leave an older assistant task while generation runs and use other Studio features. Return through its saved task link and **Resume saved course task** to check it; leaving does not cancel or replay the task.

## Recover an AI assistant task

The assistant saves its task and teaching brief on the server under the signed-in instructor. **Recent tasks** lists that instructor's recent sessions, and the task URL can reopen the saved session after a refresh. The browser's pending-request recovery stores only an opaque identifier, not teaching instructions.

**Check status** reads the existing task without submitting another AI request. If the initial planning submission loses its response, **Retry same request** explicitly resends the original request identifier and the in-memory original brief. The server treats matching retries as one task. After a refresh, fill in the original course, materials and teaching task before using this action; if a saved request already exists with different instructions, CREATE recovers that task instead of treating the changed instructions as a new request. A request is not automatically retried just because the network disconnects.

If planning is **Failed** or **Interrupted**, **Retry planning** explicitly starts planning again, reusing the current course objectives where available. If question generation fails before publication, **Retry question batch** reuses confirmed prepared candidates when the course and approved generation contract are unchanged, then regenerates the remaining questions using additional model credits; the earlier course questions remain intact. A partial result saves the checked candidates. Retrying the unchanged plan fills the unfinished slots without duplicating the checked questions.

If questions were already committed but the final H5P package could not be prepared, the assistant says the questions are saved and offers **Retry Studio draft**. This retries package preparation using the saved questions, without generating duplicate questions. Check the actual status message before retrying.

When the selected materials or linked Learning Object change, the previous plan may no longer be safe to approve or retry. Review the current course and choose **New task** for an updated plan. If local plan edits are still open, save them or choose **Discard plan edits** first. CREATE does not overwrite an independent Studio activity to update it from a changed course.
