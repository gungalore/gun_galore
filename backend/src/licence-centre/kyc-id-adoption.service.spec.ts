import { KycIdAdoptionService } from './kyc-id-adoption.service';

// Copying the ID somebody photographed to be verified into the library they
// manage. It is a NEW purpose for a document collected under another one, so
// every path here turns on an explicit yes and on never taking more than that
// yes covers.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.from([1, 2, 3])]);

function build(
  user: Record<string, unknown> | null,
  o: {
    enabled?: boolean;
    idsHeld?: number;
    totalHeld?: number;
    cap?: number;
    body?: Buffer;
    status?: number;
    createThrows?: unknown;
  } = {},
) {
  const files = {
    write: jest.fn(async () => ({
      storageKey: 'credentials/2026/08/abc.enc',
      sha256: 'sha',
      byteSize: (o.body ?? JPG).length,
    })),
    remove: jest.fn(async () => undefined),
  };
  const create = jest.fn(async (_a?: any): Promise<any> => {
    if (o.createThrows) throw o.createThrows;
    return { id: 'cred-1' };
  });
  let countCall = 0;
  const prisma = {
    user: { findUnique: jest.fn(async (): Promise<any> => user) },
    credential: {
      // First count is the ID check, second is the cap check.
      count: jest.fn(async (): Promise<number> => {
        countCall += 1;
        return countCall === 1 ? (o.idsHeld ?? 0) : (o.totalHeld ?? 0);
      }),
      create,
    },
  };
  const settings = { get: jest.fn(async () => o.cap ?? 60) };
  const quota = {
    isEnabled: jest.fn(async () => o.enabled ?? true),
    assertEnabled: jest.fn(async () => {
      if (o.enabled === false) throw new Error('disabled');
    }),
  };
  globalThis.fetch = jest.fn(async () => ({
    ok: (o.status ?? 200) < 400,
    status: o.status ?? 200,
    arrayBuffer: async () => {
      const b = o.body ?? JPG;
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  })) as never;

  const svc = new KycIdAdoptionService(
    prisma as never,
    files as never,
    settings as never,
    quota as never,
  );
  return { svc, files, create, prisma, quota };
}

const verified = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  kycStatus: 'VERIFIED',
  kycIdDocumentUrl: 'https://res.cloudinary.com/x/image/upload/v1/id.jpg',
  kycDocumentUrl: null,
  ...over,
});

