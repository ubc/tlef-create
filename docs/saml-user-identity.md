# CWL user names and email in CREATE

CREATE follows the identity-resolution approach used in TLEF-FinanceBot:

- FinanceBot's `server/src/components/auth/saml-attributes.ts` resolves friendly names and raw OID/MACE attribute names. This fills gaps in `passport-ubcshib`'s attribute mapping.
- FinanceBot's `server/src/services/users.service.ts` persists released names/email when users sign in. There is no separate directory lookup needed to display them.

## CREATE implementation

`routes/create/utils/samlIdentity.js` reads mapped `profile.attributes` and raw assertion fields, accepts strings or arrays, and trims nonempty strings. It resolves PUID, CWL username, mail, display name, given name, surname, and common name. The name preference is `displayName` → `givenName` + `sn` → `cn`. An email address or opaque ID is not inferred to be a person's name.

`routes/create/services/samlUserService.js` is used by both Passport verification callbacks. Every successful login refreshes released `displayName`, `email`, and `cwlUsername`, along with login/activity timestamps. An omitted attribute leaves previously saved details intact. Existing user document IDs, content ownership, role, API-key permissions, and counters are preserved.

UBC sign-in continues to prefer PUID as `User.cwlId`; local development sign-in continues to prefer its UID. The existing UID/NameID fallback remains available. The change does not migrate account keys or merge accounts based on email. The optional `cwlUsername` field records a released username separately from the stable Login ID.

The administrator's statistics endpoint now selects and returns identity fields. All administrator identity surfaces show the saved name/email with a Login ID fallback. These identity fields are still protected by the existing administrator guards. `ADMIN_CWLS` matches account IDs, released CWL usernames, and existing email identifiers; human display names are excluded from authorization.

## Deployment and existing users

1. Deploy the frontend build and restart the backend with this code.
2. Sign out and sign in through CWL again. Existing users refresh individually on their next CWL sign-in; no database migration is required.
3. Check **Admin Dashboard → Overview → User Activity** or **Users & Courses** for the name, email, Login ID, and optional CWL username.
4. If identity details are still missing, inspect the backend's `SAML identity attributes` diagnostic. It contains attribute names and presence flags only, without names, emails, IDs, or assertion XML.
5. If the assertion lacks `mail` and name attributes, ask UBC IAM to configure attribute release for CREATE's own service-provider entity ID (`SAML_ISSUER`). FinanceBot's release policy does not automatically apply to CREATE. If the assertion contains an unknown alias, extend the explicit resolver and its tests.

`attributeConfig` controls the library's local attribute mapping; adding a name there does not itself change UBC's release policy. Request release of `displayName` or `givenName` + `sn` (or `cn`), `mail`, and optionally `uid`/`cwlLoginName`, while retaining `ubcEduCwlPuid`. Keep staging and production service-provider registrations in mind when requesting the policy change.

An admin page refresh or a previously established session cannot recover attributes that were never saved. Auto-login does not receive CWL attributes. CREATE does not bulk infer names/emails from PUIDs or read FinanceBot's user database.
