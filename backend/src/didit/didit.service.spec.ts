import { createHmac } from 'crypto';
import { DiditService } from './didit.service';

const SECRET = 'test-didit-webhook-secret';

function sign(payload: string | Buffer): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

/** Sorted-key JSON, matching what X-Signature-V2 is computed over. */
function canonical(value: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortDeep((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortDeep(value));
}

describe('DiditService.verifyWebhook', () => {
  let service: DiditService;
  let now: number;

  const body = {
    // Deliberately NOT in sorted order, and with a non-ASCII name — the two
    // things that separate a raw-bytes signature from a canonical-JSON one.
    webhook_type: 'status.updated',
    session_id: 'sess-1',
    status: 'Approved',
    vendor_data: 'u1',
    applicant: { last_name: 'Kruger', first_name: 'André' },
  };

  beforeEach(() => {
    process.env.DIDIT_WEBHOOK_SECRET = SECRET;
    service = new DiditService();
    now = Math.floor(Date.now() / 1000);
  });

  afterEach(() => {
    delete process.env.DIDIT_WEBHOOK_SECRET;
  });

  it('accepts a raw-bytes signature (X-Signature)', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': String(now),
        'x-signature': sign(raw),
      }),
    ).toBe(true);
  });

  it('accepts a canonical-JSON signature (X-Signature-V2)', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': String(now),
        'x-signature-v2': sign(canonical(body)),
      }),
    ).toBe(true);
  });

  it('rejects a body that has been tampered with after signing', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const signature = sign(raw);
    // The attack this is actually for: flip a Declined verdict to Approved.
    const tampered = Buffer.from(
      JSON.stringify({ ...body, status: 'Declined' }),
      'utf8',
    );
    expect(
      service.verifyWebhook(tampered, {
        'x-timestamp': String(now),
        'x-signature': signature,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const wrong = createHmac('sha256', 'not-the-secret')
      .update(raw)
      .digest('hex');
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': String(now),
        'x-signature': wrong,
      }),
    ).toBe(false);
  });

  // ⚠️ Replay is what the timestamp is for. A signature stays valid forever;
  // the five-minute window is the only thing bounding how long a captured
  // delivery can be re-sent.
  it('rejects a timestamp outside the five-minute window', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const signature = sign(raw);
    for (const skew of [-301, 301]) {
      expect(
        service.verifyWebhook(raw, {
          'x-timestamp': String(now + skew),
          'x-signature': signature,
        }),
      ).toBe(false);
    }
    // Inside the window, both directions.
    for (const skew of [-299, 299]) {
      expect(
        service.verifyWebhook(raw, {
          'x-timestamp': String(now + skew),
          'x-signature': signature,
        }),
      ).toBe(true);
    }
  });

  it('rejects a missing or unparseable timestamp', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    expect(service.verifyWebhook(raw, { 'x-signature': sign(raw) })).toBe(false);
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': 'yesterday',
        'x-signature': sign(raw),
      }),
    ).toBe(false);
  });

  it('rejects when no signature header is present at all', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    expect(service.verifyWebhook(raw, { 'x-timestamp': String(now) })).toBe(
      false,
    );
  });

  // ⚠️ X-Signature-Simple signs "{timestamp}:{session_id}:{status}:{type}" —
  // the envelope, not the decision. A valid Simple signature says nothing
  // about whether the identity data underneath it was altered, so accepting it
  // would mean trusting a payload nobody signed.
  it('does NOT accept X-Signature-Simple', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const simple = sign(`${now}:sess-1:Approved:status.updated`);
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': String(now),
        'x-signature-simple': simple,
      }),
    ).toBe(false);
  });

  // Without a secret there is no way to tell a real delivery from a forged
  // one, so the only safe answer is to refuse every delivery — loudly, in the
  // log — rather than to wave them through.
  it('refuses everything when DIDIT_WEBHOOK_SECRET is unset', () => {
    delete process.env.DIDIT_WEBHOOK_SECRET;
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': String(now),
        'x-signature': sign(raw),
      }),
    ).toBe(false);
  });

  it('reads a header supplied as an array', () => {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    expect(
      service.verifyWebhook(raw, {
        'x-timestamp': [String(now)],
        'x-signature': [sign(raw)],
      }),
    ).toBe(true);
  });
});

describe('DiditService configuration', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.DIDIT_MODE;
    delete process.env.DIDIT_API_KEY;
    delete process.env.DIDIT_WORKFLOW_ID;
  });

  // ⚠️ THE WHOLE POINT OF THE GATE. The provider this replaced defaulted to
  // sandbox and production boot only LOGGED an error, so a production box
  // could run with sandbox identity checks — approving canned data with
  // nobody the wiser. Killing the boot is the fix.
  it('kills the boot when production is left on sandbox', () => {
    process.env.NODE_ENV = 'production';
    process.env.DIDIT_MODE = 'sandbox';
    process.env.DIDIT_API_KEY = 'k';
    process.env.DIDIT_WORKFLOW_ID = 'w';
    expect(() => new DiditService().onModuleInit()).toThrow(/DIDIT_MODE/);
  });

  it('kills the boot when production is live but unconfigured', () => {
    process.env.NODE_ENV = 'production';
    process.env.DIDIT_MODE = 'live';
    expect(() => new DiditService().onModuleInit()).toThrow(
      /DIDIT_API_KEY and DIDIT_WORKFLOW_ID/,
    );
  });

  it('leaves development alone', () => {
    process.env.NODE_ENV = 'development';
    process.env.DIDIT_MODE = 'sandbox';
    expect(() => new DiditService().onModuleInit()).not.toThrow();
  });
});

