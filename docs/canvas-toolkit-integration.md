# UBC Canvas Toolkit Integration in CREATE

## Scope and responsibilities

The previous implementation did not use the LMS toolkit: `canvasApiService.js` called `fetch` directly for OAuth, token refresh, and Canvas REST requests. This integration replaces those protocol operations with the official `@ubc/ubc-genai-toolkit-lms-integration` **1.4.0** while preserving the frontend API and course export workflow.

The official source is pinned to [2bf95b4](https://github.com/ubc/ubc-genai-toolkit-lms-integration/tree/2bf95b48c499d9e947abf8489349aa18df2fbeab). GitHub Packages read credentials were unavailable locally, so the npm package was built from that unchanged upstream commit. See `vendor/README.md` for the dependency, source, and checksum. This is the actual toolkit code, not a reimplementation of its API.

The toolkit handles Canvas/Moodle account authorization, API clients, course/roster/file/grade reads, and Canvas grade and feedback PDF writes. It **does not provide an LTI 1.3 server or an H5P player**.

| Responsibility | Owner |
| --- | --- |
| Canvas OAuth authorization URL, code exchange, token refresh, and revocation | UBC toolkit |
| Authenticated Canvas REST requests, retries after 401, and paginated lists | UBC toolkit |
| CREATE login, OAuth state bound to the signed-in user, and connection status | CREATE |
| Token encryption, compatibility with existing connections, and Canvas instance isolation | CREATE TokenStore adapter |
| Parameters for module, page, and ExternalTool creation | CREATE, sent through the toolkit API client |
| LTI launch validation, learner identity, and AGS grade return | Existing `ltijs` service |
| H5P/Mixed Activity content, snapshots, and rendering | CREATE |

## How the integration works

```text
Instructor selects Connect to Canvas
  → CREATE generates and stores a one-time state value
  → toolkit.buildAuthorizeUrl
  → Canvas authorization → CREATE /canvas/oauth/callback
  → toolkit.exchangeCodeForTokens → CREATE stores encrypted tokens

Instructor selects a Canvas course and module, then exports
  → toolkit.getCourses / client.getAll
  → toolkit client.post creates an ExternalTool module item
  → Canvas stores a link to CREATE's LTI tool

Learner opens the module item
  → Canvas starts an LTI 1.3 launch
  → CREATE ltijs validates it → H5P/Mixed Activity plays
```

Key files:

- `routes/create/services/canvasToolkitConnection.js` calls the toolkit's OAuth, refresh, revoke, and `createApiClient` methods. It combines concurrent refreshes and does not delete an existing connection on a network error.
- `routes/create/services/canvasTokenStore.js` implements the toolkit `TokenStore` `get/set/delete` contract using the existing `canvas_tokens` collection and encrypted fields. Tokens from different Canvas hosts are never mixed.
- `routes/create/services/canvasApiService.js` preserves the existing service signatures. Courses use `canvas.getCourses`, modules and external tools use `client.getAll`, and writes use `client.post`.
- `routes/create/controllers/canvasController.js` preserves the frontend paths and success responses. An expired Canvas connection returns a recoverable 409 instead of triggering CREATE's 401 logout behavior.
- `routes/create/services/ltiService.js` retains the LTI server and registers the Canvas platform.

CREATE does not mount the toolkit's `createAuthRouter` or `requireAuth`: their default routes, redirects, and response format do not match CREATE's existing modal workflow. CREATE uses the toolkit's public protocol APIs while retaining its own session and encrypted storage.

## Configuration and operation

1. Run `npm install`. The package built from the pinned source is included with the project; GitHub Packages credentials are not required.
2. Ask a Canvas administrator to create an **OAuth Developer Key**, set the redirect URI below, and allow the scopes listed later in this section.
3. Set these variables in the local `.env`. Never commit secrets to Git.

```dotenv
# The bare domain defaults to HTTPS for hosted UBC Canvas.
CANVAS_DOMAIN=ubc.instructure.com
CANVAS_CLIENT_ID=<OAuth Developer Key ID>
CANVAS_CLIENT_SECRET=<OAuth Developer Key secret>
CANVAS_REDIRECT_URI=https://<CREATE-backend-host>/api/create/canvas/oauth/callback
FRONTEND_URL=https://<CREATE-frontend-host>
```

A local Canvas instance can continue to use `CANVAS_BASE_URL=http://localhost` and `CANVAS_REDIRECT_URI=http://localhost:8051/api/create/canvas/oauth/callback`. When set, `CANVAS_DOMAIN` takes precedence over the older `CANVAS_BASE_URL`. Include the full `http://...` URL for a local HTTP instance. The callback URL must exactly match an allowed URI on the Canvas Developer Key.

4. Exporting a playable CREATE activity also requires a separate **LTI Developer Key and tool installation**. Configure `LTI_CLIENT_ID`, `LTI_PUBLIC_URL`, and the other LTI settings. The OAuth client ID and LTI client ID serve different purposes. Canvas and learners' browsers must be able to reach the public HTTPS address; do not use localhost in a hosted deployment.

   The LTI server listens on `LTI_PORT` (7737 by default). In a hosted deployment, reverse proxy a public HTTPS LTI host to that port. Set the Canvas LTI Key's OpenID Connect initiation URL, Target Link URI, Redirect URI, and Public JWK URL to `<LTI_PUBLIC_URL>/login`, `<LTI_PUBLIC_URL>/`, `<LTI_PUBLIC_URL>/`, and `<LTI_PUBLIC_URL>/keys`, respectively. Set a random `LTI_KEY` and set `H5P_ASSETS_URL` to the public origin of CREATE's main API. The public `/keys` endpoint must return JSON with a `keys` array, not CREATE's frontend HTML.

   For Instructure-hosted Canvas, OAuth and REST APIs continue to use the institution's Canvas domain. Configure LTI registration with Canvas's shared issuer and SSO/JWKS endpoints. Self-hosted Canvas uses its own instance endpoints.

5. Restart the backend. In the Learning Object's Canvas export dialog, select **Connect to Canvas**, authorize the account, choose a course and module, and export.
6. Open the resulting module item in Canvas and check the learner view and any required grade return. Passing API tests alone does not verify LTI registration or a real Canvas deployment.

The OAuth Developer Key needs these scopes:

```text
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:course_id/modules
url:POST|/api/v1/courses/:course_id/modules
url:POST|/api/v1/courses/:course_id/pages
url:POST|/api/v1/courses/:course_id/modules/:module_id/items
url:GET|/api/v1/courses/:course_id/external_tools
url:GET|/api/v1/accounts/:account_id/external_tools
url:POST|/api/v1/courses/:course_id/external_tools
```

The final tool-installation scope was missing from the older implementation. Existing connections need to be reauthorized if they lack a newly required scope. Canvas role permissions still apply; if instructors cannot install a tool, a Canvas administrator must install it first.

Existing database records need no bulk migration. Old tokens remain readable and refreshable; new authorizations save the Canvas user ID. Connecting to a different Canvas domain requires a new authorization. If Canvas returns no refresh token during reauthorization, the old refresh token is kept only when the Canvas user is confirmed to be the same person. Records with unknown identity are not reused across accounts.

Disconnect now asks the toolkit to revoke the Canvas token and clears the local connection; the older implementation only deleted the local record. An expired token or network failure does not prevent local disconnection. The response's `revoked` field indicates whether remote revocation was confirmed. If it was not, the instructor can also revoke CREATE's authorization in Canvas account settings.

## Using other toolkit capabilities

After obtaining `client = await connection.getClient(userId)` on the server, other toolkit methods are available:

```js
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { canvasConfig, createCanvasConnection } from './canvasToolkitConnection.js';
import { createCanvasTokenStore } from './canvasTokenStore.js';

// Create one connection when initializing the service module.
const config = canvasConfig();
const connection = createCanvasConnection({
  config,
  tokenStore: createCanvasTokenStore(config.canvasDomain)
});

// Call inside a request that has passed CREATE authentication and course access checks.
const client = await connection.getClient(userId);
const courses = await canvas.getCourses(client);
const files = await canvas.getCourseFiles(client, courseId);
const file = await canvas.downloadFile(client, courseId, fileId, {
  maxBytes: 10 * 1024 * 1024,
  via: 'public-url'
});
```

File imports are not yet connected to CREATE's material upload UI. They require size and type limits, course ownership checks, a material processing path, and the corresponding Canvas scopes.

The toolkit also provides `matchCourseRoster`, `preflightGradeExport`, `postGrades`, and feedback PDF upload. These are suitable for instructor-reviewed bulk grade and feedback operations. The current integration does not enable those features or replace the learner-facing LTI AGS grade-return path. UBC roster matching uses PUID (`integration_id`); do not substitute a CWL name or student number for a PUID.

## Verification scope

Regression tests exercise the actual toolkit against simulated Canvas HTTP responses. They cover authorization parameters, encrypted token compatibility, pagination, cross-domain refusal, refresh and 401 retries, network failures, disconnection, module creation, and LTI module item requests. Express route tests also cover OAuth state, account switching, repeated callbacks, and error responses.

Before release, complete a real authorization → course selection → module item creation → LTI launch on a configured Canvas test instance. Without that check, do not claim end-to-end UBC Canvas validation.

## Local Canvas integration check on 2026-09-26

The existing Canvas checkout is `/Users/fanhaocheng/tlef-create/canvas-lms-docker`. It uses the `canvas-lms-debian` project and its existing database volume. After starting Docker Desktop, run this in that directory:

```sh
COMPOSE_PROJECT_NAME=canvas-lms-debian DISTRIBUTION=debian docker compose -f compose.yml -f /Users/fanhaocheng/tlef/tlef-create/scripts/canvas-local.override.yml up -d --pull never
```

The override only removes a stale `server.pid` from the web container and binds to `0.0.0.0`; it does not delete the database or courses. CREATE's local `.env` used the existing Canvas OAuth Developer Key. No secret values were added to this document or the repository.

Live API checks passed for toolkit OAuth refresh/revoke, encrypted token storage, course and module listing/creation, page and module item creation, and installation of an existing LTI Developer Key. Temporary API test credentials were revoked. A browser check in CREATE selected a course, created a module, exported, and launched a Branching Scenario in Canvas; it selected a branch and reached the final feedback. The initial browser OAuth popup was not fully observed; the browser check used an already saved, valid connection. Production UBC Canvas, the Canvas mobile app, and grade return were not verified.

The integration check also resolved these issues:

- Users without a Canvas connection can enter the optional connection step in Create Course.
- A blocked browser popup produces a clear message.
- Export without a Canvas connection returns a recoverable 409 without expiring the CREATE login.
- The H5P package excludes SCSS/YAML development files using the official file allowlist, avoiding a Branching Scenario import failure.
- The Canvas LTI page uses the existing read-only player asset paths instead of requesting authenticated Studio asset paths.
- The Canvas `lti.frameResize` protocol adjusts the activity height so long feedback is not clipped.

Test course: [CREATE Toolkit QA 2026-09-26](http://localhost/courses/2/modules). The browser export is in the `Browser export verification` module. Test items were left unpublished so instructors could preview them. Publish the course, module, and item before learners use them.
