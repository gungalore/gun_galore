import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

// Address-book CRUD + notification-preference logic (Phase 2). Light Prisma
// mock; $transaction runs the callback against the same mock.
describe('UsersService — address book & notification prefs', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    address: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: UsersService;

  const validAddr = {
    street: '1 Main Rd',
    city: 'Cape Town',
    postalCode: '8001',
    province: 'WESTERN_CAPE',
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      address: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    service = new UsersService(
      prisma as never,
      {} as never,
      { isBanvEnabled: () => false } as never,
      { resolveByEntity: jest.fn() } as never,
      { purgeForUser: jest.fn() } as never,
      // Account deletion removes a member's encrypted licence documents before
      // the cascade takes the rows that point at them.
      { purgeForUser: jest.fn(async () => ({ filesRemoved: 0, filesFailed: 0, motivations: 0 })) } as never,
      // And the pair that matters most: the identity document and the selfie
      // are encrypted files on disk, and a Prisma cascade cannot reach the
      // filesystem.
      { purgeKycFiles: jest.fn(async () => ({ removed: 0, failed: 0 })) } as never,
      // Closing an account without erasing the evidence.
      {
        close: jest.fn(async () => ({ clerkId: 'c', cancelledListingIds: [] })),
        canClose: jest.fn(async () => ({ canClose: true, restricted: false, blockers: [] })),
        assertReason: jest.fn((r: string) => r),
      } as never,
    );
  });

  it('makes the first saved address the default', async () => {
    prisma.address.count.mockResolvedValue(0);
    const created = await service.createAddress('clerk1', validAddr as never);
    expect(created.isDefault).toBe(true);
  });

  it('clears the previous default when a new default is added', async () => {
    prisma.address.count.mockResolvedValue(2);
    await service.createAddress('clerk1', { ...validAddr, isDefault: true } as never);
    expect(prisma.address.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', isDefault: true },
        data: { isDefault: false },
      }),
    );
  });

  it('does not auto-default a non-first address', async () => {
    prisma.address.count.mockResolvedValue(3);
    const created = await service.createAddress('clerk1', validAddr as never);
    expect(created.isDefault).toBe(false);
  });

  it('rejects updating an address that is not the user’s', async () => {
    prisma.address.findFirst.mockResolvedValue(null);
    await expect(
      service.updateAddress('clerk1', 'aX', { city: 'Durban' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('promotes another address to default when the default is deleted', async () => {
    prisma.address.findFirst
      .mockResolvedValueOnce({ id: 'a1', userId: 'u1', isDefault: true }) // the one being deleted
      .mockResolvedValueOnce({ id: 'a2', userId: 'u1', isDefault: false }); // next to promote
    await service.deleteAddress('clerk1', 'a1');
    expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(prisma.address.update).toHaveBeenCalledWith({
      where: { id: 'a2' },
      data: { isDefault: true },
    });
  });

  // ⚠️ THE FLOOR LIVES IN THE `where`, so these assert on updateMany, not
  // update. Turning SMS off is only allowed while email is still on, and that
  // condition rides along in the WHERE rather than being decided by an earlier
  // read — two tabs racing can no longer land on both-off.
  it('writes only the provided notification-preference booleans', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: true,
    });
    await service.updateNotificationPrefs('clerk1', { smsEnabled: false });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkId: 'clerk1', notifyEmailEnabled: true },
      data: { notifySmsEnabled: false },
    });
  });

  // ⚠️ The frontend PATCHes ONLY the toggle being flipped, so a body of
  // { smsEnabled: false } is all the server sees — the fact that email is
  // already off lives in the row. The guarded WHERE simply fails to match it.
  it('refuses to leave a member with neither email nor SMS', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(
      service.updateNotificationPrefs('clerk1', { smsEnabled: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Both halves in one body is decidable from the body alone, so it must not
  // cost a round trip.
  it('rejects both channels off in one body without touching the row', async () => {
    await expect(
      service.updateNotificationPrefs('clerk1', {
        emailEnabled: false,
        smsEnabled: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  // WhatsApp is settable now, but it carries SHIPPING UPDATES ONLY and stays
  // operator-gated (whatsapp_enabled), so it still cannot stand in as the one
  // channel a member is guaranteed to keep.
  it('does not let WhatsApp satisfy the at-least-one-channel floor', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    await expect(
      service.updateNotificationPrefs('clerk1', {
        emailEnabled: false,
        whatsappEnabled: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkId: 'clerk1', notifySmsEnabled: true },
      data: { notifyEmailEnabled: false, notifyWhatsappEnabled: true },
    });
  });

  // …and the mirror image: WhatsApp is outside the floor, so setting it must
  // work whatever the other two are — and it takes no guard at all, because
  // the patch never touches the email/SMS pair.
  it('lets WhatsApp be set even when email and SMS are both already off', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      notifyEmailEnabled: false,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
    });
    await service.updateNotificationPrefs('clerk1', { whatsappEnabled: false });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkId: 'clerk1' },
      data: { notifyWhatsappEnabled: false },
    });
  });

  it('writes the fallback channel', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      notifyEmailEnabled: true,
      notifySmsEnabled: true,
      notifyWhatsappEnabled: true,
      notifyFallbackChannel: 'SMS',
    });
    await service.updateNotificationPrefs('clerk1', { fallbackChannel: 'SMS' });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkId: 'clerk1' },
      data: { notifyFallbackChannel: 'SMS' },
    });
  });

  // ⚠️ The endpoint takes an inline body type, which is erased at runtime, so
  // the global ValidationPipe never sees this field — the service is the only
  // thing standing between an arbitrary string and a Prisma enum cast. The
  // rejection must land BEFORE the write, not as a 500 out of Postgres.
  it('rejects an unknown fallback channel without writing', async () => {
    await expect(
      service.updateNotificationPrefs('clerk1', {
        fallbackChannel: 'CARRIER_PIGEON',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  // The fallback only fires when a send on an enabled channel FAILS, so it is
  // outside the floor for the same practical reason WhatsApp is — and setting
  // it takes no guard, because it never touches the email/SMS pair. A member
  // already sitting on both-off must still be able to choose where a failed
  // send retries.
  it('lets the fallback be set even when email and SMS are both already off', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      notifyEmailEnabled: false,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: true,
      notifyFallbackChannel: 'NONE',
    });
    await service.updateNotificationPrefs('clerk1', {
      fallbackChannel: 'NONE',
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { clerkId: 'clerk1' },
      data: { notifyFallbackChannel: 'NONE' },
    });
  });
});

