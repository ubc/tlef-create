// Human display names are presentation data, never an authorization identity.
// Keep existing ADMIN_CWLS support for PUID, CWL username and email identifiers.
export function isConfiguredAdmin(user, allowlist = process.env.ADMIN_CWLS || '') {
  const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const identifiers = [user?.cwlId, user?.cwlUsername, user?.email, user?.email?.split('@')[0]]
    .map(normalize).filter(Boolean);
  const entries = Array.isArray(allowlist) ? allowlist : allowlist.split(',');
  return entries.some(entry => identifiers.includes(normalize(entry)));
}
