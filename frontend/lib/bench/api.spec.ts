import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchApi } from './api';

/**
 * THE BENCH — what the finder actually asks the server for.
 *
 * 🚨 THIS FILE EXISTS BECAUSE THREE OF THE FINDER'S CONTROLS WERE DECORATIVE.
 * The cartridge tab, the weight band and every switched-off chip wrote a query
 * parameter the server did not read, so each one changed the URL and nothing
 * else — a filter that visibly does nothing, shipped twice. The half of that
 * contract this side owns is the query string, and it is asserted here rather
 * than read off a screenshot.
 *
 * 🚨 AND THE TOLERANCE HAS A ZERO. "Exact" is a tolerance of 0, an omitted
 * tolerance means the server's default of 5, and `if (q.tolerance)` treats the
 * two the same — so the one width a member picks when they mean it most would
 * silently return a ± 5 gr answer. The other three would work, which is what
 * makes it hard to see and worth a test.
 *
 * ⚠️ THE WINDOW IS A SEARCH WIDTH. It decides which loads come back, never
 * what may be loaded: each one is quoted at its own bullet weight with its own
 * charges. Nothing here asserts otherwise, and nothing should.
 */

const token = async () => 'tok';

/**
 * The URL the call went to.
 *
 * The request is captured in a closure rather than read back off a mock's
 * call list: the list is typed from the stub's own signature, which knows
 * nothing about fetch's, and indexing it is an assertion tsc cannot check.
 */
function stubFetch(): { url: () => string } {
  let seen = '';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    seen = String(input);
    return new Response('[]', { status: 200 });
  });
  return { url: () => seen };
}

/** Just the query string, so the assertions do not depend on NEXT_PUBLIC_API_URL. */
function params(url: string): URLSearchParams {
  const i = url.indexOf('?');
  return new URLSearchParams(i === -1 ? '' : url.slice(i + 1));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /bench/loads carries every control the toolbar shows', () => {
  it('sends the tolerance the member chose', async () => {
    const f = stubFetch();
    await benchApi.loads(token, { tolerance: 15 });
    expect(params(f.url()).get('tolerance')).toBe('15');
  });

  it('sends a tolerance of 0 rather than dropping it', async () => {
    // "Exact". Dropped, the server applies its default of 5 and the member
    // reads a wider answer under a pill that says otherwise.
    const f = stubFetch();
    await benchApi.loads(token, { tolerance: 0 });
    expect(params(f.url()).get('tolerance')).toBe('0');
  });

  it('omits the tolerance only when the caller has none', async () => {
    const f = stubFetch();
    await benchApi.loads(token, {});
    expect(params(f.url()).has('tolerance')).toBe(false);
  });

  it('drops a tolerance that is not a number instead of sending it as one', async () => {
    const f = stubFetch();
    await benchApi.loads(token, { tolerance: Number.NaN });
    expect(params(f.url()).has('tolerance')).toBe(false);
  });

  it('carries the tolerance alongside the cartridge, the band and the off chips', async () => {
    const f = stubFetch();
    await benchApi.loads(token, {
      cartridge: '30-06-springfield',
      weight: 'gte150',
      tolerance: 5,
      off: ['.308|150', 'pow_1'],
    });
    const p = params(f.url());
    expect(p.get('cartridge')).toBe('30-06-springfield');
    expect(p.get('weight')).toBe('gte150');
    expect(p.get('tolerance')).toBe('5');
    expect(p.get('off')).toBe('.308|150,pow_1');
  });

  it('still drops the two "everything" defaults, which the server reads as absent', async () => {
    const f = stubFetch();
    await benchApi.loads(token, { cartridge: 'all', weight: 'any', tolerance: 10 });
    const p = params(f.url());
    expect(p.has('cartridge')).toBe(false);
    expect(p.has('weight')).toBe(false);
    expect(p.get('tolerance')).toBe('10');
  });
});

/**
 * 🚨 THE TWO COUNTS AND THE LIST ARE ONE QUESTION, ASKED THREE TIMES.
 *
 * A powder row says "17 loads on your bench" and the spec card says "loads on
 * your bench", and both are promises about what the member sees when they tap
 * through. BenchController.benchFor() resolves the shelf per REQUEST — the off
 * chips and the grain window both — so a surface that sends one and not the
 * other does not fail: it answers about a different shelf and prints a figure
 * the list beside it contradicts. On "Exact" the chip counted over the server's
 * default ± 5 gr reads 17 and opens onto 9; on "± 15 gr" it reads 9 and opens
 * onto 31.
 *
 * ⚠️ AND IT IS STILL ONLY A SEARCH WIDTH. Nothing widened here changes a
 * charge — each load is quoted at its own bullet weight, in its own weight
 * group, with its own start and max.
 */
