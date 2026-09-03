import { BenchController } from './bench.controller';
import { BenchService, type GuestBench } from './bench.service';
import { DEFAULT_WEIGHT_TOLERANCE_GR, WEIGHT_TOLERANCES_GR } from './bullet-weight';

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
    handedOver: () => seen[0] as { bullets: { calibreIn?: number | null }[]; toleranceGr?: number },
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
    //
    // 🚨 AND THE WEIGHT AND THE CALIBRE ARE ALL THAT CROSS. The stored maker
    // and category stay behind: a bullet is a weight in a calibre now, and a
    // field that reaches the query is a field something can start narrowing on
    // again. Asserted with toEqual rather than toMatchObject for that reason.
    expect(handedOver().bullets).toEqual([{ weightGr: 150, calibreIn: 0.308 }]);
  });

  it('keeps two bullets of one weight in different calibres apart', async () => {
    const { controller, handedOver } = makeBench([
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.277 },
      { maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 },
    ]);

    await controller.loads(SIGNED_IN, {});

    // One weight, two different projectiles. Two clauses.
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

  /**
   * 🚨 THE SPELLING IS bulletKey()'s, IN components/bench/contract.ts:
   * `${calibreIn ?? ''}|${weightGr}`. The same string is the `off` key, so a
   * parse that disagrees does not error — it leaves a chip greyed on the
   * screen and live in the query.
   */
  it('reads the calibre-weight key the client now writes', async () => {
    const { controller, handedOver, getBench } = guestController();

    await controller.loads(GUEST, { bullets: '0.308|150' });

    expect(getBench).not.toHaveBeenCalled();
    expect(handedOver().bullets).toEqual([{ weightGr: 150, calibreIn: 0.308 }]);
  });

  it('reads an empty first part as no calibre, which is how it is written', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: '|180' });

    expect(handedOver().bullets).toEqual([{ weightGr: 180, calibreIn: null }]);
  });

  /**
   * ⚠️ THE OLD SHAPES ARE STILL READ, AND THAT IS NOT POLITENESS. A link
   * shared before this change carries `maker|weight|category` or
   * `maker|weight|category|calibre`; rejecting it would turn a shared bench
   * into an empty page. Only the weight and the calibre are taken — the maker
   * and the category are dropped on the floor, which is exactly what the
   * change means.
   */
  it('still reads the old four-part key, keeping only the weight and the calibre', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: 'Hornady|150|SP|0.308' });

    expect(handedOver().bullets).toEqual([{ weightGr: 150, calibreIn: 0.308 }]);
  });

  it('still reads the old three-part key, as any calibre', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: 'Hornady|150|SP' });

    expect(handedOver().bullets).toEqual([{ weightGr: 150, calibreIn: null }]);
  });

  it('reads an empty fourth part of an old key as no calibre', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: 'Speer|180|SP|' });

    expect(handedOver().bullets).toEqual([{ weightGr: 180, calibreIn: null }]);
  });

  /**
   * ⚠️ Number('') IS 0, NOT NaN. A key with a blank weight would otherwise
   * parse as a 0 gr bullet and search a window nothing sits in — an empty
   * screen with nothing on it saying why.
   */
  it('drops a key with no readable weight rather than searching for a 0 gr bullet', async () => {
    const { controller, handedOver } = guestController();

    await controller.loads(GUEST, { bullets: '0.308|,0.264|wide,0.277|140' });

    expect(handedOver().bullets).toEqual([{ weightGr: 140, calibreIn: 0.277 }]);
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
   * bulletKey() in components/bench/contract.ts builds `calibre|weight`, and a
   * key that disagrees by so much as an empty part does not error — it leaves
   * the chip greyed on the screen and live in the query, which is the whole
   * class of bug this parameter had.
   */
  it('takes a switched-off bullet off the shelf, told apart by its calibre', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { off: '0.308|150' });

    expect(asked().bench.bullets).toEqual([{ weightGr: 139, calibreIn: 0.264 }]);
  });

  /**
   * 🚨 THE CALIBRE IS HALF THE KEY. A 150 gr .277 and a 150 gr .308 are
   * different bullets, so switching one off must leave the other alone —
   * and a key naming the weight alone is nobody's key.
   */
  it('leaves a bullet on the shelf when a same-weight bullet of another calibre is switched off', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { off: '0.277|150' });

    expect(asked().bench.bullets).toHaveLength(2);
  });

  it('takes all three kinds off at once, the way the client sends them', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, {
      off: 'pwd_h4350,65creedmoor,0.264|139',
      cartridge: '308win',
      weight: '100to150',
    });

    expect(asked().bench).toEqual({
      powderIds: ['pwd_n550'],
      bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      cartridgeKeys: ['308win'],
      toleranceGr: DEFAULT_WEIGHT_TOLERANCE_GR,
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
        bullets: '0.308|150,0.264|139',
        off: 'pwd_h4350,65creedmoor,0.264|139',
      },
    );

    expect(seen[0]).toEqual({
      powderIds: ['pwd_n550'],
      cartridgeKeys: ['308win'],
      bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      toleranceGr: DEFAULT_WEIGHT_TOLERANCE_GR,
    });
  });
});

