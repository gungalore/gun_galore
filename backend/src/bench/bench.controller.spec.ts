import { BenchController } from './bench.controller';
import type { BenchService, GuestBench } from './bench.service';

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

/* ── The finder's three controls ────────────────────────────────────── */

/**
 * 🚨 A CONTROL THE MEMBER CAN SEE IS A PARAMETER THIS CONTROLLER READS — AND
 * FOR THREE OF THEM IT WAS NOT. lib/bench/api.ts writes `?cartridge=`,
 * `?weight=` and `?off=`; loads() read `cartridgeKey`, `weightMin` and
 * `weightMax`, and nothing anywhere read `off`. So the cartridge tab, the
 * weight band and every chip switched off changed the query string and
 * nothing else. An unread query parameter does not throw, so the screen
 * simply answered the same question however it was narrowed.
 *
 * ⚠️ AND THE EMPTY-STATE DIAGNOSIS TURNED THAT INTO A WRONG NUMBER RATHER
 * THAN A DEAD CONTROL. LoadsResponse.why counts loads with one AXIS relaxed
 * and the filters held; the panel prints those counts beside the member's own
 * product names, with the switched-off chips taken out. Counted against the
 * full shelf and printed against the narrowed one, "your .30-06 and N550 have
 * 70 loads together" credits N550 with loads found on a powder the member had
 * just switched off.
 */
describe('The Bench — the finder narrows the query it says it narrows', () => {
  const SHELF = {
    powders: [
      { id: 'pwd_n550', name: 'N550', maker: 'Vihtavuori' },
      { id: 'pwd_h4350', name: 'H4350', maker: 'Hodgdon' },
    ],
    bullets: [
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
      { maker: 'Lapua', weightGr: 139, category: 'HP', calibreIn: 0.264 },
    ],
    cartridges: [
      { key: '308win', name: '.308 Winchester' },
      { key: '65creedmoor', name: '6,5 Creedmoor' },
    ],
    units: 'metric',
  };

  /** Records the bench AND the filter the controller built from the query. */
  function harness() {
    const seen: { bench: GuestBench; filter: Record<string, unknown> }[] = [];
    const service = {
      getBench: jest.fn().mockResolvedValue(SHELF),
      loads: jest.fn((bench: GuestBench, filter: Record<string, unknown>) => {
        seen.push({ bench, filter });
        return Promise.resolve({ count: 0, groups: [] });
      }),
    };
    return {
      controller: new BenchController(service as unknown as BenchService),
      asked: () => seen[0],
    };
  }

  it('carries the cartridge tab into the query', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { cartridge: '308win' });

    expect(asked().filter.cartridgeKey).toBe('308win');
  });

  /**
   * ⚠️ THE BAND IDS ARE THE CLIENT'S, VERBATIM. WEIGHT_BANDS in
   * components/bench/contract.ts promises "values match the API's `weight`
   * query"; a rename at either end silently searches every weight again.
   *
   * The bounds overlap because the labels do — "≤ 100 gr", "100–150 gr" and
   * "150 gr +" all claim their endpoint — which is what a reloader reading
   * them expects.
   */
  it.each([
    ['lte100', { weightMax: 100 }],
    ['100to150', { weightMin: 100, weightMax: 150 }],
    ['gte150', { weightMin: 150 }],
  ])('turns the %s band into a range on the bullet weight', async (band, range) => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { weight: band });

    expect(asked().filter).toEqual(expect.objectContaining(range));
  });

  it.each([['any'], ['']])('narrows nothing on the %p band', async (band) => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { weight: band });

    expect(asked().filter.weightMin).toBeUndefined();
    expect(asked().filter.weightMax).toBeUndefined();
  });

  /**
   * 🚨 A SWITCHED-OFF CHIP LEAVES THE SHELF, AND THE SAVED BENCH IS UNTOUCHED.
   * `off` is the search's own narrowing — the rail greys the chip and saves
   * nothing — so it belongs to the bench this request is answered for and to
   * nothing else. getBench is still what is read; the subtraction happens
   * after it, on the way into the query.
   */
  it('takes a switched-off powder off the shelf for this search', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { off: 'pwd_h4350' });

    expect(asked().bench.powderIds).toEqual(['pwd_n550']);
    expect(asked().bench.cartridgeKeys).toEqual(['308win', '65creedmoor']);
    expect(asked().bench.bullets).toHaveLength(2);
  });

  it('takes a switched-off cartridge off the shelf for this search', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { off: '65creedmoor' });

    expect(asked().bench.cartridgeKeys).toEqual(['308win']);
    expect(asked().bench.powderIds).toEqual(['pwd_n550', 'pwd_h4350']);
  });

  /**
   * ⚠️ THE BULLET IS MATCHED ON THE KEY THE CLIENT WRITES, CALIBRE AND ALL.
   * bulletKey() in components/bench/contract.ts builds
   * `maker|weight|category|calibre`, and a key that disagrees by so much as a
   * trailing part does not error — it leaves the chip greyed on the screen and
   * live in the query, which is the whole class of bug this parameter had.
   */
  it('takes a switched-off bullet off the shelf, told apart by its calibre', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { off: 'Hornady|150|SP|0.308' });

    expect(asked().bench.bullets).toEqual([
      { maker: 'Lapua', weightGr: 139, category: 'HP', calibreIn: 0.264 },
    ]);
  });

  it('leaves a bullet on the shelf when only its calibre-less twin is switched off', async () => {
    const { controller, asked } = harness();

    // The three-part key an old bench writes. It is not this bullet's key.
    await controller.loads(SIGNED_IN, { off: 'Hornady|150|SP' });

    expect(asked().bench.bullets).toHaveLength(2);
  });

  it('takes all three kinds off at once, the way the client sends them', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, {
      off: 'pwd_h4350,65creedmoor,Lapua|139|HP|0.264',
      cartridge: '308win',
      weight: '100to150',
    });

    expect(asked().bench).toEqual({
      powderIds: ['pwd_n550'],
      bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }],
      cartridgeKeys: ['308win'],
    });
    expect(asked().filter).toEqual({
      cartridgeKey: '308win',
      powderId: undefined,
      weightMin: 100,
      weightMax: 150,
    });
  });

  it('takes a switched-off entry off a guest shelf too', async () => {
    const seen: GuestBench[] = [];
    const service = {
      getBench: jest.fn(),
      loads: jest.fn((bench: GuestBench) => {
        seen.push(bench);
        return Promise.resolve({ count: 0, groups: [] });
      }),
    };
    const controller = new BenchController(service as unknown as BenchService);

    await controller.loads(
      {},
      {
        powders: 'pwd_n550,pwd_h4350',
        cartridges: '308win,65creedmoor',
        bullets: 'Hornady|150|SP|0.308,Lapua|139|HP|0.264',
        off: 'pwd_h4350,65creedmoor,Lapua|139|HP|0.264',
      },
    );

    expect(seen[0]).toEqual({
      powderIds: ['pwd_n550'],
      cartridgeKeys: ['308win'],
      bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }],
    });
  });
});
