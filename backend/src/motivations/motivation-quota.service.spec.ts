import { NotFoundException } from '@nestjs/common';
import { MotivationQuotaService } from './motivation-quota.service';
import { FLAGS } from '../settings/settings.service';

// The interesting property here is the one a count-then-insert implementation
// gets wrong: with a cap of N and any amount of concurrency, EXACTLY N seats
// are handed out. The fake counter below models the one thing that makes that
// true — the increment is atomic and returns the new value.

function makeFakeCounter() {
  const counters = new Map<string, number>();
  return {
    counters,
    prisma: {
      referenceCounter: {
        upsert: jest.fn(
          async ({ where }: { where: { prefix: string } }) => {
            // Postgres does this atomically. Modelled here as a single
            // synchronous read-modify-write with no await in the middle, which
            // is what the real UPDATE ... count = count + 1 guarantees.
            const next = (counters.get(where.prefix) ?? 0) + 1;
            counters.set(where.prefix, next);
            return { prefix: where.prefix, count: next };
          },
        ),
        findUnique: jest.fn(async ({ where }: { where: { prefix: string } }) => {
          const c = counters.get(where.prefix);
          return c === undefined ? null : { prefix: where.prefix, count: c };
        }),
      },
    },
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn(async (flag: { key: string; default: unknown }) =>
      flag.key in overrides ? overrides[flag.key] : flag.default,
    ),
  };
}

function build(settingsOverrides: Record<string, unknown> = {}) {
  const fake = makeFakeCounter();
  const settings = makeSettings(settingsOverrides);
  const svc = new MotivationQuotaService(
    fake.prisma as never,
    settings as never,
  );
  return { svc, fake, settings };
}

