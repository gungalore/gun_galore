import { MotivationUploadKind } from '@prisma/client';
import { BACKFILL_BATCH, VAULTABLE, VaultAdoptionService } from './vault-adoption.service';
import { encryptJson } from '../common/blob-crypto';

// KEEPING THE PAPERWORK FROM AN APPLICATION.
//
// The rules that matter here are all about NOT doing things: not without a
// yes, not sharing a byte, not resurrecting something the member deleted, and
// never at the cost of the upload itself.

const day = (s: string) => new Date(`${s}T00:00:00Z`);

function build(
  o: {
    consent?: boolean;
    upload?: Record<string, unknown> | null;
    dupes?: number;
    held?: number;
    cap?: number;
    createThrows?: unknown;
    user?: Record<string, unknown> | null;
    rows?: { id: string; createdAt: Date; storageKey: string | null; purgedAt: Date | null }[];
  } = {},
) {
  const files = {
    read: jest.fn(async () => Buffer.from('bytes')),
    write: jest.fn(async () => ({
      storageKey: 'credentials/2026/08/new.enc',
      sha256: 'sha-new',
      byteSize: 5,
    })),
    remove: jest.fn(async () => undefined),
  };
  const credentialCreate = jest.fn(async (_a?: any): Promise<any> => {
    if (o.createThrows) throw o.createThrows;
    return { id: 'c1' };
  });
  const prisma = {
    user: {
      findUnique: jest.fn(async (): Promise<any> =>
        o.user === undefined
          ? { id: 'u1', documentVaultBackfillCursor: null, documentVaultBackfilledAt: null }
          : o.user,
      ),
      update: jest.fn(async (a: any): Promise<any> => a),
    },
    motivationUpload: {
      findFirst: jest.fn(async (): Promise<any> =>
        o.upload === undefined
          ? {
              kind: MotivationUploadKind.IDENTITY_DOCUMENT,
              storageKey: 'motivations/2026/08/a.enc',
              purgedAt: null,
              mimeType: 'image/jpeg',
              sha256: 'sha-a',
              extractionEncrypted: 'blob',
              extractionOk: true,
              extractedFields: ['id_number'],
              motivation: { referenceNumber: 'MO000117' },
            }
          : o.upload,
      ),
      findMany: jest.fn(async (): Promise<any> => o.rows ?? []),
      count: jest.fn(async () => 0),
    },
    credential: {
      // ⚠️ KEYED ON THE QUERY, NOT ON CALL ORDER. These two counts interleave
      // differently in adoptUpload and in backfillStep, and an alternating
      // stub silently answered the cap check with the duplicate count.
      count: jest.fn(async (a: any): Promise<number> =>
        a?.where?.sha256 !== undefined ? (o.dupes ?? 0) : (o.held ?? 0),
      ),
      create: credentialCreate,
    },
  };
  const settings = { get: jest.fn(async () => o.cap ?? 60) };
  const consent = { mayKeepFor: jest.fn(async () => o.consent ?? true) };
  const svc = new VaultAdoptionService(
    prisma as never,
    files as never,
    settings as never,
    consent as never,
  );
  return { svc, prisma, files, credentialCreate, consent };
}

describe('what may be kept at all', () => {
  it('keeps the paperwork that describes the PERSON', () => {
    for (const k of [
      'IDENTITY_DOCUMENT',
      'ADDRESS_CONFIRMATION',
      'EMPLOYMENT_CONFIRMATION',
      'SAFE_PHOTOGRAPHS',
      // The four retired safe kinds stay on the list too: the backfill walks
      // documents attached long before the collapse, and a row written during
      // the deploy would otherwise be the one photograph the Centre never
      // learns about.
      'SAFE_PHOTO_CLOSED',
      'SAFE_PHOTO_AJAR',
      'SAFE_PHOTO_BOLTS',
      'SAFE_INSTALLATION',
      'SHOOTING_ACTIVITY_LOG',
    ] as MotivationUploadKind[]) {
      expect(VAULTABLE.has(k)).toBe(true);
    }
  });

  it('keeps nothing tied to one firearm, one estate or one incident', () => {
    // ⚠️ THE INVERSE OF "SAFE TO REUSE" IS NOT THE ANSWER. An executor's
    // appointment is reusable within one estate and meaningless after it; an
    // incident report belongs to the incident. Neither belongs in a permanent
    // library, and an endorsement names a single firearm by serial.
    for (const k of [
      'ASSOCIATION_ENDORSEMENT',
      'FIREARM_SOURCE_PROOF',
      'SELLER_LICENCE',
      'EXECUTOR_APPOINTMENT',
      'INCIDENT_REPORT',
      'PREVIOUS_MOTIVATION',
      'CURRENT_LICENCE',
      'OTHER',
    ] as MotivationUploadKind[]) {
      expect(VAULTABLE.has(k)).toBe(false);
    }
  });
});

