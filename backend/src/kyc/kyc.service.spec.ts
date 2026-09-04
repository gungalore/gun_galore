process.env.ID_HASH_SECRET = 'test-secret-kyc-spec';

import { BadRequestException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { ClaudeKycService, type KycClaudeFindings } from './claude-kyc.service';
import { AwsKycService } from './aws-kyc.service';
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

  // ClaudeKycService is REAL — it still owns statusFromFindings and
  // retakeReason, which is exactly what these tests exercise. Only the
  // scan itself moved to AWS, so that is the only thing stubbed.
  const claudeKyc = new ClaudeKycService();
  const aws = new AwsKycService();
  const scanMock = jest.spyOn(aws, 'scan');
  if (o.scan instanceof Error) scanMock.mockRejectedValue(o.scan);
  else
    scanMock.mockResolvedValue({
      ...(o.scan ?? goodFindings()),
      provenance: {
        engine: 'aws' as const,
        integrity: {
          score: 90,
          source: 'rules' as const,
          checked: [],
          notChecked: [],
          flags: [],
        },
        livenessRan: true,
        notes: [],
      },
    });

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
    aws,
    files as never,
  );

  return {
    service,
    aws,
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
    // `mode` and the consensus lens both belonged to the Claude flow and
    // are gone: AWS returns one deterministic reading, and anchored mode
    // is derived in kyc.service from the tier plus whether a Home Affairs
    // photo actually came back. What must still hold is that the photo
    // reached the scan — without it there is no anchored gate at all.
    expect(scanMock).toHaveBeenCalledWith(
      expect.objectContaining({ haPhotoBase64: expect.any(String) }),
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

// ─────────────────────────────────────────────────────────────────────
// A RETAKE is a camera problem, not a verdict. The server is careful about
// this — no attempt increment, no status write, no alert, no failure SMS —
// but it says so ONLY through the `outcome` field, because `status` is
// deliberately left at whatever the seller already had. The wizard used to
// infer a rejection from that unchanged status, show the "email support"
// screen, and spend one of its three local attempts on a photo the server
// never counted. These tests hold the signal in place.
// ─────────────────────────────────────────────────────────────────────
describe('submitSelfieClaudeVerdict — RETAKE is not a failure', () => {
  it('reports outcome RETAKE and takes no strike', async () => {
    const { service, prisma } = makeService({
      // Can't see the photo on the ID, so there is nothing to compare the
      // selfie against — ask for a better picture, do not accuse anyone.
      scan: goodFindings({ document_photo_visible: 15 }),
    });

    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');

    expect(res.outcome).toBe('RETAKE');
    expect(res.status).toBe('PENDING');
    // The guarded write is what increments kycAttempts and sets kycStatus.
    // Reaching it at all would cost the seller a strike.
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });

  it('tells the seller what to do differently, not to email support', async () => {
    const { service } = makeService({
      scan: goodFindings({ document_photo_visible: 15 }),
    });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.message).toMatch(/retake|light|glare|frame/i);
    expect(res.message).not.toMatch(/email .*support/i);
  });

  it('a real rejection is still reported as one', async () => {
    // The counterpart: outcome must actually discriminate. If REJECTED also
    // came back as RETAKE the field would be decoration.
    const { service } = makeService({
      scan: goodFindings({ same_person: 4 }),
    });
    const res = await service.submitSelfieClaudeVerdict('clerk_1', 'c2VsZmll');
    expect(res.outcome).toBe('REJECTED');
  });
});

// ─────────────────────────────────────────────────────────────────────
// The liveness challenge is the ONLY thing that can answer the
// anti-spoofing gate, and it runs in the browser against credentials this
// endpoint vends. The failure mode that matters is not an outage — it is
// the endpoint quietly handing back something unusable and the wizard
// carrying on as though the check had happened.
// ─────────────────────────────────────────────────────────────────────
describe('createLivenessSession', () => {
  const ROLE = 'AWS_KYC_LIVENESS_ROLE_ARN';
  const original = process.env[ROLE];
  afterEach(() => {
    if (original === undefined) delete process.env[ROLE];
    else process.env[ROLE] = original;
  });

  it('reports itself unavailable when no role is configured — and mints NO session', async () => {
    delete process.env[ROLE];
    const { service, aws } = makeService();
    const create = jest.spyOn(aws, 'createLivenessSession');

    const res = await service.createLivenessSession('clerk_1');

    expect(res.available).toBe(false);
    expect('sessionId' in res).toBe(false);
    // A session starts expiring the moment it exists and is single-use.
    // Minting one we cannot hand credentials for burns it for nothing and
    // gives the browser an id that can only ever come back as CREATED.
    expect(create).not.toHaveBeenCalled();
  });

  it('vends credentials and a session together when configured', async () => {
    process.env[ROLE] = 'arn:aws:iam::123456789012:role/alloutdoor-kyc-liveness-browser';
    const { service, aws } = makeService();
    jest.spyOn(aws, 'vendBrowserCredentials').mockResolvedValue({
      accessKeyId: 'ASIA_TEST',
      secretAccessKey: 'secret',
      sessionToken: 'token',
      expiration: new Date().toISOString(),
    });
    jest.spyOn(aws, 'createLivenessSession').mockResolvedValue('sess_123');

    const res = await service.createLivenessSession('clerk_1');

    expect(res.available).toBe(true);
    // The pair is atomic on purpose: a session id without credentials is
    // unusable, and credentials without a session have nothing to stream.
    expect(res).toMatchObject({
      sessionId: 'sess_123',
      region: expect.any(String),
      credentials: expect.objectContaining({ sessionToken: 'token' }),
    });
  });

  it('never returns the server key to the browser', async () => {
    process.env[ROLE] = 'arn:aws:iam::123456789012:role/alloutdoor-kyc-liveness-browser';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_SERVER_KEY_MUST_NOT_LEAK';
    const { service, aws } = makeService();
    jest.spyOn(aws, 'vendBrowserCredentials').mockResolvedValue({
      accessKeyId: 'ASIA_TEMP',
      secretAccessKey: 'temp',
      sessionToken: 'token',
      expiration: new Date().toISOString(),
    });
    jest.spyOn(aws, 'createLivenessSession').mockResolvedValue('sess_123');

    const res = await service.createLivenessSession('clerk_1');

    expect(JSON.stringify(res)).not.toContain('AKIA_SERVER_KEY_MUST_NOT_LEAK');
  });
});