describe('MotivationQuotaService', () => {
  describe('the master switch', () => {
    it('is OFF by default so the module deploys inert', async () => {
      const { svc } = build();
      expect(FLAGS.motivationWriterEnabled.default).toBe(false);
      expect(await svc.isEnabled()).toBe(false);
    });

    it('assertEnabled throws 404, not 403 — an off module is not discoverable', async () => {
      const { svc } = build();
      await expect(svc.assertEnabled()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('assertEnabled passes once the flag is on', async () => {
      const { svc } = build({ motivation_writer_enabled: true });
      await expect(svc.assertEnabled()).resolves.toBeUndefined();
    });
  });

  describe('beta seats', () => {
    it('hands out seat numbers from 1', async () => {
      const { svc } = build();
      expect(await svc.claimBetaSeat(100)).toBe(1);
      expect(await svc.claimBetaSeat(100)).toBe(2);
      expect(await svc.seatsTaken()).toBe(2);
    });

    it('returns null once the cap is reached', async () => {
      const { svc } = build();
      for (let i = 0; i < 3; i++) expect(await svc.claimBetaSeat(3)).toBe(i + 1);
      expect(await svc.claimBetaSeat(3)).toBeNull();
      expect(await svc.claimBetaSeat(3)).toBeNull();
    });

    it('150 concurrent claims against a cap of 100 yield EXACTLY 100 seats', async () => {
      // This is the whole point of the service. A count()-then-compare
      // implementation passes every other test in this file and fails this one.
      const { svc } = build();
      const results = await Promise.all(
        Array.from({ length: 150 }, () => svc.claimBetaSeat(100)),
      );
      const granted = results.filter((r): r is number => r !== null);
      expect(granted).toHaveLength(100);
      // Every seat number is distinct — no two applicants share one.
      expect(new Set(granted).size).toBe(100);
      // And they are exactly 1..100.
      expect(granted.sort((a, b) => a - b)).toEqual(
        Array.from({ length: 100 }, (_, i) => i + 1),
      );
    });

    it('burns a seat above the cap rather than reissuing it', async () => {
      // Reissuing would mean reading the counter back down, which reopens the
      // race. Skipping numbers is the accepted cost.
      const { svc, fake } = build();
      for (let i = 0; i < 2; i++) await svc.claimBetaSeat(2);
      expect(await svc.claimBetaSeat(2)).toBeNull();
      expect(fake.counters.get('MOBETA')).toBe(3); // spent, not rolled back
      expect(await svc.claimBetaSeat(2)).toBeNull();
      expect(fake.counters.get('MOBETA')).toBe(4);
    });

    it('a cap of 0 grants nothing', async () => {
      const { svc } = build();
      expect(await svc.claimBetaSeat(0)).toBeNull();
    });

    it('counts seats from the counter, not from rows', async () => {
      // Rows get deleted — POPIA erasure, admin void. If "used" came from a row
      // count, deleting one would silently hand out another free motivation.
      const { svc, fake } = build();
      await svc.claimBetaSeat(100);
      await svc.claimBetaSeat(100);
      expect(await svc.seatsTaken()).toBe(2);
      expect(fake.prisma.referenceCounter.findUnique).toHaveBeenCalledWith({
        where: { prefix: 'MOBETA' },
      });
    });

    it('reports zero taken before anyone has started', async () => {
      const { svc } = build();
      expect(await svc.seatsTaken()).toBe(0);
    });
  });

  describe('status', () => {
    it('reports the cap, usage and remaining seats', async () => {
      const { svc } = build({ motivation_writer_enabled: true });
      await svc.claimBetaSeat(100);
      await svc.claimBetaSeat(100);
      const s = await svc.status();
      expect(s).toMatchObject({
        enabled: true,
        cap: 100,
        used: 2,
        freeRemaining: 98,
        priceCents: 19900,
        canStart: true,
      });
    });

    it('cannot start when the free seats are gone (payments are not live)', async () => {
      const { svc } = build({
        motivation_writer_enabled: true,
        motivation_beta_free_cap: 1,
      });
      await svc.claimBetaSeat(1);
      const s = await svc.status();
      expect(s.freeRemaining).toBe(0);
      expect(s.canStart).toBe(false);
    });

    it('cannot start while the module is off, however many seats are free', async () => {
      const { svc } = build();
      const s = await svc.status();
      expect(s.enabled).toBe(false);
      expect(s.freeRemaining).toBe(100);
      expect(s.canStart).toBe(false);
    });

    it('never reports negative remaining if the cap is lowered below usage', async () => {
      const { svc } = build({
        motivation_writer_enabled: true,
        motivation_beta_free_cap: 2,
      });
      for (let i = 0; i < 5; i++) await svc.claimBetaSeat(10);
      const s = await svc.status();
      expect(s.used).toBe(5);
      expect(s.freeRemaining).toBe(0);
      expect(s.canStart).toBe(false);
    });
  });

  describe('flag parsing', () => {
    it('clamps the free cap so a fat-fingered entry cannot uncap AI spend', () => {
      expect(FLAGS.motivationBetaFreeCap.parse('999999')).toBe(5000);
      expect(FLAGS.motivationBetaFreeCap.parse('-5')).toBe(100);
      expect(FLAGS.motivationBetaFreeCap.parse('not a number')).toBe(100);
      expect(FLAGS.motivationBetaFreeCap.parse('250')).toBe(250);
    });

    it('clamps gate cycles — each retry is a full generation', () => {
      expect(FLAGS.motivationMaxGateCycles.parse('99')).toBe(5);
      expect(FLAGS.motivationMaxGateCycles.parse('0')).toBe(0);
      expect(FLAGS.motivationMaxGateCycles.parse('junk')).toBe(2);
    });

    it('refuses a nonsensical retention period', () => {
      expect(FLAGS.motivationRetentionDays.parse('1')).toBe(730);
      expect(FLAGS.motivationRetentionDays.parse('99999')).toBe(3650);
      expect(FLAGS.motivationRetentionDays.parse('365')).toBe(365);
    });

    it('refuses a zero or negative price', () => {
      expect(FLAGS.motivationPriceCents.parse('0')).toBe(19900);
      expect(FLAGS.motivationPriceCents.parse('-1')).toBe(19900);
      expect(FLAGS.motivationPriceCents.parse('24900')).toBe(24900);
    });
  });
});
