# H5P Lumi Library Troubleshooting

## Context

We investigated a rendering mismatch between TLEF Create, Lumi, WordPress-hosted H5P, and official-looking H5P Interactive Book examples.

The visible symptom was confusing:

- Interactive Book shell started rendering correctly after switching to the official-compatible `H5P.InteractiveBook 1.11` and `H5P.Column 1.18` combination.
- True/False and Multiple Choice children still rendered incorrectly in Lumi.
- Older H5P packages that previously rendered correctly also became broken in Lumi after importing experimental packages.

The last point was the key clue.

## Root Cause

Lumi installs imported H5P libraries into a global local library store:

```text
~/Library/Application Support/lumi/libraries
```

H5P libraries are keyed by machine name and major/minor version, for example:

```text
H5P.MultiChoice-1.16
H5P.TrueFalse-1.8
H5P.Question-1.5
```

This means a bad library imported once can affect later packages that use the same `machineName-major.minor`, even if those later packages are otherwise valid.

During debugging, we imported experimental libraries from an official package that had newer patch versions:

```text
H5P.MultiChoice-1.16 patch 27
H5P.TrueFalse-1.8   patch 21
H5P.Question-1.5    patch 53
H5P.JoubelUI-1.3    patch 45
H5P.Components-1.0  patch 97
```

Those libraries originally required `coreApi 1.28`. To test Lumi compatibility, their `library.json` metadata was temporarily changed to `coreApi 1.27`. That allowed Lumi validation to pass, but the runtime combination was invalid. Lumi then installed those libraries globally, causing later renders to break.

## Important Lesson

Do not "fix" H5P library compatibility by lowering `coreApi` in `library.json`.

If a library says it requires `coreApi 1.28`, it may rely on runtime behavior from H5P core 1.28. Changing the metadata to `1.27` only bypasses validation. It does not make the JavaScript/CSS runtime compatible.

This can create a half-working state:

- The H5P package imports successfully.
- The Interactive Book frame may render.
- Child content types may degrade into plain text or lose styling/interaction.
- Lumi may globally cache the bad library and break unrelated packages.

## Working Combination

The successful local combination was:

```text
H5P.InteractiveBook-1.11
H5P.Column-1.18
H5P.MultiChoice-1.16 patch 14
H5P.TrueFalse-1.8 patch 11
H5P.Question-1.5 patch 15
H5P.JoubelUI-1.3 patch 10
H5P.Components-1.0 patch 96
```

The key idea is not simply "newer is better." The libraries must be mutually compatible with the target player core.

## How Interactive Book Rendering Was Fixed

The Interactive Book shell issue was separate from the later Lumi library pollution issue.

The app originally rendered/exported Interactive Book with newer container libraries:

```text
H5P.InteractiveBook-1.13
H5P.Column-1.20
```

The official-looking reference content used:

```text
H5P.InteractiveBook-1.11
H5P.Column-1.18
```

Switching the app's Interactive Book container stack to the reference versions fixed the main Interactive Book shell:

- The sidebar appeared correctly.
- The chapter navigation looked closer to official H5P output.
- The progress bar and page layout became much closer to WordPress-hosted H5P.
- The preview in TLEF Create started matching the expected Interactive Book structure.

The important code-level changes were:

```text
routes/create/config/h5pLibraryRegistry.js
```

Update the registry entries:

```js
'H5P.Column': { majorVersion: 1, minorVersion: 18, dirName: 'H5P.Column-1.18' },
'H5P.InteractiveBook': { majorVersion: 1, minorVersion: 11, dirName: 'H5P.InteractiveBook-1.11' },
```

And in:

```text
routes/create/services/h5pExportService.js
```

make Interactive Book chapters use the matching Column version:

```js
library: 'H5P.Column 1.18'
```

This matters because the version in the registry controls which library files are resolved and packaged, while the `library` string inside `content/content.json` controls which child library the H5P runtime tries to instantiate. These must agree.

### Why The Fix Worked

Interactive Book itself is a container library. Its visual shell is mostly controlled by:

```text
H5P.InteractiveBook
H5P.Column
H5P.Components
H5P.JoubelUI
FontAwesome
```

The reference package's shell was built around `InteractiveBook 1.11` and `Column 1.18`. TLEF Create was pointing to newer container versions, which produced a different shell and layout. Aligning the container versions made the shell match the reference much more closely.

### What This Fix Did Not Solve

This did not automatically fix child content types such as:

```text
H5P.TrueFalse
H5P.MultiChoice
H5P.Question
```

Those are separate H5P libraries. The Interactive Book shell can render correctly while child questions still render incorrectly if their libraries are missing, mismatched, corrupted, or polluted in Lumi's global store.

That is why the final diagnosis had two layers:

