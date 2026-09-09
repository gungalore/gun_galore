import {
  actionFromCardType,
  eligibleSlices,
  FirearmUsesService,
  useClassKey,
} from './firearm-uses.service';

// ────────────────────────────────────────────────────────────────────
// WHAT A FIREARM OF THIS CLASS IS USED FOR, PER KIND OF SHOOTER.
//
// The operator's override of guide-book Part 1 rule 7 (2026-09-09): candidate
// uses are generated per firearm CLASS — for every kind of shooter that class
// can lawfully be held by, in one call — and the member's own licence card
// chooses which lists the writer is shown. Nothing is asked of the member.
//
// ⚠️ THE MODEL IS ASKED IN WORDS, NEVER IN SECTION NUMBERS. Operator: "you can
// keep the section in you database, but what we serve gemini should be
// dedicated hunter, dedicated sport shooter, occational hunter occational
// sport shooter." The slice ids below are the DATABASE's; the keys in reply()
// are what crosses the wire.
//
// ⚠️ AND THE LISTS ARE NEVER MERGED. "that would give two lists instead of one
// consolidated list."
//
// ⚠️ THE FAIL-SOFT PATHS ARE HALF THE POINT OF THIS FILE. `documentScope`
// relaxes its invented-purpose rule ONLY for a row that actually carries uses,
// so a service that threw — or that quietly returned a half-answer — would
// either fail somebody's application or hand the writer a licence to invent.
// Every failure below must produce [] and no exception.
// ────────────────────────────────────────────────────────────────────

const RIFLE = {
  calibre: '6.5mm Creedmoor',
  type: 'Rifle',
  action: 'Manual',
  section: 'section 15',
};

const HUNT = 'I use it for plains game at moderate ranges.';
const SPORT = 'I shoot it at club precision matches.';

/** Twelve genuinely different sentences, for the volume and window tests. */
const SPECIES = [
  'impala',
  'blesbuck',
  'springbok',
  'kudu',
  'gemsbok',
  'warthog',
  'duiker',
  'steenbok',
  'bushbuck',
  'nyala',
  'zebra',
  'eland',
];

/** A model response, keyed the way the model is actually asked. */
function reply(over: Record<string, string[]> = {}) {
  return {
    text: JSON.stringify({
      occasional_hunter: [HUNT],
      occasional_sport_shooter: [SPORT],
      dedicated_hunter: ['I hunt with it under my association calendar.'],
      dedicated_sport_shooter: ['I shoot it in my registered discipline.'],
      ...over,
    }),
    model: 'gemini-3.5-flash-lite',
  };
}

function build(opts: {
  rows?: { classKey: string; uses: string[] }[];
  findMany?: jest.Mock;
  upsert?: jest.Mock;
  complete?: jest.Mock;
  configured?: boolean;
}) {
  const findMany = opts.findMany ?? jest.fn(async () => opts.rows ?? []);
  const upsert = opts.upsert ?? jest.fn(async () => undefined);
  const complete = opts.complete ?? jest.fn(async () => reply());
  const prisma = { firearmUseProfile: { findMany, upsert } };
  const llm = { isConfigured: () => opts.configured !== false, complete };
  return {
    svc: new FirearmUsesService(prisma as never, llm as never),
    findMany,
    upsert,
    complete,
  };
}

