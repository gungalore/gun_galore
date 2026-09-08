import { MotivationLicenceType } from '@prisma/client';
import {
  MotivationResearchService,
  RESEARCH_TTL_DAYS,
  cacheKeyFor,
  targetsFor,
} from './motivation-research.service';
import { LlmError } from '../common/llm/llm.types';

// ────────────────────────────────────────────────────────────────────
// THE RESEARCH LAYER — what the applicant is never asked, because we look it
// up.
//
// Three properties matter and all three are here:
//
//   COST      a cache hit makes no call at all. The whole point of keying on
//             the firearm rather than on the applicant is that the second
//             person applying for a Beretta 1301 is free.
//   PRIVACY   no applicant datum reaches a search query. The free-text brief
//             this replaces carried their suburb; nothing here carries
//             anything of theirs, and a target that did would also be
//             uncacheable.
//   SAFETY    it fails soft, every time. Research is seasoning — a null costs
//             the document colour, never the document.
// ────────────────────────────────────────────────────────────────────

const SPORT = MotivationLicenceType.S16_DEDICATED_SPORT;
const HUNTER = MotivationLicenceType.S16_DEDICATED_HUNTER;

const ANSWERS = {
  firearm_type: 'Handgun',
  firearm_action: 'Semi-automatic (self-loading)',
  firearm_make: 'CZ',
  firearm_model: 'Shadow 2',
  firearm_calibre: '9mm Parabellum',
};

