jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { NotificationsService } from './notifications.service';

// The `sendSms` fan-out seam — the heart of the WhatsApp change. `sendSms`
// itself is private, so these tests reach it via bracket access on a
// hand-built instance, exactly the pattern shipment-booked-copy.spec.ts uses
// for the public methods that call it. Collaborators (`prisma`, `sms`,
// `whatsapp`, `settings`) are jest mocks so every branch — flag off,
// unverified phone, opted out, WhatsApp success, WhatsApp throw, critical —
// can be driven directly without a database.

interface Mocks {
  smsSend: jest.Mock;
  waSend: jest.Mock;
  flagGet: jest.Mock;
  userFindFirst: jest.Mock;
}

function makeService(overrides: Partial<Mocks> = {}) {
  const smsSend = overrides.smsSend ?? jest.fn().mockResolvedValue(undefined);
  const waSend = overrides.waSend ?? jest.fn().mockResolvedValue({ success: true });
  const flagGet = overrides.flagGet ?? jest.fn().mockResolvedValue(true);
  const userFindFirst =
    overrides.userFindFirst ??
    jest.fn().mockResolvedValue({ phoneVerified: true, notifyWhatsappEnabled: true });

  const svc = Object.create(NotificationsService.prototype) as NotificationsService;
  Object.assign(svc as unknown as Record<string, unknown>, {
    logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    sms: {
      sendSms: smsSend,
      // Production normalises through SmsService.toE164; the lookup now uses
      // both forms, so the double must answer this too.
      toE164: (v: string) => (v.startsWith('0') ? `+27${v.slice(1)}` : v),
    },
    whatsapp: { sendTemplate: waSend },
    settings: { get: flagGet },
    prisma: {
      user: { findFirst: userFindFirst },
    },
  });
  return svc as unknown as Record<string, any>;
}

const REF = 'order-confirmed-tx1';
const WA_OPT = { templateKey: 'sale_accept_reminder_seller', vars: { ref: 'ABCDEF12', code: 'tcktxid1234567890' } };
describe('newSaleSeller — WhatsApp first, SMS + email fallback', () => {
  function sale(overrides: Record<string, unknown> = {}) {
    return {
      listingTitle: 'Howa 6.5 Creedmoor',
      listingId: 'l1',
      transactionId: 'tx1',
      orderReference: 'GG-TX1',
      buyerEmail: 'buyer@example.com',
      buyerName: 'Buyer',
      sellerEmail: 'seller@example.com',
      sellerName: 'Seller',
      sellerPhone: '0820000000',
      listingPrice: 100000,
      commissionZar: 0,
      processingFee: 0,
      buyerTotal: 100000,
      sellerPayout: 100000,
      passFeeToBuyer: false,
      feeModel: 'BUYNOW_MARKUP',
      shippingCost: 0,
      shippingHandlingCents: 0,
      shippingMethod: 'DEALER_TRANSFER',
      acceptActionUrl: 'https://alloutdoor.co.za/a/tok',
      acceptActionToken: 'tok',
      ...overrides,
    };
  }

  function service(sentOnWhatsApp: boolean) {
    const svc = makeService();
    Object.assign(svc, {
      appUrl: 'https://alloutdoor.co.za',
      persistByEmail: jest.fn().mockResolvedValue(undefined),
      email: jest.fn(() => '<html />'),
      send: jest.fn().mockResolvedValue(undefined),
      sendSms: jest.fn().mockResolvedValue(undefined),
      tryWhatsapp: jest.fn().mockResolvedValue(sentOnWhatsApp),
    });
    return svc;
  }

  it('⚠️ DOES NOT SEND EMAIL OR SMS WHEN WHATSAPP WINS', async () => {
    const svc = service(true);
    await svc.newSaleSeller(sale());

    expect(svc.tryWhatsapp).toHaveBeenCalledTimes(1);
    expect(svc.tryWhatsapp.mock.calls[0][1]).toMatchObject({
      templateKey: 'new_sale_seller',
      vars: expect.objectContaining({ code: 'atok', txId: 'tx1' }),
    });
    expect(svc.send).not.toHaveBeenCalled();
    expect(svc.sendSms).not.toHaveBeenCalled();
    expect(svc.persistByEmail).toHaveBeenCalledTimes(1);
  });

  it('⚠️ SENDS BOTH SMS AND EMAIL WHEN WHATSAPP IS INELIGIBLE', async () => {
    const svc = service(false);
    await svc.newSaleSeller(sale());

    expect(svc.tryWhatsapp).toHaveBeenCalledTimes(1);
    expect(svc.send).toHaveBeenCalledWith(
      'seller@example.com',
      expect.stringContaining('New sale'),
      '<html />',
    );
    expect(svc.sendSms).toHaveBeenCalledWith(
      '0820000000',
      expect.stringContaining('/a/tok'),
      'new-sale-tx1',
    );
  });
});

