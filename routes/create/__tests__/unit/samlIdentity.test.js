import { afterEach, describe, expect, jest, test } from '@jest/globals';
import User from '../../models/User.js';
import { resolveSamlIdentity, describeSamlIdentity } from '../../utils/samlIdentity.js';
import { syncSamlUser, createSamlVerify } from '../../services/samlUserService.js';
import { isConfiguredAdmin } from '../../utils/adminIdentity.js';

afterEach(() => jest.restoreAllMocks());

const puid = 'stable-puid';
const base = { ubcEduCwlPuid: puid, uid: 'faculty-login' };

describe('SAML identity resolution', () => {
  test.each([
    { attributes: { ...base, displayName: [' ', ' Professor Ada '], mail: [' ada@example.test '] } },
    { 'urn:oid:1.3.6.1.4.1.60.6.1.6': puid, 'urn:oid:0.9.2342.19200300.100.1.1': 'faculty-login',
      'urn:oid:2.16.840.1.113730.3.1.241': 'Professor Ada', 'urn:oid:0.9.2342.19200300.100.1.3': 'ada@example.test' },
    { 'urn:mace:dir:attribute-def:ubcEduCwlPuid': puid, 'urn:mace:dir:attribute-def:uid': 'faculty-login',
      'urn:mace:dir:attribute-def:displayName': 'Professor Ada', 'urn:mace:dir:attribute-def:mail': 'ada@example.test' }
  ])('resolves mapped, OID and MACE attributes without re-keying PUID accounts', profile => {
    expect(resolveSamlIdentity(profile)).toEqual({ cwlId: puid, cwlUsername: 'faculty-login', displayName: 'Professor Ada', email: 'ada@example.test' });
  });

  test('fills library mapping gaps and ignores malformed values', () => {
    const profile = { ...base, attributes: { mail: {}, displayName: [null, 42, ' '] }, mail: ['ada@example.test'],
      'urn:oid:2.5.4.42': [' Ada '], 'urn:oid:2.5.4.4': ' Lovelace ', cn: 'Common Name' };
    expect(resolveSamlIdentity(profile)).toMatchObject({ displayName: 'Ada Lovelace', email: 'ada@example.test' });
    expect(resolveSamlIdentity({ attributes: { uid: {}, mail: 42 }, nameID: {} }).cwlId).toBeNull();
  });

  test('prefers released displayName, then given/surname, then common name', () => {
    expect(resolveSamlIdentity({ ...base, displayName: 'Preferred', givenName: 'Ada', sn: 'Lovelace', cn: 'Common' }).displayName).toBe('Preferred');
    expect(resolveSamlIdentity({ ...base, cn: 'Common' }).displayName).toBe('Common');
    expect(resolveSamlIdentity({ ...base, mail: 'ada@example.test' }).displayName).toBeNull();
  });

  test('preserves local SAML uid accounts and existing NameID fallback', () => {
    expect(resolveSamlIdentity({ ...base, nameID: 'transient-id' }, { preferPuid: false }).cwlId).toBe('faculty-login');
    expect(resolveSamlIdentity({ nameID: 'local-user' }, { preferPuid: false }).cwlId).toBe('local-user');
    expect(resolveSamlIdentity({ cwlLoginName: 'released-login' }).cwlUsername).toBe('released-login');
  });

  test('logs names/presence without personal data or assertion XML', () => {
    const profile = { ...base, displayName: 'Professor Ada', mail: 'ada@example.test', getAssertionXml: () => '<secret />' };
    const summary = describeSamlIdentity(profile, resolveSamlIdentity(profile));
    expect(summary).toMatchObject({ namePresent: true, emailPresent: true, identityPresent: true });
    expect(JSON.stringify(summary)).not.toMatch(/stable-puid|faculty-login|Professor Ada|ada@example|secret|getAssertionXml/);
  });
});

describe('CWL login identity refresh', () => {
  function mockDatabase(existing = null) {
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const find = jest.spyOn(User, 'findOne').mockResolvedValue(existing);
    const save = jest.spyOn(User.prototype, 'save').mockImplementation(async function () { return this; });
    return { find, save };
  }

  test('creates a named user using real schema defaults', async () => {
    const { find, save } = mockDatabase();
    const user = await syncSamlUser({ ...base, displayName: 'Professor Ada', mail: 'ada@example.test' });
    expect(find).toHaveBeenCalledWith({ cwlId: puid });
    expect(user).toMatchObject({ cwlId: puid, cwlUsername: 'faculty-login', displayName: 'Professor Ada', email: 'ada@example.test', canUseEnvKey: false, role: 'user' });
    expect(user.stats.questionsCreated).toBe(0);
    expect(user.lastLogin).toEqual(user.stats.lastActivity);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('upgrades an old email-prefix name and refreshes released fields without changing ownership or permissions', async () => {
    const existing = new User({ cwlId: puid, password: 'saved-password', displayName: 'old.prefix', email: 'old@example.test', role: 'admin', canUseEnvKey: true, stats: { questionsCreated: 27 } });
    const id = existing._id;
    mockDatabase(existing);
    const user = await syncSamlUser({ ...base, displayName: 'Professor Ada', mail: 'new@example.test' });
    expect(user).toBe(existing);
    expect(user._id).toEqual(id);
    expect(user).toMatchObject({ displayName: 'Professor Ada', email: 'new@example.test', role: 'admin', canUseEnvKey: true, password: 'saved-password' });
    expect(user.stats.questionsCreated).toBe(27);
    await syncSamlUser({ ubcEduCwlPuid: puid });
    expect(user).toMatchObject({ displayName: 'Professor Ada', email: 'new@example.test', cwlUsername: 'faculty-login' });
  });

  test.each([{}, { preferPuid: false }])('the Passport verify callback saves identity and returns only session identifiers: %j', async options => {
    const { find } = mockDatabase();
    const done = jest.fn();
    await createSamlVerify(options)({ ...base, displayName: 'Ada', mail: 'ada@example.test' }, done);
    expect(find).toHaveBeenCalledWith({ cwlId: options.preferPuid === false ? 'faculty-login' : puid });
    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ cwlId: options.preferPuid === false ? 'faculty-login' : puid }));
    expect(done.mock.calls[0][1]).not.toHaveProperty('email');
  });

  test('rejects an absent identity without saving and propagates database failures', async () => {
    const { find, save } = mockDatabase();
    const done = jest.fn();
    await createSamlVerify()({}, done);
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ message: 'No CWL ID found in SAML profile' }));
    expect(find).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    const failure = new Error('Database unavailable');
    find.mockRejectedValue(failure);
    done.mockClear();
    await createSamlVerify()(base, done);
    expect(done).toHaveBeenCalledWith(failure);
  });
});

describe('admin identity matching', () => {
  test('keeps configured account identifiers working, with case/whitespace normalization', () => {
    const user = { cwlId: puid, cwlUsername: 'faculty-login', email: 'Ada@Example.test', displayName: 'Professor Ada' };
    for (const value of [puid, 'faculty-login', 'ada@example.test', 'ada']) {
      expect(isConfiguredAdmin(user, `other, ${value.toUpperCase()} `)).toBe(true);
    }
    expect(isConfiguredAdmin(user, 'Professor Ada')).toBe(false);
    expect(isConfiguredAdmin(null, '')).toBe(false);
  });
});
