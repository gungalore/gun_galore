// DealerVerificationService transitively imports ShippingService → the
// meilisearch client (ESM-only). Stub it so Jest can load the graph — same
// pattern the other payments specs use.
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { DealerVerificationService } from './dealer-verification.service';

/**
 * Unit tests for the dealer auto-registration hook
 * (DealerVerificationService.registerDealerFromVerification) — the money-path
 * side effect that harvests a SAPS-licensed dealer off a verified transfer.
 * Exercised directly with mocked prisma + settings; the private method is
 * reached via bracket access.
 */

type Mock = jest.Mock;

function makeService(flagOn: boolean) {
  const prisma = {
    transaction: { findUnique: jest.fn() as Mock, update: jest.fn() as Mock },
    dealer: {
      findUnique: jest.fn() as Mock,
      create: jest.fn() as Mock,
      update: jest.fn() as Mock,
    },
    adminAlert: {
      create: jest.fn().mockResolvedValue({}) as Mock,
      findFirst: jest.fn().mockResolvedValue(null) as Mock,
    },
  };
  const settings = { get: jest.fn().mockResolvedValue(flagOn) };
  const svc = new DealerVerificationService(
    prisma as never,
    {} as never, // cloudinary
    {} as never, // notifications
    {} as never, // zohoBooks
    {} as never, // shipping
    settings as never,
  );
  const run = (txId: string) =>
    (svc as unknown as {
      registerDealerFromVerification: (id: string) => Promise<void>;
    }).registerDealerFromVerification(txId);
  return { prisma, settings, run };
}

const findings = (licence: string | null) => ({
  saps534: {
    extracted_dealer_licence: licence,
    extracted_dealer_name: 'Test Dealer CC',
    extracted_dealer_address: '1 Test Rd',
    extracted_dealer_city: 'Testville',
    extracted_dealer_province: 'Gauteng',
  },
});

describe('registerDealerFromVerification', () => {
  it('is a pure no-op when the flag is OFF (never reads the tx)', async () => {
    const { prisma, run } = makeService(false);
    await run('tx1');
    expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
    expect(prisma.dealer.create).not.toHaveBeenCalled();
  });

  it('short-circuits idempotently when the tx is already dealer-linked', async () => {
    const { prisma, run } = makeService(true);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx1',
      dealerId: 'existing-dealer',
      stockedAtDealerName: 'X',
      stockedAtDealerAddress: 'Y',
      stockedAtDealerPhone: 'Z',
      dealerVerificationFindings: findings('1234567'),
    });
    await run('tx1');
    expect(prisma.dealer.findUnique).not.toHaveBeenCalled();
    expect(prisma.dealer.create).not.toHaveBeenCalled();
    expect(prisma.dealer.update).not.toHaveBeenCalled();
  });

  it('raises a NO_LICENCE alert and creates nothing when no licence is readable', async () => {
    const { prisma, run } = makeService(true);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx1',
      dealerId: null,
      stockedAtDealerName: 'Karoo Guns',
      stockedAtDealerAddress: 'Main St',
      stockedAtDealerPhone: null,
      dealerVerificationFindings: findings(null),
    });
    await run('tx1');
    expect(prisma.dealer.create).not.toHaveBeenCalled();
    expect(prisma.adminAlert.create).toHaveBeenCalledTimes(1);
    expect(prisma.adminAlert.create.mock.calls[0][0].data.type).toBe(
      'DEALER_AUTO_REGISTER_NO_LICENCE',
    );
  });

  it('does NOT re-raise the no-licence alert if one already exists (swap-leg re-approval idempotency)', async () => {
    const { prisma, run } = makeService(true);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx1',
      dealerId: null,
      stockedAtDealerName: 'Karoo Guns',
      stockedAtDealerAddress: 'Main St',
      stockedAtDealerPhone: null,
      dealerVerificationFindings: findings(null),
    });
    // An alert for this tx already exists (a prior approval raised it).
    prisma.adminAlert.findFirst.mockResolvedValue({ id: 'alert-1' });
    await run('tx1');
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
    expect(prisma.dealer.create).not.toHaveBeenCalled();
  });

  it('creates a new dealer INACTIVE + UNVERIFIED + source=AUTO, links the tx, alerts', async () => {
    const { prisma, run } = makeService(true);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx1',
      dealerId: null,
      stockedAtDealerName: 'Test Dealer typed',
      stockedAtDealerAddress: '1 Test Road, Testville',
      stockedAtDealerPhone: '+27820000000',
      dealerVerificationFindings: findings(' 12 34 567 '),
    });
    prisma.dealer.findUnique.mockResolvedValue(null);
    prisma.dealer.create.mockResolvedValue({
      id: 'new-dealer',
      name: 'Test Dealer CC',
      licenceNumber: '1234567',
    });

    await run('tx1');

    expect(prisma.dealer.create).toHaveBeenCalledTimes(1);
    const created = prisma.dealer.create.mock.calls[0][0].data;
    expect(created.licenceNumber).toBe('1234567'); // whitespace stripped
    expect(created.isActive).toBe(false);
    expect(created.isVerified).toBe(false);
    expect(created.source).toBe('AUTO_VERIFICATION');
    expect(created.firstSeenAt).toBeInstanceOf(Date);
    // tx linked to the new dealer
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' },
      data: { dealerId: 'new-dealer' },
    });
    // new-dealer alert raised
    expect(prisma.adminAlert.create.mock.calls[0][0].data.type).toBe(
      'DEALER_AUTO_REGISTERED',
    );
  });

  it('NEVER demotes an existing dealer — only bumps lastSeenAt + links, no alert', async () => {
    const { prisma, run } = makeService(true);
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx1',
      dealerId: null,
      stockedAtDealerName: 'Curated Dealer',
      stockedAtDealerAddress: 'Somewhere',
      stockedAtDealerPhone: null,
      dealerVerificationFindings: findings('1234567'),
    });
    prisma.dealer.findUnique.mockResolvedValue({ id: 'curated-1' });

    await run('tx1');

    expect(prisma.dealer.create).not.toHaveBeenCalled();
    // Only lastSeenAt bumped — no isActive / isVerified / source in the update.
    expect(prisma.dealer.update).toHaveBeenCalledTimes(1);
    const upd = prisma.dealer.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'curated-1' });
    expect(Object.keys(upd.data)).toEqual(['lastSeenAt']);
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx1' },
      data: { dealerId: 'curated-1' },
    });
    expect(prisma.adminAlert.create).not.toHaveBeenCalled();
  });
});