describe('a count against the bench is taken over the same shelf as the list', () => {
  it('sends the window and the off chips with the powder rows', async () => {
    const f = stubFetch();
    await benchApi.powders(token, undefined, { off: ['pow_1'], tolerance: 15 });
    const p = params(f.url());
    expect(p.get('tolerance')).toBe('15');
    expect(p.get('off')).toBe('pow_1');
  });

  it('sends the window with the spec card', async () => {
    const f = stubFetch();
    await benchApi.cartridge(token, '30-06-springfield', {
      off: ['.308|150'],
      tolerance: 0,
    });
    const p = params(f.url());
    expect(p.get('tolerance')).toBe('0');
    expect(p.get('off')).toBe('.308|150');
  });

  it('sends a window of 0 on both, rather than dropping it into the default', async () => {
    // "Exact" again, and the failure it hides is the loud one: the chip counts
    // over ± 5 gr, the list is drawn over ± 0, and the two disagree on screen.
    const powders = stubFetch();
    await benchApi.powders(token, 'n550', { off: [], tolerance: 0 });
    expect(params(powders.url()).get('tolerance')).toBe('0');
    // The search term still rides alongside it.
    expect(params(powders.url()).get('q')).toBe('n550');

    const spec = stubFetch();
    await benchApi.cartridge(token, '308-winchester', { off: [], tolerance: 0 });
    expect(params(spec.url()).get('tolerance')).toBe('0');
  });

  it('leaves the cartridge key escaped in the path, not in the query', async () => {
    const f = stubFetch();
    await benchApi.cartridge(token, '8x57 is', { off: [], tolerance: 5 });
    expect(f.url()).toContain('/cartridges/8x57%20is?');
    expect(params(f.url()).get('tolerance')).toBe('5');
  });
});

/* ── A signed-out visitor's shelf ────────────────────────────────────── */

/**
 * 🚨 THE GUEST SHELF'S SPELLING IS THE SERVER'S CONTRACT. SPEC-BUILD §4 names
 * the arrays `powders[]`, `bullets[]`, `cartridges[]`; the backend reads those
 * keys as repeated parameters and a bullet goes over as the chip key
 * (`calibre|weight`). Sent as a comma-joined list the server would still accept
 * the values — and nothing would ever fail — but the axis a value belongs to
 * would then live in the value's shape rather than in its name.
 */
describe('GET /bench/loads carries a guest shelf as the SPEC arrays', () => {
  it('sends each axis as its own repeated array parameter', async () => {
    const f = stubFetch();
    await benchApi.loads(async () => null, {
      shelf: {
        powderIds: ['p1', 'p2'],
        bullets: [{ weightGr: 150, calibreIn: 0.308 }, { weightGr: 139 }],
        cartridgeKeys: ['308win'],
      },
    });
    const p = params(f.url());
    expect(p.getAll('powders[]')).toEqual(['p1', 'p2']);
    expect(p.getAll('bullets[]')).toEqual(['0.308|150', '|139']);
    expect(p.getAll('cartridges[]')).toEqual(['308win']);
  });

  it('sends no shelf at all for a member, whose bench is stored', async () => {
    const f = stubFetch();
    await benchApi.loads(token, {});
    const p = params(f.url());
    expect(p.has('powders[]')).toBe(false);
    expect(p.has('bullets[]')).toBe(false);
    expect(p.has('cartridges[]')).toBe(false);
  });

  it('carries the shelf with the count reads, so a chip counts this shelf', async () => {
    const f = stubFetch();
    await benchApi.powders(async () => null, 'n550', {
      off: [],
      tolerance: 5,
      shelf: { powderIds: ['p1'], bullets: [{ weightGr: 150, calibreIn: 0.308 }], cartridgeKeys: ['308win'] },
    });
    const p = params(f.url());
    expect(p.getAll('powders[]')).toEqual(['p1']);
    expect(p.getAll('bullets[]')).toEqual(['0.308|150']);
    expect(p.getAll('cartridges[]')).toEqual(['308win']);
  });
});

/**
 * ⚠️ A TOKEN GETTER THAT ANSWERS null IS THE SIGNED-OUT STATE, AND IT MUST NOT
 * PUT AN EMPTY `Authorization: Bearer ` ON THE WIRE. The reads are content
 * reads behind the 18+ gate: the gate cookie rides along because the calls are
 * same-origin, and a blank credential header would look like a broken session
 * to OptionalAuthGuard instead of a visitor with none.
 */
describe('a read with no token sends no Authorization header', () => {
  function capture(): { headers: () => Record<string, string> } {
    let seen: Record<string, string> = {};
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return new Response('[]', { status: 200 });
    });
    return { headers: () => seen };
  }

  it('sends no Authorization header for a guest', async () => {
    const f = capture();
    await benchApi.loads(async () => null, {});
    expect(f.headers().Authorization).toBeUndefined();
  });

  it('still sends it for a member', async () => {
    const f = capture();
    await benchApi.loads(token, {});
    expect(f.headers().Authorization).toBe('Bearer tok');
  });
});
