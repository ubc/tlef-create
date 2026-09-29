# Bugs & Lessons Learned

## H5P Export

### Add new standalone content types to `standaloneTypes`
**File**: `h5pExportService.js`
**Failure**: Export wrapped the new type in `H5P.Column`, so `mainLibrary` became `H5P.Column` and Lumi could not recognize the intended type.
**Rule**: Add every new standalone H5P type to the `standaloneTypes` allowlist.

### Do not package `library.json` `editorDependencies` in exports
**File**: `h5p-libs/*/library.json`
**Failure**: The `.h5p` package included editor libraries (`H5PEditor.*`), which Lumi could not find and reported as `install-missing-libraries`.
**Rule**: Set `editorDependencies` to `[]` in the local `library.json`; the player does not need editor libraries.

### Match `coreApi` to the installed H5P core
**File**: `h5p-libs/*/library.json`
**Failure**: A library declared `coreApi: 1.28` while the server ran core `1.27`, producing `api-version-unsupported` during export.
**Rule**: A local library's `coreApi.minorVersion` must not exceed the running core version.

---

## H5P BranchingScenario

### Keep `nextContentId` aligned with `h5pContent[]` indexes
**File**: `h5pExportService.js`
**Failure**: Mapping nodes without sorting by `index` made `nextContentId` point to the wrong item and caused endless branch loops.
**Rule**: Apply `.sort((a, b) => a.index - b.index)` before export so each array index matches `node.index`.

### Identify the intro node by `node.index === 0`
**Files**: `h5pExportService.js`, `BranchingScenarioTreeView.tsx`
**Failure**: The LLM sometimes returned `question: null` for leaf nodes. Treating those as intro text misidentified them as AdvancedText, hard-coded `nextContentId` to 1, and caused a loop.
**Rule**: Only `index === 0` is the intro text node; do not use `node.question === null` for this check.

### `nextContentId: -1` ends a branch; `nextContentId: 0` loops to the intro
**File**: `llmService.js`
**Failure**: The LLM sometimes used `0` instead of `-1` to end a branch. H5P then returned to the intro indefinitely, and the tree view showed an "Introduction" terminal node.
**Rule**: During post-processing, redirect alternatives with `nextContentId === 0` or a target node with `question: null` to `-1`.

---

## Mongoose

### Mongoose strict mode silently drops undeclared fields
**File**: `models/Question.js`
**Failure**: `content.introText` and `content.nodes` were absent from the schema, so Mongoose silently dropped generated data during save.
**Rule**: Declare every content field for a new question type in the `content` subdocument schema.

---

## H5P Core

### `getVerifiedStatementValue` must create intermediate objects
**File**: `h5p-core/h5p-core.js`
**Failure**: `setObject` set only `statement.object` and did not initialize `definition`; later access to `statement.object.definition.*` raised a TypeError.
**Rule**: While traversing keys, `getVerifiedStatementValue` must create `{}` for undefined intermediate values instead of returning immediately.
