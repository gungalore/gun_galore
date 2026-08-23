import { CredentialKind } from '@prisma/client';
import { LicenceCentreService } from './licence-centre.service';
import { currentKind } from './licence-centre-extract.service';

// ────────────────────────────────────────────────────────────────────
// A RETIRED KIND MUST NOT REACH A ROW, HOWEVER IT ARRIVES.
//
// Postgres has no ALTER TYPE ... DROP VALUE, so every consolidation leaves its
// old names in CredentialKind for ever, and the controller's validation —
// `Object.values(CredentialKind).includes(...)` — accepts every one of them.
// The picker not offering a value is not a boundary; motivation-library.ts
// says so in as many words about a route it guards twice for that reason.
//
// ⚠️ THE REALISTIC SENDER IS NOT AN ATTACKER. It is a PWA holding a bundle
// from before the four safe photographs became SAFE_PHOTOGRAPHS on 2026-08-23,
// whose menu still posts SAFE_PHOTO_BOLTS. The upload used to succeed and then
// sit outside the Centre's safe row, outside the vault picker's safe slot, and
// outside the migration that had already emptied that value — a document filed
// into a hole, with nothing to tell its owner.
//
// classify() already normalised the MODEL's answer for exactly this reason.
// Nothing normalised the member's.
// ────────────────────────────────────────────────────────────────────

/** Retired → what it is filed as today. Mirrors RETIRED_KINDS. */
const FORWARD: [CredentialKind, CredentialKind][] = [
  ['SAFE_PHOTO_CLOSED', 'SAFE_PHOTOGRAPHS'],
  ['SAFE_PHOTO_AJAR', 'SAFE_PHOTOGRAPHS'],
  ['SAFE_PHOTO_BOLTS', 'SAFE_PHOTOGRAPHS'],
  ['SAFE_INSTALLATION', 'SAFE_PHOTOGRAPHS'],
  // The 2026-08-20 consolidation, which had the same hole.
  ['DEDICATED_STATUS', 'DEDICATED_DISCIPLINE'],
  ['DEDICATED_HUNTER', 'DEDICATED_DISCIPLINE'],
  ['PROFESSIONAL_HUNTER', 'DEDICATED_DISCIPLINE'],
  ['GOOD_STANDING', 'DEDICATED_DISCIPLINE'],
];

function build() {
  const create = jest.fn(async (_a?: any): Promise<any> => ({ id: 'c1' }));
  const update = jest.fn(async (_a?: any): Promise<any> => ({}));
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
    credential: {
      count: jest.fn(async () => 0),
      create,
      update,
      findFirst: jest.fn(
        async (): Promise<any> => ({
          id: 'c1',
          kind: CredentialKind.SAFE_PHOTOGRAPHS,
          expiresOn: null,
          issuedOn: null,
          confirmedAt: null,
          neverExpires: true,
          issuedOnUnknown: false,
        }),
      ),
    },
  };
  const files = {
    write: jest.fn(async () => ({
      storageKey: 'credentials/2026/08/a.enc',
      sha256: 'sha-a',
      byteSize: 4,
    })),
    remove: jest.fn(async () => undefined),
  };
  const settings = { get: jest.fn(async () => 60) };
  const notifications = { resolveByEntity: jest.fn(async () => undefined) };
  const quota = { assertEnabled: jest.fn(async () => undefined) };
  // ⚠️ NEVER CALLED FOR A PHOTOGRAPH — and that is part of what is asserted:
  // a kind normalised forward must land on the no-vision path too, or a
  // photograph of a gun safe gets a vision call spent on it and comes back
  // flagged amber for having read nothing.
  const extract = {
    classify: jest.fn(async () => null),
    read: jest.fn(async () => null),
  };
  const svc = new LicenceCentreService(
    prisma as never,
    files as never,
    settings as never,
    notifications as never,
    quota as never,
    extract as never,
    {} as never,
  );
  return { svc, create, update, extract };
}

const file = { buffer: Buffer.from('bytes'), mimetype: 'image/jpeg' };

describe('a retired kind sent by a stale client', () => {
  it.each(FORWARD)('files %s as %s', async (retired, current) => {
    const { svc, create } = build();
    await svc.create('clerk_1', retired, '', file);
    expect(create.mock.calls[0][0].data.kind).toBe(current);
  });

  it('spends no vision call on a safe photograph filed under an old name', async () => {
    const { svc, extract } = build();
    await svc.create('clerk_1', 'SAFE_PHOTO_BOLTS', '', file);
    expect(extract.read).not.toHaveBeenCalled();
  });

  it('normalises the refile on the confirm panel too', async () => {
    // Worse than the upload, if anything: this lands on a row the member has
    // already been shown as correctly filed.
    const { svc, update } = build();
    await svc.confirmExpiry('clerk_1', 'c1', {
      expiresOn: '',
      neverExpires: true,
      kind: 'SAFE_PHOTO_AJAR',
    });
    expect(update.mock.calls[0][0].data.kind).toBe('SAFE_PHOTOGRAPHS');
  });

  it('leaves a current kind alone', () => {
    // The map must not quietly rewrite anything still in use — that is how a
    // normalisation becomes the bug it was written to prevent.
    const retired = new Set(FORWARD.map(([k]) => k as string));
    for (const kind of Object.values(CredentialKind)) {
      if (retired.has(kind)) continue;
      expect(currentKind(kind)).toBe(kind);
    }
  });
});