/**
 * fetchSessionImage — the "show me the person" path.
 *
 * ⚠️ THE FIELD CHOICE IS THE WHOLE FEATURE AND IT IS EASY TO GET WRONG. The
 * live selfie is `liveness_checks[].reference_image`; `id_verifications[].
 * portrait_image` is the face cropped off the card, which is a photograph of a
 * photograph and not what an admin reviewing a member needs to see. These
 * tests exist so a future tidy-up cannot quietly swap them.
 */
describe('DiditService.fetchSessionImage', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  let service: DiditService;
  let fetchMock: jest.Mock;

  /** Queue one response for the decision call and one for the media call. */
  function queue(decision: unknown, media?: { status?: number; body?: Buffer; mime?: string }) {
    fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/decision/')) {
        const status = (decision as { __status?: number })?.__status ?? 200;
        return {
          ok: status < 400,
          status,
          text: async () => JSON.stringify(decision),
          json: async () => decision,
          arrayBuffer: async () => Buffer.alloc(0),
          headers: { get: () => 'application/json' },
        } as unknown as Response;
      }
      const s = media?.status ?? 200;
      const body = media?.body ?? JPEG;
      return {
        ok: s < 400,
        status: s,
        text: async () => '',
        json: async () => ({}),
        arrayBuffer: async () => body,
        headers: { get: (h: string) => (h === 'content-type' ? media?.mime ?? 'image/jpeg' : null) },
      } as unknown as Response;
    });
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  }

  beforeEach(() => {
    process.env.DIDIT_API_KEY = 'test-key';
    process.env.DIDIT_WORKFLOW_ID = 'wf-1';
    process.env.DIDIT_MODE = 'sandbox';
    delete process.env.NODE_ENV;
    service = new DiditService();
  });

  const decision = (extra: Record<string, unknown>) => ({
    session_id: 'sess-1',
    status: 'Approved',
    ...extra,
  });

  it('takes the selfie from the liveness reference image, never the card portrait', async () => {
    queue(
      decision({
        id_verifications: [{ portrait_image: 'https://s3.example/card.jpg' }],
        liveness_checks: [{ reference_image: 'https://s3.example/live.jpg' }],
      }),
    );
    const result = await service.fetchSessionImage('sess-1', 'selfie');
    expect(result.ok).toBe(true);
    // The media fetch must have been pointed at the LIVE image.
    expect(String(fetchMock.mock.calls[1][0])).toContain('/live.jpg');
  });

  it('prefers the uncropped document capture, falling back to the cropped one', async () => {
    queue(
      decision({
        id_verifications: [
          { front_image: 'https://s3.example/front.jpg', full_front_image: 'https://s3.example/full.jpg' },
        ],
      }),
    );
    await service.fetchSessionImage('sess-1', 'id_front');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/full.jpg');
  });

  it('falls back to the cropped front when there is no full capture', async () => {
    queue(decision({ id_verifications: [{ front_image: 'https://s3.example/front.jpg' }] }));
    await service.fetchSessionImage('sess-1', 'id_front');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/front.jpg');
  });

  it('reports no_image when the decision carries none', async () => {
    queue(decision({ id_verifications: [{ status: 'Approved' }], liveness_checks: [] }));
    expect(await service.fetchSessionImage('sess-1', 'selfie')).toEqual({
      ok: false,
      reason: 'no_image',
    });
  });

  it('reports gone when Didit no longer has the session', async () => {
    queue({ __status: 404, detail: 'Not found.' });
    expect(await service.fetchSessionImage('sess-1', 'id_front')).toEqual({
      ok: false,
      reason: 'gone',
    });
  });

  it('names the wrong-environment case — a sandbox key cannot read a live session', async () => {
    queue({ __status: 403, detail: 'You do not have permission.' });
    expect(await service.fetchSessionImage('sess-1', 'id_front')).toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('refuses bytes that are not an image', async () => {
    queue(
      decision({ id_verifications: [{ front_image: 'https://s3.example/front.pdf' }] }),
      { body: Buffer.from('%PDF-1.4 something'), mime: 'application/pdf' },
    );
    expect(await service.fetchSessionImage('sess-1', 'id_front')).toEqual({
      ok: false,
      reason: 'not_an_image',
    });
  });

  it('treats an expired media signature as gone', async () => {
    queue(decision({ id_verifications: [{ front_image: 'https://s3.example/front.jpg' }] }), {
      status: 403,
    });
    expect(await service.fetchSessionImage('sess-1', 'id_front')).toEqual({
      ok: false,
      reason: 'gone',
    });
  });
});
