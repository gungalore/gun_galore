import { MotivationSellerConsentService } from './motivation-seller-consent.service';

// ────────────────────────────────────────────────────────────────────
// THE SELLER-CONSENT INVITE.
//
// ⚠️ EVERY TEST HERE EXISTS BECAUSE THIS FLOW SHIPPED BROKEN AND NOTHING
// CAUGHT IT. There was no spec for this service at all. It was deployed on
// 2026-08-23, and the invite could never once have succeeded: the controller
// passed the CLERK SUBJECT where a User.id was wanted, and
// ActionToken.authorisedUserId is a required foreign key to User.id — so the
// first thing every invite did was violate a constraint and 500.
//
// A typecheck cannot see it: both are `string`. Only a test that asserts WHICH
// string reaches the foreign key can, which is what these do.
// ────────────────────────────────────────────────────────────────────

// The firearm snapshot is encrypted at rest, so the service needs a key even
// in a unit test. Set and restored the way blob-crypto.spec.ts does it.
const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-seller-consent-specs';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

const CLERK_SUB = 'user_3II9nOHaGzfYs6BNm6R9a6aiHIE';
const USER_ID = 'cmt50g5j30000wyvnjy31n6fj';

function make(over: { user?: unknown; owns?: unknown; mint?: jest.Mock; sms?: jest.Mock } = {}) {
  const consentRow = { id: 'consent-1', status: 'INVITED', createdAt: new Date(0), updatedAt: new Date(0) };
  const del = jest.fn(async () => consentRow);
  const prisma = {
    user: { findUnique: jest.fn(async () => ('user' in over ? over.user : { id: USER_ID })) },
    motivation: { findFirst: jest.fn(async () => ('owns' in over ? over.owns : { id: 'mo-1' })) },
    motivationSellerConsent: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => consentRow),
      update: jest.fn(async () => consentRow),
      delete: del,
    },
  };
  const mint = over.mint ?? jest.fn(async () => 'tok_abc');
  const sms = over.sms ?? jest.fn(async () => ({ success: true }));
  const svc = new MotivationSellerConsentService(
    prisma as never,
    { sendSms: sms } as never,
    {} as never,
    { mint } as never,
  );
  return { svc, prisma, mint, sms, del };
}

const ARGS = {
  motivationId: 'mo-1',
  applicantClerkId: CLERK_SUB,
  applicantName: 'Gerhard Fourie',
  name: 'Piet Seller',
  phone: '0743039999',
  firearm: { make: 'CZ', serial: 'A12345' },
  baseUrl: 'https://alloutdoor.co.za',
};

describe('who the token is minted for', () => {
  it('⚠️ mints against User.id, NEVER the Clerk subject', async () => {
    // THE BUG, IN ONE ASSERTION. `authorisedUserId` is a required FK to
    // User.id; a Clerk sub there is a constraint violation and a 500, every
    // single time. Nothing but the value's SHAPE distinguishes the two.
    const { svc, mint } = make();
    await svc.invite(ARGS as never);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint.mock.calls[0][0].authorisedUserId).toBe(USER_ID);
    expect(mint.mock.calls[0][0].authorisedUserId).not.toBe(CLERK_SUB);
  });

  it('resolves the Clerk subject by clerkId, not by id', async () => {
    const { svc, prisma } = make();
    await svc.invite(ARGS as never);
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clerkId: CLERK_SUB } }),
    );
  });
});

describe('whose motivation it is', () => {
  it('⚠️ REFUSES a motivation the caller does not own', async () => {
    // The route is guarded, so the caller is signed in — but the id in the
    // path was never matched against them. Any member could attach a consent
    // to somebody else's application and spend our SMS credits doing it.
    const { svc, mint, sms } = make({ owns: null });
    await expect(svc.invite(ARGS as never)).rejects.toThrow(/not found/i);
    expect(mint).not.toHaveBeenCalled();
    expect(sms).not.toHaveBeenCalled();
  });

  it('scopes the ownership check to the resolved user', async () => {
    const { svc, prisma } = make();
    await svc.invite(ARGS as never);
    expect(prisma.motivation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mo-1', userId: USER_ID } }),
    );
  });

  it('says "not found" for an unknown user rather than leaking anything', async () => {
    const { svc } = make({ user: null });
    await expect(svc.invite(ARGS as never)).rejects.toThrow(/not found/i);
  });
});

describe('a failed invite costs nothing', () => {
  it('⚠️ deletes the row it created when the SMS will not send', async () => {
    // The row has to exist before the token can point at it, so a failure
    // used to leave one at INVITED with no token and no SMS — and the resend
    // cooldown keys on updatedAt, so that dead row then locked the applicant
    // out of retrying for a full minute. A first attempt that fails must
    // leave no trace.
    const { svc, del } = make({ sms: jest.fn(async () => ({ success: false })) });
    await expect(svc.invite(ARGS as never)).rejects.toThrow(/could not send/i);
    expect(del).toHaveBeenCalledWith({ where: { id: 'consent-1' } });
  });

  it('deletes the row when the token will not mint', async () => {
    const { svc, del, sms } = make({
      mint: jest.fn(async () => {
        throw new Error('FK violation');
      }),
    });
    await expect(svc.invite(ARGS as never)).rejects.toThrow();
    expect(sms).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith({ where: { id: 'consent-1' } });
  });

  it('keeps a row that already existed — that consent predates the failure', async () => {
    const { svc, prisma, del } = make({ sms: jest.fn(async () => ({ success: false })) });
    prisma.motivationSellerConsent.findUnique = jest.fn(async () => ({
      id: 'consent-1',
      status: 'INVITED',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })) as never;
    await expect(svc.invite(ARGS as never)).rejects.toThrow();
    expect(del).not.toHaveBeenCalled();
  });

  it('leaves nothing behind on the happy path', async () => {
    const { svc, del, sms } = make();
    await expect(svc.invite(ARGS as never)).resolves.toEqual(
      expect.objectContaining({ status: 'INVITED' }),
    );
    expect(sms).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('the firearm has to be named', () => {
  it('refuses with no serial anywhere', async () => {
    const { svc } = make();
    await expect(
      svc.invite({ ...ARGS, firearm: { make: 'CZ' } } as never),
    ).rejects.toThrow(/serial/i);
  });

  it('treats a literal NONE as no serial', async () => {
    // Real cards read "NONE" in serial rows; it is not an identifier.
    const { svc } = make();
    await expect(
      svc.invite({ ...ARGS, firearm: { make: 'CZ', serial: 'NONE' } } as never),
    ).rejects.toThrow(/serial/i);
  });

  it('accepts a barrel serial when the headline one is NONE', async () => {
    const { svc, sms } = make();
    await svc.invite({
      ...ARGS,
      firearm: { make: 'CZ', serial: 'NONE', barrelSerial: 'B999' },
    } as never);
    expect(sms).toHaveBeenCalledTimes(1);
  });

  it('refuses with no make', async () => {
    const { svc } = make();
    await expect(
      svc.invite({ ...ARGS, firearm: { serial: 'A12345' } } as never),
    ).rejects.toThrow(/make/i);
  });
});
