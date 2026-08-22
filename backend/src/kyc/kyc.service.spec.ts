process.env.ID_HASH_SECRET = 'test-secret-kyc-spec';

import { BadRequestException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { ClaudeKycService, type KycClaudeFindings } from './claude-kyc.service';
import { encryptSaIdNumber } from '../common/id-crypto';

// Canonical Luhn-valid SA test ID — DOB 1980-01-01.
const ID = '8001015009087';
const DOB = '1980-01-01';

function goodFindings(overrides: Partial<KycClaudeFindings['face_match']> = {}): KycClaudeFindings {
  return {
    face_match: {
      same_person: 92,
      selfie_live_capture: 90,
      document_photo_visible: 95,
      issues: [],
      ...overrides,
    },
    document: {
      looks_genuine_sa_id: 88,
      document_type: 'SMART_ID_CARD',
      extracted_id_number: ID,
      extracted_surname: 'FOURIE',
      extracted_names: 'GERHARD',
      extracted_dob: DOB,
      legibility: 90,
      issues: [],
    },
    overall_confidence: 90,
    recommendation: 'APPROVE',
    recommendation_reason: 'test',
  };
}

interface Overrides {
  user?: Record<string, unknown>;
  flagOn?: boolean;
  thresholdCents?: number;
  maxListingPrice?: number | null;
  scan?: KycClaudeFindings | Error;
  haPhoto?: string | null; // anchored pull result; null = pull throws
  tokenMints?: number;
}

function makeService(o: Overrides = {}) {
  const user = {
    id: 'u1',
    clerkId: 'clerk_1',
    kycConsentGivenAt: new Date(),
    kycIdVerifiedAt: new Date(),
    dateOfBirth: DOB,
    // ⚠️ A STORAGE KEY, NOT A CDN URL. Identity documents live in the
    // encrypted `kyc` namespace now; a row carrying only a public Cloudinary
    // link is a pre-migration one, and the readers treat it as a fallback.
    kycIdStorageKey: 'kyc/2026/08/deadbeefcafe.enc',
    kycIdMimeType: 'image/jpeg',
    kycIdDocumentUrl: null,
    kycSelfieStorageKey: null,
    kycSelfieUrl: null,
    kycStatus: 'PENDING',
    kycAttempts: 0,
    kycRequiredAt: null,
    kycConsent: true,
    idNumberEncrypted: encryptSaIdNumber(ID),
    kycHaCheckJson: { firstName: 'GERHARD', surname: 'FOURIE', dob: DOB },
    phone: '+27743039999',
    email: 'seller@example.com',
    firstName: 'Gerhard',
    kycMethod: 'CLAUDE',
    kycTier: 'STANDARD',
    ...(o.user ?? {}),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
        // Dup-hash lookups come in keyed on kycIdHash — no duplicate by default.
        if ('kycIdHash' in args.where) return null;
        return user;
      }),
      update: jest.fn().mockResolvedValue(user),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    listing: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { price: o.maxListingPrice ?? 50_000 } }),
      count: jest.fn().mockResolvedValue(1),
    },
    transaction: { findFirst: jest.fn().mockResolvedValue(null) },
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
    actionToken: { count: jest.fn().mockResolvedValue(o.tokenMints ?? 0) },
  };

  const verifyNow = {
    verifyIdBasic: jest.fn().mockResolvedValue({
      success: true,
      firstName: 'GERHARD',
      surname: 'FOURIE',
      dob: DOB,
      gender: 'M',
      deceasedStatus: 'Alive',
      idBlocked: 'NO',
      transactionId: 'vn-1',
    }),
    verifyIdNumber: jest.fn(async () => {
      if (o.haPhoto === null) throw new Error('HA pull failed');
      return {
        success: true,
        firstName: 'GERHARD',
        surname: 'FOURIE',
        dob: DOB,
        deceasedStatus: 'Alive',
        idBlocked: 'NO',
        idPhotoBase64: o.haPhoto ?? 'aGFwaG90bw==',
        transactionId: 'vn-2',
      };
    }),
  };

  const sms = { sendSms: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    sellerKycApproved: jest.fn().mockResolvedValue(undefined),
    sellerKycRejected: jest.fn().mockResolvedValue(undefined),
    sellerKycRequired: jest.fn().mockResolvedValue(undefined),
  };
  const actionTokens = { mint: jest.fn().mockResolvedValue('tok_abc') };
  const settings = {
    get: jest.fn(async (flag: { key: string }) => {
      if (flag.key === 'kyc_claude_flow_enabled') return o.flagOn ?? true;
      if (flag.key === 'kyc_anchored_threshold_cents')
        return o.thresholdCents ?? 1_000_000;
      return undefined;
    }),
  };
  const cloudinary = {
    uploadImage: jest
      .fn()
      .mockResolvedValue({ url: 'https://res.cloudinary.com/demo/image/upload/v1/kyc/u1/selfie.jpg', publicId: 'p' }),
    uploadRaw: jest
      .fn()
      .mockResolvedValue({ url: 'https://res.cloudinary.com/demo/raw/upload/v1/kyc/u1/doc.pdf', publicId: 'p' }),
  };

  const claudeKyc = new ClaudeKycService();
  const scanMock = jest.spyOn(claudeKyc, 'scan');
  if (o.scan instanceof Error) scanMock.mockRejectedValue(o.scan);
  else scanMock.mockResolvedValue(o.scan ?? goodFindings());

  // ⚠️ IDENTITY DOCUMENTS LIVE HERE NOW, NOT ON A CDN. They went up with
  // Cloudinary's defaults — no `type: 'private'`, no access_mode — so the
  // secure_url was world-readable, and the decision to RETAIN the document
  // after verification made that permanent. `read` returns a JPEG's magic
  // bytes so the mime sniffer has something real to work from.
  const files = {
    write: jest.fn(async () => ({
      storageKey: 'kyc/2026/08/deadbeefcafe.enc',
      sha256: 'sha',
      byteSize: 4,
    })),
    read: jest.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    remove: jest.fn(async () => undefined),
  };

  const service = new KycService(
    prisma as never,
    verifyNow as never,
    notifications as never,
    sms as never,
    actionTokens as never,
    settings as never,
    cloudinary as never,
    claudeKyc,
    files as never,
  );

  return {
    service,
    prisma,
    verifyNow,
    sms,
    notifications,
    actionTokens,
    cloudinary,
    files,
    scanMock,
    user,
  };
}

