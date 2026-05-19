# Canvas LTI 1.3 Local Setup — Troubleshooting Guide

This document records the errors encountered when setting up the TLEF-CREATE LTI 1.3 integration with a local Canvas (`canvas-lms-docker`) instance, and the exact fix for each one.

---

## Overview of the Flow

When a user clicks "Export to Canvas" and selects a course + module, the backend:

1. Calls the Canvas REST API to create a module item of type `ExternalTool`
2. Canvas stores the `target_link_uri` (the LTI launch URL pointing to our server)
3. When a student/instructor clicks that module item in Canvas, Canvas initiates the **LTI 1.3 OIDC launch flow**:
   - Canvas redirects the browser to our `/login` endpoint
   - ltijs redirects the browser back to Canvas `/api/lti/authorize` with `redirect_uri = target_link_uri`
   - Canvas signs a JWT and form-POSTs it back to `target_link_uri`
   - ltijs validates the JWT and renders the resource

---

## Errors Encountered and Fixes

### 1. `Iss can't be blank`

**Symptom:** Canvas LTI launch fails with a validation error during the OIDC handshake — `Iss can't be blank`.

**Cause:** Canvas was not configured with an `lti_iss` (issuer) value. Without this, Canvas can't sign the LTI 1.3 JWT.

**Fix:** Add `lti_iss` to `canvas-lms-docker/canvas/config/security.yml`:

```yaml
default: &default
  encryption_key: <%= ENV.fetch('CANVAS_LMS_ENCRYPTION_KEY') %>
  jwt_encryption_keys: <%= ENV.fetch('CANVAS_LMS_JWT_ENCRYPTION_KEYS') %>
  lti_iss: http://localhost   # <-- add this line

production: *default
development: *default
test: *default
```

Then restart the Canvas web container:
```bash
docker restart canvas-web
```

---

### 2. `undefined method 'sign' for nil`

**Symptom:** Canvas throws a Ruby `NoMethodError` — `undefined method 'sign' for nil`. Appears after fixing the `lti_iss` error.

**Cause:** Canvas had no LTI RSA signing keys generated. The keys are stored in the database via `Lti::KeyStorage` and must be explicitly created.

**Fix:** Open a Rails console inside the Canvas web container and rotate/generate keys:

```bash
docker exec -it canvas-web bash
bundle exec rails runner "Lti::KeyStorage.rotate_keys"
exit
docker restart canvas-web
```

This generates a new RSA key pair stored in Canvas's database that Canvas uses to sign LTI 1.3 JWTs.

---

### 3. `Invalid redirect_uri`

**Symptom:** After the OIDC login redirect, Canvas rejects the request with `Invalid redirect_uri`.

**Cause:** ltijs constructs the `redirect_uri` as `request.target_link_uri`. The URL stored in Canvas's `ContentTag` (the module item) must exactly match one of the redirect URIs registered in the Canvas Developer Key.

**Fix:** In Canvas Admin → Developer Keys → your LTI key → Edit, add all URI variants to the **Redirect URIs** list:

```
http://localhost:7737/
http://localhost:7737/login
http://host.docker.internal:7737/
http://host.docker.internal:7737/login
```

The `host.docker.internal` variants are needed because Canvas (running in Docker) may store them when the module item is first created.

---

### 4. `host.docker.internal` not resolving in the browser

**Symptom:** After fixing the redirect URI list, the browser gets redirected to `http://host.docker.internal:7737/...` which doesn't resolve in the user's browser (only resolvable inside Docker containers).

**Root cause:** When the LTI module item was first created, `LTI_PUBLIC_URL` in `.env` was temporarily set to `http://host.docker.internal:7737`. This URL was stored in Canvas's `ContentTag` table. ltijs then uses `request.target_link_uri` (derived from `ContentTag.url`) as the `redirect_uri`, so the browser was redirected to a Docker-internal address.

**Fix:** Update the stored URL directly in the Canvas database:

```bash
docker exec -it canvas-web bash
bundle exec rails runner "ContentTag.where('url LIKE ?', '%host.docker.internal%').each { |t| t.update!(url: t.url.gsub('host.docker.internal', 'localhost')) }"
```