function build(opts: { row?: any; text?: string; throws?: Error } = {}) {
  const upserts: any[] = [];
  const prisma = {
    motivationResearch: {
      findUnique: jest.fn(async (): Promise<any> => opts.row ?? null),
      upsert: jest.fn(async (args: any) => {
        upserts.push(args);
        return {};
      }),
    },
  };
  const complete = jest.fn(async (_req?: any) => {
    if (opts.throws) throw opts.throws;
    return {
      text: opts.text ?? 'The CZ Shadow 2 is a steel-framed competition pistol.',
      groundingSources: [{ uri: 'https://example.co.za/a', title: 'A' }],
    };
  });
  const llm = { isConfigured: () => true, complete, model: 'gemini-test' };
  return {
    svc: new MotivationResearchService(prisma as never, llm as never),
    prisma,
    complete,
    upserts,
  };
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('what gets researched', () => {
  it('asks about the firearm and the cartridge once both are known', () => {
    const targets = targetsFor(SPORT, ANSWERS).map((t) => t.target);
    expect(targets).toContain('firearm');
    expect(targets).toContain('calibre');
  });

  it('asks nothing at all about a firearm nobody has described', () => {
    // ⚠️ NOTHING RATHER THAN A GUESS. A brief about "a rifle" is worth neither
    // the call nor the paragraph it would produce.
    expect(targetsFor(SPORT, {})).toEqual([]);
  });

  it('does not ask about the firearm on a make alone', () => {
    const targets = targetsFor(SPORT, { firearm_make: 'CZ' }).map((t) => t.target);
    expect(targets).not.toContain('firearm');
  });

  it('keys the same cartridge differently for hunting and for sport', () => {
    // ⚠️ THE USE CLASS IS PART OF THE KEY ON PURPOSE. "Is .308 right for
    // plains game" and "is .308 right for this discipline" are different
    // questions about one cartridge, and sharing a row would answer one of
    // them with the other's brief.
    const sport = targetsFor(SPORT, ANSWERS).find((t) => t.target === 'calibre')!;
    const hunt = targetsFor(HUNTER, ANSWERS).find((t) => t.target === 'calibre')!;
    expect(sport.cacheKey).not.toBe(hunt.cacheKey);
  });

  it('keys a discipline to its registry slug, not to what was typed', () => {
    const t = targetsFor(SPORT, {
      ...ANSWERS,
      discipline: 'ipsc-handgun, other',
    }).find((x) => x.target === 'discipline');
    // Only researched when the slug resolves to a real discipline.
    if (t) expect(t.cacheKey).toMatch(/^discipline\|[a-z0-9-]+$/);
  });

  it('does not research a free-text "something else" discipline', () => {
    // There is no stable thing to key it to, and one applicant's wording is
    // not a cache.
    const targets = targetsFor(SPORT, {
      ...ANSWERS,
      discipline: 'other',
      discipline_other: 'Our club runs its own thing',
    }).map((t) => t.target);
    expect(targets).not.toContain('discipline');
  });

  it('asks about the quarry from the tapped game cards', () => {
    const t = targetsFor(HUNTER, {
      ...ANSWERS,
      hunt_game_class: 'plains_medium',
    }).find((x) => x.target === 'game');
    expect(t).toBeDefined();
    expect(t!.ask).toContain('humane kill');
  });

  it('keys the quarry on a stable, order-independent set', () => {
    const a = targetsFor(HUNTER, { ...ANSWERS, hunt_game_class: 'small, dangerous' });
    const b = targetsFor(HUNTER, { ...ANSWERS, hunt_game_class: 'dangerous, small' });
    const keyOf = (list: typeof a) => list.find((t) => t.target === 'game')!.cacheKey;
    expect(keyOf(a)).toBe(keyOf(b));
  });
});

describe('⚠️ nothing about the applicant reaches a search query', () => {
  it('never carries a name, an ID number, an address or a serial', () => {
    // The free-text brief this replaces redacted an address down to its
    // suburb and sent that. These targets carry no location at all — precinct
    // figures come from our own SAPS workbook (crime-stats) instead.
    const targets = targetsFor(MotivationLicenceType.S13_SELF_DEFENCE, {
      ...ANSWERS,
      full_name: 'Johan Pretorius',
      id_number: '8905125800087',
      residential_address: '36 Kerkstraat, Polokwane, Limpopo',
      firearm_serial: 'ZABA01892',
      police_station: 'Westenburg',
      employer_name: 'Acme Construction',
    });
    const everything = targets.map((t) => `${t.cacheKey} ${t.ask}`).join(' ');
    for (const leak of [
      'Johan',
      'Pretorius',
      '8905125800087',
      'Kerkstraat',
      'Polokwane',
      'Limpopo',
      'ZABA01892',
      'Westenburg',
      'Acme',
    ]) {
      expect(everything).not.toContain(leak);
    }
  });
});

describe('the cache', () => {
  it('⚠️ A HIT MAKES NO CALL AT ALL', async () => {
    const { svc, complete } = build({
      row: {
        target: 'firearm',
        cacheKey: 'firearm|cz|shadow 2|9mm parabellum|sport shooting',
        payload: 'cached prose',
        sources: [{ uri: 'https://example.co.za/a' }],
        expiresAt: future(),
      },
    });
    const pack = await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(complete).not.toHaveBeenCalled();
    expect(pack.firearm?.payload).toBe('cached prose');
  });

  it('treats an expired row as a miss and refetches', async () => {
    // ⚠️ CHECKED ON READ, NOT SWEPT. Nothing has to run on a schedule for the
    // cache to stay honest — a sweep that failed would otherwise serve stale
    // discipline rules into a document somebody signs.
    const { svc, complete } = build({
      row: {
        target: 'firearm',
        cacheKey: 'k',
        payload: 'stale prose',
        sources: [],
        expiresAt: past(),
      },
    });
    const pack = await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(complete).toHaveBeenCalled();
    expect(pack.firearm?.payload).not.toBe('stale prose');
  });

  it('writes one row per target on a miss, with the TTL on it', async () => {
    const { svc, upserts } = build();
    await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(upserts).toHaveLength(1);
    const ttlDays =
      (upserts[0].create.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(ttlDays)).toBe(RESEARCH_TTL_DAYS);
  });

  it('upserts rather than creates, so two applications cannot race', async () => {
    const { svc, prisma } = build();
    await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(prisma.motivationResearch.upsert).toHaveBeenCalled();
  });

  it('normalises a key so two spellings are one row', () => {
    expect(cacheKeyFor('firearm', ['  Beretta ', 'A400  Xcel'])).toBe(
      cacheKeyFor('firearm', ['BERETTA', 'a400 xcel']),
    );
  });
});

describe('it fails soft, always', () => {
  it('returns nothing rather than throwing when the call fails', async () => {
    const { svc } = build({ throws: new LlmError('timeout', 'timeout' as never) });
    await expect(
      svc.researchFor(SPORT, { firearm_make: 'CZ', firearm_model: 'Shadow 2' }),
    ).resolves.toEqual({});
  });

  it('returns nothing when the model is not configured', async () => {
    const { svc, prisma } = build();
    (svc as any).llm = { isConfigured: () => false };
    prisma.motivationResearch.findUnique = jest.fn(async () => null);
    await expect(
      svc.researchFor(SPORT, { firearm_make: 'CZ', firearm_model: 'Shadow 2' }),
    ).resolves.toEqual({});
  });

  it('survives a cache read that throws, by treating it as a miss', async () => {
    const { svc, complete, prisma } = build();
    prisma.motivationResearch.findUnique = jest.fn(async () => {
      throw new Error('db down');
    });
    const pack = await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(complete).toHaveBeenCalled();
    expect(pack.firearm).toBeDefined();
  });

  it('still returns the answer when the cache WRITE fails', async () => {
    // We have it in hand; failing to store it costs the NEXT applicant a call,
    // not this one a document.
    const { svc, prisma } = build();
    prisma.motivationResearch.upsert = jest.fn(async (_args: any) => {
      throw new Error('disk full');
    });
    const pack = await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(pack.firearm?.payload).toBeTruthy();
  });

  it('keeps an empty answer out of the cache', async () => {
    const { svc, upserts } = build({ text: '   ' });
    const pack = await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    expect(pack.firearm).toBeUndefined();
    expect(upserts).toHaveLength(0);
  });
});

describe('the call itself', () => {
  it('is grounded, and names its purpose per target', async () => {
    const { svc, complete } = build();
    await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    const req = complete.mock.calls[0][0] as any;
    expect(req.grounding).toEqual({ web: true });
    expect(req.purpose).toBe('motivation.research.firearm');
  });

  it('⚠️ NEVER ASKS FOR JSON ALONGSIDE GROUNDING', async () => {
    // The adapter throws bad_request for that combination on Gemini rather
    // than silently dropping one — see LlmRequest.grounding. Getting grounded
    // JSON means two calls, which would double the cost of every miss to buy
    // structure the writer does not need.
    const { svc, complete } = build();
    await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    const req = complete.mock.calls[0][0] as any;
    expect(req.json).toBeUndefined();
    expect(req.tools).toBeUndefined();
  });

  it('tells the model to paraphrase and to take no view on the application', async () => {
    const { svc, complete } = build();
    await svc.researchFor(SPORT, {
      firearm_make: 'CZ',
      firearm_model: 'Shadow 2',
    });
    const system = (complete.mock.calls[0][0] as any).system as string;
    expect(system).toMatch(/paraphrased/i);
    expect(system).toMatch(/no opinion on any application/i);
    expect(system).toMatch(/never any\s*\n?\s*prediction/i);
  });
});

describe('the cartridge the applicant already holds', () => {
  it('researches it, so the comparison has both sides', async () => {
    // ⚠️ RULE 1 FORBIDS THE WRITER EVERY FIGURE IT WAS NOT GIVEN. Without
    // published material on the OTHER cartridge, the strongest section in a
    // same-class application can only be written in generalities.
    const { svc, complete } = build();
    const pack = await svc.researchFor(HUNTER, ANSWERS, {
      heldCalibres: ['.308 Win'],
    });
    expect(pack.held).toHaveLength(1);
    const asks = complete.mock.calls.map((c) => (c[0] as any).messages[0].content);
    expect(asks.some((a: string) => a.includes('.308 Win'))).toBe(true);
  });

  it('shares the cache with an applied-for cartridge of the same name', () => {
    // A .308 researched for somebody's comparison is free the next time
    // somebody applies for a .308 — same target, same key.
    expect(cacheKeyFor('calibre', ['.308 Win', 'hunting'])).toBe(
      cacheKeyFor('calibre', ['.308 win', 'hunting']),
    );
  });

  it('never researches the applied-for cartridge twice', async () => {
    const { svc, complete } = build();
    await svc.researchFor(HUNTER, ANSWERS, {
      heldCalibres: ['9mm Parabellum'],
    });
    const calibreAsks = complete.mock.calls
      .map((c) => (c[0] as any).purpose)
      .filter((p: string) => p === 'motivation.research.calibre');
    expect(calibreAsks).toHaveLength(1);
  });

  it('caps the comparison at three cartridges', async () => {
    // An owned table with six rows in one class would otherwise spend the
    // whole budget on the sixth.
    const { svc } = build();
    const pack = await svc.researchFor(HUNTER, ANSWERS, {
      heldCalibres: ['.243', '.270', '.30-06', '7x64', '6.5x55'],
    });
    expect(pack.held).toHaveLength(3);
  });
});

describe('the block handed to the writer', () => {
  it('names what may be cited', () => {
    const block = MotivationResearchService.toBlock({
      calibre: {
        target: 'calibre',
        cacheKey: 'k',
        payload: 'The 9mm Parabellum is a low-recoil service cartridge.',
        sources: [{ uri: 'https://example.co.za/a', title: 'SA Hunter' }],
      },
    });
    expect(block).toContain('low-recoil service cartridge');
    expect(block).toContain('SA Hunter');
  });

  it('⚠️ SAYS SO WHEN THERE IS NOTHING TO ATTRIBUTE', () => {
    // A grounded call that opened nothing leaves us with a brief and no
    // citation. A writer told to cite will otherwise invent one, which is
    // rule 1 applied to a bibliography.
    const block = MotivationResearchService.toBlock({
      calibre: {
        target: 'calibre',
        cacheKey: 'k',
        payload: 'Some prose.',
        sources: [],
      },
    });
    expect(block).toContain('do not attribute it');
  });

  it('is empty for an empty pack, so nothing is handed over at all', () => {
    expect(MotivationResearchService.toBlock({})).toBe('');
  });
});
