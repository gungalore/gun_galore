import { MotivationLicenceType } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { MotivationGenerationService } from './motivation-generation.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { encryptJson } from '../common/blob-crypto';

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-precinct-preview';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

// ────────────────────────────────────────────────────────────────────
// MotivationGenerationService.precinctFor() — the read-only preview behind
// GET /motivations/:id/precinct, so the wizard can show a self-defence
// applicant the SAPS figures that WILL be cited before they ever reach
// Generate.
//
// The fetch this shares with runGeneration (station -> CrimeStatsService)
// is exercised end to end elsewhere; this file is the endpoint's own
// contract — ownership, licence-type gating, and fail-soft on a bad lookup.
// ────────────────────────────────────────────────────────────────────

function build(motivation: unknown, precinct: jest.Mock) {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    motivation: {
      findFirst: jest.fn(async () => motivation),
    },
  };
  const crimeStats = { precinct } as unknown as { precinct: jest.Mock };
  const shared = new MotivationSharedService(prisma as never, new MemberProfileAnswersService(prisma as never));
  const svc = new MotivationGenerationService(
    prisma as never,
    {} as never, // quota — unused by this read
    {} as never, // settings
    {} as never, // model
    {} as never, // firearmImages
    {} as never, // notifications
    shared,
    crimeStats as never,
    {} as never, // news — unused by precinctFor()
    {} as never, // research — unused by precinctFor()
    {} as never, // firearmUses — unused by precinctFor()
  );
  return { svc, prisma };
}

const FIGURES = {
  station: { name: 'Brooklyn', district: 'Pretoria', province: 'Gauteng' },
  release: { key: '2026-Q1', periodLabel: 'Jan-Mar 2026', fetchedOn: '2026-04-01', sourceUrl: 'https://saps.gov.za' },
  categories: [],
};

describe('precinctFor', () => {
  it('returns the figures for the station on file', async () => {
    const precinct = jest.fn(async () => FIGURES);
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        answersEncrypted: encryptJson({
          police_station: 'Brooklyn',
          police_station_province: 'Gauteng',
        }),
      },
      precinct,
    );

    const out = await svc.precinctFor('c1', 'mo-1');
    expect(out).toEqual(FIGURES);
    expect(precinct).toHaveBeenCalledWith('Brooklyn', 'Gauteng');
  });

  it('is null, not an error, on any other licence type', async () => {
    const precinct = jest.fn(async () => FIGURES);
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
        answersEncrypted: encryptJson({ police_station: 'Brooklyn' }),
      },
      precinct,
    );

    expect(await svc.precinctFor('c1', 'mo-1')).toBeNull();
    expect(precinct).not.toHaveBeenCalled();
  });

  it('is null when no station has been answered yet', async () => {
    const precinct = jest.fn(async () => FIGURES);
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        answersEncrypted: encryptJson({}),
      },
      precinct,
    );

    expect(await svc.precinctFor('c1', 'mo-1')).toBeNull();
    expect(precinct).not.toHaveBeenCalled();
  });

  it('fails soft to null when the lookup throws', async () => {
    const precinct = jest.fn(async () => {
      throw new Error('workbook unavailable');
    });
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        answersEncrypted: encryptJson({ police_station: 'Brooklyn' }),
      },
      precinct,
    );

    await expect(svc.precinctFor('c1', 'mo-1')).resolves.toBeNull();
  });

  it('404s rather than 403s on someone else\'s id — never confirms it exists', async () => {
    const precinct = jest.fn(async () => FIGURES);
    const { svc } = build(null, precinct);
    await expect(svc.precinctFor('c1', 'not-mine')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
