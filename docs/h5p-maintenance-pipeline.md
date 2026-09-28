# CREATE H5P maintenance pipeline

This pipeline maintains CREATE's vendored H5P libraries. It separates discovery,
candidate preparation, regression acceptance, content migration and deployment.
It does not grant teachers library-install permission or change live content.

## Execution order

| Stage | Implementation | Result / gate |
| --- | --- | --- |
| Inventory | Every relevant PR, weekly run and manual run | Hash all 118 current library directories and Core/Editor; check the committed lock |
| Upstream discovery | Wednesdays at 16:17 UTC; manual run with empty `library` | Download official Hub packages for installed runnable types; report newer packaged libraries and dependencies |
| Candidate preparation | Manual run with a machine name, e.g. `H5P.MultiChoice` | Extract libraries into temporary storage; keep same/newer patches and older minor directories; never import example content |
| Compatibility | Before materializing a candidate | Check descriptors, declared JS/CSS, CSS assets, all dependency kinds and Core requirements; reject new defects or defects in the requested activity's dependency closure |
| Regression | Relevant PR or selected candidate | H5P backend tests, frontend compatibility tests, Chromium editor/player/export/reimport matrix using an isolated Mongo database |
| Review artifact | Every candidate run, including failed runs | Plan, hashes, affected activity list, candidate patch, acceptance results and browser traces |
| Content migration / external acceptance | Maintainer with UBC or target platform | Test historical content copies, nested content, media, scoring and independent-host import |
| Release | Existing reviewed code and manual production deployment | No automatic merge, production write or content migration |

The weekly job **detects** updates. A maintainer selects the activity for a
candidate run; this is intentionally not unattended production updating. It
does not automatically open PRs, send messages or need a write-capable token.
All jobs use `contents: read`. Reports remain Actions artifacts for 30 days.
Enable GitHub's own workflow failure notifications according to team preferences.

## Activate

Commit the workflow, scripts, tests, lock and package-script additions and merge
them into the repository's default branch. GitHub Actions must be enabled.
The schedule and Run workflow button are effective only after the workflow is
on the default branch. No H5P credentials, site registration or new repository
secrets are required. Candidate validation uses the project's existing npm
dependencies and requires all referenced vendor packages to be committed.

Open **Actions → CREATE H5P maintenance → Run workflow**:

- Leave `library` empty for a complete update report.
- Enter `H5P.MultiChoice` (or another installed official machine name) to prepare
  and validate that package plus its bundled dependencies.

Select the intended base branch. Inspect `h5p-candidate-and-acceptance`, especially
`plan.json`, `candidate.patch` and `h5p-acceptance.json`. A prepared candidate has
not passed tests yet. `automatedChecksPassed` is separate from release approval;
skipped or failed test steps do not count as success. Individual external-service
activities skipped by the existing browser suite still need manual acceptance.

## Local commands

Prerequisites: Python 3.10+, curl with normal TLS verification, Node.js 20.19+
and the repository's npm dependencies for regression tests.

```sh
npm run test:h5p:maintenance
npm run h5p:inventory
npm run h5p:check -- --library H5P.MultiChoice
npm run h5p:prepare -- --library H5P.MultiChoice --out artifacts/h5p-candidate
npm run test:h5p:backend
```

Inventory/check reports default to `artifacts/h5p-maintenance/`. Candidate output
must be a fresh directory; an existing candidate is never silently overwritten.
`--package /absolute/path/activity.h5p` permits offline candidate preparation,
but its provenance is explicitly marked as requiring manual verification.

The official Hub currently produces ZIP archives that the project's installed
adm-zip may reject with `Descriptor data is malformed`. Maintenance uses Python
zipfile, including its CRC checks, to read those ZIP variants. It does not alter
the application's existing import parser.

## Materializing an upgrade for review

Use a **disposable clean checkout/worktree of the same base revision**. Download
the candidate artifact, then run from that checkout:

```sh
python3 scripts/h5p/maintain.py apply --candidate /absolute/path/h5p-candidate --allow-worktree-write
npm run h5p:inventory
npm run test:h5p:backend
```

`apply` verifies the baseline of every library, Core/Editor, manifest and lock,
then verifies candidate files before replacing any directories. It updates the
runtime manifest and full lock together and restores touched paths if a write
fails. It is a checkout operation, **not** a transaction-safe live-server deploy.
Do not run it in a serving production directory or a checkout being edited by
another process. The candidate must be regenerated if its base has changed.

The Actions-generated binary `candidate.patch` is an alternative for code review;
it includes new library files as well as changes/deletions. Apply it only to the
matching clean base and rerun verification. Do not apply both methods.

After passing regression checks, inspect changes to shared dependencies and
local patches; run target-platform acceptance; commit the generated libraries,
manifest and lock as a reviewed upgrade. Existing production deployment remains
manual. No database credentials are used by the maintenance tooling.

