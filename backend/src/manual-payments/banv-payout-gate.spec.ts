/*
 * The BANV payout hold must ride on the Peach PAYOUTS GO-LIVE FLAG, not on
 * "credentials happen to be configured".
 *
 * Why this is a spec and not just a comment: the Payouts credentials land on
 * the box days before launch. When the hold keyed off credentials alone
 * (2026-11-24 audit), EVERY seller payout was held on `bankVerifiedAt` — the
 * live, Ozow-only payout queue included — a gate nobody had switched on and
 * almost no seller could pass yet.
 */
import { ManualPaymentsService } from './manual-payments.service';
import { FLAGS } from '../settings/settings.service';

function service(opts: { banvReady: boolean; payoutsEnabled: boolean }) {
  const svc = Object.create(ManualPaymentsService.prototype) as Record<
    string,
    any
  >;
  svc.settings = {
    get: jest.fn(async (flag: { key: string }) =>
      flag.key === FLAGS.peachPayoutsEnabled.key ? opts.payoutsEnabled : false,
    ),
  };
  svc.peach = { isBanvEnabled: () => opts.banvReady };
  return svc as unknown as ManualPaymentsService;
}

function payout(over: Record<string, unknown> = {}) {
  return {
    id: 'tx_1',
    sellerId: 's_1',
    orderReference: 'ORD-1',
    sellerPayout: 90_000,
    failedShipmentChargeCents: 0,
    refundChildren: [],
    seller: {
      username: 'seller',
      email: 'seller@example.com',
      phone: '+27000000000',
      bankAccountHolder: 'A Seller',
      bankName: 'FNB',
      bankAccountNumber: '123456789',
      bankBranchCode: '250655',
      bankAccountType: 'cheque',
      kycStatus: 'VERIFIED',
      profileCompletedAt: new Date(),
      bankVerifiedAt: null,
    },
    ...over,
  };
}

function collect(svc: ManualPaymentsService, payouts: unknown[]) {
  return (svc as unknown as { collectDue: (p: unknown) => Promise<any> })
    .collectDue({ payouts, refunds: [] });
}

describe('BANV payout hold — only with peach_payouts_enabled', () => {
  it('does NOT hold a payout on an unverified bank while Peach payouts are OFF', async () => {
    const r = await collect(
      service({ banvReady: true, payoutsEnabled: false }),
      [payout()],
    );
    expect(r.payoutIds).toEqual(['tx_1']);
    expect(r.skipped.some((s: any) => /BANV/.test(s.reason))).toBe(false);
  });

  it('holds the payout once peach_payouts_enabled is ON', async () => {
    const r = await collect(service({ banvReady: true, payoutsEnabled: true }), [
      payout(),
    ]);
    expect(r.payoutIds).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/BANV/);
  });

  it('pays a BANV-verified seller once Peach payouts are ON', async () => {
    const r = await collect(service({ banvReady: true, payoutsEnabled: true }), [
      payout({
        seller: {
          ...payout().seller,
          bankVerifiedAt: new Date(),
        },
      }),
    ]);
    expect(r.payoutIds).toEqual(['tx_1']);
  });

  it('does NOT hold when the Peach Payouts product is not configured', async () => {
    const r = await collect(
      service({ banvReady: false, payoutsEnabled: true }),
      [payout()],
    );
    expect(r.payoutIds).toEqual(['tx_1']);
  });
});
