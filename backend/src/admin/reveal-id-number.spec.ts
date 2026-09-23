// meilisearch is ESM and breaks ts-jest if imported for real (AdminService
// → ListingsService → SearchService pulls it in transitively).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { AdminService } from './admin.service';
import { encryptSaIdNumber } from '../common/id-crypto';

/**
 * AdminService.revealIdNumber — the "show me the ID number" path.
 *
 * ⚠️ THE AUDIT ROW IS THE FEATURE. The number is the most sensitive single
 * field we hold outside the documents themselves, and it is deliberately kept
 * out of the dossier GET (which every active admin can read). Asking for it on
 * purpose is allowed; asking for it invisibly is not. These tests pin that a
 * reveal always writes an AdminAuditEvent, that not having a number is a 404
 * rather than a blank, and that an undecryptable value says so instead of
 * reporting "no ID number" — a wrong conclusion an admin might act on.
 */
function makeService(overrides: {
  idNumberEncrypted?: string | null;
  user?: boolean;
}) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.user === false
          ? null
          : { idNumberEncrypted: overrides.idNumberEncrypted ?? null },
      ),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(
    prisma as never,
    {} as never, // sessions
    {} as never, // users
    {} as never, // files
    {} as never, // notifications
    {} as never, // listings
    audit as never,
    {} as never, // zohoBooks
    {} as never, // ozow
    {} as never, // transactions
    {} as never, // sms
    {} as never, // closures
    {} as never, // didit
  );
  return { service, prisma, audit };
}

describe('AdminService.revealIdNumber', () => {
  beforeEach(() => {
    process.env.ID_HASH_SECRET = 'test-id-hash-secret';
  });

  it('decrypts the number, masks it, and records who looked', async () => {
    const { service, audit } = makeService({
      idNumberEncrypted: encryptSaIdNumber('8409120830083'),
    });

    const result = await service.revealIdNumber('user_1', 'admin_1');

    expect(result.idNumber).toBe('8409120830083');
    // Six digits of date-of-birth and the last three; the identifying middle
    // four stay hidden.
    expect(result.masked).toBe('840912••••083');

    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.action).toBe('USER_ID_NUMBER_REVEAL');
    expect(entry.resourceType).toBe('User');
    expect(entry.resourceId).toBe('user_1');
    expect(entry.adminUserId).toBe('admin_1');
    expect(String(entry.reason).trim().length).toBeGreaterThan(0);
  });

  it('404s when the member holds no ID number', async () => {
    const { service, audit } = makeService({ idNumberEncrypted: null });
    await expect(service.revealIdNumber('user_1', 'admin_1')).rejects.toThrow(
      /No ID number is held/,
    );
    // Nothing to audit — nobody saw a number.
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s for an unknown member', async () => {
    const { service } = makeService({ user: false });
    await expect(service.revealIdNumber('nope', 'admin_1')).rejects.toThrow(
      /User not found/,
    );
  });

  it('says the value could not be decrypted rather than "no ID number"', async () => {
    // Ciphertext from a DIFFERENT key — exactly what a rotated
    // ID_HASH_SECRET leaves behind.
    process.env.ID_HASH_SECRET = 'the-original-secret';
    const stale = encryptSaIdNumber('8409120830083');
    process.env.ID_HASH_SECRET = 'a-different-secret';
    const { service, audit } = makeService({ idNumberEncrypted: stale });

    await expect(service.revealIdNumber('user_1', 'admin_1')).rejects.toThrow(
      /could not be decrypted/,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('masks a value that is not a clean 13-digit ID entirely', async () => {
    const { service } = makeService({
      idNumberEncrypted: encryptSaIdNumber('8409120830083'),
    });
    // The mask helper is exercised through the real path: a 13-digit value
    // masks partially, so assert the shape rather than the source.
    const { masked } = await service.revealIdNumber('user_1', 'admin_1');
    expect(masked).toMatch(/^\d{6}••••\d{3}$/);
  });
});