## Lock and provenance

`h5p-library-lock.json` records versions, dependency lists, complete per-library
tree hashes, Core/Editor hashes and current direct integrity findings. Repository
tree fingerprints normalize CRLF to LF in UTF-8 text (matching Git checkout
normalization), and exclude generated `.d.ts`, OS files and dependency folders.
Package archive hashes cover the original downloaded bytes. Extraction normalizes
UTF-8 CRLF to LF and records that transformation; manifest asset hashes cover the
actual installed bytes, so Git line-ending conversion cannot invalidate them.
The initial
lock is a **local baseline**, not a claim that old libraries came from verified
upstream packages. The inventory reports provenance gaps separately; currently
the earlier runtime manifest documents only 10 of the 118 library directories.

Prepared updates add the official package URL, archive hash and installed asset
hashes. Source npm manifests are excluded from installed library directories to
avoid duplicate Jest package discovery; runtime assets, semantics, translations
and licenses remain together. No downloaded code or build scripts are executed
during discovery or extraction. Regression tests execute candidate JS on the
disposable CI runner with no production secrets.

For an intentional hand-maintained Core/library change, inspect the diff and
update upstream provenance in the existing runtime manifest first. Then refresh
the baseline explicitly and review it:

```sh
python3 scripts/h5p/maintain.py baseline --allow-worktree-write
git diff -- routes/create/config/h5p-library-lock.json
```

Never use baseline refresh to conceal an unexplained hash change. Source metadata
is retained only for unchanged hashes. Existing known integrity defects remain
visible; adding a defect fails candidate preparation. Core-requiring updates are
blocked for coordinated Core/Editor integration work, not relabelled compatible.

## Limits and recovery

- Discovery reflects the official Hub package feed, not all GitHub branches,
  commercial H5P.com activities or Lumi npm releases. A retired/unpublished
  activity may return an error. The existing retired Twitter User Feed is explicitly
  excluded by `h5p-maintenance-policy.json` and remains visible as excluded in the
  report. For other errors, the job records them and fails instead of claiming
  everything is up-to-date; healthy activities are still included in the report.
- No automatic same-patch replacement: local fixes and newer installed patches
  are retained. Repair an incomplete same-version library as an explicit reviewed
  change. Missing compiled bundles are not fixed by changing `coreApi`.
- The impact report identifies affected runnable library versions, including
  retained old versions. It does not query production content or report exact
  instructor/content IDs. New minor/major directories flag migration review;
  dependency updates may still require content review even on a patch upgrade.
- Before production migration, snapshot the database, stored H5P JSON/media and
  the deployed library/Core release. Exercise upstream `upgrades.js` on copies,
  then migrate in batches. Restore the entire compatible snapshot for rollback;
  reverting code alone does not reverse a content migration. This pipeline does
  not yet implement a production content migrator.
- UBC/WordPress compatibility, accessibility, scoring behavior and educational
  quality require acceptance beyond the existing local structural browser matrix.
  Share fixtures and version inventories with UBC; do not infer compatibility
  from activity names or a passing local import.
- Workflow files and local passing tests alone do not mean CI is live. Verify the
  first GitHub run after merging and configure branch protection if these checks
  should be mandatory. This change does not modify repository settings.

References: [H5P Hub migration](https://h5p.org/h5p-february-2026-update),
[content upgrades](https://h5p.org/node/883),
[GitHub manual workflow activation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[CREATE research](h5p-maintenance-research-2026-09-26.md).

## Local verification, 2026-09-26

- 16 maintenance tests passed, including ZIP64 data descriptors, unsafe archives,
  dependency/Core blocking, baseline drift, text normalization and write rollback.
- Existing H5P backend suite: 15 suites / 140 tests passed.
- Frontend compatibility/ready tests: 2 files / 11 tests passed.
- A real official MultiChoice package was prepared without changing installed
  workspace libraries. It updates 6 libraries and affects 34 runnable library
  versions through dependencies. Applied in a temporary copy, it passed the
  same 140 H5P backend tests.
- The repository lock was checked against both local files and a fresh extraction
  of tracked Git files. This exposed and resolved checkout newline/type-declaration
  differences without changing application runtime files.
- The live full Hub scan found 35 activity packages with newer libraries or
  dependencies, 1 with no newer packaged version and 1 retired Twitter Feed
  download failure. Twitter Feed was then explicitly excluded by maintenance
  policy; exclusion behavior is tested. This is a point-in-time feed result, not
  certification that all 35 updates can be safely released.
- Workflow YAML parses and `git diff --check` passes. The GitHub-hosted workflow
  and its browser matrix have not been run by this local implementation task.
  Production content migration and independent UBC/WordPress acceptance remain
  release gates.