describe('whether there is an offer to make at all', () => {
  it('offers it to a verified member who holds no ID here', async () => {
    const { svc } = build(verified());
    expect(await svc.offer('c1')).toEqual({
      available: true,
      alreadyThere: false,
    });
  });

  it('does not offer what is already there', async () => {
    // ⚠️ ANY ID document counts, not only one we put there. A member who
    // photographed their own ID into the Centre must not end up with a second
    // copy of the same paper under a second annexure letter.
    const { svc } = build(verified(), { idsHeld: 1 });
    expect(await svc.offer('c1')).toEqual({
      available: false,
      alreadyThere: true,
    });
  });

  it('OFFERS EVEN BEFORE THE VERDICT, because that is when it is asked', async () => {
    // ⚠️ THIS ASSERTED THE OPPOSITE UNTIL 2026-08-23. Operator: "As soon as
    // the KYC is done a window must pop up asking for permission... Does not
    // matter if the KYC has passed or not." The question is now put at
    // SUBMISSION, before a verdict exists — so a VERIFIED gate meant somebody
    // pressing yes and nothing happening, silently.
    //
    // It is also right on its own terms: the document is their own ID copy
    // going into their own storage, and a face-match result says nothing
    // about whether the copy is useful on a licence application.
    for (const st of ['UNDER_REVIEW', 'PENDING', 'REJECTED']) {
      const { svc } = build(verified({ kycStatus: st }));
      expect(await svc.offer('c1')).toEqual({
        available: true,
        alreadyThere: false,
      });
    }
  });

  it('does not offer when there is no stored copy', async () => {
    const { svc } = build(verified({ kycIdDocumentUrl: null }));
    expect((await svc.offer('c1')).available).toBe(false);
  });

  it('falls back to the retired manual-flow column', async () => {
    const { svc } = build(
      verified({
        kycIdDocumentUrl: null,
        kycDocumentUrl: 'https://res.cloudinary.com/x/image/upload/v1/old.jpg',
      }),
    );
    expect((await svc.offer('c1')).available).toBe(true);
  });

  it('stays QUIET rather than throwing when the Centre is switched off', async () => {
    // ⚠️ This renders a card at the end of being verified. A 404 here would
    // put a visible error on the page somebody sees the moment they are told
    // they passed.
    const { svc, prisma } = build(verified(), { enabled: false });
    expect(await svc.offer('c1')).toEqual({
      available: false,
      alreadyThere: false,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('taking the copy', () => {
  it('fetches the original, stores it encrypted, and files it as an ID', async () => {
    const { svc, files, create } = build(verified());
    await expect(svc.adopt('c1')).resolves.toEqual({
      added: true,
      credentialId: 'cred-1',
    });
    // ⚠️ INTO THE ENCRYPTED STORE. The KYC original lives on a CDN; this is
    // the only document in the Centre that has to be fetched back off one.
    expect(files.write).toHaveBeenCalledWith(
      'credentials',
      expect.any(Buffer),
      expect.any(Date),
    );
    const row = create.mock.calls[0][0].data;
    expect(row.kind).toBe('IDENTITY_DOCUMENT');
    // So a member who does not remember putting it there can be told.
    expect(row.addedVia).toBe('kyc');
    // ⚠️ NO DATES. An ID does not expire in any sense this module chases, and
    // the CHECK constraint forbids an expiresOn on this kind outright.
    expect(row.expiresOn).toBeUndefined();
    expect(row.confirmedAt).toBeUndefined();
  });

  it('reads the type off the bytes, not off the URL', async () => {
    // The download route serves whatever this column says, so a wrong content
    // type is a document that will not open.
    for (const [body, mime] of [
      [PDF, 'application/pdf'],
      [PNG, 'image/png'],
      [JPG, 'image/jpeg'],
    ] as [Buffer, string][]) {
      const { svc, create } = build(verified(), { body });
      await svc.adopt('c1');
      expect(create.mock.calls[0][0].data.mimeType).toBe(mime);
    }
  });

  it('is a no-op, not an error, when they already hold one', async () => {
    // They pressed a button on an offer. "It is already there" is a success
    // from where they are standing.
    const { svc, create } = build(verified(), { idsHeld: 1 });
    await expect(svc.adopt('c1')).resolves.toEqual({ added: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('takes the copy whatever the verdict said', async () => {
    // Same reasoning as the offer above. A failed verification does not make
    // it less their ID, and they can delete it from the Centre at any time.
    const { svc, create } = build(verified({ kycStatus: 'REJECTED' }));
    await expect(svc.adopt('c1')).resolves.toMatchObject({ added: true });
    expect(create.mock.calls[0][0].data.kind).toBe('IDENTITY_DOCUMENT');
  });

  it('still refuses when there is no ID on file at all', () => {
    // The one gate that remains: we cannot copy what we do not hold.
    const { svc } = build(
      verified({ kycIdDocumentUrl: null, kycDocumentUrl: null, kycIdStorageKey: null }),
    );
    return expect(svc.adopt('c1')).rejects.toThrow(/do not have a copy/i);
  });

  it('refuses when the Centre is full, and says the number', async () => {
    const { svc } = build(verified(), { totalHeld: 60, cap: 60 });
    await expect(svc.adopt('c1')).rejects.toThrow(/60 documents/);
  });

  it('does not leave bytes behind when the row fails', async () => {
    // A file with no row pointing at it is undeletable except by hand.
    const { svc, files } = build(verified(), {
      createThrows: new Error('boom'),
    });
    await expect(svc.adopt('c1')).rejects.toThrow('boom');
    expect(files.remove).toHaveBeenCalledWith('credentials/2026/08/abc.enc');
  });

  it('treats a duplicate-file collision as nothing to do', async () => {
    // Same bytes already filed by hand under another kind.
    const p2002 = Object.assign(new Error('dup'), {
      code: 'P2002',
      clientVersion: '7',
      name: 'PrismaClientKnownRequestError',
    });
    Object.setPrototypeOf(
      p2002,
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype,
    );
    const { svc, files } = build(verified(), { createThrows: p2002 });
    await expect(svc.adopt('c1')).resolves.toEqual({ added: false });
    expect(files.remove).toHaveBeenCalled();
  });

  it('fails soft and retryably when the CDN will not serve it', async () => {
    const { svc, files } = build(verified(), { status: 404 });
    await expect(svc.adopt('c1')).rejects.toThrow(/try again/i);
    expect(files.write).not.toHaveBeenCalled();
  });

  it('refuses an empty body rather than storing nothing', async () => {
    const { svc } = build(verified(), { body: Buffer.alloc(0) });
    await expect(svc.adopt('c1')).rejects.toThrow(/empty|try again/i);
  });
});
