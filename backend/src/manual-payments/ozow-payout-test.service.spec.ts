import {
  OzowPayoutTestService,
  resolveMockConfigKeys,
} from './ozow-payout-test.service';

const PASCAL = {
  IsAccountDecryptionFailed: false,
  IsNotVerifiedResponse: false,
  IsAccountDecryptionKeyMissing: false,
};
const CAMEL = {
  isAccountDecryptionFailed: false,
  isNotVerifiedResponse: false,
  isAccountDecryptionKeyMissing: false,
};

function makeService(ozowOverrides: Record<string, unknown> = {}) {
  const ozow = {
    isPayoutsConfigured: jest.fn().mockReturnValue(true),
    getPayoutTestConfiguration: jest.fn(),
    setPayoutTestConfiguration: jest.fn().mockResolvedValue({}),
    ...ozowOverrides,
  };
  const prisma = { ozowPayoutTestAttempt: {} };
  const svc = new OzowPayoutTestService(prisma as never, ozow as never);
  return { svc, ozow };
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>) {
  const names = Object.keys(env);
  const original = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const n of names) {
      if (original[n] === undefined) delete process.env[n];
      else process.env[n] = original[n] as string;
    }
  });
}

describe('resolveMockConfigKeys', () => {
  it('maps the documented PascalCase keys', () => {
    expect(resolveMockConfigKeys(PASCAL)).toMatchObject({
      decryptionFailed: 'IsAccountDecryptionFailed',
      notVerified: 'IsNotVerifiedResponse',
      keyMissing: 'IsAccountDecryptionKeyMissing',
    });
  });

  it('maps the camelCase keys Ozow instructions use', () => {
    expect(resolveMockConfigKeys(CAMEL)).toMatchObject({
      decryptionFailed: 'isAccountDecryptionFailed',
      notVerified: 'isNotVerifiedResponse',
      keyMissing: 'isAccountDecryptionKeyMissing',
    });
  });

  it('falls back to the documented names when the config is empty', () => {
    expect(resolveMockConfigKeys({})).toMatchObject({
      decryptionFailed: 'IsAccountDecryptionFailed',
      notVerified: 'IsNotVerifiedResponse',
      keyMissing: 'IsAccountDecryptionKeyMissing',
    });
  });

  it('ignores non-boolean fields such as siteCode', () => {
    const keys = resolveMockConfigKeys({
      siteCode: null,
      isNotVerifiedResponse: false,
    });
    expect(keys.all).not.toContain('siteCode');
    expect(keys.notVerified).toBe('isNotVerifiedResponse');
  });
});

describe('OzowPayoutTestService guard', () => {
  it('refuses to run unless OZOW_PAYOUT_TEST=true', async () => {
    const { svc } = makeService();
    await withEnv({ OZOW_ENV: 'staging', OZOW_PAYOUT_TEST: undefined }, async () => {
      await expect(svc.listAttempts()).rejects.toThrow(/OZOW_PAYOUT_TEST=true/);
    });
  });

  it('refuses to run in live mode even with the opt-in set', async () => {
    const { svc } = makeService();
    await withEnv({ OZOW_ENV: 'live', OZOW_PAYOUT_TEST: 'true' }, async () => {
      await expect(svc.listAttempts()).rejects.toThrow(/live mode/);
    });
  });
});

describe('OzowPayoutTestService.setMockScenario', () => {
  it('arms exactly one flag, in the casing Ozow returned, never siteCode', async () => {
    const withSite = { siteCode: null, ...CAMEL };
    const get = jest
      .fn()
      .mockResolvedValueOnce(withSite)
      .mockResolvedValueOnce({ ...withSite, isNotVerifiedResponse: true });
    const set = jest.fn().mockResolvedValue({});
    const { svc } = makeService({
      getPayoutTestConfiguration: get,
      setPayoutTestConfiguration: set,
    });

    await withEnv({ OZOW_ENV: 'staging', OZOW_PAYOUT_TEST: 'true' }, async () => {
      const out = await svc.setMockScenario('notVerified');
      expect(set).toHaveBeenCalledWith({
        isAccountDecryptionFailed: false,
        isNotVerifiedResponse: true,
        isAccountDecryptionKeyMissing: false,
      });
      expect(get).toHaveBeenCalledTimes(2);
      expect(out.after).toEqual({ ...withSite, isNotVerifiedResponse: true });
    });
  });

  it('clears every flag when passed null', async () => {
    const set = jest.fn().mockResolvedValue({});
    const { svc } = makeService({
      getPayoutTestConfiguration: jest.fn().mockResolvedValue(PASCAL),
      setPayoutTestConfiguration: set,
    });

    await withEnv({ OZOW_ENV: 'staging', OZOW_PAYOUT_TEST: 'true' }, async () => {
      await svc.setMockScenario(null);
      expect(set).toHaveBeenCalledWith({
        IsAccountDecryptionFailed: false,
        IsNotVerifiedResponse: false,
        IsAccountDecryptionKeyMissing: false,
      });
    });
  });
});