describe('the class key', () => {
  it('⚠️ FOLDS THE SIX SPELLINGS OF ONE CARTRIDGE INTO ONE ROW', () => {
    // A card reader, a member typing, and the overlap table all disagree, and
    // keyed raw every one of them would buy its own generation.
    const a = useClassKey({ ...RIFLE, calibre: '9MM PAR ( 9X19MM )' }, 's13');
    const b = useClassKey({ ...RIFLE, calibre: '9mm par (9x19mm)' }, 's13');
    const c = useClassKey({ ...RIFLE, calibre: '9mm-par-9x19mm' }, 's13');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('⚠️ IS THE CLASS AND THE SLICE, AND NOTHING ELSE', () => {
    // The section on a member's card chooses which rows are READ. It is not
    // part of the class, because one generation fills every purpose the class
    // can be held for — which is what lets the operator's section 15 Creedmoor
    // and somebody else's section 16 one share a table.
    const { calibre, type, action } = RIFLE;
    expect(useClassKey({ calibre, type, action }, 's16_hunt')).toBe(
      '65mmcreedmoor|rifle|manual|s16_hunt',
    );
  });

  it('keeps the disciplines apart, because they argue differently', () => {
    expect(useClassKey(RIFLE, 's15_hunt')).not.toBe(
      useClassKey(RIFLE, 's15_sport'),
    );
    expect(useClassKey(RIFLE, 's15_hunt')).not.toBe(
      useClassKey(RIFLE, 's16_hunt'),
    );
  });

  it('keeps a self-loading rifle apart from a bolt one', () => {
    expect(
      useClassKey({ ...RIFLE, action: 'Self-loading' }, 's16_hunt'),
    ).not.toBe(useClassKey(RIFLE, 's16_hunt'));
  });
});

describe('the action, off the card', () => {
  it('reads the S/L a licence card prints', () => {
    expect(actionFromCardType('S/L RIFLE')).toBe('Self-loading');
    expect(actionFromCardType('SELF-LOADING SHOTGUN')).toBe('Self-loading');
    expect(actionFromCardType('semi automatic rifle')).toBe('Self-loading');
  });

  it('⚠️ TELLS A MANUAL CARD FROM NO CARD AT ALL', () => {
    // A card printing "RIFLE" is SAYING the rifle is not self-loading; no card
    // says nothing, and an unstated action never rules a purpose out.
    expect(actionFromCardType('RIFLE')).toBe('Manual');
    expect(actionFromCardType('SHOTGUN')).toBe('Manual');
    expect(actionFromCardType('')).toBe('');
  });
});

describe('which shooters a class can be held by', () => {
  it('⚠️ A MANUAL SHOTGUN YIELDS FIVE LISTS', () => {
    // Operator: "so a manual shotgun should yield 5 sets of uses for example."
    expect(eligibleSlices('Shotgun', 'Manual')).toEqual([
      's13',
      's15_hunt',
      's15_sport',
      's16_hunt',
      's16_sport',
    ]);
  });

  it('a bolt rifle yields four — it is nobody’s self-defence firearm', () => {
    expect(eligibleSlices('Rifle', 'Manual')).toEqual([
      's15_hunt',
      's15_sport',
      's16_hunt',
      's16_sport',
    ]);
  });

  it('a handgun: self-defence, and either sporting discipline', () => {
    expect(eligibleSlices('Handgun', 'Self-loading')).toEqual([
      's13',
      's15_hunt',
      's15_sport',
      's16_hunt',
      's16_sport',
    ]);
  });

  it('⚠️ NEVER THE RESTRICTED LIST FOR A HANDGUN, whatever its action', () => {
    // s14 is for a RESTRICTED firearm — a semi-automatic rifle or shotgun. A
    // semi-automatic pistol is an ordinary section 13 firearm.
    expect(eligibleSlices('Handgun', 'Manual')).not.toContain('s14');
    expect(eligibleSlices('Handgun', 'Self-loading')).not.toContain('s14');
  });

  it('⚠️ A SELF-LOADING SHOTGUN GETS THREE, NOT FIVE', () => {
    // It loses BOTH ends: s13(1)(a) takes a shotgun "not fully or
    // semi-automatic", and s15(1)(b) says the same of the occasional sections.
    // What is left is the restricted self-defence list and the two dedicated
    // ones — which is why eligibility is asked of sectionAllows and not
    // assumed from the manual shotgun's five.
    expect(eligibleSlices('Shotgun', 'Self-loading')).toEqual([
      's14',
      's16_hunt',
      's16_sport',
    ]);
  });

  it('⚠️ A SELF-LOADING RIFLE IS NEVER AN OCCASIONAL FIREARM', () => {
    const out = eligibleSlices('Rifle', 'Self-loading');
    expect(out).toContain('s14');
    expect(out).not.toContain('s15_hunt');
    expect(out).toContain('s16_hunt');
  });

  it('an unstated action rules nothing out', () => {
    // A shotgun no card placed could be either, and refusing on silence is
    // how sectionAllows got it wrong once before.
    const out = eligibleSlices('Shotgun', '');
    expect(out).toContain('s13');
    expect(out).toContain('s14');
  });

  it('a combination gun gets every list, because no category fits it', () => {
    expect(eligibleSlices('Combination', '')).toHaveLength(6);
  });
});

describe('resolving a row', () => {
  it('⚠️ SPENDS NOTHING ON A CLASS ALREADY GENERATED', () => {
    // The table is keyed on the class, not on the member, so the second
    // applicant with a 6.5 Creedmoor pays for nobody.
    const { svc, complete } = build({
      rows: [
        { classKey: useClassKey(RIFLE, 's15_hunt'), uses: [HUNT] },
        { classKey: useClassKey(RIFLE, 's15_sport'), uses: [SPORT] },
      ],
    });
    return svc.forClass(RIFLE).then((groups) => {
      // ⚠️ TWO LABELLED LISTS, NOT ONE MERGED ONE.
      expect(groups).toEqual([
        { label: 'occasional hunting', uses: [HUNT] },
        { label: 'occasional sport shooting', uses: [SPORT] },
      ]);
      expect(complete).not.toHaveBeenCalled();
    });
  });

  it('⚠️ READS THE SECTION OFF THE ROW, NOT THE APPLICATION', () => {
    // The operator's own battery: the 6.5 Creedmoor is section 15 and the rest
    // are section 16, in one pack.
    const { svc } = build({
      rows: [
        { classKey: useClassKey(RIFLE, 's16_hunt'), uses: ['dedicated hunt'] },
        {
          classKey: useClassKey(RIFLE, 's16_sport'),
          uses: ['dedicated sport'],
        },
      ],
    });
    return expect(
      svc.forClass({ ...RIFLE, section: 'section 16' }),
    ).resolves.toEqual([
      { label: 'dedicated hunting', uses: ['dedicated hunt'] },
      { label: 'dedicated sport shooting', uses: ['dedicated sport'] },
    ]);
  });

  it('generates every eligible list and stores each', async () => {
    const { svc, complete, upsert } = build({});
    const groups = await svc.forClass(RIFLE);
    expect(groups.map((g) => g.label)).toEqual([
      'occasional hunting',
      'occasional sport shooting',
    ]);
    // ⚠️ THREE ROUNDS, ONE WRITE PER LIST. The rounds are where the volume
    // comes from; the table is written once at the end, not per round.
    expect(complete).toHaveBeenCalledTimes(3);
    expect(upsert).toHaveBeenCalledTimes(4);
    const keys = upsert.mock.calls.map((c) => c[0].where.classKey);
    expect(keys).toContain(useClassKey(RIFLE, 's16_sport'));
  });

  /**
   * ⚠️ THE ROUNDS ARE THE WHOLE ANSWER TO "we need a huge list of reasons".
   * Asked once the model gives two to five whatever the cap says; asked again
   * with its own answer in front of it, it goes and finds more.
   */
  it('⚠️ SHOWS THE MODEL WHAT IT ALREADY SAID, AND FORBIDS REPEATING IT', async () => {
    const { svc, complete } = build({});
    await svc.forClass(RIFLE);
    const first = complete.mock.calls[0][0].messages[0].content[0].text;
    const second = complete.mock.calls[1][0].messages[0].content[0].text;
    expect(first).not.toContain('ALREADY GIVEN');
    expect(second).toContain('YOU HAVE ALREADY GIVEN THESE');
    expect(second).toContain(HUNT);
    expect(second).toContain('genuinely different');
  });

  it('⚠️ FOLDS A REWORDING RATHER THAN COUNTING IT TWICE', async () => {
    // The model mostly obeys "do not repeat" and then reaches for a synonym.
    // An exact-match check catches almost none of those.
    let round = 0;
    const { svc, upsert } = build({
      complete: jest.fn(async () => {
        round++;
        if (round === 1) {
          return reply({
            occasional_hunter: ['I hunt impala in thick bushveld cover.'],
          });
        }
        return reply({
          occasional_hunter: [
            // The same use, reworded — must not be counted again.
            'I hunt impala in bushveld cover that is thick.',
            // Genuinely different — must be kept.
            'I shoot springbok on open Karoo plains in winter.',
          ],
        });
      }),
    });
    await svc.forClass(RIFLE);
    const hunt = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_hunt'),
    );
    expect(hunt[0].create.uses).toEqual([
      'I hunt impala in thick bushveld cover.',
      'I shoot springbok on open Karoo plains in winter.',
    ]);
  });

  it('⚠️ A LATER ROUND THAT FAILS KEEPS THE EARLIER ONES', async () => {
    // Round 1 is the one that matters; 2 and 3 are enrichment.
    let round = 0;
    const { svc } = build({
      complete: jest.fn(async () => {
        round++;
        if (round === 1) return reply();
        throw new Error('503 from the provider');
      }),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional hunting', uses: [HUNT] },
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
  });

  it('⚠️ ASKS IN WORDS, AND NAMES NO SECTION ANYWHERE', async () => {
    const { svc, complete } = build({});
    await svc.forClass(RIFLE);
    const sent = complete.mock.calls[0][0].messages[0].content[0].text;
    expect(sent).toContain('6.5mm Creedmoor');
    expect(sent).toContain('OCCASIONAL HUNTER');
    expect(sent).toContain('DEDICATED SPORT SHOOTER');
    expect(sent).not.toContain('SELF-DEFENCE');
    expect(sent).not.toMatch(/section\s*1[3-6]/i);
    expect(complete.mock.calls[0][0].json.schema.required).toEqual([
      'occasional_hunter',
      'occasional_sport_shooter',
      'dedicated_hunter',
      'dedicated_sport_shooter',
    ]);
  });

  it('⚠️ OFFERS NOTHING WHERE NO CARD PLACED THE FIREARM', async () => {
    // We do not know whether it is a self-defence pistol or a sporting one,
    // and handing over both sets is how a s13 firearm gets a hunting sentence.
    const { svc, findMany, complete } = build({});
    await expect(svc.forClass({ ...RIFLE, section: '' })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('⚠️ RETURNS [] AND DOES NOT THROW WHEN THE MODEL FAILS', async () => {
    const { svc, upsert } = build({
      complete: jest.fn(async () => {
        throw new Error('503 from the provider');
      }),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('⚠️ RETURNS [] AND DOES NOT THROW WHEN THE VAULT READ FAILS', async () => {
    const { svc, complete } = build({
      findMany: jest.fn(async () => {
        throw new Error('connection reset');
      }),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([]);
    // A read that threw is not a cache miss — it is a database we cannot
    // trust, and spending on it would double the fault.
    expect(complete).not.toHaveBeenCalled();
  });

  it('regenerates when only half a class was written', async () => {
    // One generation writes every list, so holding one and not the other means
    // the write was interrupted.
    const { svc, complete } = build({
      rows: [{ classKey: useClassKey(RIFLE, 's15_hunt'), uses: [HUNT] }],
    });
    await svc.forClass(RIFLE);
    expect(complete).toHaveBeenCalled();
  });

  it('returns [] when no model is configured at all', async () => {
    const { svc, complete } = build({ configured: false });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([]);
    expect(complete).not.toHaveBeenCalled();
  });

  it('⚠️ KEEPS THE ANSWER WHEN ONLY THE WRITE FAILS', async () => {
    // Losing the cache row costs the next applicant a generation. Losing the
    // uses costs this one their sentence.
    const { svc } = build({
      upsert: jest.fn(async () => {
        throw new Error('unique constraint');
      }),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional hunting', uses: [HUNT] },
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
  });

  it('stores an empty list rather than dropping it', async () => {
    // Rule 9: an empty list beats a dishonest one, and storing it stops the
    // next applicant paying to be told the same thing.
    const { svc, upsert } = build({
      complete: jest.fn(async () => reply({ occasional_sport_shooter: [] })),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional hunting', uses: [HUNT] },
    ]);
    const sport = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_sport'),
    );
    expect(sport[0].create.uses).toEqual([]);
  });

  it('drops junk the model returned rather than printing it', async () => {
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({ occasional_hunter: ['', '  ', 'ok', HUNT] }),
      ),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional hunting', uses: [HUNT] },
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
  });

  it('⚠️ KEEPS BOTH LISTS SEPARATE RATHER THAN MERGING THEM', async () => {
    // An earlier version capped the FIREARM at eight sentences across both
    // disciplines, which is how the operator came to see one consolidated list
    // where two were generated.
    const many = (p: string) =>
      Array.from({ length: 12 }, (_, i) => `I ${p} ${SPECIES[i]} in season.`);
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: many('hunt'),
          occasional_sport_shooter: many('shoot at'),
        }),
      ),
    });
    const out = await svc.forClass(RIFLE);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe('occasional hunting');
    expect(out[1].label).toBe('occasional sport shooting');
  });

  /**
   * ⚠️ THE TABLE HOLDS EVERYTHING; THE PROMPT DOES NOT. Forty sentences per
   * list across five held firearms is four hundred suggestions wrapped around
   * a handful of facts, and the writer argues from the FACTS.
   */
  it('⚠️ STORES THE WHOLE LIST AND OFFERS A WINDOW INTO IT', async () => {
    const many = (p: string) =>
      Array.from({ length: 12 }, (_, i) => `I ${p} ${SPECIES[i]} in season.`);
    const { svc, upsert } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: many('hunt'),
          occasional_sport_shooter: many('shoot at'),
        }),
      ),
    });
    const out = await svc.forClass(RIFLE, 'MR90189D');
    const hunt = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_hunt'),
    );
    expect(hunt[0].create.uses).toHaveLength(12);
    expect(out[0].uses).toHaveLength(10);
    // Every offered sentence is one that was actually stored.
    for (const u of out[0].uses) expect(hunt[0].create.uses).toContain(u);
  });

  it('⚠️ THE WINDOW MOVES WITH THE SERIAL, so two members differ', async () => {
    // Everybody holding a .30-06 being handed the same ten sentences in the
    // same order is how a battery of documents starts to look like one.
    const rows = [
      {
        classKey: useClassKey(RIFLE, 's15_hunt'),
        uses: SPECIES.map((s) => `I hunt ${s} in season.`),
      },
      { classKey: useClassKey(RIFLE, 's15_sport'), uses: [SPORT] },
    ];
    const a = await build({ rows }).svc.forClass(RIFLE, 'MR90189D');
    const b = await build({ rows }).svc.forClass(RIFLE, 'HW65001');
    expect(a[0].uses).toHaveLength(10);
    expect(b[0].uses).toHaveLength(10);
    expect(a[0].uses).not.toEqual(b[0].uses);
    // Stable for one firearm, or a retry becomes a different document.
    const again = await build({ rows }).svc.forClass(RIFLE, 'MR90189D');
    expect(again[0].uses).toEqual(a[0].uses);
  });

  it('does not ask about a row that names no firearm', async () => {
    const { svc, findMany, complete } = build({});
    await expect(
      svc.forClass({ calibre: '', type: '', action: '', section: 'section 15' }),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ THE SCREEN. Every sentence is judged by the SAME gate that would reject
   * the finished document, before it is ever stored — so the discipline is
   * enforced rather than asked for, and a sentence that would cost a
   * regeneration costs nothing instead.
   */
  it('⚠️ DROPS A HUNTING SENTENCE OFFERED AS SELF-DEFENCE', async () => {
    const { svc, upsert } = build({
      complete: jest.fn(async () =>
        reply({
          self_defence: [
            'I use it for hunting plains game on weekends.',
            'I use it for self-defence in my home.',
          ],
        }),
      ),
    });
    await expect(
      svc.forClass({ ...RIFLE, type: 'Handgun', section: 'section 13' }),
    ).resolves.toEqual([
      { label: 'self-defence', uses: ['I use it for self-defence in my home.'] },
    ]);
    const s13 = upsert.mock.calls.find((c) =>
      String(c[0].where.classKey).endsWith('|s13'),
    );
    expect(s13[0].create.uses).toEqual([
      'I use it for self-defence in my home.',
    ]);
  });

  it('⚠️ DROPS A SELF-DEFENCE SENTENCE OFFERED TO A DEDICATED HUNTER', async () => {
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          dedicated_hunter: ['I carry it for protection on the farm.'],
          dedicated_sport_shooter: [SPORT],
        }),
      ),
    });
    // The hunting list is emptied by the screen and drops out entirely.
    await expect(
      svc.forClass({ ...RIFLE, section: 'section 16' }),
    ).resolves.toEqual([{ label: 'dedicated sport shooting', uses: [SPORT] }]);
  });

  it('⚠️ DROPS A SENTENCE ABOUT WHERE THE FIREARM LIVES', async () => {
    // A live run produced "I keep it loaded…", "I keep it accessible in my
    // bedroom" and "I stage the firearm securely…" for a 12 gauge. The pack
    // answers storage from the applicant's own premises, in its own heading,
    // with photographs of the safe annexed; this table knows none of that.
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          self_defence: [
            'I keep it loaded with defensive rounds inside the home.',
            'I keep it accessible in my bedroom for a night intrusion.',
            'I use it to protect my family from an armed intruder.',
          ],
        }),
      ),
    });
    await expect(
      svc.forClass({ ...RIFLE, type: 'Handgun', section: 'section 13' }),
    ).resolves.toEqual([
      {
        label: 'self-defence',
        uses: ['I use it to protect my family from an armed intruder.'],
      },
    ]);
  });

  it('drops catalogue copy, which the gate refuses everywhere', async () => {
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: [
            'I use it where terminal ballistics matter on plains game.',
          ],
        }),
      ),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
  });

  it('⚠️ FOLDS AN AMERICANISM RATHER THAN THROWING THE SENTENCE AWAY', async () => {
    // "caliber" is a spelling to fix, not a use to lose.
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: [
            'I hunt plains game with this caliber at 200 meters.',
          ],
        }),
      ),
    });
    const out = await svc.forClass(RIFLE);
    expect(out[0].uses[0]).toBe(
      'I hunt plains game with this calibre at 200 metres.',
    );
  });
});