// ── account deletion ────────────────────────────────────────────────
//
// Both branches of deleteByClerkId used to leak a member's encrypted licence
// documents, in opposite directions: a hard delete cascaded the rows away and
// left the files unreachable, and the PII-scrub fallback kept the User row so
// the motivations survived an erasure request entirely.

describe('UsersService.deleteByClerkId', () => {
  function build(
    opts: { firearmTxns?: number; payoutsDue?: number } = {},
  ) {
    const retention = {
      purgeForUser: jest.fn(async () => ({
        filesRemoved: 2,
        filesFailed: 0,
        motivations: 1,
      })),
    };
    const order: string[] = [];
    let scrubbed: Record<string, unknown> = {};
    let counts = 0;
    const prisma: any = {
      user: {
        findFirst: jest.fn(async () => ({ id: 'u-1' })),
        deleteMany: jest.fn(async () => {
          order.push('user.delete');
          return { count: 1 };
        }),
        updateMany: jest.fn(async (a: any) => {
          order.push('user.scrub');
          scrubbed = a.data;
          return { count: 1 };
        }),
      },
      // First count is the firearm-transfer hold, second is payouts owed.
      transaction: {
        count: jest.fn(async () => {
          counts += 1;
          return counts === 1 ? (opts.firearmTxns ?? 0) : (opts.payoutsDue ?? 0);
        }),
      },
    };
    retention.purgeForUser.mockImplementation(async () => {
      order.push('motivations.purge');
      return { filesRemoved: 2, filesFailed: 0, motivations: 1 };
    });
    const licenceCentre = { purgeForUser: jest.fn() };
    licenceCentre.purgeForUser.mockImplementation(async () => {
      order.push('licence.purge');
      return { credentials: 1, filesRemoved: 1, filesFailed: 0 };
    });
    const svc = new UsersService(
      prisma as never,
      {} as never,
      { isBanvEnabled: () => false } as never,
      { resolveByEntity: jest.fn() } as never,
      retention as never,
      licenceCentre as never,
      // And the pair that matters most: the identity document and the selfie
      // are encrypted files on disk, and a Prisma cascade cannot reach the
      // filesystem.
      { purgeKycFiles: jest.fn(async () => ({ removed: 0, failed: 0 })) } as never,
      // Closing an account without erasing the evidence.
      {
        close: jest.fn(async () => ({ clerkId: 'c', cancelledListingIds: [] })),
        canClose: jest.fn(async () => ({ canClose: true, restricted: false, blockers: [] })),
        assertReason: jest.fn((r: string) => r),
      } as never,
    );
    return { svc, prisma, retention, licenceCentre, order, s: () => scrubbed };
  }

  it('erases the Licence Centre even when the hard delete falls back to a scrub', async () => {
    // THE BRANCH THAT MATTERS. When a financial foreign key blocks the delete,
    // the User row SURVIVES and is scrubbed instead — so no cascade ever runs,
    // and a vault document would outlive the erasure request that was supposed
    // to remove it. purgeForUser deletes the rows explicitly for this reason.
    const { svc, licenceCentre } = build();
    await svc.deleteByClerkId('clerk_1');
    expect(licenceCentre.purgeForUser).toHaveBeenCalledTimes(1);
  });

  it('still scrubs the account when the licence purge throws', async () => {
    // The caller is a Clerk webhook: an exception makes Clerk retry forever
    // and the account is never dealt with at all.
    const { svc, licenceCentre, order } = build();
    licenceCentre.purgeForUser.mockRejectedValueOnce(new Error('disk gone'));
    await expect(svc.deleteByClerkId('clerk_1')).resolves.not.toThrow();
    expect(order).toContain('user.scrub');
  });

  it('NEVER hard-deletes the row', async () => {
    // ⚠️ THE WHOLE POINT. This used to attempt a hard delete FIRST and treat
    // the scrub as the catch — so the member with the cleanest record got the
    // most thorough wipe, and with them went their Complaint rows, every
    // ComplaintPhoto, their SupportTicket history and their LoginEvent trail,
    // all by cascade. Operator, 2026-08-22: "if a user commited a crime or
    // something they cant just vanish by deleting and wiping evidence."
    const { svc, prisma, order } = build();
    await svc.deleteByClerkId('clerk_1');
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(order).not.toContain('user.delete');
  });

  it('does not stamp isBanned — leaving is not misconduct', async () => {
    // It used to. Every admin view and every isBanned filter then read a
    // departure as an enforcement action, including the ones an admin uses to
    // find people we have actually banned.
    const { svc, s } = build();
    await svc.deleteByClerkId('clerk_1');
    expect(s()).not.toHaveProperty('isBanned');
  });

  it('HOLDS the identity when a firearm transfer needs Section C', async () => {
    // ⚠️ assembleSaps534Data builds Section C of the SAP 534 LIVE off this
    // row — firstName, lastName, idNumberEncrypted, phone, email and the
    // address block — and Transaction carries no identity snapshot. Nulling
    // them made a statutory firearm-transfer form unregenerable, with the
    // whole of Section C blank on re-download.
    const { svc, s } = build({ firearmTxns: 1 });
    await svc.deleteByClerkId('clerk_1');
    for (const k of [
      'firstName',
      'lastName',
      'idNumberEncrypted',
      'phone',
      'email',
      'addrStreet',
    ]) {
      expect(s()).not.toHaveProperty(k);
    }
    // The rest still goes.
    expect(s()).toMatchObject({ avatarUrl: null, kycIdStorageKey: null });
  });

  it('erases the identity when no firearm transfer is involved', async () => {
    const { svc, s } = build({ firearmTxns: 0 });
    await svc.deleteByClerkId('clerk_1');
    expect(s()).toMatchObject({
      firstName: null,
      lastName: null,
      idNumberEncrypted: null,
      phone: null,
      // ⚠️ .invalid is reserved by RFC 6761 so it can never resolve. A
      // made-up subdomain of a domain we own can be created by accident and
      // start accepting mail addressed to erased members.
      email: expect.stringContaining('@accounts.invalid'),
      phoneVerified: false,
    });
  });

  it('HOLDS the bank details while a payout is still owed', async () => {
    // hasBank() is the readiness predicate for every payout run. Clearing the
    // quartet while money is due makes it permanently unpayable, with no alert
    // and nobody left to re-collect the details from.
    const { svc, s } = build({ payoutsDue: 1 });
    await svc.deleteByClerkId('clerk_1');
    expect(s()).not.toHaveProperty('bankAccountNumber');
  });

  it('clears the bank details when nothing is owed', async () => {
    const { svc, s } = build({ payoutsDue: 0 });
    await svc.deleteByClerkId('clerk_1');
    expect(s()).toMatchObject({ bankAccountNumber: null, bankName: null });
  });

  it('silences every channel, because the row now survives', async () => {
    // Without this a cron could still address an erased member — at the
    // sentinel address.
    const { svc, s } = build();
    await svc.deleteByClerkId('clerk_1');
    expect(s()).toMatchObject({
      notifyEmailEnabled: false,
      notifySmsEnabled: false,
      notifyWhatsappEnabled: false,
    });
  });

  it('removes the documents BEFORE scrubbing the row that points at them', async () => {
    // A cascade cannot reach the filesystem, and the scrub nulls the keys —
    // so the other order strands the encrypted files with nothing left
    // referencing them, invisible to the nightly sweep, which finds files
    // THROUGH rows.
    const { svc, retention, order } = build();
    await svc.deleteByClerkId('clerk_1');
    expect(retention.purgeForUser).toHaveBeenCalledWith('u-1');
    expect(order).toEqual([
      'motivations.purge',
      'licence.purge',
      'user.scrub',
    ]);
  });

  it('does not throw out of the webhook when the purge fails', async () => {
    // Clerk retries forever on a non-2xx, and the account stays undeleted.
    const { svc, retention } = build();
    retention.purgeForUser.mockRejectedValueOnce(new Error('disk on fire'));
    await expect(svc.deleteByClerkId('clerk_1')).resolves.toBeUndefined();
  });

  it('skips the purge for a clerk id we never had a row for', async () => {
    const { svc, prisma, retention } = build();
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await svc.deleteByClerkId('clerk_unknown');
    expect(retention.purgeForUser).not.toHaveBeenCalled();
  });
});
