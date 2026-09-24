# H5P Studio

H5P Studio provides advanced authoring with H5P's official semantics-based editor. It is useful when the normal Review fields do not expose a content type's full H5P configuration.

## Open a Learning Object in H5P Studio

In **Preview & Export**, choose **Advanced H5P Editor**. CREATE converts the Learning Object to a native H5P document, saves it through the same Lumi storage used by the official editor, and opens it in H5P Studio. This copy becomes an independent H5P draft, so later question changes in Review are not automatically merged into it.

If an H5P draft already exists, CREATE asks whether to **Open existing draft** or **Create fresh draft**. Opening preserves its advanced manual edits. Creating fresh converts the current questions and Learning Objectives into a separate Studio draft without deleting or overwriting the earlier one. CREATE marks an existing draft as potentially out of date when the Learning Object, one of its questions, or one of its Learning Objectives changed after the draft source revision was saved.

## Create new H5P content

Open **H5P Studio** from the sidebar and choose **New blank activity**. Select one of the H5P content types installed in CREATE, complete the required title and fields, and choose **Save**. The editor fields come from the selected library's H5P semantics.

When **Your content** contains many activities, scroll inside that list to find an older activity. The list does not push the editor down an increasingly long page.

## Upload an H5P package

Choose **Import .h5p** to import an existing package. Instructor uploads may use libraries that are already installed and reviewed in CREATE. Packages that require missing or unreviewed executable libraries are rejected; ask a CREATE administrator to validate and install the required libraries first.

## Preview and download

Choose **Preview** to run an unchanged saved activity. After an edit, the button becomes **Save changes & preview**: CREATE validates and saves the changed content before opening it. If the serialized editor content still matches the saved version, CREATE skips the write, does not change the Edited time and opens the saved preview without a save notification. **Download** performs the same change check before obtaining a standard `.h5p` package; in preview mode it downloads the saved version. Choose **Back to editor** to continue authoring. If Preview is opened while the H5P runtime is still starting after a server restart, CREATE waits for that shared runtime instead of returning a broken preview.

The preview in **Preview & Export** does not create a Studio draft. It renders the selected H5P format from the current CREATE questions through the same native document builder used by H5P Studio. A Learning Objective filter intentionally previews only that subset.

## Important editing boundary

H5P Studio stores the complete native H5P document. Advanced changes are not converted back into CREATE's normalized question records. Continue editing that advanced copy in H5P Studio and export it from there.

## Content type availability

H5P Studio can author locally installed, open H5P libraries. H5P.com premium or server-backed multiplayer activities are not made available merely by embedding the editor.

CREATE's AI workflow can also generate **Guess the Answer** as a native `H5P.GuessTheAnswer 1.5` activity inside Column or Interactive Book. After generation, choose **Advanced H5P Editor** to fine-tune the official reveal label, answer, and other library fields in H5P Studio.

## Create with AI

**Create with AI** is one creation form. First choose **One activity** or **Question collection**. For a collection, choose an illustrated **Column**, **Question Set**, or **Interactive Book** layout. The illustrated question-type cards allow multiple selections: choose one type for several questions of that type, or several types for a mix. Leave all cards unselected to let AI choose compatible types. Write **Teaching instructions**, including an exact total or quantities per type if needed. AI proposes a type-and-count plan that includes every selected type. Review and edit each count before choosing **Generate AI draft**. A collection can contain at most eight generated items. The saved native H5P draft opens in the official editor.

**Add course evidence** is optional. Choose **Use a course** to select or create a course and Learning Object, upload PDF/DOCX materials, select already processed materials, generate Learning Objectives from those materials, and choose up to eight existing objectives. Review or edit objective wording in the course Learning Objectives tab. A single activity may use several selected objectives; AI is asked to combine their concepts. Selected processed material excerpts and selected objective text are sent as bounded context for planning and drafting. Wait until selected materials say **Ready**.

**Teaching instructions** are required for **Use my instructions**. If you choose **Use a course**, select at least one ready material or learning objective; then you may leave Teaching instructions empty. CREATE uses a general evidence-grounded request, which you can refine before generating. A short, unfinished instruction still needs at least ten characters or can be cleared to use the course evidence. When an action is greyed out, **To continue** below the generation button and nearby guidance explain which selection, evidence, plan, or instruction is missing.

**Prompt helper** sits beside **Teaching instructions** in both One activity and Question collection. It opens a floating conversation, remembers it in this browser tab, and knows your current type, layout, selected question types, selected learning objectives and material names. It does not read full course files in this chat. Ask it what context it has, discuss goals, or answer its follow-up questions without generating a prompt. When it has enough information, it may offer **Yes, generate prompt** and **Not now**; choosing Not now keeps the conversation going. A clear instruction to create an activity or write a prompt can generate one immediately. Once generated, the editable prompt has **Use this prompt** to fill Teaching instructions and **Copy prompt** to copy it in one click for pasting elsewhere. Copying does not start generation or change the Teaching instructions field.

