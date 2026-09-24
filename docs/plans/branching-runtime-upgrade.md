# Branching Scenario runtime recovery

Status: the compatible runtime upgrade is implemented on 2026-09-20. Automated
asset, native save/reopen, package and real JavaScript execution checks pass.
Browser acceptance is recorded separately in the current QA artifacts. No
independent Moodle/WordPress host certification is claimed.

## Selected official versions

The application uses actual matching browser core/editor files, not a changed
version declaration over old code. Lumi remains on its existing server package;
its explicit `coreApiVersion` is 1.28 and `h5pVersion` is 1.28.0. The upstream
release tag for the paired assets is `moodle-1.28.2`.

| Component | Version/ref | Exact upstream commit |
| --- | --- | --- |
| [Core](https://github.com/h5p/h5p-php-library/tree/moodle-1.28.2) | moodle-1.28.2 | `1edc95dc65581be53fe83f772fb2767249876fb0` |
| [Editor core](https://github.com/h5p/h5p-editor-php-library/tree/moodle-1.28.2) | moodle-1.28.2 | `73dfed6073b8916faa7e8b1a5fca5adb2bde5dc4` |
| [Branching Scenario](https://github.com/h5p/h5p-branching-scenario/tree/1.10.1) | 1.10.1 | `6860e97e916054c09e9f2c4bb824ca958521213a` |
| [Retained Branching Scenario](https://github.com/h5p/h5p-branching-scenario/tree/82efbae93680d4609bd98bd8f00f4b5173143089) | 1.9.2 version-bump commit | `82efbae93680d4609bd98bd8f00f4b5173143089` |
| [Branching editor](https://github.com/h5p/h5p-editor-branching-scenario/tree/1.5.13) | 1.5.13 | `8fcd92d0a5a5f6b855d9d03ce4d19ab31baa4b99` |
| [Course Presentation](https://github.com/h5p/h5p-course-presentation/tree/1.27.25) | 1.27.25 | `e1de9c2b632dd5e081bf44101b9a3c1f001cfb18` |
| [Interactive Video](https://github.com/h5p/h5p-interactive-video/tree/1.28.37) | 1.28.37 | `bcfa06d2b057cddc583fb922a75038981084be62` |
| [Course Presentation editor](https://github.com/h5p/h5p-editor-course-presentation/tree/b0097e02b8b2fcd88d5f4b9ab5d3bd67f67fa788) | 1.26.6 version-bump commit | `b0097e02b8b2fcd88d5f4b9ab5d3bd67f67fa788` |
| [Interactive Video editor](https://github.com/h5p/h5p-editor-interactive-video/tree/205abc173eece12046c4dedbe883ea5835e49151) | 1.26.3 version-bump commit | `205abc173eece12046c4dedbe883ea5835e49151` |
| [Drag and Drop](https://github.com/h5p/h5p-drag-question/tree/1.15.16) | 1.15.16 | `383aaeb169827e921c43eb7ecdcf72f667b95514` |

The official [Branching native package](https://api.h5p.org/v1/content-types/H5P.BranchingScenario)
provides matching Branching Question 1.0.20 and its missing editor 1.0.5. Only
those two directories are installed from that package. Its older Branching
Scenario runtime is not relabelled or substituted for 1.10.1. The matching native
Branching Question descriptor restores the real editor dependencies that the
local descriptor had omitted.

The installed jQuery.ui 1.10.22 CSS identifies itself as jQuery UI 1.13.0. Six
missing referenced icon sprites are restored from the official
[jQuery UI 1.13.0 theme assets](https://github.com/jquery/jquery-ui/tree/1.13.0/themes/base/images).
Neither CSS nor library metadata is changed to hide the missing files.

## Reproducible build and preservation

`routes/create/config/h5p-runtime-manifest.json` records archive SHA-256 values,
source commits, upstream lockfile hashes and installed asset hashes. Browser
bundles for both Branching minors, Branching editor, Course Presentation,
Interactive Video and Drag and Drop were compiled from the selected official
source archives under Node 20.19.0:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

The builds use each upstream lockfile without dependency updates. All declared
JS/CSS, emitted font/image assets, descriptors, semantics, translations and
licenses travel together. Source package manifests are omitted from the
installed library directories to avoid duplicate package names for retained
minor versions in Jest; upstream sources remain reproducible from the pins.
Core/editor release files already include their built browser artifacts.

Older Branching 1.9, Course Presentation 1.26, Interactive Video 1.27 and editor
minors remain installed. No saved activity data is migrated or overwritten.
The core upgrade also makes already installed Column 1.20 and Question Set 1.21
eligible in Studio; normalized Quiz exports retain their older explicit mappings.

CREATE retains three editor fixes: single-option initialization, default-widget
fallback and required-field validation. The core bridge preserves the official
`H5P.jQuery` instance after `noConflict(true)`. Three core files receive only
trailing whitespace/terminal blank-line normalization. These exceptions are
listed in the manifest. Other vendored JavaScript is upstream source/build output.

## Shared runtime and defense against incomplete deployments

`h5pRuntime.js` supplies the real API version, complete core assets and cache
revision to Studio/editor, player and native preview. Fonts/theme CSS are
included both on the editor host and its iframe. Generated and uploaded-package
previews use the official core instead of the former minimal substitute.
Uploaded packages must contain their matching assets; missing files now produce
a clear failure instead of a placeholder or a silently mixed patch.

The runtime guard now checks Branching's actual dependency tree synchronously.
Healthy deployments enable Studio, normalized Standalone and Canvas Mixed
Activity entries. A missing runtime/editor dependency still rejects generation
before model work and rejects broken exports before opening the ZIP output.
Branching remains excluded from Column, Interactive Book and Question Set.

## Automated validation and browser acceptance

- `h5pRuntimeUpgrade.test.js` verifies pinned asset hashes, the recursive
  runtime/editor tree for both Branching minors, every required CSS asset,
  package contents, extracted-package rendering and native Lumi save/reopen.
- A separate Node/JSDOM harness executes the actual official core and both
  compiled Branching bundles without network. It checks one real instance,
  visible start text and preserved branch/end targets. This proves JavaScript
  initialization, not browser layout or every interaction.
- Existing editor-runtime, Studio, adapter, native-document/package, preview and
  library integrity suites cover retained surfaces and unavailable-deployment
  defenses. Missing dependencies are injected in tests rather than assuming
  Branching must always be disabled.
- The focused 14 backend suites passed 143 tests; the frontend capability
  suite passed 9 tests. The HTTP route suite needed permission to bind a local
  test port outside the sandbox. `git diff --check` passes.
- No live model request is needed for acceptance fixtures. The current artifact
  directory is `artifacts/next-phase-2026-09-20/branching-runtime/`.

Import `laboratory-safety.h5p` in Studio. Check the start screen, introduction,
two alternatives and independent feedback/end states. Follow the safe choice,
restart and follow the unsafe choice. Edit/save/reopen, then export/reimport and
repeat. The expected ending titles are **Safe choice** and **Review the safety
check**. Also import `column-1.20.h5p` and `question-set-1.21.h5p`, answer **4**
to the real 2 + 2 question, check feedback and save/reopen. Reopen existing
Documentation Tool and older Question Set content to check the shared-core
change. Browser screenshots and outcomes belong in the live QA report.

Independent host import/playback, old production content with media, and all
possible nested content combinations remain separate acceptance scope. Do not
claim those checks from a passing local package or DOM test.


## Browser acceptance completed on 2026-09-20

The local authenticated application was exercised through the browser after the upgrade:

- Imported the laboratory Branching Scenario fixture, saved it, and followed both alternatives. The safe choice reached its ending; the other choice displayed feedback and reached the distinct review-safety ending. Restart worked.
- Imported Column 1.20 and Question Set 1.21 fixtures. Both accepted the answer 4 to 2 + 2 and scored 1/1; Question Set reached its final Results screen.
- Reopened an existing Documentation Tool, entered a synthetic written response, and verified the native Create document page contained the response.
- Saved the existing Interactive Video QA activity. DOM asset paths confirmed InteractiveVideo 1.28.37; its real six-second MP4 played to the end and the summary interaction reached 1/1.

Screenshots are linked from `artifacts/next-phase-2026-09-20/index.html`. These checks establish the exercised local paths, not exhaustive media/browser coverage or independent LMS interoperability.