Then set `LTI_PUBLIC_URL=http://localhost:7737` in `.env` (so future module items are created with the correct URL).

**Prevention:** Always verify `LTI_PUBLIC_URL` is set to a browser-accessible URL before exporting to Canvas for the first time.

---

### 5. LTI tool not found via Canvas external_tools API

**Symptom:** The backend calls `GET /api/v1/courses/:id/external_tools` to find the LTI tool before creating a module item, but the tool is not returned — even though it is installed at the account level.

**Cause:** Canvas's course-level external tools API does not return LTI 1.3 tools installed at the account level in all configurations.

**Fix (in `canvasApiService.js`):** Fall back to auto-installing the tool via client ID if it's not found in either course-level or account-level lookups:

```js
const installed = await canvasRequest(userId, `/courses/${courseId}/external_tools`, {
  method: 'POST',
  body: JSON.stringify({ client_id: ltiClientId })
});
```

Canvas responds with the installed tool's `id`, which is then used for creating the `ExternalTool` module item.

---

### 6. JWK validation error (Developer Key configuration)

**Symptom:** Canvas cannot validate our LTI server's JSON Web Key Set (JWKS), causing the LTI handshake to fail.

**Cause:** The Developer Key was initially configured with a **Public JWK URL** pointing to our JWKS endpoint, but Canvas had trouble fetching/validating it in the local Docker environment.

**Fix:** Switch the Developer Key's JWK method from **Public JWK URL** to **Paste Public JWK**, and paste the static JWK JSON directly. Retrieve the JWK from our server:

```bash
curl http://localhost:7737/keys
```

Copy the result and paste it into the Canvas Developer Key editor under **Paste Public JWK**.

---

## Final Working Configuration

### `.env` (tlef-create)
```env
LTI_CLIENT_ID=10000000000002
LTI_PUBLIC_URL=http://localhost:7737
CANVAS_BASE_URL=http://localhost
CANVAS_CLIENT_ID=10000000000001
CANVAS_CLIENT_SECRET=<your-canvas-secret>
CANVAS_REDIRECT_URI=http://localhost:8051/api/create/canvas/oauth/callback
```

### `canvas-lms-docker/canvas/config/security.yml`
```yaml
default: &default
  encryption_key: <%= ENV.fetch('CANVAS_LMS_ENCRYPTION_KEY') %>
  jwt_encryption_keys: <%= ENV.fetch('CANVAS_LMS_JWT_ENCRYPTION_KEYS') %>
  lti_iss: http://localhost
```

### Canvas Developer Key settings
- **Key type:** LTI Key
- **Redirect URIs:**
  ```
  http://localhost:7737/
  http://localhost:7737/login
  ```
- **Target Link URI:** `http://localhost:7737/`
- **OpenID Connect Initiation URL:** `http://localhost:7737/login`
- **JWK Method:** Paste Public JWK (from `curl http://localhost:7737/keys`)

### After any Canvas reset
If you reset or re-create the Canvas Docker environment, run these steps:

```bash
# 1. Generate LTI signing keys
docker exec -it canvas-web bash -c "bundle exec rails runner 'Lti::KeyStorage.rotate_keys'"

# 2. Restart Canvas web
docker restart canvas-web

# 3. Verify security.yml has lti_iss set
grep lti_iss canvas-lms-docker/canvas/config/security.yml
```

---

## LTI 1.3 OIDC Flow (Reference)

```
Browser clicks module item in Canvas
  → Canvas redirects to: GET /login?iss=...&login_hint=...&target_link_uri=...
  → ltijs captures target_link_uri, redirects to:
      GET /api/lti/authorize?redirect_uri=<target_link_uri>&...
  → Canvas signs JWT, form-POSTs to target_link_uri (our /lti endpoint)
  → ltijs validates JWT using Canvas's JWKS
  → ltijs renders the LTI resource
```

Key insight: **`redirect_uri` = `target_link_uri`** (set by `node_modules/ltijs/dist/Utils/Request.js:18`). Whatever URL is stored in `ContentTag.url` becomes the redirect URI — so it must be browser-accessible and registered in the Developer Key.
