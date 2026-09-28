# UBC LMS integration toolkit

CREATE uses the **unmodified official** `@ubc/ubc-genai-toolkit-lms-integration`
package, version **1.4.0**, built from upstream commit
`2bf95b48c499d9e947abf8489349aa18df2fbeab` (retrieved 2026-09-26).

Source: https://github.com/ubc/ubc-genai-toolkit-lms-integration/tree/2bf95b48c499d9e947abf8489349aa18df2fbeab
License declared by upstream: GPL-3.0. The corresponding complete source,
including build configuration and lockfile, is supplied alongside the compiled
package in `ubc-genai-toolkit-lms-integration-2bf95b4-source.tar.gz`.

The package is distributed through GitHub Packages, which requires authentication
even for this public repository. This source-built package keeps CREATE installs
reproducible without requiring every developer/CI runner to have package credentials.
No toolkit source modifications were made. No credentials are included.

- npm package SHA-256: `11fcd02794d47cea51e52566aaa99ce819beea1d067811fb09aac39c0fc766c7`
- source archive SHA-256: `c4073018e96ea49a7a4fa2a871a7a255708c77566dfced34262ca269e040f059`

To rebuild, unpack the source archive into a temporary directory, use Node 20+,
then run `npm ci --ignore-scripts`, `npm run build`, and
`npm pack --ignore-scripts`. The project lockfile also records npm package integrity.

To use the registry distribution instead, configure `@ubc:registry=https://npm.pkg.github.com`
and a read:packages credential in your **user-level** npm configuration (never
commit a token), then run:

```sh
npm install --save-exact @ubc/ubc-genai-toolkit-lms-integration@1.4.0
```

Verify the resulting lockfile and run CREATE's Canvas tests before removing the
local package/source archives. Do not automatically track upstream master.
