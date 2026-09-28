import { LicenceCentreService } from './licence-centre.service';
import { MAX_IDENTIFY_FILES } from '../common/document-identify.service';

// ────────────────────────────────────────────────────────────────────
// THE BATCH COMMIT — the one confirm on the sorted review screen.
//
// Operator, 2026-09-28: documents sorted, evidence sorted, one button, "and it
// goes into the vault". This is that button's server half. What it must hold:
//
//   ⚠️ THE DATES ARE ACCEPTED, SO A REMINDER IS ARMED. The operator asked for
//   the single confirm to mean "this is right", so a document's read dates are
//   confirmed as it is filed.
//   ⚠️ A DATE WE COULD NOT SETTLE IS NOT A FAILURE. confirmExpiry refuses and
//   the row is still filed, unconfirmed — the Centre already asks about it.
//   ⚠️ EVIDENCE IS PLACED FROM ITS IMAGE AND THE MEMBER'S WORDS.
//   ⚠️ ONE BAD FILE KEEPS THE REST.
// ────────────────────────────────────────────────────────────────────

function build() {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })) },
  };
  const svc = new LicenceCentreService(
    prisma as never,
    { write: jest.fn(), remove: jest.fn(), read: jest.fn() } as never,
    { get: jest.fn(async () => 60) } as never,
    { resolveByEntity: jest.fn(async () => undefined) } as never,
    { assertEnabled: jest.fn(async () => undefined) } as never,
    { classify: jest.fn(), read: jest.fn() } as never,
    { classifyEvidence: jest.fn(), ocr: jest.fn() } as never,
    {
      rearmAutolinkFor: jest.fn(async () => 0),
      removeCredentialFromEditableDrafts: jest.fn(async () => ({
        uploads: 0,
        answers: 0,
      })),
    } as never,
    { note: () => undefined } as never,
    { findBySha: jest.fn(), put: jest.fn(), take: jest.fn() } as never,
  );
  return svc;
}

const file = (name: string) => ({
  buffer: Buffer.from(name),
  mimetype: 'image/jpeg',
  identifyId: `id-${name}`,
});

const created = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'FIREARM_LICENCE',
  title: 'Licence',
  neverExpires: false,
  proposed: { expiresOn: '2030-01-01', issuedOn: '2025-01-01' },
  ...over,
});

describe('commit()', () => {
  it('files a document and accepts the dates we read', async () => {
    const svc = build();
    const create = jest
      .spyOn(svc, 'create')
      .mockResolvedValue(created() as never);
    const confirm = jest
      .spyOn(svc, 'confirmExpiry')
      .mockResolvedValue({ confirmed: true, expiresOn: '2030-01-01' } as never);

    const out = await svc.commit('u1', [file('a')]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'u1',
      'c1',
      expect.objectContaining({
        expiresOn: '2030-01-01',
        issuedOn: '2025-01-01',
      }),
    );
    expect(out).toEqual([
      {
        ok: true,
        id: 'c1',
        kind: 'FIREARM_LICENCE',
        title: 'Licence',
        confirmed: true,
      },
    ]);
  });

  it('\u26a0\ufe0f FILES A DOCUMENT EVEN WHEN NO DATE COULD BE CONFIRMED', async () => {
    const svc = build();
    jest.spyOn(svc, 'create').mockResolvedValue(created() as never);
    jest
      .spyOn(svc, 'confirmExpiry')
      .mockRejectedValue(new Error('needs a date') as never);

    const out = await svc.commit('u1', [file('a')]);

    // Filed, but not confirmed — the honest outcome, not a failure.
    expect(out[0]).toMatchObject({ ok: true, id: 'c1', confirmed: false });
  });

  it('\u26a0\ufe0f PLACES EVIDENCE FROM ITS IMAGE AND THE MEMBER\u2019S WORDS', async () => {
    const svc = build();
    jest
      .spyOn(svc, 'create')
      .mockResolvedValue(
        created({ kind: 'EVIDENCE', title: 'Hunting photo' }) as never,
      );
    const redescribe = jest
      .spyOn(svc, 'redescribeEvidence')
      .mockResolvedValue(undefined as never);
    const confirm = jest.spyOn(svc, 'confirmExpiry');

    const out = await svc.commit('u1', [
      { ...file('a'), description: 'me and my son on a hunt' },
    ]);

    expect(redescribe).toHaveBeenCalledWith(
      'u1',
      'c1',
      'me and my son on a hunt',
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ ok: true, confirmed: false });
  });

  it('\u26a0\ufe0f ONE BAD FILE DOES NOT SINK THE BATCH', async () => {
    const svc = build();
    jest
      .spyOn(svc, 'create')
      .mockResolvedValueOnce(created({ id: 'c1' }) as never)
      .mockRejectedValueOnce(new Error('we could not read that one') as never)
      .mockResolvedValueOnce(created({ id: 'c3' }) as never);
    jest.spyOn(svc, 'confirmExpiry').mockResolvedValue(undefined as never);

    const out = await svc.commit('u1', [file('a'), file('b'), file('c')]);

    expect(out.map((r) => r.ok)).toEqual([true, false, true]);
    expect(out[1].error).toMatch(/could not read/);
  });

  it('refuses a file with no identify id rather than filing it blind', async () => {
    const svc = build();
    const create = jest.spyOn(svc, 'create');

    const out = await svc.commit('u1', [
      { ...file('a'), identifyId: undefined },
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(out[0]).toMatchObject({ ok: false });
  });

  it('caps the batch at MAX_IDENTIFY_FILES', async () => {
    const svc = build();
    await expect(
      svc.commit(
        'u1',
        Array.from({ length: MAX_IDENTIFY_FILES + 1 }, (_, i) =>
          file(String(i)),
        ),
      ),
    ).rejects.toThrow(/up to/i);
  });
});
