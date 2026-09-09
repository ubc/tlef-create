# H5P Studio

H5P Studio provides advanced authoring with H5P's official semantics-based editor. It is useful when the normal Review fields do not expose a content type's full H5P configuration.

## Open a Learning Object in H5P Studio

In **Preview & Export**, choose **Advanced H5P Editor**. CREATE converts the Learning Object to a native H5P document, saves it through the same Lumi storage used by the official editor, and opens it in H5P Studio. This copy becomes an independent H5P draft, so later question changes in Review are not automatically merged into it.

If an H5P draft already exists, CREATE asks whether to **Open existing draft** or **Create fresh draft**. Opening preserves its advanced manual edits. Creating fresh converts the current questions and Learning Objectives into a separate Studio draft without deleting or overwriting the earlier one. CREATE marks an existing draft as potentially out of date when the Learning Object, one of its questions, or one of its Learning Objectives changed after the draft source revision was saved.

## Create new H5P content

Open **H5P Studio** from the sidebar and choose **New content**. Select one of the H5P content types installed in CREATE, complete the required title and fields, and choose **Save**. The editor fields come from the selected library's H5P semantics.

## Upload an H5P package

Choose **Upload .h5p** to import an existing package. Instructor uploads may use libraries that are already installed and reviewed in CREATE. Packages that require missing or unreviewed executable libraries are rejected; ask a CREATE administrator to validate and install the required libraries first.

## Preview and download

Choose **Save & preview** to save current editor values and run the activity. Validation must succeed before the preview opens. **Download** also saves current editor values before obtaining a standard `.h5p` package; in preview mode it downloads the saved version. Choose **Back to editor** to continue authoring. If Preview is opened while the H5P runtime is still starting after a server restart, CREATE waits for that shared runtime instead of returning a broken preview.

The preview in **Preview & Export** does not create a Studio draft. It renders the selected H5P format from the current CREATE questions through the same native document builder used by H5P Studio. A Learning Objective filter intentionally previews only that subset.

## Important editing boundary

H5P Studio stores the complete native H5P document. Advanced changes are not converted back into CREATE's normalized question records. Continue editing that advanced copy in H5P Studio and export it from there.

## Content type availability

H5P Studio can author locally installed, open H5P libraries. H5P.com premium or server-backed multiplayer activities are not made available merely by embedding the editor.

CREATE's AI workflow can also generate **Guess the Answer** as a native `H5P.GuessTheAnswer 1.5` activity inside Column or Interactive Book. After generation, choose **Advanced H5P Editor** to fine-tune the official reveal label, answer, and other library fields in H5P Studio.

## Create with AI

Choose **Create with AI** in H5P Studio, or **Explore AI activities** in a Quiz's Generate Questions page. The numbered Studio workflow is **Create a draft → Review & edit → Preview & download**. This beta feature uses installed H5P semantics to create native activity parameters, rather than the smaller set of normalized Quiz question types.

1. Search **Find a type** and choose an **Activity type**, such as Chart, Timeline, Questionnaire, Course Presentation, or Summary. The catalogue separates questions/text, lessons/collections, media activities, and external content.
2. Enter **Teaching instructions**: audience, learning goal, source facts and preferred feedback. A Quiz entry point also includes that Quiz's saved objectives and questions as context; it does not retrieve additional course files. Standalone Studio generation uses only your brief and optional template.
3. Choose **Generate AI draft**. Keep the page open while CREATE generates and validates it. The model can make one automatic repair attempt. An invalid draft is not saved; your brief stays available so you can revise it and retry.
4. The saved **AI draft · Needs your review** opens in the official editor. Check accuracy, answers, accessibility and layout. **Save & preview**, try the student interaction, then **Download** the `.h5p` package.

The generated activity is a separate Studio draft. It does not overwrite its source Quiz or template, add rows to the Quiz Blueprint, change Quiz question counts, or inherit Quiz evidence/coverage links. Continue editing and downloading the native activity in Studio. The ordinary Quiz flow remains the better choice for evidence-linked question sets and PDF/Markdown/Canvas exports.

## AI media templates and availability

**Prepare a template in the editor** creates an empty saved draft and opens the
selected compatible type directly. It does not call the AI yet.
Add your real media, save it, then return to **Create with AI** and choose that
saved template. For Dictation, provide and verify the transcript yourself; AI
does not listen to the audio. The builder currently uses Dictation 1.3.9, which
matches CREATE's installed core, rather than the newer incompatible 1.4 library.

An empty template is only a starting point. **Save & preview** stays in the
editor if required fields are missing. Complete the highlighted fields and add
the actual audio, image or video before trying again. A saved empty template
cannot be used to bypass the AI builder's real-media requirement.

Types labelled **needs a saved template** require a real prepared activity. Examples include Memory Game, Image Hotspots, Interactive Video and Multimedia Choice. Use **New content**, select that type, upload your actual media and save. Then return to **Create with AI** and select the activity under **Saved template (required)**. You can also import an owned `.h5p` package as a template.

AI uses the saved template version, creates a separate draft and retains referenced files. It does not create new images, generate speech, watch videos or inspect images. Describe what your media shows in the brief, and inspect timing, hotspot positions and answer mappings in the editor afterward. External embeds still require a valid URL/account and the external service's permission to embed; an AI draft cannot make an unavailable service work.

Types labelled **needs maintenance** have missing compiled runtime files, missing dependencies or a newer H5P Core requirement. Generation is disabled and the explanation appears below the selected type. Ask an administrator to install a complete compatible version and restart the server if necessary. The catalogue rechecks installed files; installing an editor alone does not guarantee every type can run.

AI drafts are structurally checked, not certified correct. Always test the specific activity and its downloaded package in your target H5P host before teaching with it.