describe('submitDetails', () => {
  it('rejects when the flag is off', async () => {
    const { service } = makeService({ flagOn: false });
    await expect(service.submitDetails('clerk_1', ID, DOB)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a Luhn-invalid ID BEFORE burning a VerifyNow credit', async () => {
    const { service, verifyNow } = makeService();
    await expect(
      service.submitDetails('clerk_1', '8001015009088', DOB),
    ).rejects.toThrow('valid SA ID number');
    expect(verifyNow.verifyIdBasic).not.toHaveBeenCalled();
  });

  it('rejects under-18 date of birth', async () => {
    const { service, verifyNow } = makeService();
    const recent = `${new Date().getFullYear() - 10}-01-01`;
    await expect(service.submitDetails('clerk_1', ID, recent)).rejects.toThrow(
      'at least 18',
    );
    expect(verifyNow.verifyIdBasic).not.toHaveBeenCalled();
  });

  it('blocks an ID already linked to another account without burning a credit', async () => {
    const { service, prisma, verifyNow } = makeService();
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        if ('kycIdHash' in args.where) return { id: 'someone-else' };
        return { id: 'u1', kycConsentGivenAt: new Date(), idNumberEncrypted: null };
      },
    );
    await expect(service.submitDetails('clerk_1', ID, DOB)).rejects.toThrow(
      'already linked',
    );
    expect(verifyNow.verifyIdBasic).not.toHaveBeenCalled();
  });

  it('persists dob + HA snapshot + encrypted ID + locked names on success', async () => {
    const { service, prisma } = makeService({
      user: { idNumberEncrypted: null },
    });
    const res = await service.submitDetails('clerk_1', ID, DOB);
    expect(res).toEqual({ success: true, firstName: 'GERHARD', surname: 'FOURIE' });
    const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
    expect(data.dateOfBirth).toBe(DOB);
    expect(data.kycMethod).toBe('CLAUDE');
    expect(data.kycStatus).toBe('PENDING');
    expect(data.firstName).toBe('GERHARD');
    expect(data.kycHaCheckJson).toMatchObject({ dob: DOB, surname: 'FOURIE' });
    expect(typeof data.idNumberEncrypted).toBe('string');
  });
});

