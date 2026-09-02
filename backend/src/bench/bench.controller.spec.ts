import { BenchController } from './bench.controller';
import type { BenchService } from './bench.service';

/**
 * THE BENCH — the trip from a member's stored shelf into the query.
 *
 * 🚨 THIS FILE EXISTS BECAUSE THE CALIBRE SHIPPED INERT ONCE. bench.leak.spec
 * proves loads() pins a shelf bullet to its own calibre, and it proves it by
 * calling loads() directly — which is the one caller that never happens in
 * production. Every real request arrives through the controller, and the
 * controller rebuilds each bullet field by field in benchFor(). It dropped
 * calibreIn, so every signed-in member's .308" 150 gr SP went on matching the
 * 8x57 loads it will not chamber in, with the picker, the chip and the whole
 * service-level suite all green.
 *
 * ⚠️ SO WHAT IS ASSERTED HERE IS THE HANDOVER, NOT THE MATCHING. Not "does the
 * right load come back" — that is the leak spec's job — but "does the figure
 * the member stored reach the thing that matches on it, unchanged". A test
 * that reaches past the controller cannot see this class of bug at all.
 */

/** A stand-in service: it records what the controller handed it. */
function makeBench(stored: unknown[]) {
  const seen: unknown[] = [];
  const service = {
    getBench: jest.fn().mockResolvedValue({
      powders: [{ id: 'pwd_1', name: 'H4350', maker: 'Hodgdon' }],
      bullets: stored,
      cartridges: [{ key: '308win', name: '.308 Winchester' }],
      units: 'metric',
    }),
    loads: jest.fn((bench: unknown) => {
      seen.push(bench);
      return Promise.resolve({ count: 0, groups: [] });
    }),
  };
  return {
    controller: new BenchController(service as unknown as BenchService),
    handedOver: () => seen[0] as { bullets: { calibreIn?: number | null }[] },
  };
}

const SIGNED_IN = { clerkUserId: 'clerk_1' };

describe('The Bench — the calibre survives the controller', () => {
  it('carries a stored calibre through to the results query', async () => {
    const { controller, handedOver } = makeBench([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);

    await controller.loads(SIGNED_IN, {});

    // ⚠️ THE EXACT FIGURE, NOT A ROUNDED OR RE-DERIVED ONE. loads() looks this
    // up in a Map keyed on calibreFromG1()'s own answer, so anything that
    // tidied it — a toFixed, a Number() round-trip through a string, a snap to
    // the nearest thou — would miss every key in the map and match nothing.
    expect(handedOver().bullets).toEqual([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);
  });

  it('keeps two same-named bullets apart rather than folding them to one', async () => {
    const { controller, handedOver } = makeBench([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 },
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);

    await controller.loads(SIGNED_IN, {});

    // The same three words on the box, two different projectiles. Two clauses.
    expect(handedOver().bullets.map((b) => b.calibreIn)).toEqual([0.277, 0.308]);
  });

  /**
   * ⚠️ BACKWARD COMPATIBILITY, WHICH IS NOT A NICETY HERE. Every bench saved
   * before calibres were recorded holds bullets with no figure at all. loads()
   * reads a null as "matches any calibre" — exactly the behaviour those
   * benches had — so a null must arrive as a null. Anything else empties a
   * member's screen overnight through no action of theirs, and an empty screen
   * on this page reads as the feature being broken.
   */
  it('leaves a bench saved before calibres existed matching as it did', async () => {
    const { controller, handedOver } = makeBench([
      { maker: 'Hornady', weightGr: 150, category: 'SP' },
    ]);

    await controller.loads(SIGNED_IN, {});

    expect(handedOver().bullets[0].calibreIn).toBeNull();
  });

  /**
   * UserBench.bullets is a Json column, so nothing in the database enforces
   * the shape. An unreadable figure is treated as a bench with no figure —
   * which is what it is — rather than as a calibre of its own, because a
   * calibre no cartridge shares matches nothing and says nothing about why.
   */
  it('treats an unreadable stored figure as no figure', async () => {
    const { controller, handedOver } = makeBench([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: '0.308' },
      { maker: 'Sierra', weightGr: 168, category: 'HPBT', calibreIn: null },
    ]);

    await controller.loads(SIGNED_IN, {});

    expect(handedOver().bullets.map((b) => b.calibreIn)).toEqual([null, null]);
  });
});

describe('The Bench — a guest shelf carries its calibres too', () => {
  /** No Clerk subject: the bench is whatever the query string says. */
  const GUEST = {};

  function guestController() {
    const seen: unknown[] = [];
    const service = {
      getBench: jest.fn(),
      loads: jest.fn((bench: unknown) => {
        seen.push(bench);
        return Promise.resolve({ count: 0, groups: [] });
      }),
    };
    return {
      controller: new BenchController(service as unknown as BenchService),
      handedOver: () => seen[0] as { bullets: { calibreIn: number | null }[] },
      getBench: service.getBench,
    };
  }

  it('reads the four-part key the client now writes', async () => {
    const { controller, handedOver, getBench } = guestController();

    await controller.loads(GUEST, { bullets: 'Hornady|150|SP|0.308' });

    expect(getBench).not.toHaveBeenCalled();
    expect(handedOver().bullets).toEqual([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);
  });

  /**
   * ⚠️ THE THREE-PART FORM IS STILL LEGAL. It is what a link shared before
   * calibres existed carries, and it means the same thing a stored bench with
   * no figure means: any calibre. Rejecting it would turn an old link into an
   * empty page.
   */
  it('still reads the three-part key, as any calibre', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: 'Hornady|150|SP' });

    expect(handedOver().bullets).toEqual([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: null },
    ]);
  });

  it('reads an empty fourth part as no calibre, which is how it is written', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: 'Speer|180|SP|' });

    expect(handedOver().bullets).toEqual([
      { maker: 'Speer', weightGr: 180, category: 'SP', calibreIn: null },
    ]);
  });
});
