# Testing TLEF-CREATE

TLEF-CREATE uses three complementary test layers. Frontend Vitest tests cover components and state, backend Jest tests cover domain and API behavior, and Playwright checks a production frontend build against the real Express API.

## Fast local checks

```bash
npm test -- --run
npm run test:backend:unit
npm run build
```

`test:backend:unit` uses `routes/create/jest.unit.config.js` and intentionally does not load the Mongo setup. The full `test:backend` command retains database-backed integration coverage.

## Playwright E2E smoke

Install the Chromium binary once:

```bash
npm run test:e2e:install
```

Run the E2E suite:

```bash
npm run test:e2e
```

The Playwright configuration builds the Vite frontend, serves it on port 8092, starts Express on port 8051, authenticates an isolated `e2e-admin` session, creates a course through the browser, verifies the API and navigation result, and deletes that course afterward.

The backend launcher never intentionally uses the normal application database. It uses `E2E_MONGODB_URI` when provided; otherwise it derives a database name ending in `-e2e` from `MONGODB_URI`. It refuses to start if the resolved database name does not contain `e2e`.

Authentication uses `/auth/auto-login` only while `AUTO_LOGIN_ENABLED=true`. The E2E launcher enables it inside the isolated test process. Public deployments should leave the variable false. Playwright storage state is written under `playwright/.auth/` and is ignored by Git.

On failure, Playwright retains the screenshot/video and records a trace on the first retry. Open the report with:

```bash
npx playwright show-report
```

## What belongs in E2E

Use Playwright for browser/API contracts: authentication and roles, tab navigation, Blueprint save/restore, failure messages, SSE progress, preserving existing questions after a failed save, review, preview, and downloads.

Do not make pull-request E2E tests depend on a live commercial LLM. Model output is nondeterministic, rate-limited, and may incur cost. Test model streaming, retry, parsing, and budget handling with deterministic backend contract tests. Run a small fixed real-model workflow separately as a scheduled staging canary.

Start with Chromium for pull requests. Add Firefox/WebKit as a scheduled or release suite after the core smoke is stable.
