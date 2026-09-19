import { MotivationStatus } from '@prisma/client';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import { MotivationDocumentsService } from './motivation-documents.service';

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-motivation-cleanup';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

describe('MotivationDocumentsService vault deletion cleanup', () => {
  it('removes vault-sourced draft answers and copies, not completed packs', async () => {
    const answers = {
      existing_firearm_1_make: 'MARLIN',
      existing_firearm_1_serial: 'MR90189D',
      firearm_make: 'TIKKA',
    };
    const updates: any[] = [];
    const deletes: any[] = [];
    const prisma: any = {
      motivationUpload: {
        findMany: jest.fn(async () => [
          {
            id: 'upload-draft',
            storageKey: 'motivation/draft',
            sha256: 'hash-draft',
            motivation: {
              id: 'draft-1',
              answersEncrypted: encryptJson(answers),
              answerProvenance: {
                existing_firearm_1_make: {
                  source: 'VAULT',
                  sourceId: 'credential-1',
                  from: 'licence',
                  at: '2026-09-15T00:00:00.000Z',
                },
                existing_firearm_1_serial: {
                  source: 'VAULT',
                  sourceId: 'credential-1',
                  from: 'licence',
                  at: '2026-09-15T00:00:00.000Z',
                },
                firearm_make: {
                  source: 'MEMBER',
                  from: 'the member',
                  at: '2026-09-15T00:00:00.000Z',
                },
              },
            },
          },
        ]),
        delete: jest.fn(async (args: any) => deletes.push(args)),
      },
      motivation: {
        update: jest.fn(async (args: any) => updates.push(args)),
      },
    };
    const files = { remove: jest.fn(async () => undefined) };
    const readCache = { forget: jest.fn(async () => undefined) };
    const svc: any = Object.create(MotivationDocumentsService.prototype);
    svc.prisma = prisma;
    svc.files = files;
    svc.readCache = readCache;
    // The page rasteriser purges beside the read cache; this spec is about the
    // read cache, so it only has to be present.
    svc.pageRaster = { forget: jest.fn(async () => undefined) };
    svc.logger = { warn: jest.fn() };

    await svc.removeCredentialFromEditableDrafts('user-1', 'credential-1');

    const query = prisma.motivationUpload.findMany.mock.calls[0][0];
    expect(query.where.motivation.status).toEqual({ in: [
      MotivationStatus.DRAFT,
      MotivationStatus.INTERVIEW,
      MotivationStatus.NEEDS_MORE_INFO,
    ] });
    expect(files.remove).toHaveBeenCalledWith('motivation/draft');
    expect(deletes).toEqual([{ where: { id: 'upload-draft' } }]);
    expect(readCache.forget).toHaveBeenCalledWith('hash-draft');

    const saved = updates[0].data;
    expect(decryptJson(saved.answersEncrypted)).toEqual({ firearm_make: 'TIKKA' });
    expect(saved.answerProvenance).toEqual({
      firearm_make: {
        source: 'MEMBER',
        from: 'the member',
        at: '2026-09-15T00:00:00.000Z',
      },
    });
  });
});