/* ── The grain window ───────────────────────────────────────────────── */

/**
 * 🚨 A CONTROL THE MEMBER CAN SEE IS A PARAMETER THIS CONTROLLER READS — and
 * three of the finder's controls were decorative for exactly the want of that.
 * The tolerance is the fourth, and it is the one that decides how much of the
 * shelf a member is shown, so an unread `?tolerance=` would answer the same
 * question however they set it.
 *
 * ⚠️ IT WIDENS THE SEARCH, NEVER A CHARGE. It reaches the bullet axis and
 * nothing else; every load still comes back quoted at its own bullet weight
 * with its own start and max.
 */
describe('The Bench — the grain window reaches the query', () => {
  function harness(stored: unknown[] = [{ maker: 'Hornady', weightGr: 150, category: 'SP' }]) {
    const seen: GuestBench[] = [];
    const service = {
      getBench: jest.fn().mockResolvedValue({
        powders: [{ id: 'pwd_n550', name: 'N550', maker: 'Vihtavuori' }],
        bullets: stored,
        cartridges: [{ key: '3006', name: '.30-06 Springfield' }],
        units: 'metric',
      }),
      loads: jest.fn((bench: GuestBench) => {
        seen.push(bench);
        return Promise.resolve({ count: 0, groups: [] });
      }),
      powders: jest.fn((_q: unknown, bench: GuestBench) => {
        seen.push(bench);
        return Promise.resolve([]);
      }),
      cartridge: jest.fn((_k: string, bench: GuestBench) => {
        seen.push(bench);
        return Promise.resolve({});
      }),
    };
    return {
      controller: new BenchController(service as unknown as BenchService),
      asked: () => seen[0],
    };
  }

  it('carries an offered width straight through', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { tolerance: '15' });

    expect(asked().toleranceGr).toBe(15);
  });

  it('reads Exact as a real zero, not as an absent value', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { tolerance: '0' });

    // A width the member chose must survive the trip; treating 0 as "unset"
    // would silently widen the search they had just narrowed.
    expect(asked().toleranceGr).toBe(0);
  });

  it('defaults when the parameter is absent', async () => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, {});

    expect(asked().toleranceGr).toBe(DEFAULT_WEIGHT_TOLERANCE_GR);
  });

  /**
   * 🚨 THE TRAP THIS PARAMETER WAS BORN WITH. `Number('')` is 0, not NaN — so
   * a blank `?tolerance=` in the URL falls through as a real zero and
   * collapses the search back to the exact weight, which is the precise
   * narrowness the window exists to undo. Blank is ABSENT, not Exact.
   */
  it.each([[''], ['   ']])('treats a blank %p as absent rather than as Exact', async (blank) => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { tolerance: blank });

    expect(asked().toleranceGr).toBe(DEFAULT_WEIGHT_TOLERANCE_GR);
  });

  /**
   * ⚠️ A QUERY STRING IS A STRANGER. Unbounded, one request could ask for
   * every bullet weight in the catalogue; negative, it would invert the window
   * into one that matches nothing.
   */
  it.each([
    ['9999', 15],
    ['-40', 0],
    ['7', 5],
  ])('clamps %p to the offered width %p', async (raw, expected) => {
    const { controller, asked } = harness();

    await controller.loads(SIGNED_IN, { tolerance: raw });

    expect(asked().toleranceGr).toBe(expected);
    expect(WEIGHT_TOLERANCES_GR).toContain(asked().toleranceGr);
  });

  it.each([['wide'], ['NaN'], ['5 gr']])(
    'falls back to the default on the unreadable %p',
    async (raw) => {
      const { controller, asked } = harness();

      await controller.loads(SIGNED_IN, { tolerance: raw });

      expect(asked().toleranceGr).toBe(DEFAULT_WEIGHT_TOLERANCE_GR);
    },
  );

  /**
   * 🚨 THE SAME WIDTH ON EVERY SURFACE THAT COUNTS AGAINST THE BENCH. The
   * powder chips and the spec card put a NUMBER in front of the member before
   * the list does, and a number counted over a different window than the list
   * is the same broken promise the calibre once made: "12 loads" on a chip
   * over a screen showing five. It rides on the bench through benchFor, so all
   * three read it from one door.
   */
  it('hands the same width to the powder chips', async () => {
    const { controller, asked } = harness();

    await controller.powders(SIGNED_IN, { tolerance: '0' });

    expect(asked().toleranceGr).toBe(0);
  });

  it("hands the same width to the cartridge card's count", async () => {
    const { controller, asked } = harness();

    await controller.cartridge('3006', SIGNED_IN, { tolerance: '15' });

    expect(asked().toleranceGr).toBe(15);
  });

  it('carries the width onto a guest shelf too', async () => {
    const { controller, asked } = harness();

    await controller.loads({}, { bullets: '0.308|150', tolerance: '10' });

    expect(asked()).toEqual({
      powderIds: [],
      cartridgeKeys: [],
      bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      toleranceGr: 10,
    });
  });
});

