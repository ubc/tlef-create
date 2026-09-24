# H5P Type Compatibility Playbook

This document is the engineering checklist for adding or debugging an H5P
content type in CREATE. It records the compatibility lessons that are easy to
miss when a generated package passes validation but fails in the player,
editor, Lumi, WordPress, or another LMS.

Use this playbook together with:

- `docs/create-supported-question-types.md` for the product compatibility matrix.
- `docs/h5p-lumi-library-troubleshooting.md` for Lumi library-store pollution
  and player-core version problems.
- `src/constants/questionTypeCapabilities.ts` for the frontend source of truth.
- `routes/create/config/h5pLibraryRegistry.js` for vendored library versions.
- `routes/create/config/h5pTypeAdapterRegistry.js` for native adapter metadata.

## Pinned runtime baseline (2026-09-20)

CREATE serves actual official H5P core and editor assets from the matched
`moodle-1.28.2` release (API 1.28). `routes/create/config/h5pRuntime.js` owns the
API declaration, complete core script/style lists and asset revision.
`h5p-runtime-manifest.json` beside it records source commits, build lockfiles,
installed asset hashes and the small CREATE patches. The implementation record
is [Branching runtime recovery](plans/branching-runtime-upgrade.md).

- Branching Scenario 1.10.1 plus editor 1.5.13 requires Course Presentation 1.27,
  Interactive Video 1.28 and their editors. Existing Branching 1.9.2 is retained.
  Branching Question 1.0 also requires its editor widget; stripping its
  `editorDependencies` creates an editor that appears installed but cannot work.
- Branching is a standalone native activity. It remains excluded from Column,
  Interactive Book and Question Set in the normalized question matrix.
- Studio, generated-question previews and uploaded-package previews use the
  same official core. An uploaded package must carry its own matching libraries;
  do not repair its missing bundle using another patch from the local store.
- Official `jquery.js` already assigns `H5P.jQuery` and calls `noConflict(true)`.
  A compatibility bridge must preserve that instance when global `jQuery` is
  absent. Verify initialization by executing real bundles, not just inspecting
  version strings or checking for HTTP 200 responses.
- Both editor host/iframe and player pages need core fonts, theme variables and
  styles. The Lumi package's static core asset list alone is incomplete for this
  release. Keep one shared list and use the same revision query on all surfaces.
- Keep the runtime availability guard and export integrity preflight. Restoring
  the frontend entry does not remove defense against incomplete deployments.

## The four contracts every type must satisfy

Supporting an H5P type is not one conversion function. It requires four
contracts to agree:

1. **CREATE domain contract** — the question schema produced by AI, manual
   authoring, editing, persistence, and API responses.
2. **H5P parameter contract** — the exact nested params expected by the target
   library version.
3. **Container contract** — whether the library is valid as Standalone content
   or as a child of Column, Interactive Book, or Question Set.
4. **Runtime/package contract** — compatible library descriptors, JavaScript,
   CSS, transitive dependencies, metadata, and files are present together.

A type is supported only when all four contracts work in create, save, preview,
export, re-import, and edit flows.

## Start from a known-good reference package

Create the desired activity with an official-compatible H5P editor and download
the `.h5p` file. Treat it as a ZIP archive and inspect:

```bash
reference_dir=$(mktemp -d /tmp/h5p-reference-XXXXXX)
unzip -q reference.h5p -d "$reference_dir"
unzip -p reference.h5p h5p.json
unzip -p reference.h5p content/content.json
```

Record:

- `mainLibrary` and its exact major/minor version.
- The root and nested `library` strings in `content/content.json`.
- The complete params shape, including empty, omitted, and defaulted fields.
- Direct and transitive dependencies in each `library.json`.
- `preloadedJs`, `preloadedCss`, and assets referenced from CSS.
- The upstream patch version and required `coreApi` version.

Do not infer the JSON shape from screenshots or the editor UI.

## Semantics describe authoring, runtime code defines execution

`semantics.json` is necessary but not sufficient. It describes fields for the
editor and sanitizer, while player JavaScript may make stricter assumptions.

Before writing an adapter, inspect both:

```text
routes/create/h5p-libs/<Library-version>/semantics.json
routes/create/h5p-libs/<Library-version>/library.json
routes/create/h5p-libs/<Library-version>/<runtime entry files>
```

Search the runtime for direct property access, `Object.keys`, array methods,
destructuring, and nested `params` access. These reveal shapes that the runtime
assumes even when semantics marks a field optional.

### Empty object is not the same as an omitted optional field

This caused the initial `H5P.GuessTheAnswer 1.5` failure.

The generated params contained:

```json
{
  "media": {}
}
```

The runtime checked whether `media` existed and then evaluated:

```js
Object.keys(params.media.params)
```