describe('submitSelfieClaudeVerdict', () => {
  it('VERIFIED on clean scan + clean cross-check; approval SMS sent', async () => {
    const { service, prisma, sms } = makeService();
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.status).toBe('VERIFIED');
    const um = (prisma.user.updateMany as jest.Mock).mock.calls[0][0];
    expect(um.where.kycStatus.in).toEqual(['PENDING', 'REJECTED']);
    expect(um.data.kycStatus).toBe('VERIFIED');
    expect(um.data.kycTier).toBe('STANDARD');
    expect(sms.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'kyc-approved-u1' }),
    );
  });

  it('REJECTED with a GENERIC message when the entered DOB lies about the ID digits', async () => {
    const { service } = makeService({ user: { dateOfBirth: '1980-01-02' } });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.status).toBe('REJECTED');
    // The silent catch-out must never be named to the user.
    expect((res.message as string).toLowerCase()).not.toContain('birth');
    expect((res.message as string).toLowerCase()).not.toContain('dob');
  });

  it('UNDER_REVIEW + admin alert when the Claude scan fails', async () => {
    const { service, prisma, sms } = makeService({ scan: new Error('api down') });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.status).toBe('UNDER_REVIEW');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'KYC_REVIEW' }),
      }),
    );
    // No failure SMS for a review — nothing is needed from the seller.
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('no-ops when another request already decided (guarded transition)', async () => {
    const { service, prisma, sms } = makeService();
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.success).toBe(false);
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('ANCHORED tier: pulls the HA photo and scans in anchored mode', async () => {
    const { service, verifyNow, scanMock, prisma } = makeService({
      maxListingPrice: 1_500_000, // R15k listing → over the R10k threshold
      scan: goodFindings({ same_person_vs_ha_photo: 95 } as never),
    });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(verifyNow.verifyIdNumber).toHaveBeenCalled();
    // Second arg is the consensus lens — the anchored scan now runs through
    // scanWithConsensus, which labels each reading (BASELINE here; a
    // borderline score would add the SKEPTICAL/CHARITABLE passes).
    expect(scanMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'anchored', haPhotoBase64: expect.any(String) }),
      'BASELINE',
    );
    expect(res.status).toBe('VERIFIED');
    expect(
      (prisma.user.updateMany as jest.Mock).mock.calls[0][0].data.kycTier,
    ).toBe('ANCHORED');
  });

  it('ANCHORED tier: a failed HA-photo pull parks for review, never silently downgrades', async () => {
    const { service } = makeService({
      maxListingPrice: 1_500_000,
      haPhoto: null,
    });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.status).toBe('UNDER_REVIEW');
  });

  it('third strike raises KYC_REPEATED_FAILURE', async () => {
    const { service, prisma } = makeService({
      user: { dateOfBirth: '1980-01-02', kycAttempts: 2 },
    });
    (prisma.user.findUnique as jest.Mock).mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        if ('kycIdHash' in args.where) return null;
        // post-increment re-read
        return { kycAttempts: 3 } as never;
      },
    );
    // First findUnique (the main load) also runs through the impl above —
    // give it the full user once.
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'u1',
      kycIdVerifiedAt: new Date(),
      dateOfBirth: '1980-01-02',
      kycIdDocumentUrl: 'https://res.cloudinary.com/demo/image/upload/doc.jpg',
      kycStatus: 'PENDING',
      kycAttempts: 2,
      idNumberEncrypted: encryptSaIdNumber(ID),
      kycHaCheckJson: {},
      phone: '+27743039999',
      email: 's@e.com',
      firstName: 'G',
    });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.status).toBe('REJECTED');
    expect(prisma.adminAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'KYC_REPEATED_FAILURE' }),
      }),
    );
  });
});