/**
 * 🚨 THE SEAM THE LAST BUG SLIPPED THROUGH. bench.leak.spec proves the service
 * builds the right `where` and calls loads() directly; this file proves the
 * controller hands over the right bench and stubs the service. Between the two
 * sits the join neither watches — and that join is exactly where the calibre
 * shipped inert, green on both sides.
 *
 * So these run the whole path: a query string, through the real controller,
 * through the real service, to the `where` Prisma is actually given. A control
 * the member can see has to be shown changing the answer, and this is where
 * that is shown.
 */
describe('The Bench — the grain window changes the query, end to end', () => {
  /** The .30-06's C.I.P. G1, in millimetres. Snaps to .308". */
  const G1_3006_MM = 7.85;

  function wiredController() {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'usr_1' }) },
      userBench: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'usr_1',
          powderIds: ['pwd_n550'],
          cartridgeKeys: ['3006'],
          // A bench saved under the old model: the maker and the category are
          // still stored, and must reach nothing.
          bullets: [{ maker: 'Hornady', weightGr: 150, category: 'SP', calibreIn: 0.308 }],
          units: 'metric',
        }),
      },
      benchPowder: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pwd_n550', name: 'N550', maker: 'Vihtavuori' }]),
      },
      benchCartridge: {
        findMany: jest.fn().mockResolvedValue([{ key: '3006', name: '.30-06 Springfield' }]),
      },
      benchCipDimension: {
        findMany: jest.fn().mockResolvedValue([{ cartridgeKey: '3006', G1: G1_3006_MM }]),
      },
      benchLoad: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new BenchService(prisma as never);
    return {
      controller: new BenchController(service),
      // The bullet branch the query was actually run with.
      clause: () =>
        (
          prisma.benchLoad.findMany.mock.calls[0][0] as {
            where: { OR: { weightGr: { gte: number; lte: number }; cartridgeKey?: unknown }[] };
          }
        ).where.OR[0],
    };
  }

  it.each([
    ['0', { gte: 150, lte: 150 }],
    ['5', { gte: 145, lte: 155 }],
    ['15', { gte: 135, lte: 165 }],
    // Blank is absent, not Exact — Number('') is 0, and a silent zero here
    // would collapse the search to the stated weight.
    ['', { gte: 145, lte: 155 }],
    // A stranger from the query string, clamped to a width the finder offers.
    ['9999', { gte: 135, lte: 165 }],
  ])('a ?tolerance=%p search runs over %p', async (raw, window) => {
    const { controller, clause } = wiredController();

    await controller.loads(SIGNED_IN, { tolerance: raw });

    expect(clause().weightGr).toEqual(window);
  });

  /**
   * 🚨 THE MAKER AND THE CATEGORY STOP AT THE CONTROLLER, ALL THE WAY DOWN.
   * The stored bullet still names both; the query names neither, and the
   * calibre it does name is the one that decides which cartridges are legal.
   */
  it('runs a stored maker+category bullet as a weight in a calibre', async () => {
    const { controller, clause } = wiredController();

    await controller.loads(SIGNED_IN, {});

    expect(clause()).toEqual({
      weightGr: { gte: 145, lte: 155 },
      cartridgeKey: { in: ['3006'] },
    });
  });
});
