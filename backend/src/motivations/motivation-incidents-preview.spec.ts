import { MotivationLicenceType } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { MotivationGenerationService } from './motivation-generation.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { encryptJson } from '../common/blob-crypto';

const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-incidents-preview';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

// ────────────────────────────────────────────────────────────────────
// MotivationGenerationService.incidentsFor() — the read-only list behind
// GET /motivations/:id/incidents, so the wizard's "Your circumstances" step
// can offer a picker of nearby crime reporting for the member to choose up
// to eight clippings from.
//
// Written the same shape as motivation-precinct-preview.spec.ts, which is
// the sibling endpoint this one was modelled on: ownership, licence-type
// gating, and fail-soft on a bad lookup are exercised identically. What the
// chosen ids DO once saved (fact pack fold, printed annexure) is covered in
// motivations.service.spec.ts and motivation-pdf.service.spec.ts.
// ────────────────────────────────────────────────────────────────────

function build(motivation: unknown, incidentsNear: jest.Mock) {
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    motivation: {
      findFirst: jest.fn(async () => motivation),
    },
  };
  const news = { incidentsNear } as unknown as { incidentsNear: jest.Mock };
  const shared = new MotivationSharedService(prisma as never, new MemberProfileAnswersService(prisma as never));
  const svc = new MotivationGenerationService(
    prisma as never,
    {} as never, // quota — unused by this read
    {} as never, // settings
    {} as never, // model
    {} as never, // firearmImages
    {} as never, // notifications
    shared,
    {} as never, // crimeStats — unused by incidentsFor()
    news as never,
    {} as never, // research — unused by incidentsFor()
  );
  return { svc, prisma };
}

const INCIDENTS = [
  {
    id: 'inc-1',
    sourceKey: 'lowvelder',
    sourceName: 'Lowvelder',
    url: 'https://lowvelder.co.za/a',
    headline: 'Armed robbery in Nelspruit',
    standfirst: 'Police are investigating.',
    imageUrl: null,
    author: null,
    publishedOn: '2026-08-30',
    crimeType: 'armed robbery',
    places: ['Nelspruit'],
    distanceKm: 3,
  },
];

describe('incidentsFor', () => {
  it('returns the nearby incidents for the station on file', async () => {
    const incidentsNear = jest.fn(async () => INCIDENTS);
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        answersEncrypted: encryptJson({
          police_station: 'Brooklyn',
          police_station_province: 'Gauteng',
        }),
      },
      incidentsNear,
    );

    const out = await svc.incidentsFor('c1', 'mo-1');
    expect(out).toEqual({ station: 'Brooklyn', incidents: INCIDENTS });
    expect(incidentsNear).toHaveBeenCalledWith({
      station: { name: 'Brooklyn', province: 'Gauteng' },
      months: 12,
      limit: 12,
    });
  });

  it('is empty on any other licence type', async () => {
    const incidentsNear = jest.fn(async () => INCIDENTS);
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S16_DEDICATED_SPORT,
        answersEncrypted: encryptJson({ police_station: 'Brooklyn' }),
      },
      incidentsNear,
    );

    expect(await svc.incidentsFor('c1', 'mo-1')).toEqual({
      station: null,
      incidents: [],
    });
    expect(incidentsNear).not.toHaveBeenCalled();
  });

  it('is empty when no station has been answered yet', async () => {
    const incidentsNear = jest.fn(async () => INCIDENTS);
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        answersEncrypted: encryptJson({}),
      },
      incidentsNear,
    );

    expect(await svc.incidentsFor('c1', 'mo-1')).toEqual({
      station: null,
      incidents: [],
    });
    expect(incidentsNear).not.toHaveBeenCalled();
  });

  it('fails soft to an empty list — station kept — when the lookup throws', async () => {
    const incidentsNear = jest.fn(async () => {
      throw new Error('feed unavailable');
    });
    const { svc } = build(
      {
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        answersEncrypted: encryptJson({ police_station: 'Brooklyn' }),
      },
      incidentsNear,
    );

    await expect(svc.incidentsFor('c1', 'mo-1')).resolves.toEqual({
      station: 'Brooklyn',
      incidents: [],
    });
  });

  it('404s rather than 403s on someone else\'s id — never confirms it exists', async () => {
    const incidentsNear = jest.fn(async () => INCIDENTS);
    const { svc } = build(null, incidentsNear);
    await expect(svc.incidentsFor('c1', 'not-mine')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
