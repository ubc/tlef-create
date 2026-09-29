# H5P Debugging Notes

Troubleshooting notes and fixes for H5P issues.

---

## [2026-05-18] Crossword — Library not available for preview

### Symptom
Previewing a Crossword question displayed:
```
H5P.Crossword — Library not available for preview.
```

### Root cause
`H5P.classFromName('Crossword')` returned `undefined`, meaning the Crossword JavaScript had not registered its class under `window.H5P`.

Call path:
1. `h5p-core.js` calls `H5P.classFromName(machineName)`.
2. That function looks for the constructor at `window.H5P.Crossword`.
3. When it is missing, H5P renders a placeholder error.

### Diagnosis
The `h5p-libs/H5P.Crossword-0.4/` directory **had no `dist/` directory**, although `library.json` declared `dist/h5p-crossword.js` as its main script. The missing file never loaded, so the class was never registered.

```
H5P.Crossword-0.4/
├── icon.svg
├── language/
├── library.json
├── semantics.json
└── upgrades.js     ← no dist/; the library cannot run
```

### Fix
Replace it with **version 0.5**, including its complete `dist/` directory. Update all three locations:

**1. Copy the complete library.**
```bash
cp -r /path/to/H5P.Crossword-0.5 tlef-create/routes/create/h5p-libs/
```

**2. `h5pExportService.js`**
```js
// Before
"library": "H5P.Crossword 0.4"
// After
"library": "H5P.Crossword 0.5"
```

**3. `h5pLibraryRegistry.js`**
```js
// Before
'H5P.Crossword': { majorVersion: 0, minorVersion: 4, dirName: 'H5P.Crossword-0.4' }
// After
'H5P.Crossword': { majorVersion: 0, minorVersion: 5, dirName: 'H5P.Crossword-0.5' }
```

### Checklist for any H5P "Library not available" error

1. **Confirm the library directory exists under `h5p-libs/`.**
2. **Confirm it contains `dist/`.** Every path declared in `library.json` under `preloadedJs` must exist.
3. **Confirm the version and `dirName` in `h5pLibraryRegistry.js` match the directory.**
4. **Confirm the library version string in `h5pExportService.js` matches too.**

A mismatch in any one version prevents the library from loading.
