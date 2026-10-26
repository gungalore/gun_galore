import { FirearmLicenceService } from './firearm-licence.service';

// ────────────────────────────────────────────────────────────────────
// Expiry is READ and RECORDED, never a gate. A licence can be renewed and
// the dealer checks the card at hand-over, so an expired or near-expiry
// date must not stop a listing. Serial/holder mismatches still BLOCK.
// ────────────────────────────────────────────────────────────────────

function reading(overrides: {
  expiryDate?: string | null;
  extractedSerial?: string;
  licenceSerial?: string;
  holderMatches?: number;
  licenceLegible?: number;
}) {
  const serial = overrides.extractedSerial ?? 'ABC123';
  return {
    serialPhoto: {
      extracted_serial: serial,
      matches_typed: 100,
      legible: 100,
    },
    licence: {
      extracted_serial: overrides.licenceSerial ?? serial,
      serial_matches_typed: 100,
      holder_name: 'JOHN SMITH',
      holder_matches_seller: overrides.holderMatches ?? 100,
      expiry_date:
        overrides.expiryDate === undefined ? '2030-01-01' : overrides.expiryDate,
      is_firearm_licence: 100,
      legible: overrides.licenceLegible ?? 100,
    },
    issues: [],
  };
}

function makeService(payload: unknown) {
  const llm = {
    isConfigured: () => true,
    complete: jest.fn().mockResolvedValue({
      text: JSON.stringify(payload),
      stopReason: 'end',
    }),
  };
  const prisma = {
    adminAlert: { create: jest.fn().mockResolvedValue({}) },
  };
  return new FirearmLicenceService(prisma as never, llm as never);
}

const ARGS = {
  typedSerial: 'ABC123',
  serialPhotoUrl: 'https://example.test/serial.jpg',
  licencePhotoUrl: 'https://example.test/licence.jpg',
  sellerName: 'John Smith',
};

describe('FirearmLicenceService — expiry is not a gate', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as never;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows an expired licence and records the date', async () => {
    const result = await makeService(
      reading({ expiryDate: '2020-01-01' }),
    ).verify(ARGS);

    expect(result.gate).toBe('OK');
    expect(result.licenceExpiresAt?.toISOString().slice(0, 10)).toBe(
      '2020-01-01',
    );
    expect(result.daysUntilExpiry).toBeLessThan(0);
  });

  it('allows a licence expiring within 30 days', async () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const result = await makeService(reading({ expiryDate: soon })).verify(
      ARGS,
    );

    expect(result.gate).toBe('OK');
    expect(result.daysUntilExpiry).toBeGreaterThanOrEqual(0);
  });

  it('allows the listing when the expiry date cannot be read', async () => {
    const result = await makeService(reading({ expiryDate: null })).verify(
      ARGS,
    );

    expect(result.gate).toBe('OK');
    expect(result.licenceExpiresAt).toBeNull();
  });

  it('still blocks a serial mismatch', async () => {
    const result = await makeService(
      reading({ extractedSerial: 'ZZZ999', licenceSerial: 'ZZZ999' }),
    ).verify(ARGS);

    expect(result.gate).toBe('BLOCK');
  });

  it('still blocks an unreadable licence', async () => {
    const result = await makeService(
      reading({ licenceLegible: 10 }),
    ).verify(ARGS);

    expect(result.gate).toBe('BLOCK');
  });
});
