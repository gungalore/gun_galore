import { CredentialKind } from '@prisma/client';

// ⚠️ MOCKED SO THE HOOK ITSELF IS WHAT IS UNDER TEST. recomputeDerivedCompetencies
// has its own arithmetic and its own tests; what this file asks is a different
// question — does every write path that can change the licence set actually
// CALL it. That question cannot be answered by watching the arithmetic,
// because the arithmetic is correct and was simply never reached.
jest.mock('./credential-derive-recompute', () => ({
  recomputeDerivedCompetencies: jest.fn(async () => 0),
  competencyRenewalAdvice: jest.fn(async () => null),
}));

import { recomputeDerivedCompetencies } from './credential-derive-recompute';
import { LicenceCentreService } from './licence-centre.service';

// ────────────────────────────────────────────────────────────────────
// EVERY WRITE THAT MOVES A COMPETENCY'S DATE, AND THE ONE THAT DID NOT.
//
// A competency has no lifespan of its own — it runs to the latest licence in
// its firearm category — so the stored date is an answer to a MOVING question,
// and something has to move it. create() re-dated. confirmExpiry() re-dated.
// remove() did not, and remove() is the direction that can only ever leave a
// date TOO LATE: delete the last rifle licence behind a rifle competency and
// the certificate kept the expiry that licence had lent it. Green card, live
// reminder ladder, counting down to a deadline whose only support had just
// been thrown away. Nothing errored.
//
// So the test is not "does the arithmetic work" — it does — it is "was it
// asked". These assert the CALL.
// ────────────────────────────────────────────────────────────────────

const recompute = recomputeDerivedCompetencies as jest.MockedFunction<
  typeof recomputeDerivedCompetencies
>;

type Row = {
  id: string;
  kind: CredentialKind;
  coversKinds: CredentialKind[];
  storageKey?: string | null;
  expiresOn?: Date | null;
  title?: string;
};

/**
 * ⚠️ THE DEPENDENCIES ARE private ON THE CLASS, so
 * `LicenceCentreService & { prisma: unknown }` reduces to `never` — TypeScript
 * will not let an object type re-declare a name a class keeps private. So this
 * casts through unknown to a shape naming only what these tests touch, and
 * borrows the real method signatures rather than restating them, so a change
 * to one still breaks these tests instead of drifting past them.
 *
 * Same pattern as licence-centre-usage.spec.ts.
 */
