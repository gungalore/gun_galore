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

// ════════════════════════════════════════════════════════════════════
// THE CARD IS THE SOURCE OF TRUTH FOR THE FIREARM.
//
// The consent used to declare whatever the BUYER typed at invite. The seller's
// government card is the real record — proven live: a card OCR'd cleanly as
// HOWA 6.5mm Creedmoor B477423 while the signed consent said "CZ 557 .308
// TEST-12345", because the buyer's guess was never replaced. These lock the
// replacement, the "NONE" asymmetry, and the coarse-type mapping.
// ════════════════════════════════════════════════════════════════════
import {
  mapCardType,
  primarySerial,
  cardToApplicationFirearm,
  sanitiseCardFirearm,
} from './motivation-seller-consent.service';
import { encryptText, tryDecryptText } from '../common/blob-crypto';

describe('mapCardType — the card does not use our words', () => {
  it('maps the real card strings to the fixed choices', () => {
    expect(mapCardType('MANUALLY OPERATED RIFLE')).toBe('Rifle');
    expect(mapCardType('S/L: RIFLE CAL - RIFLE/CARBINE')).toBe('Rifle');
    expect(mapCardType('SEMI-AUTO SHOTGUN')).toBe('Shotgun');
    expect(mapCardType('SELF-LOADING PISTOL')).toBe('Handgun');
    expect(mapCardType('REVOLVER')).toBe('Handgun');
    expect(mapCardType('COMBINATION GUN')).toBe('Combination');
  });

  it('returns undefined for anything it cannot place — the buyer picks it', () => {
    expect(mapCardType('')).toBeUndefined();
    expect(mapCardType(undefined)).toBeUndefined();
    expect(mapCardType('SOMETHING ELSE')).toBeUndefined();
  });

  it('checks Combination before Rifle so a combination is not called a rifle', () => {
    expect(mapCardType('COMBINATION RIFLE/SHOTGUN')).toBe('Combination');
  });
});

describe('primarySerial — first present, never "NONE"', () => {
  it('prefers the headline serial', () => {
    expect(primarySerial({ serial: 'A1', barrelSerial: 'B2' })).toBe('A1');
  });
  it('falls through NONE and blanks to the barrel', () => {
    expect(
      primarySerial({ serial: 'NONE', barrelSerial: 'B477423', frameSerial: 'NONE' }),
    ).toBe('B477423');
  });
  it('is undefined when every row is NONE or empty', () => {
    expect(primarySerial({ serial: 'NONE', barrelSerial: '' })).toBeUndefined();
  });
});

describe('cardToApplicationFirearm — a usable subset, NONE dropped', () => {
  it('maps the HOWA card the way the live flow will', () => {
    const out = cardToApplicationFirearm({
      make: 'HOWA',
      model: 'NONE',
      type: 'MANUALLY OPERATED RIFLE',
      calibre: '6.5MM CREEDMOOR',
      serial: 'B477423',
      barrelSerial: 'B477423',
    });
    expect(out).toEqual({
      firearm_make: 'HOWA',
      firearm_type: 'Rifle',
      firearm_calibre: '6.5MM CREEDMOOR',
      firearm_serial: 'B477423',
    });
    // ⚠️ model NONE is DROPPED for the application even though it PRINTS on the
    // consent — writing the word "NONE" into a free-text field is not a value.
    expect('firearm_model' in out).toBe(false);
  });

  it('omits a field it cannot supply rather than sending an empty string', () => {
    expect(cardToApplicationFirearm({ make: 'CZ' })).toEqual({ firearm_make: 'CZ' });
  });
});

describe('sanitiseCardFirearm — the applicant can never be overwritten', () => {
  it('keeps only firearm keys, capped, and drops applicant identity', () => {
    const out = sanitiseCardFirearm({
      make: '  HOWA  ',
      calibre: '6.5MM CREEDMOOR',
      applicantName: 'AN ATTACKER',
      applicantIdNumber: '9',
      serial: 'x'.repeat(500),
    } as never);
    expect(out.make).toBe('HOWA');
    expect(out.calibre).toBe('6.5MM CREEDMOOR');
    expect((out as Record<string, unknown>).applicantName).toBeUndefined();
    expect((out as Record<string, unknown>).applicantIdNumber).toBeUndefined();
    expect(out.serial!.length).toBe(120);
  });
});

