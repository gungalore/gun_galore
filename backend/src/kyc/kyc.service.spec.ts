process.env.ID_HASH_SECRET = 'test-secret-kyc-spec';

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { KycService } from './kyc.service';
import { encryptSaIdNumber } from '../common/id-crypto';
import { DiditError, type DiditDecision } from '../didit/didit.types';

// Canonical Luhn-valid SA test ID — DOB 1980-01-01.
const ID = '8001015009087';
const DOB = '1980-01-01';

interface Overrides {
  user?: Record<string, unknown>;
  session?: Record<string, unknown> | null;
  createSession?: Partial<{
    session_id: string;
    url: string;
    status: string;
    workflow_id: string;
  }> | Error;
}

function makeService(o: Overrides = {}) {
  const user = {
    id: 'u1',
    email: 'seller@example.com',
    username: 'seller',
    firstName: 'Gerhard',
    phone: '+27743039999',
    kycConsentGivenAt: new Date(),
    kycIdVerifiedAt: new Date(),
    dateOfBirth: DOB,
    kycStatus: 'PENDING',
    kycAttempts: 0,
    kycRequiredAt: null,
    idNumberEncrypted: encryptSaIdNumber(ID),
    kycIdStorageKey: null,
    kycIdDocumentUrl: null,
    kycSelfieStorageKey: null,
    kycSelfieUrl: null,
    kycMethod: 'DIDIT',
    ...(o.user ?? {}),
  };

  const updateMany = jest.fn(
    async (_args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => ({ count: 1 }),
  );
  const update = jest.fn(async () => user);

  const prisma = {
    user: {
      findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
        // Dup-hash lookups come in keyed on kycIdHash — none by default.
        if ('kycIdHash' in args.where) return null;
        return user;
      }),
      update,
      updateMany,
    },
    diditVerification: {
      findFirst: jest.fn(async () => o.session ?? null),
      findUnique: jest.fn(async () => o.session ?? null),
      upsert: jest.fn(async () => ({ id: 'dv1' })),
      update: jest.fn(async () => ({ id: 'dv1' })),
    },
    adminAlert: { create: jest.fn(async () => ({})) },
    loginEvent: { create: jest.fn(async () => ({})) },
  };

  const didit = {
    createKycSession: jest.fn(async () => {
      if (o.createSession instanceof Error) throw o.createSession;
      return {
        session_id: 'sess-1',
        url: 'https://verify.didit.me/u/abc',
        session_token: 't',
        status: 'Not Started',
        workflow_id: 'wf-1',
        ...(o.createSession ?? {}),
      };
    }),
    getDecision: jest.fn(),
  };

  const notifications = {
    sellerKycApproved: jest.fn(async () => undefined),
    sellerKycRejected: jest.fn(async () => undefined),
    sellerKycRequired: jest.fn(async () => undefined),
  };
  const sms = { sendSms: jest.fn(async () => ({ success: true })) };
  const actionTokens = { mint: jest.fn(async () => 'tok') };
  const files = { remove: jest.fn(async () => undefined) };

  const service = new KycService(
    prisma as never,
    notifications as never,
    sms as never,
    actionTokens as never,
    didit as never,
    files as never,
  );

  return { service, prisma, didit, notifications, sms, update, updateMany, user };
}

function decision(over: Partial<DiditDecision> = {}): DiditDecision {
  return {
    session_id: 'sess-1',
    status: 'Approved',
    id_verifications: [
      {
        status: 'Approved',
        personal_number: ID,
        first_name: 'GERHARD',
        last_name: 'FOURIE',
        date_of_birth: DOB,
      },
    ],
    face_matches: [{ status: 'Approved', score: 92 }],
    liveness_checks: [{ status: 'Approved', score: 88 }],
    ...over,
  } as DiditDecision;
}

