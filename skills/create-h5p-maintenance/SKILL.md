---
name: create-h5p-maintenance
description: Update TLEF-CREATE's vendored H5P libraries and expand its official Studio editor, resolving dependencies and validating real editor forms. Use for CREATE H5P content-type or library-version maintenance; AI generation support is a separate change.
---

Maintain the repository's executable H5P libraries, with reviewable provenance and browser evidence. Work in the user's CREATE checkout and read its AGENTS.md. Preserve unrelated edits. This skill authorizes no publishing, GitHub mutations, production deployment, or content migration beyond the user's request.

## Workflow

Read [the maintenance workflow](references/workflow.md) before changing libraries. It identifies the repository tooling, where Studio discovers types, and the acceptance commands.

1. Inspect the installed catalog, lock, core version, and dirty library diffs. Resolve requested display names to actual upstream machine names. Use `routes/create/config/h5p-studio-targets.json` as the current target, not a permanent limit on H5P's changing catalog.
2. Fetch a trusted package into temporary storage and prepare a candidate with `scripts/h5p/maintain.py`. Inspect all changed dependencies and affected activities. Preserve existing minor versions and documented CREATE patches. A core requirement higher than the installed runtime is a blocker, never a descriptor-editing opportunity.
3. Apply compatible candidates using the tool's checksum and rollback guards. For source builds or a batch, retain equivalent guards and record each artifact's actual source. Read [troubleshooting](references/troubleshooting.md) when downloads, names, bundles, or forms fail.
4. Keep new content types editor-only until their AI path has separate validation. Update the target manifest, help, and regression coverage when scope changes. Do not claim that installing libraries extends the normal question-generation matrix.
5. Run the real editor acceptance and regression commands in the workflow. Repair failures and repeat affected checks. Record actual results, versions, unresolved limitations, and upstream source hashes in a report. If a required package or compatible runtime cannot be obtained, explain the specific blocker rather than inventing a type or declaring completion.

The minimum installation check is picker visibility and form loading. When the request includes creating content, run the browser save/reopen check and at least one real blank-form keyboard test in CREATE; distinguish those from learner playback, grading, external services, and Canvas acceptance. Never use a target count alone as proof of compatibility.

The reusable skill lives in `skills/create-h5p-maintenance/`. To make `$create-h5p-maintenance` discoverable, install this whole folder in the current user's Codex skills directory using the host's permitted file operations. Keep the repository copy authoritative and verify installed files match. The skill runs when invoked by an agent; it is not a background updater.