One activity can use any available installed native H5P type, including types that need a saved media template. Collection plans use only question types supported by the chosen H5P container. AI currently plans at most eight native collection items per request; if a larger quantity is needed, create multiple drafts or use the main Learning Object workflow. CREATE checks the generated collection against the approved type and count plan and makes one repair attempt before rejecting a mismatch.

The former **Use course materials** and **Quick activity** tabs are merged into this form. A Studio draft linked to a course appears with that course's Studio activities, but native H5P edits and generated items do not automatically create or replace CREATE Question records or alter the Review question count. When a course and Learning Object are selected, choose **Build linked course questions** to carry your task and selected materials into the course assistant. There, review its Learning Objectives and plan before generating normalized Question records and a Column Studio draft. The regular course **Generate Questions** tab also remains available for this purpose. A native AI draft does not replace or update Quiz questions.

The creation brief and selected plan remain in this browser tab when you return from the editor or refresh. Older in-progress assistant sessions can still be resumed from a saved task link. **New blank activity** and **Import .h5p** remain secondary manual-authoring actions.

The former **Create a draft** step bar has been removed. Edit the selected activity in the official editor, then use **Preview** or **Save changes & preview**, **Back to editor**, and **Download**. There is no extra draft step to complete.

## Quick activity

Choose **Create with AI → One activity**, or **Explore AI activities** in a Quiz's Generate Questions page. This beta builder uses installed H5P semantics to create native activity parameters, rather than the smaller set of normalized Quiz question types.

A new **Quick activity** draft does not replace your Quiz questions. The generated activity is a separate Studio draft. It does not overwrite its source Quiz or template, add rows to the Quiz Blueprint, change Quiz question counts, or inherit Quiz evidence/coverage links. Continue editing and downloading the native activity in Studio. The ordinary Quiz flow remains the better choice for evidence-linked question sets and PDF/Markdown/Canvas exports.

1. Search **Find a type**, choose an illustrated card or use **Activity type** to browse installed types such as Chart, Timeline, Questionnaire, or Summary. Collection layouts have their own visual cards.
2. Enter **Teaching instructions**: audience, learning goal, source facts and preferred feedback. **Prompt helper** can draft and refine this text through conversation; choose **Use this prompt** or **Copy prompt** when it is ready. If you select course materials or objectives, Studio includes only those selected sources as context and you may leave Teaching instructions empty. Without selected course evidence, generation requires your brief and optional template.
3. Choose **Generate AI draft**. CREATE generates and validates it. The model can make one automatic repair attempt within this request. An invalid draft is not saved; your brief stays available on the current page so you can revise it and retry.
4. The saved **AI draft · Needs your review** opens in the official editor. Check accuracy, answers, accessibility and layout. Choose **Save changes & preview**, try the student interaction, then **Download** the `.h5p` package.

## Return to Quick activity

Returning from the editor to **Create with AI** restores the creation shape, layout, activity type, **Teaching instructions**, selected course evidence, reviewed question plan, search and saved-activity selection in the same browser tab. These settings survive refresh and are kept separately for each activity and signed-in author. After generation, the new activity is selected as the saved starting point so you can extend your instructions and generate a separate revision. Save manual editor changes before returning if you want the next revision to include them.

The brief is stored in this browser tab, not permanently on the server. A different browser or a closed tab may not retain it. Older activities without a retained brief still select their type and saved activity automatically, but CREATE cannot reconstruct instructions that were never saved.

If you explicitly selected **Create a new activity**, returning to your saved brief keeps that selection. It does not substitute the activity currently open in the editor as a template, especially when that activity has a different type.

For **Documentation Tool**, the official editor should show **Elements** below **Heading**, including page types and **Add page**. A form showing only Title and Heading has not loaded correctly; refresh to get current editor assets. Standard pages support text and input fields, with a Document Export Page for exporting written responses. Multiple-choice quizzes are not a native page type inside Documentation Tool. If a brief asks for both Documentation Tool and multiple-choice questions, Create with AI blocks generation and suggests Question Set or Column. If the activity must export written responses to Word, keep Documentation Tool and revise the multiple-choice step to a written response. A Question Set or Column does not provide a combined Word export of learner answers.

New Documentation Tool AI drafts use a focused page structure for reading text, response fields and document export. CREATE checks the required pages and can ask the model to repair an incomplete result once. A title and heading alone are not accepted as a complete AI activity. Check the actual page contents and export interaction in Preview; structural validation cannot prove the activity meets every teaching instruction.

## AI media templates and availability

**Prepare a template in the editor** creates an empty saved draft and opens the
selected compatible type directly. It does not call the AI yet.
Add your real media, save it, then return to **Create with AI → One activity** and choose that
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

Types labelled **needs a saved template** require a real prepared activity. Examples include Memory Game, Image Hotspots, Interactive Video and Multimedia Choice. Use **New blank activity**, select that type, upload your actual media and save. Then return to **Create with AI → One activity** and select the activity under **Saved template (required)**. You can also import an owned `.h5p` package as a template.

AI uses the saved template version, creates a separate draft and retains referenced files. It does not create new images, generate speech, watch videos or inspect images. Describe what your media shows in the brief, and inspect timing, hotspot positions and answer mappings in the editor afterward. External embeds still require a valid URL/account and the external service's permission to embed; an AI draft cannot make an unavailable service work.