Because `media` was truthy but `media.params` was undefined, rendering failed
with `Cannot convert undefined or null to object`.

The safe no-media representation is to omit `media` entirely. If media is
present, supply the complete library wrapper:

```json
{
  "media": {
    "library": "H5P.Image 1.1",
    "subContentId": "<uuid>",
    "params": {
      "file": { "path": "images/example.png", "mime": "image/png" },
      "alt": "Description"
    }
  }
}
```

General rule:

- Omit optional groups or libraries when unused.
- Do not emit `{}`, `null`, or `[]` merely to mirror a semantics field.
- When a nested library is used, provide its entire `{ library, params,
  subContentId, metadata? }` contract.
- Verify this behavior against runtime code and a known-good package.

## Adapter boundary

New native types should use an isolated adapter under:

```text
routes/create/services/h5pTypeAdapters/
```

The adapter should:

- Accept CREATE's normalized question object.
- Escape user-controlled HTML where the H5P field permits markup.
- Apply stable defaults only when the target library accepts them.
- Omit unused optional groups.
- Return the exact H5P `library`, `params`, `subContentId`, and metadata shape.
- Avoid changing the legacy converter for unrelated types.

Register the adapter and capability together. Audit these surfaces:

1. `src/constants/questionTypeCapabilities.ts`
2. Frontend generation, manual add, edit, review, and interactive rendering
3. Backend constants and Mongoose schemas
4. LLM output prompt and response validation
5. `h5pTypeAdapterRegistry.js` and the adapter implementation
6. `h5pLibraryRegistry.js`, dependencies, preview, and export
7. PDF, Markdown, and Word exports where applicable
8. CREATE Guide and compatibility documentation

## Library and asset integrity

Every `preloadedJs` and `preloadedCss` path declared by `library.json` must
exist. CSS-referenced fonts, images, and other assets must also be vendored.

Common failures:

- A library descriptor was copied without its compiled `dist/` bundle.
- A newer `library.json` was combined with an older JavaScript patch.
- A transitive dependency is absent from the package or registry.
- Content JSON references `H5P.Column 1.20` while only Column 1.18 is packaged.
- Editor-only `H5PEditor.*` libraries are incorrectly treated as player
  dependencies.
- The server returns a JSON 404 body for a JavaScript or CSS URL, causing MIME
  type errors in the browser.

Never lower `coreApi` in `library.json` to bypass validation. Metadata changes
cannot make newer runtime code compatible with an older H5P core.

## Container compatibility

Do not assume a valid standalone library is valid in every container.

- **Column** accepts only child types listed by its semantics and supported by
  its runtime.
- **Interactive Book** normally contains Columns, so child compatibility is
  constrained by both Interactive Book and Column.
- **Question Set** accepts a narrower list of scored question libraries.
- **Standalone** requires the question library to become `mainLibrary`; it is
  not a fallback for arbitrary container-only types.

Keep CREATE's delivery matrix, backend registry, container builder, and help
documentation aligned.

## Save success is not render success

Lumi accepting and saving a native document proves that metadata and semantics
validation passed. It does not prove that the browser runtime can instantiate
the library.

Test each layer separately:

1. Adapter returns the intended params.
2. Native document builder embeds those params in the intended container.
3. Lumi saves and reloads the document without changing its shape.
4. Preview loads all JS/CSS with correct MIME types.
5. `H5P.newRunnable()` creates the real activity rather than a placeholder.
6. Interaction works: reveal, submit, retry, navigation, resize, and media.
7. Exported `.h5p` opens in Lumi and at least one independent H5P host.
8. Imported content reopens in the official editor and can be saved again.

## Keep generated Preview, Studio, and Download on one document contract

CREATE has three surfaces for generated H5P content: the Review & Edit Preview,
an editable H5P Studio draft, and the downloaded `.h5p` package. All three must
start from `buildNativeH5PDocument()`. Do not add a second question-to-H5P
converter inside a preview controller or React component.

The shared builder contract is the generated document's root `library`, exact
`parameters`, and `metadata.preloadedDependencies`. The Preview renderer should
instantiate that root runnable directly, resolve only its player dependencies,
and fail explicitly when a declared asset is missing. It must not silently
replace a failed activity with a different representation.

The three results are semantically equivalent but are not the same persisted
object:

- **Preview** is temporary and does not save editor changes.
- **H5P Studio** creates or reuses an independent editable draft. Later changes
  to the Learning Object do not overwrite that draft.
- **Download** packages a fresh native document for another H5P host.

Do not promise byte-identical output. Generated subcontent IDs and package
metadata may differ between builds even when the source content is unchanged.
Test the root library, parameters, dependency graph, and runtime behavior
instead.

## Required automated tests