1. Interactive Book shell mismatch: fixed by aligning `InteractiveBook` and `Column` versions with the reference package.
2. Child question rendering mismatch in Lumi: caused by polluted globally installed Lumi libraries from an earlier experimental import.

### Export-Specific Follow-Up

Preview and export must use the same library stack.

TLEF Create preview loads libraries directly from the local app filesystem, so it can look correct even if the exported `.h5p` package is incomplete. Exported Interactive Book packages should include the runtime libraries that they actually use.

For a self-contained Interactive Book export, verify that the `.h5p` contains the expected runtime files:

```bash
unzip -l package.h5p | rg 'H5P.InteractiveBook-1.11|H5P.Column-1.18|H5P.MultiChoice-1.16|H5P.TrueFalse-1.8|H5P.Question-1.5|H5P.JoubelUI-1.3|H5P.Components-1.0'
```

Also verify that `content/content.json` references the same Column version:

```bash
unzip -p package.h5p content/content.json | rg 'H5P.Column 1.18'
```

If the package includes `H5P.Column-1.18` but `content/content.json` says `H5P.Column 1.20`, or the reverse, the runtime may resolve the wrong library.

## Export Packaging Notes

TLEF Create preview can work while exported `.h5p` files fail because preview loads libraries directly from the local app filesystem.

Lumi imports packages differently:

- It validates `h5p.json`.
- It installs libraries into its global store.
- It may reuse globally installed libraries for future packages.

For Interactive Book exports, the package should be self-contained and include the runtime libraries it actually uses. Avoid relying on the target platform to provide missing libraries.

Also avoid mixing authoring/editor libraries into playable export dependencies unless explicitly required:

```text
H5PEditor.*
```

These are editor-side libraries, not normal player runtime libraries.

## How To Diagnose

Inspect the exported package:

```bash
unzip -p package.h5p h5p.json
unzip -p package.h5p content/content.json
unzip -l package.h5p | rg 'H5P.MultiChoice|H5P.TrueFalse|H5P.Question|H5P.JoubelUI|H5P.Components'
```

Check library versions inside a package:

```bash
tmpdir=$(mktemp -d /tmp/h5p-check-XXXXXX)
unzip -q package.h5p -d "$tmpdir"
node -e "const fs=require('fs'); const root=process.argv[1]; for (const d of ['H5P.MultiChoice-1.16','H5P.TrueFalse-1.8','H5P.Question-1.5','H5P.JoubelUI-1.3','H5P.Components-1.0']) { const p=root+'/'+d+'/library.json'; if (fs.existsSync(p)) { const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(d, 'patch', j.patchVersion, 'core', j.coreApi && j.coreApi.majorVersion + '.' + j.coreApi.minorVersion); } }" "$tmpdir"
```

Check Lumi's global library store:

```bash
node -e "const fs=require('fs'); const root=process.env.HOME + '/Library/Application Support/lumi/libraries'; for (const d of ['H5P.MultiChoice-1.16','H5P.TrueFalse-1.8','H5P.Question-1.5','H5P.JoubelUI-1.3','H5P.Components-1.0','H5P.InteractiveBook-1.11','H5P.Column-1.18']) { const p=root+'/'+d+'/library.json'; if (fs.existsSync(p)) { const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(d, 'patch', j.patchVersion, 'core', j.coreApi && j.coreApi.majorVersion + '.' + j.coreApi.minorVersion); } }"
```

## How To Recover Lumi From A Polluted Library Store

Quit Lumi completely first.

Then move suspicious libraries out of Lumi's global store instead of deleting them permanently:

```bash
backup="/tmp/lumi-h5p-bad-libs-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"

for d in \
  H5P.MultiChoice-1.16 \
  H5P.TrueFalse-1.8 \
  H5P.Question-1.5 \
  H5P.JoubelUI-1.3 \
  H5P.Components-1.0
do
  if [ -d "$HOME/Library/Application Support/lumi/libraries/$d" ]; then
    mv "$HOME/Library/Application Support/lumi/libraries/$d" "$backup/$d"
  fi
done

echo "$backup"
```

Reopen Lumi and import a known-good package. Lumi should reinstall clean libraries from that package.

## Debugging Rule Of Thumb

When H5P rendering differs between Lumi and WordPress:

1. First compare the package's `h5p.json` and `content/content.json`.
2. Then compare the actual library versions and patch versions.
3. Then check Lumi's global library store for polluted or incompatible libraries.
4. Avoid changing `coreApi` as a compatibility shortcut.
5. Prefer using a complete, internally consistent set of libraries from a known-good `.h5p` package.

## What Happened In This Case

The breakthrough was noticing that packages that used to work also became broken after importing experimental packages. That meant the problem was no longer only the current export package. It was Lumi's global library state.

After removing the polluted libraries from:

```text
~/Library/Application Support/lumi/libraries
```

and importing a package with stable libraries, Lumi rendering recovered.
