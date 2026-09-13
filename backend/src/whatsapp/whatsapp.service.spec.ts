import { WhatsappService } from './whatsapp.service';

function makePrisma(over: { logs?: unknown[] } = {}) {
  const created: Record<string, unknown>[] = [];
  return {
    whatsappMessageLog: {
      create: jest.fn().mockImplementation(({ data }: { data: unknown }) => {
        created.push(data as Record<string, unknown>);
        return Promise.resolve({ id: `log-${created.length}`, ...(data as object) });
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(over.logs ?? []),
    },
    adminAlert: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
    _created: created,
  };
}

function makeSms() {
  return {
    // Mirrors the real SmsService.toE164 closely enough for these tests —
    // valid-looking ZA numbers pass through, garbage returns null.
    toE164: jest.fn((raw: string) => {
      let n = raw.replace(/[\s\-()]/g, '');
      if (n.startsWith('0')) n = '+27' + n.slice(1);
      else if (n.startsWith('27')) n = '+' + n;
      if (!/^\+27\d{9}$/.test(n)) return null;
      return n;
    }),
  };
}

function setConfigured(on: boolean) {
  if (on) {
    process.env.WHATSAPP_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  } else {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

describe('WhatsappService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('unconfigured: writes a STUB row and makes no HTTP call', async () => {
    setConfigured(false);
    const prisma = makePrisma();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new WhatsappService(prisma as never, makeSms() as never);

    const result = await svc.sendTemplate({
      to: '0821234567',
      templateKey: 'order_confirmed_buyer',
      vars: { ref: 'MO123', txId: 'tx1' },
      reference: 'order-confirmed-tx1',
    });

    expect(result).toEqual({ success: true, stub: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'STUB', templateKey: 'order_confirmed_buyer' }),
      }),
    );
  });

  // ⚠️ A SENT WHATSAPP MESSAGE CANNOT BE RECALLED, so a gap in the variables
  // has to stop the send rather than be discovered in it. Both gaps below are
  // silent on the wire: an empty body parameter renders "Order  is
  // confirmed", and a missing txId builds the button suffix `tundefined`,
  // which resolveShortCode quietly redirects to the home page.
  it.each([
    ['a body variable', { txId: 'tx1' }, 'ref'],
    ['the button variable', { ref: 'MO123' }, 'txId'],
    ['a blank body variable', { ref: '   ', txId: 'tx1' }, 'ref'],
  ])(
    'refuses to send when %s is missing, and does not retry',
    async (_label, vars, expectedMissing) => {
      setConfigured(true);
      const prisma = makePrisma();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const svc = new WhatsappService(prisma as never, makeSms() as never);

      const result = await svc.sendTemplate({
        to: '0821234567',
        templateKey: 'order_confirmed_buyer',
        vars: vars as Record<string, string>,
        reference: 'order-confirmed-tx1',
      });

      expect(result).toEqual({ success: false });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            retryable: false,
            error: expect.stringContaining(expectedMissing),
          }),
        }),
      );
    },
  );

  it('200 response: writes a SENT row with the returned messageId', async () => {
    setConfigured(true);
    const prisma = makePrisma();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.ABC123' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new WhatsappService(prisma as never, makeSms() as never);

    const result = await svc.sendTemplate({
      to: '0821234567',
      templateKey: 'order_confirmed_buyer',
      vars: { ref: 'MO123', txId: 'tx1' },
    });

    expect(result).toEqual({ success: true, messageId: 'wamid.ABC123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('123456789/messages');
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-token',
    );
    expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SENT', messageId: 'wamid.ABC123' }),
      }),
    );
  });

  it('non-2xx response: writes a FAILED row, retryable, with nextRetryAt set', async () => {
    setConfigured(true);
    const prisma = makePrisma();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal error' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new WhatsappService(prisma as never, makeSms() as never);

    const result = await svc.sendTemplate({
      to: '0821234567',
      templateKey: 'order_confirmed_buyer',
      vars: { ref: 'MO123', txId: 'tx1' },
    });

    expect(result).toEqual({ success: false });
    expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          retryable: true,
          nextRetryAt: expect.any(Date),
        }),
      }),
    );
  });

  it('error code 131047 (outside 24h window) is FAILED and NOT retryable', async () => {
    setConfigured(true);
    const prisma = makePrisma();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Re-engagement message', code: 131047 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new WhatsappService(prisma as never, makeSms() as never);

    await svc.sendTemplate({
      to: '0821234567',
      templateKey: 'order_confirmed_buyer',
      vars: { ref: 'MO123', txId: 'tx1' },
    });

    expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', retryable: false, nextRetryAt: null }),
      }),
    );
  });

  it('error code 132001 (no such template) is FAILED and NOT retryable', async () => {
    setConfigured(true);
    const prisma = makePrisma();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Template does not exist', code: 132001 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new WhatsappService(prisma as never, makeSms() as never);

    await svc.sendTemplate({
      to: '0821234567',
      templateKey: 'order_confirmed_buyer',
      vars: { ref: 'MO123', txId: 'tx1' },
    });

    expect(prisma.whatsappMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', retryable: false, nextRetryAt: null }),
      }),
    );
  });

  it('unknown template key throws (programming error, not a failed send)', async () => {
    setConfigured(true);
    const prisma = makePrisma();
    const svc = new WhatsappService(prisma as never, makeSms() as never);
    await expect(
      svc.sendTemplate({
        to: '0821234567',
        templateKey: 'does_not_exist',
        vars: {},
      }),
    ).rejects.toThrow(/Unknown WhatsApp template key/);
  });

  describe('retryFailed', () => {
    it('respects the max attempts budget — does not retry a row already at the cap', async () => {
      setConfigured(true);
      // findMany's own where-clause (attempts < MAX) is mocked out, so we
      // simulate the DB already excluding exhausted rows by returning none.
      const prisma = makePrisma({ logs: [] });
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const svc = new WhatsappService(prisma as never, makeSms() as never);

      const result = await svc.retryFailed();
      expect(result).toEqual({ retried: 0, sent: 0, exhausted: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('marks a row exhausted once it fails on its final allowed attempt', async () => {
      setConfigured(true);
      const dueRow = {
        id: 'log-1',
        to: '+27821234567',
        templateKey: 'order_confirmed_buyer',
        vars: { ref: 'MO123', txId: 'tx1' },
        attempts: 2, // one more failure reaches MAX_WHATSAPP_ATTEMPTS (3)
        status: 'FAILED',
        retryable: true,
      };
      const prisma = makePrisma({ logs: [dueRow] });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'still down' } }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const svc = new WhatsappService(prisma as never, makeSms() as never);

      const result = await svc.retryFailed();
      expect(result.exhausted).toBe(1);
      expect(prisma.whatsappMessageLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'log-1' },
          data: expect.objectContaining({ attempts: 3, nextRetryAt: null }),
        }),
      );
    });
  });

  describe('checkOutage (via retryFailed)', () => {
    it('raises exactly one WHATSAPP_OUTAGE alert after 5 consecutive failures, deduped', async () => {
      setConfigured(true);
      const prisma = makePrisma({ logs: [] });
      prisma.whatsappMessageLog.findMany = jest
        .fn()
        // First call inside retryFailed is the "due" query (none due).
        .mockResolvedValueOnce([])
        // Second call is checkOutage's "recent 5" query.
        .mockResolvedValueOnce([
          { status: 'FAILED' },
          { status: 'FAILED' },
          { status: 'FAILED' },
          { status: 'FAILED' },
          { status: 'FAILED' },
        ]);
      const svc = new WhatsappService(prisma as never, makeSms() as never);

      await svc.retryFailed();

      expect(prisma.adminAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'WHATSAPP_OUTAGE' }),
        }),
      );
    });

    it('does not raise a second alert when one is already open (deduped)', async () => {
      setConfigured(true);
      const prisma = makePrisma({ logs: [] });
      prisma.whatsappMessageLog.findMany = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { status: 'FAILED' },
          { status: 'FAILED' },
          { status: 'FAILED' },
          { status: 'FAILED' },
          { status: 'FAILED' },
        ]);
      prisma.adminAlert.count = jest.fn().mockResolvedValue(1); // already open
      const svc = new WhatsappService(prisma as never, makeSms() as never);

      await svc.retryFailed();

      expect(prisma.adminAlert.create).not.toHaveBeenCalled();
    });
  });
});
