import { Global, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AuthGuard } from '../auth/auth.guard';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { BenchController } from './bench.controller';
import { BenchModule } from './bench.module';
import { BenchService, type GuestBench } from './bench.service';

/**
 * THE BENCH — the signed-out, 18+-declared visitor.
 *
 * SPEC-BUILD §10 deferred the guest bench because the reads had been publishing
 * the whole consolidated catalogue to anybody who could type a URL. The 18+ gate
 * is the deliberate door that was missing: the finder's reads now take
 * OptionalAuthGuard + ContentAccessGuard, so a declared visitor gets the same
 * catalogue a member does, a caller with neither a session nor a declaration
 * still 404s, and the shelf that decides what a guest sees is handed in the
 * query (`powders[]`, `bullets[]`, `cartridges[]`) and never stored.
 *
 * 🚨 THIS FILE WATCHES THE THREE THINGS THAT CAN SILENTLY GO WRONG:
 *
 *   1. THE GUARD WIRING — a read left on AuthGuard makes the page work for
 *      members only; a write relaxed to the optional pair lets a stranger touch
 *      a member's bench or log. Both are asserted at the ROUTE level, through a
 *      real Nest app, because that is the only place Nest's metadata is real.
 *   2. THE PARSE — the guest shelf is a stranger's query string, so malformed
 *      bullets and a bare `?powders=` must narrow the answer rather than 500 it.
 *   3. NO USER ROW IS READ FOR A GUEST — the branch that would do it is one
 *      `getBench()` call away, and nothing in the old tests could see it.
 *
 * ⚠️ THE PAYLOAD HAS TO BE THE MEMBER'S PAYLOAD. The finder must answer the same
 * shape either way, or the page grows two rendering paths — so the parity test
 * runs one guest query and one member request for the SAME shelf and compares
 * the bodies exactly.
 */

const MEMBER_ID = 'usr_member';

/* ── The stubbed globals ─────────────────────────────────────────────── */

/**
 * SessionService and PrismaService are @Global() in the app, so they are the
 * only stand-ins the real BenchModule needs. AuthGuard is built for real (it
 * injects SessionService) so its 401 path is the production one.
 */
const sessions = {
  verify: jest.fn(),
  verifyCatalogueDeclaration: jest.fn(),
};