describe('sendSms fan-out seam', () => {
  it('behaves byte-identically to today when no `whatsapp:` opt is passed', async () => {
    const svc = makeService();
    await svc.sendSms('0820000000', 'ALL Outdoor: hello', REF);
    expect(svc.sms.sendSms).toHaveBeenCalledWith({
      to: '0820000000',
      message: 'ALL Outdoor: hello',
      reference: REF,
    });
    expect(svc.whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends SMS when whatsapp_enabled is off', async () => {
    const svc = makeService({ flagGet: jest.fn().mockResolvedValue(false) });
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(svc.sms.sendSms).toHaveBeenCalled();
  });

  it('still uses WhatsApp when the phone is unverified (buyers never OTP)', async () => {
    const svc = makeService({
      userFindFirst: jest
        .fn()
        .mockResolvedValue({ phoneVerified: false, notifyWhatsappEnabled: true }),
    });
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.whatsapp.sendTemplate).toHaveBeenCalled();
    expect(svc.sms.sendSms).not.toHaveBeenCalled();
  });

  it('sends SMS when notifyWhatsappEnabled is false', async () => {
    const svc = makeService({
      userFindFirst: jest
        .fn()
        .mockResolvedValue({ phoneVerified: true, notifyWhatsappEnabled: false }),
    });
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(svc.sms.sendSms).toHaveBeenCalled();
  });

  it('does NOT send the SMS when WhatsApp succeeds', async () => {
    const svc = makeService();
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.whatsapp.sendTemplate).toHaveBeenCalledWith({
      to: '0820000000',
      templateKey: WA_OPT.templateKey,
      vars: WA_OPT.vars,
      reference: REF,
    });
    expect(svc.sms.sendSms).not.toHaveBeenCalled();
  });

  it('still sends the SMS when sendTemplate throws — never loses the notification', async () => {
    const svc = makeService({
      waSend: jest.fn().mockRejectedValue(new Error('Meta is down')),
    });
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.sms.sendSms).toHaveBeenCalled();
  });

  it('critical: true still bypasses the SMS mute', async () => {
    // A muted member (notifySmsEnabled: false) is who this exists for —
    // courier PIN / waybill must still reach them.
    const svc = makeService({
      userFindFirst: jest.fn().mockResolvedValue({ notifySmsEnabled: false }),
    });
    await svc.sendSms('0820000000', 'body', 'critical-ref', { critical: true });
    expect(svc.sms.sendSms).toHaveBeenCalled();
  });

  it('without critical, a muted member does not get the SMS', async () => {
    const svc = makeService({
      userFindFirst: jest.fn().mockResolvedValue({ notifySmsEnabled: false }),
    });
    await svc.sendSms('0820000000', 'body', 'muted-ref');
    expect(svc.sms.sendSms).not.toHaveBeenCalled();
  });

  it('an SMS mute does not silence an opted-in WhatsApp send', async () => {
    const svc = makeService({
      userFindFirst: jest.fn().mockResolvedValue({
        phoneVerified: false,
        notifySmsEnabled: false,
        notifyWhatsappEnabled: true,
      }),
    });
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.whatsapp.sendTemplate).toHaveBeenCalled();
    expect(svc.sms.sendSms).not.toHaveBeenCalled();
  });

  it('falls back to SMS when WhatsApp is in stub mode', async () => {
    const svc = makeService({
      waSend: jest.fn().mockResolvedValue({ success: false, stub: true }),
    });
    await svc.sendSms('0820000000', 'body', REF, { whatsapp: WA_OPT });
    expect(svc.sms.sendSms).toHaveBeenCalled();
  });

  it('critical: true does NOT bypass notifyWhatsappEnabled', async () => {
    const svc = makeService({
      userFindFirst: jest
        .fn()
        .mockResolvedValue({ phoneVerified: true, notifyWhatsappEnabled: false }),
    });
    await svc.sendSms('0820000000', 'body', REF, {
      critical: true,
      whatsapp: WA_OPT,
    });
    // critical bypasses the MUTE, not the WhatsApp opt-in gate — the member
    // declined WhatsApp, so this must fall through to SMS regardless.
    expect(svc.whatsapp.sendTemplate).not.toHaveBeenCalled();
    expect(svc.sms.sendSms).toHaveBeenCalled();
  });
});

describe('welcomeWhatsapp', () => {
  it('no-ops when the member has no phone at all', async () => {
    const svc = makeService();
    await svc.welcomeWhatsapp({ userId: 'u1', phone: null });
    expect(svc.whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends the welcome template when eligible', async () => {
    const svc = makeService();
    await svc.welcomeWhatsapp({ userId: 'u1', phone: '0820000000' });
    expect(svc.whatsapp.sendTemplate).toHaveBeenCalledWith({
      to: '0820000000',
      templateKey: 'welcome_complete_profile',
      vars: {},
      reference: 'welcome-u1',
    });
  });

  it('no-ops when the flag is off, same gate as everything else', async () => {
    const svc = makeService({ flagGet: jest.fn().mockResolvedValue(false) });
    await svc.welcomeWhatsapp({ userId: 'u1', phone: '0820000000' });
    expect(svc.whatsapp.sendTemplate).not.toHaveBeenCalled();
  });
});
