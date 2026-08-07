# H5P Studio

H5P Studio provides advanced authoring with H5P's official semantics-based editor. It is useful when the normal Review & Edit fields do not expose a content type's full H5P configuration.

## Open a Learning Object in H5P Studio

In **Review & Edit**, choose **Advanced H5P Editor**. CREATE converts the Learning Object to a native H5P document, saves it through the same Lumi storage used by the official editor, and opens it in H5P Studio. This copy becomes an independent H5P draft, so later question changes in Review & Edit are not automatically merged into it.

If an H5P draft already exists, CREATE asks whether to **Open existing draft** or **Create fresh draft**. Opening preserves its advanced manual edits. Creating fresh converts the current questions and Learning Objectives into a separate Studio draft without deleting or overwriting the earlier one. CREATE marks an existing draft as potentially out of date when the Learning Object, one of its questions, or one of its Learning Objectives changed after the draft source revision was saved.

## Create new H5P content

Open **H5P Studio** from the sidebar and choose **New content**. Select one of the H5P content types installed in CREATE, complete the required title and fields, and choose **Save**. The editor fields come from the selected library's H5P semantics.

## Upload an H5P package

Choose **Upload .h5p** to import an existing package. Instructor uploads may use libraries that are already installed and reviewed in CREATE. Packages that require missing or unreviewed executable libraries are rejected; ask a CREATE administrator to validate and install the required libraries first.

## Preview and download

After saving, choose **Preview** to run the activity or **Download** to obtain a standard `.h5p` package. Choose **Back to editor** to continue authoring. If Preview is opened while the H5P runtime is still starting after a server restart, CREATE waits for that shared runtime instead of returning a broken preview.

The **Preview** button in Review & Edit does not create a Studio draft. It renders the selected H5P format from the current CREATE questions through the same native document builder used by H5P Studio. A Learning Objective filter intentionally previews only that subset.

## Important editing boundary

H5P Studio stores the complete native H5P document. Advanced changes are not converted back into CREATE's normalized question records. Continue editing that advanced copy in H5P Studio and export it from there.

## Content type availability

H5P Studio can author locally installed, open H5P libraries. H5P.com premium or server-backed multiplayer activities are not made available merely by embedding the editor.

CREATE's AI workflow can also generate **Guess the Answer** as a native `H5P.GuessTheAnswer 1.5` activity inside Column or Interactive Book. After generation, choose **Advanced H5P Editor** to fine-tune the official reveal label, answer, and other library fields in H5P Studio.
