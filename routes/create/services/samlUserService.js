import User from '../models/User.js';
import { describeSamlIdentity, resolveSamlIdentity } from '../utils/samlIdentity.js';

// Share identity refresh between local SAML and UBC Shibboleth sign-in.
export async function syncSamlUser(profile, options = {}) {
  const identity = resolveSamlIdentity(profile, options);
  console.info('SAML identity attributes:', describeSamlIdentity(profile, identity));
  if (!identity.cwlId) throw new Error('No CWL ID found in SAML profile');

  let user = await User.findOne({ cwlId: identity.cwlId });
  if (!user) {
    user = new User({ cwlId: identity.cwlId, password: 'saml-authenticated' });
  }
  // Refresh released fields on every login, preserving previously known fields
  // when an assertion omits them. Do not replace a real name with an ID/email.
  for (const field of ['displayName', 'email', 'cwlUsername']) {
    if (identity[field]) user[field] = identity[field];
  }
  const now = new Date();
  user.lastLogin = now;
  user.stats ??= {};
  user.stats.lastActivity = now;
  await user.save();
  return user;
}

export function createSamlVerify(options = {}) {
  return async (profile, done) => {
    try {
      const user = await syncSamlUser(profile, options);
      done(null, { _id: user._id, cwlId: user.cwlId, stats: user.stats });
    } catch (error) {
      console.error('SAML authentication failed:', error.name);
      done(error);
    }
  };
}