Types labelled **needs maintenance** have missing compiled runtime files, missing dependencies, a newer H5P Core requirement or a retired external service. Generation is disabled and the explanation appears below the selected type. Branching Scenario is available again after a coordinated runtime, core and editor upgrade. Existing Branching versions are retained. In a new scenario, check every decision, branch destination and ending in the student preview before delivery. **Twitter User Feed** is no longer supported because the Twitter API used by its official H5P component is no longer available; changing your teaching instructions cannot repair it. Course Presentation remains available without using that retired component. The catalogue rechecks installed files; installing an editor alone does not guarantee every type can run.

## Media preview and save troubleshooting

**Preview** and **Save changes & preview** open the student preview using the full Studio workspace width. The activity list is hidden while previewing; choose **Back to editor** to switch activities. The preview height follows H5P as pages, feedback and panels expand or collapse, so long activities scroll with the page instead of being confined to a fixed-height inner window. Supported activities also offer their own fullscreen control.

Compare layout with the [official H5P examples](https://h5p.org/content-types-and-applications). Text, images, card counts and activity settings affect the appearance. A successfully saved activity still needs a visual and interaction check; a minimal test activity is not proof that every layout is correct.

If an image stays blank or a video never loads, save the activity and reopen its preview. The media must belong to the saved activity, and its files must still exist. A preview should load the same uploaded media after returning from the editor or reopening the activity; do not regenerate with AI to fix a missing file.

Image Hotspots accepts positions created by the current official editor. In **Multimedia Choice**, picture options do not require a hidden **Poster image**; audio options do require one. Complete the visible required fields before saving. For **Iframe Embedder**, the target website must allow embedding: an empty external frame may be a restriction of that website. Test with a URL that you control and know permits embedding.

AI drafts are structurally checked, not certified correct. Always test the specific activity and its downloaded package in your target H5P host before teaching with it.

## Recover a Studio generation after refresh or disconnection

If you refresh during Studio AI generation, return to **Create with AI** in the same browser tab. CREATE checks the original request and opens its saved draft when ready. It does not submit another AI generation just because the browser disconnected. The request identifier and your activity brief are retained in this browser tab; the generation receipt on the server does not store your teaching instructions.

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

**Approve & generate questions** first saves the current edits, then explicitly approves question generation. A failed plan save does not approve an older plan. The new questions are appended to the Learning Object only after the whole batch succeeds. Existing saved questions are preserved.

## Watch assistant question progress and open the Studio draft

**Question progress** connects to live generation updates and shows each question moving from waiting, through drafting and validation, to prepared. While the model is writing, **Live AI draft** displays its incoming text; this text is provisional and can be reset when CREATE automatically revises a rejected attempt. The connection label reports whether live updates are connected. If that connection drops, the saved task continues on the server and periodic status checks remain active; do not start a duplicate task. **Check status** reads the durable task record without repeating generation.

When questions become ready, **Question preview** renders the actual prepared H5P content. This preview is temporary and cannot edit the source records. Prepared questions are not yet part of the saved course until every question in the batch succeeds. The live text is progress feedback only; the validated saved question and H5P preview remain the authoritative result.

After the batch is saved, the assistant prepares one combined Column H5P activity containing the Learning Object's existing and newly appended questions. Choose **Edit activity** to open the official Studio editor, or **Preview activity** to view its saved student experience. New results do not automatically switch your open editor. The native Studio draft is an independent version: advanced Studio edits do not rewrite course questions, objectives or the Blueprint.

You can leave an older assistant task while generation runs and use other Studio features. Return through its saved task link and **Resume saved course task** to check it; leaving does not cancel or replay the task.

## Recover an AI assistant task

The assistant saves its task and teaching brief on the server under the signed-in instructor. **Recent tasks** lists that instructor's recent sessions, and the task URL can reopen the saved session after a refresh. The browser's pending-request recovery stores only an opaque identifier, not teaching instructions.

**Check status** reads the existing task without submitting another AI request. If the initial planning submission loses its response, **Retry same request** explicitly resends the original request identifier and the in-memory original brief. The server treats matching retries as one task. After a refresh, fill in the original course, materials and teaching task before using this action; if a saved request already exists with different instructions, CREATE recovers that task instead of treating the changed instructions as a new request. A request is not automatically retried just because the network disconnects.

If planning is **Failed** or **Interrupted**, **Retry planning** explicitly starts planning again, reusing the current course objectives where available. If question generation fails before publication, **Retry question batch** retries the whole approved question batch and may use additional model credits; the earlier course questions remain intact. Prepared candidates from a failed batch are not added individually.

If questions were already committed but the final H5P package could not be prepared, the assistant says the questions are saved and offers **Retry Studio draft**. This retries package preparation using the saved questions, without generating duplicate questions. Check the actual status message before retrying.

When the selected materials or linked Learning Object change, the previous plan may no longer be safe to approve or retry. Review the current course and choose **New task** for an updated plan. If local plan edits are still open, save them or choose **Discard plan edits** first. CREATE does not overwrite an independent Studio activity to update it from a changed course.