At minimum, add or update:

- Adapter registry coverage for type metadata and container support.
- A converter test asserting the exact required and omitted params.
- Native document tests for container nesting.
- Lumi save/reload tests.
- H5P library asset-integrity tests.
- Package tests that inspect `h5p.json` and `content/content.json`.
- CREATE Guide retrieval tests when the visible type catalogue changes.

Automated JSON tests cannot replace a browser runtime smoke test. For a newly
supported type, add a Playwright path that opens Preview, waits for the real H5P
root class, performs the primary interaction, and fails on console errors.

## Common browser errors

| Symptom | Likely cause | First check |
|---|---|---|
| `Cannot convert undefined or null to object` | Empty or malformed nested params | Runtime line in the named library and generated `content.json` |
| `Cannot read properties of undefined (reading 'extend')` | H5P core/editor scripts loaded out of order | Core bootstrap order and duplicate `window.H5P` initialization |
| `window.H5P.init is not a function` | Player core missing, overwritten, or version-mismatched | Network order and resolved core assets |
| JS/CSS 404 followed by JSON MIME errors | Asset route returned an API error envelope | Requested library path versus `library.json` |
| Placeholder instead of activity | Child constructor failed or dependency API is absent | Earlier console error and transitive libraries |
| Endless editor loading | Editor initialization rejected before ready callback | Network errors, editor bootstrap, and API response payload |
| Preview works but exported package fails | Preview used local libraries not included in `.h5p` | ZIP contents and `h5p.json` dependencies |
| Old packages break after a new Lumi import | Lumi's global library store was polluted | Installed patch versions in Lumi's library directory |

## Definition of done for a new H5P type

### Native Studio acceptance lessons (September 2026)

- Ordinary groups with exactly one child are **flattened** in H5P parameters.
  The synthetic root parameters object and `isSubContent` groups are exceptions.
  Apply this rule consistently to JSON Schema, parameter validation, and media
  discovery. Interactive Book chapter entries are native library objects, not
  `{chapter: ...}` wrappers. Image Slider has the same pattern.
- Pass an absent single-child group through to its child before inventing an
  empty object. Otherwise optional `overallFeedback` becomes an invalid list.
- The official editor can emit `{params: {}}` for an unselected optional library,
  and null for an optional color. These are empty choices, not unknown libraries
  or invalid text. Continue rejecting explicit unapproved library names.
- Optional groups propagate optionality to their children. Native optional
  selects may retain a `-` placeholder. The video editor adds an empty subtitle
  row; discard the unused row at the editor-save boundary without relaxing the
  AI's file allowlist. Wait for nested semantics/assets before enabling Save:
  Lumi's root loaded event alone is too early for some composite types.
- `dynamicCheckboxes` selections are indexes, not a static enum. Validate their
  syntax and their references to existing drag elements/drop zones.
- Semantics alone do not guarantee runtime safety: DragQuestion 1.14 reads
  `tipsAndFeedback.tip` even when the group is omitted. Supply an empty group.
  Conversely, GuessTheAnswer cannot handle an invented empty media group.
- Avoid initializing the same nested library twice when the selector has only
  one choice. If an optional editor widget is missing, use the known default
  widget constructor, not a property on the uninitialized widget instance.
- Lumi serves core/editor assets with a one-year cache lifetime. When patching
  vendored editor code, update `H5P_RUNTIME_REVISION` in `config/h5pRuntime.js`
  for both the host page and editor iframe; do not mislabel the upstream API
  version just to invalidate a browser cache.
- A media round-trip test must delete its original **test** template before
  exporting the derived draft; otherwise a stale source-file reference can hide
  behind files that still exist on the test server.
- `e2e/h5p-type-matrix.spec.ts` exercises fixed AI completion → production
  validation → native save/import → official editor → save/preview → export →
  reimport. These synthetic fixtures do not prove live AI quality, every nested
  combination, or acceptance by an independent LMS. External embeds and gated
  libraries need separately authorized acceptance and must not be counted as
  passing local compatibility tests.

A type is complete only when all answers below are yes:

- Can AI generation produce a validated CREATE question?
- Can an instructor add and edit it manually?
- Can Review & Edit render a useful CREATE-native preview?
- Does the adapter produce runtime-safe H5P params?
- Does it work in every advertised container and nowhere unsupported?
- Can Lumi save, reload, preview, and export it?
- Does the exported package open in an independent H5P host?
- Are all declared libraries and assets packaged at compatible versions?
- Do empty optional fields, rich text, special characters, and missing media
  behave safely?
- Do automated tests and a browser interaction smoke test pass?
- Are the capability matrix, user help, and developer docs updated?

If any answer is no, advertise the type as experimental or keep it out of the
user-facing compatibility matrix.