describe('getStatus nextStep matrix', () => {
  const base = {
    kycStatus: 'PENDING',
    kycVerifiedAt: null,
    kycFaceMatchScore: null,
    kycConsentGivenAt: new Date(),
    kycIdVerifiedAt: new Date(),
    kycRequiredAt: null,
    kycAttempts: 0,
    dateOfBirth: DOB,
    kycIdDocumentUrl: 'x',
    kycSelfieUrl: null,
    phone: '+27743039999',
  };
  const cases: [string, Record<string, unknown>, string][] = [
    ['fresh user', { ...base, kycConsentGivenAt: null, kycIdVerifiedAt: null, dateOfBirth: null, kycIdDocumentUrl: null, kycIdStorageKey: null }, 'consent'],
    ['consent only', { ...base, kycIdVerifiedAt: null, dateOfBirth: null, kycIdDocumentUrl: null, kycIdStorageKey: null }, 'details'],
    ['legacy user without dob resumes at details', { ...base, dateOfBirth: null, kycIdDocumentUrl: null, kycIdStorageKey: null }, 'details'],
    ['details done', { ...base, kycIdDocumentUrl: null, kycIdStorageKey: null }, 'document'],
    ['document done', base, 'selfie'],
    ['under review', { ...base, kycStatus: 'UNDER_REVIEW' }, 'review'],
    ['verified', { ...base, kycStatus: 'VERIFIED' }, 'done'],
    ['3 strikes rejected', { ...base, kycStatus: 'REJECTED', kycAttempts: 3 }, 'failed'],
  ];
  it.each(cases)('%s → %s', async (_label, user, expected) => {
    const { service, prisma } = makeService();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    const status = await service.getStatus('clerk_1');
    expect(status?.nextStep).toBe(expected as never);
    expect(status?.flow).toBe('CLAUDE');
    expect(status?.phoneMasked).toBe('•••9999');
  });
});

describe('sendHandoffSms', () => {
  it('mints a token and SMSes the /a/ link', async () => {
    const { service, actionTokens, sms } = makeService();
    const res = await service.sendHandoffSms('clerk_1');
    expect(res.sent).toBe(true);
    expect(actionTokens.mint).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'KYC_VERIFY' }),
    );
    expect(
      (sms.sendSms as jest.Mock).mock.calls[0][0].message,
    ).toContain('/a/tok_abc');
  });

  it('refuses without a phone on file', async () => {
    const { service } = makeService({ user: { phone: null } });
    await expect(service.sendHandoffSms('clerk_1')).rejects.toThrow(
      'No phone number',
    );
  });

  it('caps at 3 mints per hour', async () => {
    const { service, actionTokens } = makeService({ tokenMints: 3 });
    await expect(service.sendHandoffSms('clerk_1')).rejects.toThrow(
      'Too many links',
    );
    expect(actionTokens.mint).not.toHaveBeenCalled();
  });
});

describe('triggerSellerVerification', () => {
  it('no-ops while UNDER_REVIEW (no SMS, no kycRequiredAt write)', async () => {
    const { service, prisma, sms } = makeService({
      user: { kycStatus: 'UNDER_REVIEW' },
    });
    await service.triggerSellerVerification('u1');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });
});

describe('maybeUpgradeKycTier (silent anchored upgrade)', () => {
  const verifiedStandard = {
    kycStatus: 'VERIFIED',
    kycTier: 'STANDARD',
    kycMethod: 'CLAUDE',
    kycSelfieUrl: 'https://res.cloudinary.com/demo/image/upload/selfie.jpg',
  };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(16),
    } as never) as never;
  });

  it('skips below the threshold', async () => {
    const { service, verifyNow } = makeService({ user: verifiedStandard });
    await service.maybeUpgradeKycTier('u1', 500_000); // R5k < R10k
    expect(verifyNow.verifyIdNumber).not.toHaveBeenCalled();
  });

  it('silently bumps the tier when the anchored match passes', async () => {
    const { service, prisma } = makeService({
      user: verifiedStandard,
      scan: goodFindings({ same_person_vs_ha_photo: 92 } as never),
    });
    await service.maybeUpgradeKycTier('u1', 1_500_000);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { kycTier: 'ANCHORED' } }),
    );
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('flips to UNDER_REVIEW + alerts when the anchored match fails', async () => {
    const { service, prisma } = makeService({
      user: verifiedStandard,
      scan: goodFindings({ same_person_vs_ha_photo: 40 } as never),
    });
    await service.maybeUpgradeKycTier('u1', 1_500_000);
    const um = (prisma.user.updateMany as jest.Mock).mock.calls[0][0];
    expect(um.where.kycStatus).toBe('VERIFIED');
    expect(um.data.kycStatus).toBe('UNDER_REVIEW');
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });

  it('never throws into the payment path', async () => {
    const { service } = makeService({ user: verifiedStandard, haPhoto: null });
    await expect(
      service.maybeUpgradeKycTier('u1', 1_500_000),
    ).resolves.toBeUndefined();
  });
});