describe('submitDetails', () => {
  it('refuses an ID number that fails the Luhn check before anything costs money', async () => {
    const { service, didit } = makeService();
    await expect(service.submitDetails('u1', '8001015009088', DOB)).rejects.toThrow(
      BadRequestException,
    );
    expect(didit.createKycSession).not.toHaveBeenCalled();
  });

  it('refuses an applicant under 18', async () => {
    const { service } = makeService();
    const recent = new Date();
    recent.setFullYear(recent.getFullYear() - 10);
    await expect(
      service.submitDetails('u1', ID, recent.toISOString().slice(0, 10)),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses without POPIA consent', async () => {
    const { service } = makeService({ user: { kycConsentGivenAt: null } });
    await expect(service.submitDetails('u1', ID, DOB)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns nothing about the identity — there is no Home Affairs answer to echo', async () => {
    const { service } = makeService();
    const res = await service.submitDetails('u1', ID, DOB);
    expect(res).toEqual({ success: true });
  });
});

describe('startVerification', () => {
  it('refuses before the details step', async () => {
    const { service } = makeService({ user: { kycIdVerifiedAt: null } });
    await expect(service.startVerification('u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses to spend a session on an already-settled member', async () => {
    for (const kycStatus of ['VERIFIED', 'UNDER_REVIEW']) {
      const { service, didit } = makeService({ user: { kycStatus } });
      await expect(service.startVerification('u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(didit.createKycSession).not.toHaveBeenCalled();
    }
  });

  it('records the session and hands back the hosted URL', async () => {
    const { service, prisma } = makeService();
    const res = await service.startVerification('u1');
    expect(res.url).toBe('https://verify.didit.me/u/abc');
    expect(prisma.diditVerification.upsert).toHaveBeenCalled();
  });

  it('raises an admin alert and stays user-safe when Didit is down', async () => {
    const { service, prisma } = makeService({
      createSession: new DiditError('provider_unavailable', 'boom'),
    });
    await expect(service.startVerification('u1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.adminAlert.create).toHaveBeenCalled();
  });
});

describe('applyDecision', () => {
  const session = { id: 'dv1', userId: 'u1', status: 'In Progress' };

  it('is a no-op for a session we never recorded', async () => {
    const { service, updateMany } = makeService({ session: null });
    expect(await service.applyDecision('nope', decision())).toEqual({
      applied: false,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('leaves an in-flight status alone', async () => {
    const { service, updateMany } = makeService({ session });
    const res = await service.applyDecision(
      'sess-1',
      decision({ status: 'In Progress' }),
    );
    expect(res.applied).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('verifies on Approved when the document agrees with what was typed', async () => {
    const { service, updateMany, notifications } = makeService({ session });
    const res = await service.applyDecision('sess-1', decision());
    expect(res).toEqual({ applied: true, status: 'VERIFIED' });
    expect(updateMany.mock.calls[0][0].data.kycStatus).toBe('VERIFIED');
    expect(notifications.sellerKycApproved).toHaveBeenCalled();
  });

  // The whole point of keeping the typed ID number: Didit proves the document
  // is genuine, not that it belongs to the person holding this account.
  it('parks an Approved session for review when the document is a DIFFERENT person', async () => {
    const { service, updateMany, prisma, notifications } = makeService({ session });
    const res = await service.applyDecision(
      'sess-1',
      decision({
        id_verifications: [
          { status: 'Approved', personal_number: '9202204720082', date_of_birth: '1992-02-20' },
        ],
      }),
    );
    expect(res.status).toBe('UNDER_REVIEW');
    expect(updateMany.mock.calls[0][0].data.kycStatus).toBe('UNDER_REVIEW');
    expect(prisma.adminAlert.create).toHaveBeenCalled();
    // Never told they passed, never told they failed.
    expect(notifications.sellerKycApproved).not.toHaveBeenCalled();
    expect(notifications.sellerKycRejected).not.toHaveBeenCalled();
  });

  it('rejects on Declined', async () => {
    const { service, updateMany, notifications } = makeService({ session });
    const res = await service.applyDecision(
      'sess-1',
      decision({ status: 'Declined' }),
    );
    expect(res.status).toBe('REJECTED');
    expect(updateMany.mock.calls[0][0].data.kycStatus).toBe('REJECTED');
    expect(notifications.sellerKycRejected).toHaveBeenCalled();
  });

  // "In Review" is Didit saying a human has not decided. Collapsing it either
  // way is the difference between paying an unverified seller and refusing a
  // real one.
  it.each(['In Review', 'Abandoned', 'Expired', 'Kyc Expired', 'Something New'])(
    'parks %s in UNDER_REVIEW rather than guessing',
    async (status) => {
      const { service, updateMany } = makeService({ session });
      const res = await service.applyDecision(
        'sess-1',
        decision({ status: status as DiditDecision['status'] }),
      );
      expect(res.status).toBe('UNDER_REVIEW');
      expect(updateMany.mock.calls[0][0].data.kycStatus).toBe('UNDER_REVIEW');
    },
  );

  // Didit retries any non-2xx and can redeliver the same status. The guarded
  // updateMany is what stops a redelivery burning a second attempt.
  it('is idempotent when the guard matches nothing', async () => {
    const { service, updateMany } = makeService({ session });
    updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await service.applyDecision('sess-1', decision());
    expect(res.applied).toBe(false);
  });

  it('never overwrites a name with an empty read', async () => {
    const { service, updateMany } = makeService({ session });
    await service.applyDecision(
      'sess-1',
      decision({
        id_verifications: [{ status: 'Approved', personal_number: ID }],
      }),
    );
    const data = updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('firstName');
    expect(data).not.toHaveProperty('lastName');
  });
});

describe('getStatus nextStep matrix', () => {
  it('sends a member with no consent to consent', async () => {
    const { service } = makeService({ user: { kycConsentGivenAt: null } });
    expect((await service.getStatus('u1'))!.nextStep).toBe('consent');
  });

  it('sends a consented member with no details to details', async () => {
    const { service } = makeService({ user: { kycIdVerifiedAt: null } });
    expect((await service.getStatus('u1'))!.nextStep).toBe('details');
  });

  it('sends a member with details and no session to verify', async () => {
    const { service } = makeService({ session: null });
    expect((await service.getStatus('u1'))!.nextStep).toBe('verify');
  });

  it('holds a member with an in-flight session on waiting', async () => {
    const { service } = makeService({
      session: { diditSessionId: 'sess-1', status: 'In Progress' },
    });
    expect((await service.getStatus('u1'))!.nextStep).toBe('waiting');
  });

  it('reports done / review / failed from the stored status', async () => {
    const done = makeService({ user: { kycStatus: 'VERIFIED' } });
    expect((await done.service.getStatus('u1'))!.nextStep).toBe('done');

    const review = makeService({ user: { kycStatus: 'UNDER_REVIEW' } });
    expect((await review.service.getStatus('u1'))!.nextStep).toBe('review');

    const failed = makeService({
      user: { kycStatus: 'REJECTED', kycAttempts: 3 },
    });
    expect((await failed.service.getStatus('u1'))!.nextStep).toBe('failed');
  });

  it('masks the phone number', async () => {
    const { service } = makeService();
    expect((await service.getStatus('u1'))!.phoneMasked).toBe('•••9999');
  });
});
