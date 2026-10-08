import { SoldCompsService } from './sold-comps.service';

function build() {
  const prisma = {
    soldComp: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  return { service: new SoldCompsService(prisma), prisma };
}

describe('SoldCompsService', () => {
  it('returns nothing without a make and model', async () => {
    const { service, prisma } = build();
    expect(await service.find('firearms', null, 'M77')).toEqual([]);
    expect(prisma.soldComp.findMany).not.toHaveBeenCalled();
  });

  it('maps sold rows to exact-model raw comps with a high-trust source site', async () => {
    const { service, prisma } = build();
    prisma.soldComp.findMany.mockResolvedValue([
      {
        id: 's1',
        make: 'Ruger',
        model: 'M77 African',
        condition: 'Good',
        soldPriceCents: 2_850_000,
        soldAt: new Date('2026-09-01T00:00:00Z'),
      },
    ]);
    const comps = await service.find('firearms', 'Ruger', 'M77');
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ sourceSite: 'own-sold', priceZar: 28500, pageOpened: true });
    expect(comps[0].match?.diffs).toEqual([]);
  });

  it('imports rows with a source tag', async () => {
    const { service, prisma } = build();
    const n = await service.import(
      'knives',
      [{ make: 'Kershaw', model: 'Blur', soldPriceCents: 150000, soldAt: new Date() }],
      'dealer',
    );
    expect(n).toBe(1);
    expect(prisma.soldComp.createMany).toHaveBeenCalled();
  });
});