function prismaStub() {
  return {
    user: { findUnique: jest.fn() },
    userBench: { findUnique: jest.fn() },
    benchPowder: { findMany: jest.fn().mockResolvedValue([]) },
    benchCartridge: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    benchCipDimension: { findMany: jest.fn().mockResolvedValue([]) },
    benchLoad: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    benchShare: { findUnique: jest.fn() },
    benchLogEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const prisma = prismaStub();

@Global()
@Module({
  providers: [
    { provide: SessionService, useValue: sessions },
    { provide: PrismaService, useValue: prisma },
    AuthGuard,
  ],
  exports: [SessionService, PrismaService, AuthGuard],
})
class StubGlobalsModule {}

/* ── Fixtures ────────────────────────────────────────────────────────── */

/** The 18+-declaration cookie the middleware/backend verify together. */
const DECLARED = 'ao_cat=declaration';

/** The shelf a guest hands in the query — SPEC-BUILD §4's spelling. */
const GUEST_QUERY: Record<string, string[]> = {
  'powders[]': ['pwd_h4350'],
  'bullets[]': ['0.308|150'],
  'cartridges[]': ['308win'],
};

/** A consolidated row, in exactly the shape loads() selects. */
const LOAD_ROW = {
  id: 'load_1',
  cartridgeKey: '308win',
  bulletMaker: 'Hornady',
  bulletType: 'SP',
  weightGr: 150,
  startGr: 41.2,
  startFps: 2500,
  maxGr: 45.5,
  maxFps: 2700,
  coalMm: 70.1,
  coalLoMm: null,
  coalHiMm: null,
  powder: { name: 'H4350' },
  cartridge: {
    key: '308win',
    name: '.308 Winchester',
    maxLengthMm: 71.12,
    pmaxBar: 4150,
    pmaxPsi: 60191,
    dims: { R: 1.2 },
  },
};

/** The .308's C.I.P. G1, in millimetres. Snaps to .308". */
const G1_308_MM = 7.82;

/** A member with the same shelf as GUEST_QUERY, for the parity test. */
function storeMemberShelf() {
  prisma.user.findUnique.mockResolvedValue({ id: MEMBER_ID });
  prisma.userBench.findUnique.mockResolvedValue({
    userId: MEMBER_ID,
    powderIds: ['pwd_h4350'],
    bullets: [{ weightGr: 150, calibreIn: 0.308 }],
    cartridgeKeys: ['308win'],
    units: 'metric',
  });
  prisma.benchPowder.findMany.mockResolvedValue([
    { id: 'pwd_h4350', name: 'H4350', maker: 'Hodgdon' },
  ]);
  prisma.benchCartridge.findMany.mockResolvedValue([
    { key: '308win', name: '.308 Winchester' },
  ]);
  prisma.benchCipDimension.findMany.mockResolvedValue([
    { cartridgeKey: '308win', G1: G1_308_MM },
  ]);
  prisma.benchLoad.findMany.mockResolvedValue([LOAD_ROW]);
}

/** A controller on the REAL service, so loads()/powders()/cartridge() run. */
function wired() {
  return new BenchController(new BenchService(prisma as never));
}

/** A recording stand-in, for asserting what the controller parsed. */
function recording(storedBench: unknown = { powders: [], bullets: [], cartridges: [], units: 'metric' }) {
  const seen: GuestBench[] = [];
  const service = {
    getBench: jest.fn().mockResolvedValue(storedBench),
    loads: jest.fn((bench: GuestBench) => {
      seen.push(bench);
      return Promise.resolve({ count: 0, groups: [] });
    }),
    powders: jest.fn((_q: unknown, bench: GuestBench) => {
      seen.push(bench);
      return Promise.resolve([]);
    }),
    cartridge: jest.fn((_key: string, bench: GuestBench) => {
      seen.push(bench);
      return Promise.resolve({});
    }),
  };
  return { controller: new BenchController(service as unknown as BenchService), seen, service };
}

beforeEach(() => {
  jest.clearAllMocks();
  sessions.verify.mockResolvedValue({ sub: MEMBER_ID, sid: 'sid_1' });
  sessions.verifyCatalogueDeclaration.mockResolvedValue(true);
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.userBench.findUnique.mockResolvedValue(null);
  prisma.benchLoad.findMany.mockResolvedValue([]);
  prisma.benchLoad.count.mockResolvedValue(0);
  prisma.benchLoad.groupBy.mockResolvedValue([]);
  prisma.benchPowder.findMany.mockResolvedValue([]);
  prisma.benchCartridge.findMany.mockResolvedValue([]);
  prisma.benchCartridge.findUnique.mockResolvedValue(null);
  prisma.benchCipDimension.findMany.mockResolvedValue([]);
  prisma.benchShare.findUnique.mockResolvedValue(null);
});

/* ── The guest shelf, parsed ─────────────────────────────────────────── */

describe('The Bench — a guest shelf comes out of the query string', () => {
  it('turns the SPEC arrays into the same GuestBench a stored shelf produces', async () => {
    const { controller, seen } = recording();

    await controller.loads(undefined, GUEST_QUERY);

    expect(seen[0]).toEqual({
      toleranceGr: 5,
      powderIds: ['pwd_h4350'],
      bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      cartridgeKeys: ['308win'],
    });
  });

  /**
   * 🔴 THE CLIENT'S ARRAY SPELLING AND THE OLD COMMA SPELLING MUST BOTH WORK.
   * The arrays are what the page sends; a hand-written or older link may still
   * carry `?powders=a,b`, and a parser that silently read only one of them
   * would return an empty answer with no error to explain it.
   */
  it('reads the plain comma spelling as well', async () => {
    const { controller, seen } = recording();

    await controller.loads(undefined, {
      powders: 'pwd_h4350,pwd_n550',
      bullets: '0.308|150,0.264|139',
      cartridges: '308win,65creedmoor',
    });

    expect(seen[0].powderIds).toEqual(['pwd_h4350', 'pwd_n550']);
    expect(seen[0].bullets).toEqual([
      { weightGr: 150, calibreIn: 0.308 },
      { weightGr: 139, calibreIn: 0.264 },
    ]);
    expect(seen[0].cartridgeKeys).toEqual(['308win', '65creedmoor']);
  });

  /**
   * 🚨 A QUERY STRING IS A STRANGER. A malformed bullet must be dropped, not
   * thrown on: a shared or hand-edited link with one broken key should answer
   * for the shelf that parses, and the page's own empty state explains the rest.
   */
  it.each([
    ['no weight', '0.308|'],
    ['a non-numeric weight', '0.308|heavy'],
    ['no separators at all', '150'],
  ])('drops a bullet key with %s instead of failing the request', async (_why, bad) => {
    const { controller, seen } = recording();

    await controller.loads(undefined, { 'bullets[]': [bad, '0.308|150'] });

    expect(seen[0].bullets).toEqual([{ weightGr: 150, calibreIn: 0.308 }]);
  });

  /** A bullet saved before calibres existed keys as `|150`, and keeps matching any calibre. */
  it('reads a calibre-less bullet key as a null calibre', async () => {
    const { controller, seen } = recording();

    await controller.loads(undefined, { 'bullets[]': ['|168'] });

    expect(seen[0].bullets).toEqual([{ weightGr: 168, calibreIn: null }]);
  });

  /**
   * ⚠️ THE SWITCHED-OFF CHIPS REACH A GUEST'S SHELF TOO. The page draws the same
   * chips signed out, and a chip the visitor switched off has to leave the query
   * — otherwise the screen says one thing and the answer says another.
   */
  it('applies the switched-off chips and the grain window to the query shelf', async () => {
    const { controller, seen } = recording();

    await controller.loads(undefined, {
      'powders[]': ['pwd_h4350', 'pwd_n550'],
      'bullets[]': ['0.308|150', '0.264|139'],
      'cartridges[]': ['308win', '65creedmoor'],
      off: 'pwd_n550,0.264|139,65creedmoor',
      tolerance: '15',
    });

    expect(seen[0]).toEqual({
      toleranceGr: 15,
      powderIds: ['pwd_h4350'],
      bullets: [{ weightGr: 150, calibreIn: 0.308 }],
      cartridgeKeys: ['308win'],
    });
  });

  /** The finder's documented filter names are read, not silently ignored. */
  it('reads the SPEC filter names when the client names are absent', async () => {
    const { controller, service } = recording();

    await controller.loads(undefined, {
      ...GUEST_QUERY,
      cartridgeKey: '308win',
      weightMin: '100',
      weightMax: '150',
      powderId: 'pwd_h4350',
    });

    expect(service.loads).toHaveBeenCalledWith(expect.anything(), {
      cartridgeKey: '308win',
      powderId: 'pwd_h4350',
      weightMin: 100,
      weightMax: 150,
    });
  });

  /**
   * 🚨 NO USER ROW IS READ FOR A GUEST. Every personal field on this module
   * comes through getBench(); a guest branch that fell into it would read a row
   * for an id the request does not have, and the "read-only" promise would be
   * one deleted `if` away from a write path.
   */
  it('never reads a user row for a guest shelf', async () => {
    const { controller, service } = recording();

    await controller.loads(undefined, GUEST_QUERY);
    await controller.powders(undefined, GUEST_QUERY);
    await controller.cartridge('308win', undefined, GUEST_QUERY);

    expect(service.getBench).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ A SESSION ALWAYS WINS OVER A QUERY SHELF. A signed-in request carrying
   * the arrays (a stale tab, a hand-copied URL) must answer for the member's
   * STORED bench: a mixed shelf would be one the member never chose.
   */
  it('ignores the query shelf when there is a session', async () => {
    const { controller, seen, service } = recording({
      powders: [{ id: 'pwd_stored', name: 'Varget', maker: 'Hodgdon' }],
      bullets: [{ weightGr: 168, calibreIn: 0.308 }],
      cartridges: [{ key: '308win', name: '.308 Winchester' }],
      units: 'metric',
    });

    await controller.loads('user_1', GUEST_QUERY);

    expect(service.getBench).toHaveBeenCalledWith('user_1');
    expect(seen[0].powderIds).toEqual(['pwd_stored']);
    expect(seen[0].bullets).toEqual([{ weightGr: 168, calibreIn: 0.308 }]);
  });

  /** The counts and the spec card read the guest shelf through the same door. */
  it('hands the guest shelf to the powder chips and the spec card', async () => {
    const { controller, seen } = recording();

    await controller.powders(undefined, GUEST_QUERY);
    await controller.cartridge('308win', undefined, GUEST_QUERY);

    expect(seen).toHaveLength(2);
    for (const bench of seen) {
      expect(bench.powderIds).toEqual(['pwd_h4350']);
      expect(bench.cartridgeKeys).toEqual(['308win']);
    }
  });
});

/* ── An empty shelf, and the payload a member gets ───────────────────── */

describe('The Bench — an empty guest shelf is a valid answer', () => {
  it('answers loads with an empty payload rather than a 500', async () => {
    const controller = wired();

    await expect(controller.loads(undefined, {})).resolves.toEqual({ count: 0, groups: [] });
    // No user row was consulted, and no load query was needed to say so.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.benchLoad.findMany).not.toHaveBeenCalled();
  });

  it('answers the pickers plainly, without bench counts', async () => {
    prisma.benchPowder.findMany.mockResolvedValue([
      { id: 'pwd_h4350', name: 'H4350', maker: 'Hodgdon' },
    ]);
    prisma.benchCartridge.findMany.mockResolvedValue([
      { key: '308win', name: '.308 Winchester' },
    ]);
    prisma.benchCartridge.findUnique.mockResolvedValue({
      key: '308win',
      name: '.308 Winchester',
      slug: '308-winchester',
      type: null,
      origin: null,
      year: null,
      caseLengthMm: null,
      maxLengthMm: null,
      pmaxPsi: null,
      pmaxBar: null,
      dims: null,
    });
    const controller = wired();

    await expect(controller.powders(undefined, {})).resolves.toEqual([
      { id: 'pwd_h4350', name: 'H4350', maker: 'Hodgdon' },
    ]);
    await expect(controller.cartridges()).resolves.toEqual([
      { key: '308win', name: '.308 Winchester', loads: 0 },
    ]);

    const card = (await controller.cartridge('308win', undefined, {})) as {
      loadsForBench: number;
      loadCount: number;
    };
    expect(card.loadsForBench).toBe(0);
    expect(card.loadCount).toBe(0);
  });
});

describe('The Bench — the guest payload is the member payload', () => {
  /**
   * 🚨 ONE SHAPE, TWO CALLERS. A guest's answer is not a different projection;
   * it is the same result for a shelf someone typed instead of saved. If these
   * ever differ, the page needs two rendering paths and one of them will rot.
   */
  it('answers a guest query exactly as it answers the same stored shelf', async () => {
    storeMemberShelf();
    const controller = wired();

    const guest = await controller.loads(undefined, GUEST_QUERY);
    const member = await controller.loads(MEMBER_ID, {});

    expect(guest).toEqual(member);
    expect(guest.count).toBe(1);
    // The payload is catalogue data only; no member identifier can ride along.
    expect(JSON.stringify(guest)).not.toContain(MEMBER_ID);
  });

  it('has no personal field for a guest to receive in the first place', async () => {
    storeMemberShelf();
    const controller = wired();

    const guest = await controller.loads(undefined, GUEST_QUERY);

    const keys = JSON.stringify(guest);
    for (const personal of ['userId', 'user', 'email', 'username']) {
      expect(keys).not.toContain(personal);
    }
  });
});

/* ── The guard wiring, at the route level ────────────────────────────── */

/**
 * 🚨 THESE RUN A REAL NEST APP AND REAL GUARDS. Guard wiring is metadata on the
 * route handler, and the two ways it goes wrong are both invisible to a unit
 * test that calls the handler directly: a read left on AuthGuard locks the guest
 * out, and a write relaxed onto the optional pair hands a member's bench to a
 * stranger. The routes are the same ones main.ts serves (no global prefix in a
 * testing module), so the paths below are the ones the frontend calls.
 */
describe('The Bench — who may call which route', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, BenchModule],
    }).compile();
    app = mod.createNestApplication();
    // The app installs cookie-parser in main.ts; OptionalAuthGuard reads the
    // declaration off req.cookies, so the test app needs the same middleware.
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  it('404s a read caller with neither a session nor a declaration', async () => {
    await http().get('/bench/loads').expect(404);
    await http().get('/bench/powders').expect(404);
    await http().get('/bench/bullets').expect(404);
    await http().get('/bench/cartridges').expect(404);
    await http().get('/bench/share/token').expect(404);
  });

  it('serves the finder to a declared 18+ visitor, from the query shelf', async () => {
    prisma.benchLoad.findMany.mockResolvedValue([LOAD_ROW]);
    prisma.benchCipDimension.findMany.mockResolvedValue([
      { cartridgeKey: '308win', G1: G1_308_MM },
    ]);

    const res = await http()
      .get(
        '/bench/loads?powders%5B%5D=pwd_h4350&bullets%5B%5D=0.308%7C150&cartridges%5B%5D=308win',
      )
      .set('Cookie', DECLARED)
      .expect(200);

    expect(res.body.count).toBe(1);
    expect(res.body.groups[0].cartridge.key).toBe('308win');
    // The query shelf is a filter and no user row exists behind it.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('serves the pickers to a declared visitor', async () => {
    await http().get('/bench/powders').set('Cookie', DECLARED).expect(200);
    await http().get('/bench/bullets').set('Cookie', DECLARED).expect(200);
    await http().get('/bench/cartridges').set('Cookie', DECLARED).expect(200);
  });

  it('404s a visitor whose declaration does not verify', async () => {
    sessions.verifyCatalogueDeclaration.mockResolvedValue(false);

    await http().get('/bench/loads').set('Cookie', DECLARED).expect(404);
  });

  it('404s a spoofed/broken session token with no declaration', async () => {
    sessions.verify.mockRejectedValue(new Error('bad token'));

    await http().get('/bench/loads').set('Authorization', 'Bearer nope').expect(404);
  });

  /**
   * 🚨 THE MEMBER'S OWN DATA STAYS MEMBER-ONLY. A declaration grants the
   * catalogue, not an identity — so every route that reads or writes a person's
   * bench or log must still answer 401 without a session.
   */
  it.each([
    ['GET', '/bench/me'],
    ['PUT', '/bench/me'],
    ['GET', '/bench/log'],
    ['GET', '/bench/log.csv'],
    ['POST', '/bench/log'],
    ['PATCH', '/bench/log/entry_1'],
    ['DELETE', '/bench/log/entry_1'],
    ['POST', '/bench/share'],
  ])('%s %s is member-only', async (method, path) => {
    await http()[method.toLowerCase() as 'get' | 'put' | 'post' | 'patch' | 'delete'](path)
      .set('Cookie', DECLARED)
      .set('Content-Type', 'application/json')
      .send(method === 'GET' || method === 'DELETE' ? undefined : '{}')
      .expect(401);
  });

  it('lets a member read their own bench and the finder', async () => {
    storeMemberShelf();

    await http().get('/bench/me').set('Authorization', 'Bearer member-token').expect(200);
    await http().get('/bench/loads').set('Authorization', 'Bearer member-token').expect(200);
    await http().get('/bench/log').set('Authorization', 'Bearer member-token').expect(200);
  });

  it('lets a declared visitor open a shared link, and still not create one', async () => {
    prisma.benchShare.findUnique.mockResolvedValue({
      token: 'token',
      payload: { filters: { cartridge: '308win' } },
      expiresAt: new Date(Date.now() + 60_000),
    });

    await http().get('/bench/share/token').set('Cookie', DECLARED).expect(200);
    await http()
      .post('/bench/share')
      .set('Cookie', DECLARED)
      .set('Content-Type', 'application/json')
      .send({ payload: {} })
      .expect(401);
  });
});