describe('submit replaces the firearm with the card, keeps the applicant', () => {
  function submitHarness(existingSnapshotObj: Record<string, unknown>) {
    let updated: Record<string, unknown> | null = null;
    const prisma = {
      motivationSellerConsent: {
        findUnique: jest.fn(async () => ({
          id: 'consent-1',
          motivationId: 'mo-1',
          status: 'INVITED',
          firearmSnapshotEncrypted: encryptText(JSON.stringify(existingSnapshotObj)),
        })),
        update: jest.fn(async (a: { data: Record<string, unknown> }) => {
          updated = a.data;
          return { id: 'consent-1' };
        }),
      },
      motivationUpload: { create: jest.fn(async () => ({})) },
    };
    const files = {
      write: jest.fn(async () => ({
        storageKey: 'k' + Math.random().toString(36).slice(2),
        byteSize: 10,
        sha256: 'h' + Math.random().toString(36).slice(2),
      })),
      remove: jest.fn(async () => undefined),
    };
    const svc = new MotivationSellerConsentService(
      prisma as never,
      { sendSms: jest.fn() } as never,
      files as never,
      { mint: jest.fn() } as never,
    );
    return { svc, get: () => updated };
  }

  const base = {
    consentId: 'consent-1',
    answers: { fullName: 'Piet Seller', idNumber: '8001015009087' },
    signature: Buffer.from('\x89PNG signature'),
    signatureMime: 'image/png',
    licenceFront: Buffer.from('jpegfront'),
    licenceBack: Buffer.from('jpegback'),
    licenceMime: 'image/jpeg',
  };

  it('⚠️ the stored snapshot is the CARD, not the buyer guess', async () => {
    const { svc, get } = submitHarness({
      make: 'CZ',
      model: '557',
      calibre: '.308 Winchester',
      serial: 'TEST-12345',
      applicantName: 'Gerhard Fourie',
      applicantIdNumber: '8905125220089',
    });
    await svc.submit({
      ...base,
      firearm: {
        make: 'HOWA',
        model: 'NONE',
        type: 'MANUALLY OPERATED RIFLE',
        calibre: '6.5MM CREEDMOOR',
        serial: 'B477423',
        section: 'SECTION 15',
      },
    } as never);
    const snap = JSON.parse(tryDecryptText(get()!.firearmSnapshotEncrypted as string)!);
    // The card won.
    expect(snap.make).toBe('HOWA');
    expect(snap.calibre).toBe('6.5MM CREEDMOOR');
    expect(snap.serial).toBe('B477423');
    expect(snap.section).toBe('SECTION 15');
    // The buyer's wrong values are gone.
    expect(snap.make).not.toBe('CZ');
    // The applicant identity is untouched — it is the buyer's, not the card's.
    expect(snap.applicantName).toBe('Gerhard Fourie');
    expect(snap.applicantIdNumber).toBe('8905125220089');
  });

  it('keeps the buyer values if the card fields arrive empty (OCR dead)', async () => {
    const { svc, get } = submitHarness({
      make: 'CZ',
      serial: 'TEST-12345',
      applicantName: 'Gerhard Fourie',
    });
    await svc.submit({ ...base, firearm: {} } as never);
    const snap = JSON.parse(tryDecryptText(get()!.firearmSnapshotEncrypted as string)!);
    expect(snap.make).toBe('CZ'); // not blanked
    expect(snap.applicantName).toBe('Gerhard Fourie');
  });
});

describe('statusFor — the buyer can see the result and collect the card firearm', () => {
  function statusHarness(over: {
    user?: unknown;
    owns?: unknown;
    consent?: unknown;
  } = {}) {
    const prisma = {
      user: { findUnique: jest.fn(async () => ('user' in over ? over.user : { id: 'U1' })) },
      motivation: { findFirst: jest.fn(async () => ('owns' in over ? over.owns : { id: 'mo-1' })) },
      motivationSellerConsent: {
        findUnique: jest.fn(async () => ('consent' in over ? over.consent : null)),
      },
    };
    const svc = new MotivationSellerConsentService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, prisma };
  }

  it('offers the mapped card firearm once COMPLETED', async () => {
    const { svc } = statusHarness({
      consent: {
        status: 'COMPLETED',
        invitedName: 'Piet',
        declinedAt: null,
        firearmSnapshotEncrypted: encryptText(
          JSON.stringify({ make: 'HOWA', type: 'MANUALLY OPERATED RIFLE', calibre: '6.5MM CREEDMOOR', serial: 'B477423' }),
        ),
      },
    });
    const res = await svc.statusFor('user_abc', 'mo-1');
    expect(res.status).toBe('COMPLETED');
    expect(res.cardFirearm).toEqual({
      firearm_make: 'HOWA',
      firearm_type: 'Rifle',
      firearm_calibre: '6.5MM CREEDMOOR',
      firearm_serial: 'B477423',
    });
  });

  it('does NOT offer a firearm while only INVITED — that is still the buyer guess', async () => {
    const { svc } = statusHarness({
      consent: {
        status: 'INVITED',
        invitedName: 'Piet',
        declinedAt: null,
        firearmSnapshotEncrypted: encryptText(JSON.stringify({ make: 'CZ' })),
      },
    });
    const res = await svc.statusFor('user_abc', 'mo-1');
    expect(res.status).toBe('INVITED');
    expect(res.cardFirearm).toBeNull();
  });

  it('reports NONE when no invite has been sent', async () => {
    const { svc } = statusHarness({ consent: null });
    expect((await svc.statusFor('user_abc', 'mo-1')).status).toBe('NONE');
  });

  it('refuses a motivation the caller does not own', async () => {
    const { svc } = statusHarness({ owns: null });
    await expect(svc.statusFor('user_abc', 'mo-1')).rejects.toThrow(/not found/i);
  });
});