function build(row: Row | null) {
  const updates: Record<string, unknown>[] = [];
  const persisted: Record<string, unknown>[] = [];
  // ⚠️ ORDER IS THE ASSERTION for the delete-propagation test below, and
  // nothing else can express it: both writes succeed either way round, and the
  // wrong order simply loses the stamp. So the calls are recorded in sequence.
  const order: string[] = [];
  const uploadUpdates: Record<string, unknown>[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    credential: {
      findFirst: jest.fn(async () => row),
      findMany: jest.fn(async () => []),
      delete: jest.fn(async () => {
        order.push('credential.delete');
        return {};
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
    motivationUpload: {
      updateMany: jest.fn(async (args: Record<string, unknown>) => {
        order.push('motivationUpload.updateMany');
        uploadUpdates.push(args);
        return { count: 1 };
      }),
    },
  };
  const notifications = {
    resolveByEntity: jest.fn(async () => undefined),
    persist: jest.fn(async (o: Record<string, unknown>) => {
      persisted.push(o);
    }),
  };
  const svc = Object.create(LicenceCentreService.prototype) as unknown as {
    prisma: unknown;
    quota: unknown;
    files: unknown;
    notifications: unknown;
    logger: unknown;
    requireUser: (c: string) => Promise<{ id: string }>;
    readDetails: (b: string | null) => Record<string, string>;
    motivations: unknown;
    rearmAutolink: (u: string) => Promise<void>;
    remove: LicenceCentreService['remove'];
    confirmExpiry: LicenceCentreService['confirmExpiry'];
  };
  svc.prisma = prisma;
  svc.quota = { assertEnabled: jest.fn(async () => undefined) };
  svc.files = { remove: jest.fn(async () => undefined) };
  svc.notifications = notifications;
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.requireUser = async () => ({ id: 'user-1' });
  svc.readDetails = () => ({});
  const rearm = jest.fn(async () => 1);
  svc.motivations = { rearmAutolinkFor: rearm };
  return {
    svc,
    prisma,
    notifications,
    updates,
    persisted,
    order,
    uploadUpdates,
    rearm,
  };
}

beforeEach(() => recompute.mockClear());

describe('deleting a document', () => {
  it('🚨 RE-DATES THE COMPETENCIES when the deleted row was a licence', () => {
    // The defect. Deleting the last licence in a category left every
    // competency dated off it holding a date with nothing behind it.
    const { svc } = build({
      id: 'cred-1',
      kind: CredentialKind.FIREARM_LICENCE,
      coversKinds: [],
      storageKey: 'k/1',
    });
    return svc.remove('clerk_1', 'cred-1').then(() => {
      expect(recompute).toHaveBeenCalledTimes(1);
      expect(recompute).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
        expect.any(Function),
        expect.anything(),
      );
    });
  });

  it('⚠️ re-dates when the row merely COVERS a licence', async () => {
    // Every licence query in the derivation reads
    // `{ kind: FIREARM_LICENCE } OR { coversKinds has FIREARM_LICENCE }`, so a
    // row filed under another kind that covers one IS a licence to the
    // arithmetic. A trigger asking only about `kind` misses it.
    const { svc } = build({
      id: 'cred-1',
      kind: CredentialKind.OTHER,
      coversKinds: [CredentialKind.FIREARM_LICENCE],
      storageKey: 'k/1',
    });
    await svc.remove('clerk_1', 'cred-1');
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('does not re-date for a document no competency could follow', async () => {
    // A photograph of a safe changes nothing about any expiry, and a recompute
    // per delete would be two queries spent to learn that.
    const { svc } = build({
      id: 'cred-1',
      kind: CredentialKind.SAFE_PHOTOGRAPHS,
      coversKinds: [],
      storageKey: 'k/1',
    });
    await svc.remove('clerk_1', 'cred-1');
    expect(recompute).not.toHaveBeenCalled();
  });

  it('🚨 STAMPS THE PACKS THAT COPIED IT, BEFORE THE ROW GOES', async () => {
    // The defect this closes: a member deletes a licence from the Centre and
    // every motivation carrying a copy of it says nothing. The copy is still
    // good — the bytes were copied, not shared — but it can no longer be
    // re-picked, re-dated or renewed from the vault, and the pack was the last
    // place that would have told them.
    const { svc, prisma, uploadUpdates } = build({
      id: 'cred-1',
      kind: CredentialKind.FIREARM_LICENCE,
      coversKinds: [],
      storageKey: 'k/1',
    });
    await svc.remove('clerk_1', 'cred-1');
    expect(prisma.motivationUpload.updateMany).toHaveBeenCalledTimes(1);
    const args = uploadUpdates[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.where).toEqual({
      sourceCredentialId: 'cred-1',
      // ⚠️ ONLY THE UNSTAMPED ROWS. Re-stamping would move a date already on
      // somebody's screen the next time they deleted anything.
      sourceRemovedAt: null,
    });
    expect(args.data.sourceRemovedAt).toBeInstanceOf(Date);
  });

  it('⚠️ and the ORDER is the whole trick', async () => {
    // The relation is onDelete: SetNull, so the instant the credential goes
    // every sourceCredentialId pointing at it is null — and a null pointer is
    // indistinguishable from a copy that never came from the vault. Stamping
    // AFTER the delete would match nothing and fail silently, with both
    // queries returning success.
    const { svc, order } = build({
      id: 'cred-1',
      kind: CredentialKind.FIREARM_LICENCE,
      coversKinds: [],
      storageKey: 'k/1',
    });
    await svc.remove('clerk_1', 'cred-1');
    expect(order).toEqual(['motivationUpload.updateMany', 'credential.delete']);
  });

  it('⚠️ stamps for EVERY kind, not just the ones a competency follows', async () => {
    // The re-date is about licences; this is about copies, and a safe
    // photograph is copied into a pack exactly as a licence is. Sharing the
    // licence test would have made the notice arrive for some documents and
    // not others, which is worse than never arriving.
    const { svc, prisma } = build({
      id: 'cred-1',
      kind: CredentialKind.SAFE_PHOTOGRAPHS,
      coversKinds: [],
      storageKey: 'k/1',
    });
    await svc.remove('clerk_1', 'cred-1');
    expect(prisma.motivationUpload.updateMany).toHaveBeenCalledTimes(1);
  });

  it('⚠️ still deletes when the packs cannot be stamped', async () => {
    // POPIA erasure is the stronger of the two obligations. Losing a notice
    // must never cost somebody the deletion they asked for.
    const { svc, prisma } = build({
      id: 'cred-1',
      kind: CredentialKind.FIREARM_LICENCE,
      coversKinds: [],
      storageKey: 'k/1',
    });
    prisma.motivationUpload.updateMany.mockRejectedValueOnce(
      new Error('database on fire'),
    );
    await expect(svc.remove('clerk_1', 'cred-1')).resolves.toEqual({
      removed: true,
    });
    expect(prisma.credential.delete).toHaveBeenCalledTimes(1);
  });

  it('reads the kind BEFORE the delete, since afterwards there is no row', async () => {
    const { svc, prisma } = build({
      id: 'cred-1',
      kind: CredentialKind.FIREARM_LICENCE,
      coversKinds: [],
      storageKey: 'k/1',
    });
    await svc.remove('clerk_1', 'cred-1');
    const select = (prisma.credential.findFirst.mock.calls[0] as unknown as [
      { select: Record<string, boolean> },
    ])[0].select;
    expect(select.kind).toBe(true);
    expect(select.coversKinds).toBe(true);
  });
});

describe('confirming a date', () => {
  const row = {
    id: 'cred-1',
    kind: CredentialKind.FIREARM_LICENCE,
    coversKinds: [] as CredentialKind[],
    neverExpires: false,
    expiresOn: null,
    title: 'My .308',
  };

  it('🚨 CLEARS THE PROVENANCE COLUMNS', async () => {
    // dateSource / dateSourceNote / dateReadConfident say WE put the date
    // there. After a confirm that is simply false — the member has looked at
    // it and answered, possibly by typing something different — and the card
    // renders its "where did this come from" line off these columns. It read
    // "We read this date off the document you uploaded" over a date the member
    // had just corrected by hand.
    const { svc, updates } = build(row as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' });
    expect(updates[0]).toMatchObject({
      dateSource: null,
      dateSourceNote: null,
      // Non-null Boolean column, so false rather than null — and false is the
      // right reading anyway: this is no longer our confident reading.
      dateReadConfident: false,
    });
  });

  it('⚠️ re-dates for a row that only COVERS a licence', async () => {
    // This asked `before.kind === 'FIREARM_LICENCE' || nextKind === ...` and
    // never looked at coversKinds, so confirming one of these entered the
    // derivation set and re-dated nothing.
    const { svc } = build({
      ...row,
      kind: CredentialKind.OTHER,
      coversKinds: [CredentialKind.FIREARM_LICENCE],
    } as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' });
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('⚠️ re-dates when a row is RE-FILED INTO a licence', async () => {
    const { svc } = build({
      ...row,
      kind: CredentialKind.OTHER,
    } as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', {
      expiresOn: '2032-11-28',
      kind: CredentialKind.FIREARM_LICENCE,
    });
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('⚠️ and when it is re-filed OUT of one', async () => {
    // Leaving the licence set is exactly as much of a change as joining it:
    // the competency that was dated off this row now has nothing behind it.
    const { svc } = build(row as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', {
      expiresOn: '2032-11-28',
      kind: CredentialKind.OTHER,
    });
    expect(recompute).toHaveBeenCalledTimes(1);
  });

  it('does not re-date for a document that was never a licence', async () => {
    const { svc } = build({
      ...row,
      kind: CredentialKind.ADDRESS_CONFIRMATION,
    } as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' });
    expect(recompute).not.toHaveBeenCalled();
  });

  it('🚨 RE-ARMS AUTO-ATTACH, so the open drafts see the settled date', async () => {
    // Auto-attach is one-shot per application: Motivation.autolinkedAt is
    // stamped the first time a draft sweeps the vault and a stamped draft never
    // sweeps again. Confirming is the moment a document becomes fully usable —
    // credentialOffer will take an unconfirmed row's make but not its date — so
    // without this the sweep's answer is frozen at the moment of upload.
    const { svc, rearm } = build(row as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' });
    expect(rearm).toHaveBeenCalledWith('user-1');
  });

  it('⚠️ re-arms for a document no competency follows, too', async () => {
    // Nothing about attaching is licence-shaped. An ID document confirmed
    // after the application was started is exactly the case this exists for.
    const { svc, rearm } = build({
      ...row,
      kind: CredentialKind.IDENTITY_DOCUMENT,
    } as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' });
    expect(rearm).toHaveBeenCalledTimes(1);
  });

  it('⚠️ still confirms when the drafts cannot be re-armed', async () => {
    // Fail-open. A member confirming a date must not be told it failed because
    // a module on the other side of a boundary was unavailable.
    const { svc, rearm } = build(row as unknown as Row);
    rearm.mockRejectedValueOnce(new Error('motivations unavailable'));
    await expect(
      svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' }),
    ).resolves.toMatchObject({ confirmed: true });
  });

  it('clears the nudge the upload path now raises', async () => {
    // The other half of the H7 loop — see the create() test below. This call
    // has always been here; until now there was no row for it to resolve.
    const { svc, notifications } = build(row as unknown as Row);
    await svc.confirmExpiry('clerk_1', 'cred-1', { expiresOn: '2032-11-28' });
    expect(notifications.resolveByEntity).toHaveBeenCalledWith(
      'credential',
      'cred-1',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// A DATE WE READ AND WOULD NOT ACT ON, AND NOBODY WAS TOLD.
//
// mayArmReadExpiry is the only thing standing between an OCR misreading and an
// SMS about somebody's firearm licence, and when it refuses, the date is still
// written and shown — it simply drives nothing. That is the right call. What
// was wrong is what happened next: a single `logger.log` line, and then
// silence. No inbox row, no badge, no email. The one document in the vault
// that most needs a human to look at it was the one document that never asked.
//
// Worse, confirmExpiry's own comment claimed to clear "the 'confirm this'
// nudge", and resolveByEntity('credential', …) has been called there for as
// long as it has existed — against a notification nothing ever created. The
// resolve half of the loop was built and wired; only the row was missing.
// ────────────────────────────────────────────────────────────────────

function buildUpload(reading: {
  expiresOn: string | null;
  issuedOn: string | null;
  details: Record<string, string>;
  lowConfidence: string[];
}) {
  const persisted: Record<string, unknown>[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    credential: {
      count: jest.fn(async () => 0),
      create: jest.fn(async () => ({ id: 'cred-new' })),
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
    },
  };
  const svc = Object.create(LicenceCentreService.prototype) as unknown as {
    prisma: unknown;
    quota: unknown;
    files: unknown;
    settings: unknown;
    extract: unknown;
    notifications: unknown;
    logger: unknown;
    requireUser: (c: string) => Promise<{ id: string }>;
    readDetails: (b: string | null) => Record<string, string>;
    motivations: unknown;
    rearmAutolink: (u: string) => Promise<void>;
    create: LicenceCentreService['create'];
  };
  svc.prisma = prisma;
  svc.quota = { assertEnabled: jest.fn(async () => undefined) };
  svc.settings = { get: jest.fn(async () => 50) };
  svc.files = {
    write: jest.fn(async () => ({
      storageKey: 'k/1',
      sha256: 'sha',
      byteSize: 12,
    })),
    remove: jest.fn(async () => undefined),
  };
  svc.extract = {
    classify: jest.fn(async () => null),
    read: jest.fn(async () => reading),
  };
  svc.notifications = {
    persist: jest.fn(async (o: Record<string, unknown>) => {
      persisted.push(o);
    }),
    resolveByEntity: jest.fn(async () => undefined),
  };
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  svc.requireUser = async () => ({ id: 'user-1' });
  svc.readDetails = () => ({});
  const rearm = jest.fn(async () => 1);
  svc.motivations = { rearmAutolinkFor: rearm };
  return { svc, persisted, rearm };
}

const FILE = { buffer: Buffer.from('bytes'), mimetype: 'image/jpeg' };

// create() encrypts whatever it read before storing it, so the blob key has to
// exist for this path to run at all. Nothing here reads the ciphertext back.
const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-licence-centre-write-hooks';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

describe('a read date that could not be armed', () => {
  it('🚨 RAISES AN INBOX ROW, which is what nothing did', async () => {
    // No section on the card, so mayArmReadExpiry has nothing to cross-check
    // the term against and refuses — the commonest refusal there is.
    const { svc, persisted } = buildUpload({
      expiresOn: '2032-11-28',
      issuedOn: '2022-11-29',
      details: { make: 'HOWA' },
      lowConfidence: [],
    });
    await svc.create('clerk_1', CredentialKind.FIREARM_LICENCE, '', FILE);

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      userId: 'user-1',
      category: 'ACCOUNT',
      // ⚠️ THE LINK IS WHAT MAKES IT CLEARABLE. resolveByEntity in
      // confirmExpiry matches on linkedType + linkedId; without them the row
      // could never be resolved by the action it is asking for.
      linkedType: 'credential',
      linkedId: 'cred-new',
      url: '/documents',
      // Dismissible: the member may reasonably decide the date is fine and
      // never touch it. An action-required row they cannot clear would sit in
      // the inbox for the life of the document.
      dismissible: true,
    });
  });

  it('says nothing when the date WAS armed', async () => {
    // A clean, corroborated s16 licence: ten years, section on the card. The
    // reminder ladder is now watching it, so there is nothing to ask.
    const { svc, persisted } = buildUpload({
      expiresOn: '2035-09-21',
      issuedOn: '2025-09-22',
      details: { section: 'S16' },
      lowConfidence: [],
    });
    await svc.create('clerk_1', CredentialKind.FIREARM_LICENCE, '', FILE);
    expect(persisted).toHaveLength(0);
  });

  it('⚠️ says nothing when there was no date to begin with', async () => {
    // Absent is not wrong. A document that simply prints no expiry has nothing
    // for this guard to refuse, and asking about it would be asking the member
    // to check a date that does not exist.
    const { svc, persisted } = buildUpload({
      expiresOn: null,
      issuedOn: '2022-11-29',
      details: { make: 'HOWA' },
      lowConfidence: [],
    });
    await svc.create('clerk_1', CredentialKind.FIREARM_LICENCE, '', FILE);
    expect(persisted).toHaveLength(0);
  });
});

// ────────────────────────────────────────
// THE DOCUMENT THAT ARRIVED AFTER THE APPLICATION DID.
//
// Auto-attach sweeps the vault ONCE per draft and stamps Motivation
// .autolinkedAt when it has. So a member who starts an application on Monday
// and files their competency certificate on Thursday had that certificate one
// screen away from an application that would never look for it again — and
// nothing on either screen said so. Filing a document re-arms the sweep.
// ────────────────────────────────────────

describe('filing a new document', () => {
  const READ = {
    expiresOn: '2035-09-21',
    issuedOn: '2025-09-22',
    details: { section: 'S16' },
    lowConfidence: [],
  };

  it('🚨 RE-ARMS AUTO-ATTACH on every open draft', async () => {
    const { svc, rearm } = buildUpload(READ);
    await svc.create('clerk_1', CredentialKind.FIREARM_LICENCE, '', FILE);
    expect(rearm).toHaveBeenCalledWith('user-1');
  });

  it('⚠️ never lets that cost the member their upload', async () => {
    // The upload is the thing the member did. A re-arm is housekeeping we
    // decided to do afterwards, and it must not be able to fail the file they
    // just took a photograph of.
    const { svc, rearm } = buildUpload(READ);
    rearm.mockRejectedValueOnce(new Error('motivations unavailable'));
    await expect(
      svc.create('clerk_1', CredentialKind.FIREARM_LICENCE, '', FILE),
    ).resolves.toMatchObject({ id: 'cred-new' });
  });
});
