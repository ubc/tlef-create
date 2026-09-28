# CREATE H5P maintenance workflow

## Inspect and decide

Use the repository root; do not hardcode another developer's home directory. Read `AGENTS.md`, `git status --short`, and diffs overlapping proposed changes. Current boundaries:

- `routes/create/h5p-libs/<machineName>-<major>.<minor>/`: runtime assets. Patch updates replace a directory; minor updates coexist.
- `routes/create/config/h5p-runtime-manifest.json`: source archives/commits, transforms and installed file SHA-256.
- `routes/create/config/h5p-library-lock.json`: dependency graph, content digests, core/editor digests.
- `routes/create/config/h5p-studio-targets.json`: named target types and `editorOnly` scope. The initial 54 are the public h5p.org showcase, including its three featured types. Audio is an existing extra; retired Twitter is not a usable type.
- `h5pStudioCatalog.js`: discovers library descriptors/semantics, selects usable versions, checks complete dependency closure. `lumiService.js` filters the native Hub selector through that catalog.
- `h5pEditorController.js` filters manual-only types out of `/ai/catalog`; `h5pStudioAIService.js` rejects them before calling an LLM. Existing adapters and `questionTypeCapabilities.ts` describe a separate AI/export contract.

Use a supported Node runtime for the installed npm/Playwright versions. Node 22.22.3 was used for the September 2026 expansion; discover the user's runtime instead of copying a machine-specific PATH.

```sh
python3 scripts/h5p/maintain.py inventory --out /tmp/create-h5p-inventory --verify-lock
node scripts/h5p/audit-studio.mjs
```

Inspect pre-existing failures without erasing them by regenerating a baseline. Never read `.env` or credentials for a library inventory.

## Download and prepare

Prefer `https://hub-api.h5p.org/v1/content-types/<machineName>` (the package endpoint). Consult the official [registry](https://github.com/h5p/h5p-registry/blob/main/libraries.json) for exact names and original authors; GitHub operations use the repository's gh guidance. A public title is not necessarily a machine name.

```sh
python3 scripts/h5p/maintain.py prepare --library H5P.Flashcards --out /tmp/create-h5p-candidate
```

Use a new output directory for each candidate. Inspect `plan.json`, including blockers, changed shared dependencies, preserved versions, affected runnable libraries, and content-migration review. A download/update is not acceptance. When using an official example package or a source build, pass `--package /tmp/reviewed.h5p` and record the actual URL/commit, archive hash, reviewed build commands, lockfile hash, and installed hashes in the candidate provenance. Update candidate metadata hashes consistently; never mislabel a local build as a Hub release.

The tool safely unpacks ZIP64, rejects traversal/symlinks, validates JS/CSS plus CSS resources, and refuses requirements above the core API. It retains same/newer installed patches. Audit retained local patches: a greater upstream version does not automatically include a CREATE fix.

## Apply and verify

Use a disposable checkout when available. A user-authorized direct change is also possible after checking overlapping changes; `apply` checks the exact base and candidate hashes and rolls back its own partial writes on error.

```sh
python3 scripts/h5p/maintain.py apply --candidate /tmp/create-h5p-candidate --allow-worktree-write
python3 scripts/h5p/maintain.py inventory --out /tmp/create-h5p-after --verify-lock
node scripts/h5p/audit-studio.mjs
python3 -m unittest discover -s tests/h5p-maintenance
node scripts/h5p/test-backend.mjs
node scripts/h5p/verify-editor.mjs /tmp/create-h5p-browser
node scripts/h5p/verify-manual-save.mjs /tmp/create-h5p-browser-save
npm run build
```

For a batch, merge candidates in staging sequentially so each sees preceding dependencies. Produce a combined plan against the original base with per-directory sources and use the same `apply` safeguards. Re-run inventory after browser-driven fixes and refresh only the hashes whose changes were reviewed.

`verify-editor.mjs` uses actual CREATE Lumi configuration, native scripts and AJAX router, an unprivileged author, fresh temporary content storage, Chromium, and an ephemeral localhost port. It checks all target types in the browser selector, opens every target form, waits for nested assets, rejects browser exceptions/HTTP failures, checks the three CREATE icon patches, and writes JSON/screenshots. It deliberately replaces the remote Hub cache with an empty result so installed types work independently of Hub uptime. It never logs into a teacher account or writes to MongoDB. A sandbox may need permission for the temporary loopback listener. It does not test complete lesson content, uploads, learner grading or external APIs.

When creation is in scope, `verify-manual-save.mjs` preloads synthetic valid content parameters into each editor-only native form, types a new title through keyboard events, submits via its browser Save button, and reopens the saved item from temporary storage. Call this a browser save/reopen test, not hand-entered content authoring. For a focused blank Flashcards keyboard/form check, run `H5P_VERIFY_TYPE=H5P.Flashcards H5P_VERIFY_BLANK=1 node scripts/h5p/verify-manual-save.mjs /tmp/create-h5p-blank-save`. For actual CREATE integration, use the logged-in Studio UI, type real input through keyboard events, save, reload, verify fields, and preview when practical. Keep the QA item clearly named and report its location. `fill()` alone may not commit H5P field changes.

Add target/dependency regression coverage to `h5pLibraryAssets.test.js`, manual-only AI rejection tests, and help retrieval coverage for new visible terminology. Review `git diff --check` and `git status`: nested library `dist/` files are source assets, not application build output. Do not stage/commit unrelated work. Report deployment/restart needs separately from code verification.
