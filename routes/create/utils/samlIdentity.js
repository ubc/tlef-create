// Resolve both passport-ubcshib's mapped fields and raw assertion names.
// Its reverse mapping drops some MACE aliases; keep our aliases explicit.
export const SAML_ATTRIBUTE_ALIASES = {
  ubcEduCwlPuid: ['urn:oid:1.3.6.1.4.1.60.6.1.6'],
  uid: ['urn:oid:0.9.2342.19200300.100.1.1'],
  cwlLoginName: [],
  mail: ['urn:oid:0.9.2342.19200300.100.1.3', 'email'],
  displayName: ['urn:oid:2.16.840.1.113730.3.1.241'],
  givenName: ['urn:oid:2.5.4.42'],
  sn: ['urn:oid:2.5.4.4'],
  cn: ['urn:oid:2.5.4.3']
};

export const SAML_REQUESTED_ATTRIBUTES = [...Object.keys(SAML_ATTRIBUTE_ALIASES), 'eduPersonAffiliation'];

function firstText(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.find(item => typeof item === 'string' && item.trim())?.trim() || null;
}

export function resolveSamlIdentity(profile = {}, { preferPuid = true } = {}) {
  const resolved = {};
  for (const [friendly, aliases] of Object.entries(SAML_ATTRIBUTE_ALIASES)) {
    const names = [friendly, ...aliases, `urn:mace:dir:attribute-def:${friendly}`];
    for (const source of [profile.attributes, profile]) {
      for (const name of names) {
        const value = firstText(source?.[name]);
        if (value) { resolved[friendly] = value; break; }
      }
      if (resolved[friendly]) break;
    }
  }
  const cwlUsername = resolved.uid || resolved.cwlLoginName || null;
  // Preserve each strategy's existing account key; never re-key course owners.
  const cwlId = (preferPuid ? resolved.ubcEduCwlPuid : cwlUsername) ||
    cwlUsername || firstText(profile.nameID);
  return {
    cwlId,
    cwlUsername,
    email: resolved.mail || null,
    displayName: resolved.displayName ||
      [resolved.givenName, resolved.sn].filter(Boolean).join(' ') || resolved.cn || null
  };
}

// Diagnostics contain field names/presence only, never assertion values or XML.
export function describeSamlIdentity(profile, identity) {
  const plumbing = new Set(['attributes', 'issuer', 'sessionIndex', 'nameID', 'nameIDFormat',
    'nameQualifier', 'spNameQualifier', 'ID', 'inResponseTo']);
  return {
    attributeNames: [...new Set([...Object.keys(profile || {}), ...Object.keys(profile?.attributes || {})])]
      .filter(key => !plumbing.has(key) && typeof profile?.[key] !== 'function').sort(),
    identityPresent: Boolean(identity.cwlId),
    namePresent: Boolean(identity.displayName),
    emailPresent: Boolean(identity.email),
    usernamePresent: Boolean(identity.cwlUsername)
  };
}
