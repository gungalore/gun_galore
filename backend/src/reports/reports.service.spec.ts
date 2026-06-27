import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    listing: { findUnique: jest.Mock };
    adminAlert: { create: jest.Mock };
  };
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      listing: { findUnique: jest.fn() },
      adminAlert: { create: jest.fn().mockResolvedValue({}) },
    };
    service = new ReportsService(prisma as never);
  });

  it('creates a LISTING_REPORTED AdminAlert with the listing id + reason', async () => {
    prisma.listing.findUnique.mockResolvedValue({ id: 'L1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'U_reporter' });
    await service.reportListing('L1', 'clerk_reporter', 'scam', 'looks fake');
    const arg = prisma.adminAlert.create.mock.calls[0][0];
    expect(arg.data.type).toBe('LISTING_REPORTED');
    expect(arg.data.referenceId).toBe('L1');
    const ctx = JSON.parse(arg.data.context);
    expect(ctx.reason).toBe('scam');
    expect(ctx.reporterId).toBe('U_reporter');
  });

  it('maps an unknown reason to "other"', async () => {
    prisma.listing.findUnique.mockResolvedValue({ id: 'L1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'U' });
    await service.reportListing('L1', 'clerk', 'whatever');
    const ctx = JSON.parse(prisma.adminAlert.create.mock.calls[0][0].data.context);
    expect(ctx.reason).toBe('other');
  });

  it('404s reporting a non-existent listing', async () => {
    prisma.listing.findUnique.mockResolvedValue(null);
    await expect(
      service.reportListing('nope', 'clerk', 'scam'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a SELLER_REPORTED alert keyed on the seller User.id', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'S1' }) // seller lookup by clerkId
      .mockResolvedValueOnce({ id: 'U_reporter' }); // reporter
    await service.reportSeller('clerk_seller', 'clerk_reporter', 'suspicious');
    const arg = prisma.adminAlert.create.mock.calls[0][0];
    expect(arg.data.type).toBe('SELLER_REPORTED');
    expect(arg.data.referenceId).toBe('S1');
  });

  it('blocks self-reporting', async () => {
    await expect(
      service.reportSeller('clerk_same', 'clerk_same', 'scam'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
