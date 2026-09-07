import { MotivationLicenceType } from '@prisma/client';
import { MotivationPrefillService } from './motivation-prefill.service';

// ────────────────────────────────────────────────────────────────────
// MotivationPrefillService.stationOffer() — the nearest SAPS station,
// worked out from the address rather than asked.
//
// Everything else this method touches (create()'s and saveAnswers()'s
// wiring, provenance, the field registry) is covered where those live —
// motivations.service.spec.ts and motivation-fields.spec.ts. This file is
// the pure-method guard for stationOffer() itself: the four refusals that
// must hold on their own, independent of any caller.
// ────────────────────────────────────────────────────────────────────

function build(nearestStation: jest.Mock) {
  const crimeStats = { nearestStation } as unknown as {
    nearestStation: jest.Mock;
  };
  const svc = new MotivationPrefillService(
    {} as never,
    {} as never,
    {} as never,
    crimeStats as never,
  );
  return svc;
}

const FOUND = {
  station: { name: 'Brooklyn', district: 'Pretoria', province: 'Gauteng' },
  how: 'places' as const,
  candidates: [],
};

describe('stationOffer', () => {
  it('offers the station and province, with a chip explaining the guess', async () => {
    const nearestStation = jest.fn(async () => FOUND);
    const svc = build(nearestStation);

    const out = await svc.stationOffer(MotivationLicenceType.S13_SELF_DEFENCE, {
      residential_address: '1 Middel Street, Brooklyn, Pretoria',
    });

    expect(out).toEqual({
      station: 'Brooklyn',
      province: 'Gauteng',
      from: expect.stringMatching(/nearest saps station/i),
    });
    expect(nearestStation).toHaveBeenCalledWith(
      '1 Middel Street, Brooklyn, Pretoria',
    );
  });

  it('never runs for anything but self-defence', async () => {
    const nearestStation = jest.fn(async () => FOUND);
    const svc = build(nearestStation);

    const out = await svc.stationOffer(MotivationLicenceType.S16_DEDICATED_SPORT, {
      residential_address: '1 Middel Street, Brooklyn, Pretoria',
    });

    expect(out).toBeNull();
    expect(nearestStation).not.toHaveBeenCalled();
  });

  it('never overwrites a station already on the application', async () => {
    const nearestStation = jest.fn(async () => FOUND);
    const svc = build(nearestStation);

    const out = await svc.stationOffer(MotivationLicenceType.S13_SELF_DEFENCE, {
      residential_address: '1 Middel Street, Brooklyn, Pretoria',
      police_station: 'Sunnyside',
    });

    expect(out).toBeNull();
    expect(nearestStation).not.toHaveBeenCalled();
  });

  it('asks nothing without an address', async () => {
    const nearestStation = jest.fn(async () => FOUND);
    const svc = build(nearestStation);

    const out = await svc.stationOffer(MotivationLicenceType.S13_SELF_DEFENCE, {});

    expect(out).toBeNull();
    expect(nearestStation).not.toHaveBeenCalled();
  });

  it('returns null, never throws, when the lookup finds nothing', async () => {
    const nearestStation = jest.fn(async () => ({
      station: null,
      how: null,
      candidates: [],
    }));
    const svc = build(nearestStation);

    const out = await svc.stationOffer(MotivationLicenceType.S13_SELF_DEFENCE, {
      residential_address: 'Somewhere with no match',
    });

    expect(out).toBeNull();
  });

  it('returns null, never throws, when the lookup fails', async () => {
    const nearestStation = jest.fn(async () => {
      throw new Error('Places API down');
    });
    const svc = build(nearestStation);

    await expect(
      svc.stationOffer(MotivationLicenceType.S13_SELF_DEFENCE, {
        residential_address: '1 Middel Street, Brooklyn, Pretoria',
      }),
    ).resolves.toBeNull();
  });
});