describe('adopting one upload', () => {
  it('files a retired safe kind FORWARD, so the Centre can find it', async () => {
    // ⚠️ ADMITTING A ROW AND THEN LOSING IT IS WORSE THAN NOT ADMITTING IT.
    // VAULTABLE keeps the retired four on purpose, so an application filed
    // before 2026-08-23 still hands its safe photographs to the Centre — and
    // this wrote `kind: u.kind`, which put them in the Centre under a value the
    // backfill migration had already emptied. Outside the safe checklist row,
    // outside the vault picker's safe slot, and nothing anywhere to tell the
    // member their photograph had landed in a hole.
    const { svc, credentialCreate } = build({
      upload: {
        kind: MotivationUploadKind.SAFE_PHOTO_BOLTS,
        storageKey: 'motivations/2026/08/a.enc',
        purgedAt: null,
        mimeType: 'image/jpeg',
        sha256: 'sha-a',
        extractionEncrypted: null,
        extractionOk: false,
        extractedFields: [],
        motivation: { referenceNumber: 'MO000117' },
      },
    });
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(true);
    expect(credentialCreate.mock.calls[0][0].data.kind).toBe('SAFE_PHOTOGRAPHS');
    // The member's own words survive the refiling — it is the only record left
    // of which shot they said this was.
    expect(credentialCreate.mock.calls[0][0].data.title).toMatch(/bolts/i);
  });

  it('leaves every other kind exactly where it was', async () => {
    // The identity naming is the whole reason there is no translation table.
    const { svc, credentialCreate } = build();
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(true);
    expect(credentialCreate.mock.calls[0][0].data.kind).toBe('IDENTITY_DOCUMENT');
  });

  it('copies the bytes into a FRESH key, never the upload own', async () => {
    // ⚠️ THE INVARIANT THE WHOLE FEATURE RESTS ON. Motivation uploads are
    // purged on a two-year clock and vault documents are not, so a shared
    // storageKey means the writer's retention sweep silently blanking a
    // document out of somebody's Centre — with nothing in the Centre's own
    // code to explain it.
    const { svc, files, credentialCreate } = build();
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(true);
    expect(files.read).toHaveBeenCalledWith('motivations/2026/08/a.enc');
    expect(files.write).toHaveBeenCalledWith(
      'credentials',
      expect.any(Buffer),
      expect.any(Date),
    );
    expect(credentialCreate.mock.calls[0][0].data.storageKey).toBe(
      'credentials/2026/08/new.enc',
    );
  });

  it('files the vision reading in detailsEncrypted, NOT extractionEncrypted', async () => {
    // Credential.extractionEncrypted is documented NEVER WRITTEN — the vault
    // keeps its reading in detailsEncrypted. A reader that trusted the mirror
    // decrypted null on every row for months, which is how the vault silently
    // failed to fill anything on a motivation.
    const { svc, credentialCreate } = build();
    await svc.adoptUpload('u1', 'up1');
    const d = credentialCreate.mock.calls[0][0].data;
    expect(d.detailsEncrypted).toBe('blob');
    expect(d.extractionEncrypted).toBeUndefined();
  });

  it('records where it came from', async () => {
    const { svc, credentialCreate } = build();
    await svc.adoptUpload('u1', 'up1');
    const d = credentialCreate.mock.calls[0][0].data;
    expect(d.addedVia).toBe('application');
    expect(d.addedForRef).toBe('MO000117');
  });

  it('does NOTHING without a yes', async () => {
    // Keeping is new processing. mayKeepFor fails closed.
    const { svc, files, prisma } = build({ consent: false });
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(false);
    expect(prisma.motivationUpload.findFirst).not.toHaveBeenCalled();
    expect(files.read).not.toHaveBeenCalled();
  });

  it('skips a kind that belongs to one application', async () => {
    const { svc, files } = build({
      upload: {
        kind: MotivationUploadKind.ASSOCIATION_ENDORSEMENT,
        storageKey: 'motivations/2026/08/a.enc',
        purgedAt: null,
        mimeType: 'image/jpeg',
        sha256: 'sha-a',
        extractionEncrypted: null,
        extractionOk: false,
        extractedFields: [],
        motivation: { referenceNumber: 'MO1' },
      },
    });
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(false);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('skips an upload whose bytes retention has already deleted', async () => {
    const { svc, files } = build({
      upload: {
        kind: MotivationUploadKind.IDENTITY_DOCUMENT,
        storageKey: null,
        purgedAt: day('2026-01-01'),
        mimeType: 'image/jpeg',
        sha256: 'sha-a',
        extractionEncrypted: null,
        extractionOk: false,
        extractedFields: [],
        motivation: { referenceNumber: 'MO1' },
      },
    });
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(false);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('skips one they already hold, by content', async () => {
    const { svc, files } = build({ dupes: 1 });
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(false);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('stops at the cap without throwing', async () => {
    // A full Centre is a thing to tell them about, not an error to raise in
    // the middle of an upload they came here to do.
    const { svc, files } = build({ held: 60, cap: 60 });
    await expect(svc.adoptUpload('u1', 'up1')).resolves.toBe(false);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('does not leave bytes behind when the row fails', async () => {
    const { svc, files } = build({ createThrows: new Error('boom') });
    await expect(svc.adoptUpload('u1', 'up1')).rejects.toThrow('boom');
    expect(files.remove).toHaveBeenCalledWith('credentials/2026/08/new.enc');
  });
});

describe('the one-off copy of what came before the yes', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `up${i}`,
      createdAt: day(`2026-0${(i % 9) + 1}-01`),
      storageKey: `motivations/2026/08/${i}.enc`,
      purgedAt: null,
    }));

  it('advances the cursor to the OLDEST row in the batch', async () => {
    // ⚠️ THIS IS WHY DELETION MEANS DELETION. The walk only ever looks strictly
    // older than the cursor, so a document the member removes from their Centre
    // afterwards is never re-copied by a later step. A cron over the whole
    // table would resurrect it every night, because the row it copies FROM is
    // still sitting in the application.
    const batch = rows(BACKFILL_BATCH);
    const { svc, prisma } = build({ rows: batch });
    await svc.backfillStep('c1');
    const upd = (prisma.user.update as jest.Mock).mock.calls[0][0];
    expect(upd.data.documentVaultBackfillCursor).toEqual(
      batch[batch.length - 1].createdAt,
    );
  });

  it('reports a purged document instead of trying to read it', async () => {
    // The row survives its bytes so the application's annexure list still says
    // what was attached. Offering to copy one would fail at the moment of
    // copying, after the member had been given a number.
    const { svc, files } = build({
      rows: [
        { id: 'up0', createdAt: day('2026-01-01'), storageKey: null, purgedAt: day('2026-06-01') },
      ],
    });
    const step = await svc.backfillStep('c1');
    expect(step.skippedPurged).toBe(1);
    expect(step.adopted).toBe(0);
    expect(files.read).not.toHaveBeenCalled();
  });

  it('reports a full Centre without throwing, so they can clear space', async () => {
    const { svc } = build({ rows: rows(2), held: 60, cap: 60 });
    const step = await svc.backfillStep('c1');
    expect(step.cappedOut).toBe(2);
    expect(step.adopted).toBe(0);
  });

  it('marks itself finished when nothing is left, and never runs again', async () => {
    const { svc, prisma } = build({ rows: [] });
    const step = await svc.backfillStep('c1');
    expect(step.done).toBe(true);
    expect(
      (prisma.user.update as jest.Mock).mock.calls[0][0].data
        .documentVaultBackfilledAt,
    ).toBeInstanceOf(Date);
  });

  it('is not done while a full batch came back', async () => {
    const { svc } = build({ rows: rows(BACKFILL_BATCH) });
    expect((await svc.backfillStep('c1')).done).toBe(false);
  });

  it('STOPS MID-BACKFILL when the member withdraws', async () => {
    // Re-checked every batch, not once at the start. Somebody who switches it
    // off half way through must stop half way through.
    const { svc, prisma } = build({ consent: false, rows: rows(5) });
    const step = await svc.backfillStep('c1');
    expect(step).toEqual({ adopted: 0, skippedPurged: 0, cappedOut: 0, done: true });
    expect(prisma.motivationUpload.findMany).not.toHaveBeenCalled();
  });

  it('does nothing once it has already finished', async () => {
    const { svc, prisma } = build({
      user: {
        id: 'u1',
        documentVaultBackfillCursor: day('2026-01-01'),
        documentVaultBackfilledAt: day('2026-08-01'),
      },
    });
    expect((await svc.backfillStep('c1')).done).toBe(true);
    expect(prisma.motivationUpload.findMany).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────
// H8 — THE DATES COME ACROSS.
//
// A firearm licence adopted from an application landed in the Centre with no
// expiry at all, so the reminder sweep could not see it, so the member got NO
// renewal reminder for a licence we were holding a photograph of. The old note
// said "the member confirms the dates in the Centre when they want to" — which
// is the confirm step CLAUDE.md's "Automate It" section exists to end.
// ────────────────────────────────────────────────────────────────────

describe('the dates on an adopted document', () => {
  const ORIGINAL = process.env.ID_HASH_SECRET;
  beforeAll(() => {
    process.env.ID_HASH_SECRET = 'test-secret-for-vault-adoption';
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.ID_HASH_SECRET;
    else process.env.ID_HASH_SECRET = ORIGINAL;
  });

  /** A licence upload whose stored reading carries real dates. */
  const licenceUpload = (details: Record<string, string>) => ({
    kind: MotivationUploadKind.CURRENT_LICENCE,
    storageKey: 'motivations/2026/08/l.enc',
    purgedAt: null,
    mimeType: 'image/jpeg',
    sha256: 'sha-l',
    extractionEncrypted: encryptJson(details),
    extractionOk: true,
    extractedFields: Object.keys(details),
    motivation: { referenceNumber: 'MO000117' },
  });

  /**
   * ⚠️ CURRENT_LICENCE IS NOT IN VAULTABLE, DELIBERATELY — see the note on the
   * set. The date-writing must still be right for it, because the operator's
   * decision on whether to admit it is theirs to take and this must not be the
   * thing that then goes wrong. So the test admits it locally rather than
   * changing the shipped rule.
   */
  const adoptable = (svc: VaultAdoptionService, u: unknown) => {
    (VAULTABLE as Set<MotivationUploadKind>).add(
      MotivationUploadKind.CURRENT_LICENCE,
    );
    return { svc, u };
  };
  afterEach(() => {
    (VAULTABLE as Set<MotivationUploadKind>).delete(
      MotivationUploadKind.CURRENT_LICENCE,
    );
  });

  it('writes the issue and expiry dates it already holds, and arms them', async () => {
    // Nothing is re-read: the reading is already on the row. This simply stops
    // throwing the dates inside it away.
    const upload = licenceUpload({
      issued_on: '2025-06-06',
      expires_on: '2035-06-06',
      section: 'Section 16',
      firearm_type: 'RIFLE',
    });
    const { svc, prisma } = build({ upload });
    adoptable(svc, upload);

    expect(await svc.adoptUpload('u1', 'up-1')).toBe(true);
    const data = prisma.credential.create.mock.calls[0][0].data;
    expect(data.issuedOn?.toISOString().slice(0, 10)).toBe('2025-06-06');
    expect(data.expiresOn?.toISOString().slice(0, 10)).toBe('2035-06-06');
    // A date beside a standing neverExpires tick breaks the model's CHECK
    // constraint and stores two contradictory answers.
    expect(data.neverExpires).toBe(false);
    // Armed, so the reminder sweep can act on it — which is the whole point.
    expect(data.dateSource).toBe('read');
    // In the clear, so a competency can be dated off it: the derivation is a
    // group-by on this column and SQL cannot open the encrypted details.
    expect(data.firearmCategory).toBeTruthy();
  });

  it('⚠️ WRITES A DATE ALREADY PAST, AND REFUSES TO ARM IT', () => {
    // The Licence Centre's own guard, imported rather than reimplemented. The
    // reminder ladder's last stage fires on anything at or past its expiry, so
    // arming one that lapsed in 2019 sends a notice about it tonight. The
    // member still SEES the date and can correct it; only the automatic part is
    // withheld.
    const upload = licenceUpload({
      issued_on: '2014-01-01',
      expires_on: '2019-01-01',
      section: 'Section 16',
    });
    const { svc, prisma } = build({ upload });
    adoptable(svc, upload);

    return svc.adoptUpload('u1', 'up-1').then(() => {
      const data = prisma.credential.create.mock.calls[0][0].data;
      expect(data.expiresOn?.toISOString().slice(0, 10)).toBe('2019-01-01');
      expect(data.dateSource).toBeUndefined();
    });
  });

  it('writes no dates at all where the document carries none', async () => {
    // Absent stays absent, which is a different thing from wrong. An ID copy
    // has no expiry in any sense and must not acquire one.
    const { svc, prisma } = build();
    expect(await svc.adoptUpload('u1', 'up-1')).toBe(true);
    const data = prisma.credential.create.mock.calls[0][0].data;
    expect(data.issuedOn).toBeUndefined();
    expect(data.expiresOn).toBeUndefined();
    expect(data.dateSource).toBeUndefined();
  });
});
