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

/**
 * ⚠️ SUITABILITY, NOT HISTORY. The stored voice is about the FIREARM — "the I
 * hunt gireaffe shit aint going to fly, that a blatant lie" (operator,
 * 2026-09-09). A first-person sentence in this voice is refused outright.
 */
const HUNT = 'It is suited to plains game at moderate ranges.';
const SPORT = 'It is a standard chambering for club precision matches.';

/**
 * Twelve genuinely different sentences, for the volume and window tests.
 *
 * ⚠️ THEY HAVE TO BE GENUINELY DIFFERENT, not twelve of one shape. `merge()`
 * folds near-duplicates on content-word overlap, so "It is suited to impala in
 * bushveld terrain" and "…to blesbuck in bushveld terrain" are ONE use as far
 * as it is concerned — correctly. Pairing each species with its own terrain is
 * what makes twelve distinct sentences rather than one repeated.
 */
const TERRAIN = [
  'thornveld',
  'Karoo',
  'highveld',
  'mountain',
  'coastal',
  'farmland',
  'riverine',
  'savannah',
  'wetland',
  'scrub',
  'grassland',
  'woodland',
];

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
      dedicated_hunter: ['It is used on association calendar hunts.'],
      dedicated_sport_shooter: ['It is shot in registered disciplines.'],
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
    // ⚠️ THREE ROUNDS PLUS THE RESTATEMENT, ONE WRITE PER LIST. The rounds are
    // where the volume comes from; the fourth call turns the tense; the table
    // is written once at the end, not per round.
    expect(complete).toHaveBeenCalledTimes(4);
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
            occasional_hunter: ['It is suited to impala in thick bushveld.'],
          });
        }
        return reply({
          occasional_hunter: [
            // The same use, reworded — must not be counted again.
            'It is suited to impala in bushveld that is thick.',
            // Genuinely different — must be kept.
            'It suits springbok on open Karoo plains in winter.',
          ],
        });
      }),
    });
    await svc.forClass(RIFLE);
    const hunt = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_hunt'),
    );
    expect(hunt[0].create.uses).toEqual([
      'It is suited to impala in thick bushveld.',
      'It suits springbok on open Karoo plains in winter.',
    ]);
  });

  /**
   * ⚠️ THE TENSE IS AN ARGUMENT, NOT A STYLE. Operator, 2026-09-09: "if I
   * state that I already, the obvious question will be why do you need a
   * firearm for it if you already do." A firearm in the safe is used in the
   * present tense truthfully; one on an application form is not owned yet.
   */
  it('⚠️ RESTATES EVERY USE FOR A FIREARM NOBODY OWNS YET', async () => {
    const WANT = 'I would like to hunt plains game at moderate ranges.';
    let call = 0;
    const { svc, upsert, complete } = build({
      complete: jest.fn(async () => {
        call++;
        if (call <= 3) return reply();
        return reply({ occasional_hunter: [WANT] });
      }),
    });
    await svc.forClass(RIFLE);
    const sent = complete.mock.calls[3][0].messages[0].content[0].text;
    expect(sent).toContain('RESTATE EVERY ONE OF THEM');
    expect(sent).toContain('INTENDS to do');
    expect(sent).toContain('INTENT, NEVER HISTORY');
    expect(sent).toContain(HUNT);

    const hunt = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_hunt'),
    );
    // ⚠️ BOTH VOICES ON ONE ROW. The present tense is the truth for a firearm
    // already licensed; the future tense is the truth for one applied for.
    expect(hunt[0].create.uses).toEqual([HUNT]);
    expect(hunt[0].create.usesProspective).toEqual([WANT]);
  });

  it('⚠️ SERVES THE VOICE THE CALLER ASKED FOR', async () => {
    const rows = [
      {
        classKey: useClassKey(RIFLE, 's15_hunt'),
        uses: [HUNT],
        usesProspective: ['I would like to hunt plains game.'],
      },
      {
        classKey: useClassKey(RIFLE, 's15_sport'),
        uses: [SPORT],
        usesProspective: ['I would like to shoot club matches.'],
      },
    ];
    const held = await build({ rows }).svc.forClass(RIFLE, '', 'held');
    const applying = await build({ rows }).svc.forClass(RIFLE, '', 'applying');
    expect(held[0].uses).toEqual([HUNT]);
    expect(applying[0].uses).toEqual(['I would like to hunt plains game.']);
  });

  it('⚠️ AN APPLICATION NARROWS WHAT A CARD CANNOT', async () => {
    // A card saying "section 16" does not say hunter or sports shooter, so a
    // HELD firearm gets both. An S16_DEDICATED_HUNTER application says which.
    const rows = [
      { classKey: useClassKey(RIFLE, 's16_hunt'), uses: ['hunt'] },
      { classKey: useClassKey(RIFLE, 's16_sport'), uses: ['sport'] },
    ];
    const c = { ...RIFLE, section: 'section 16' };
    const both = await build({ rows }).svc.forClass(c);
    const one = await build({ rows }).svc.forClass(c, '', 'held', ['s16_hunt']);
    expect(both.map((g) => g.label)).toEqual([
      'dedicated hunting',
      'dedicated sport shooting',
    ]);
    expect(one.map((g) => g.label)).toEqual(['dedicated hunting']);
  });

  it('⚠️ A FAILED RESTATEMENT NEVER COSTS THE PRESENT-TENSE LIST', async () => {
    // Most firearms in a pack are already held and never need the other voice.
    let call = 0;
    const { svc, upsert } = build({
      complete: jest.fn(async () => {
        call++;
        if (call <= 3) return reply();
        throw new Error('503 from the provider');
      }),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional hunting', uses: [HUNT] },
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
    const hunt = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_hunt'),
    );
    expect(hunt[0].create.uses).toEqual([HUNT]);
    expect(hunt[0].create.usesProspective).toEqual([]);
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
      Array.from(
        { length: 12 },
        (_, i) => `It ${p} ${SPECIES[i]} on ${TERRAIN[i]} ground.`,
      );
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: many('suits'),
          occasional_sport_shooter: many('handles'),
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
      Array.from(
        { length: 12 },
        (_, i) => `It ${p} ${SPECIES[i]} on ${TERRAIN[i]} ground.`,
      );
    const { svc, upsert } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: many('suits'),
          occasional_sport_shooter: many('handles'),
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
        uses: SPECIES.map((sp, i) => `It suits ${sp} on ${TERRAIN[i]} ground.`),
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
            'It is suited to hunting plains game on weekends.',
            'It is suited to self-defence in the home.',
          ],
        }),
      ),
    });
    await expect(
      svc.forClass({ ...RIFLE, type: 'Handgun', section: 'section 13' }),
    ).resolves.toEqual([
      {
        label: 'self-defence',
        uses: ['It is suited to self-defence in the home.'],
      },
    ]);
    const s13 = upsert.mock.calls.find((c) =>
      String(c[0].where.classKey).endsWith('|s13'),
    );
    expect(s13[0].create.uses).toEqual([
      'It is suited to self-defence in the home.',
    ]);
  });

  it('⚠️ DROPS A SELF-DEFENCE SENTENCE OFFERED TO A DEDICATED HUNTER', async () => {
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          dedicated_hunter: ['It is carried for protection on the farm.'],
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
            'It is kept loaded with defensive rounds inside the home.',
            'It is stored in a bedroom for a night intrusion.',
            'It is suited to protecting a household from an armed intruder.',
          ],
        }),
      ),
    });
    await expect(
      svc.forClass({ ...RIFLE, type: 'Handgun', section: 'section 13' }),
    ).resolves.toEqual([
      {
        label: 'self-defence',
        uses: [
          'It is suited to protecting a household from an armed intruder.',
        ],
      },
    ]);
  });

  it('⚠️ DROPS A DOUBLED WORD, which nothing downstream proofreads', async () => {
    // A live run produced "in thick coastal coastal thickets". The writer
    // lifts a sentence whole, so the typo would reach a signed document.
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: [
            'It is suited to bushbuck in thick coastal coastal bush.',
          ],
        }),
      ),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
  });

  /**
   * ⚠️ THE GIRAFFE. A live run stored "I hunt giraffe on vast bushveld farms
   * during regulated culling contracts" against a held .300 Winchester
   * Magnum. Operator, 2026-09-09: "the I hunt gireaffe shit aint going to fly,
   * that a blatant lie." Nothing in any pack says the applicant has ever
   * hunted anything, and the document is signed under s120(9) of the Act.
   */
  it('⚠️ REFUSES A SENTENCE THAT CLAIMS THE APPLICANT DOES IT', async () => {
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: [
            'I hunt giraffe on vast bushveld farms during culling contracts.',
            'My rifle takes kudu at two hundred metres.',
            'It is suited to kudu in thornveld at two hundred metres.',
          ],
        }),
      ),
    });
    await expect(svc.forClass(RIFLE)).resolves.toEqual([
      {
        label: 'occasional hunting',
        uses: ['It is suited to kudu in thornveld at two hundred metres.'],
      },
      { label: 'occasional sport shooting', uses: [SPORT] },
    ]);
  });

  it('⚠️ AND REFUSES AN INTENT SENTENCE WITH NO INTENT IN IT', async () => {
    // The restatement is what makes the applied-for firearm honest. A sentence
    // that slipped back into the present tense is the giraffe again.
    let call = 0;
    const { svc, upsert } = build({
      complete: jest.fn(async () => {
        call++;
        if (call <= 3) return reply();
        return reply({
          occasional_hunter: [
            'I hunt plains game at moderate ranges.',
            'I would like to hunt plains game at moderate ranges.',
          ],
        });
      }),
    });
    await svc.forClass(RIFLE);
    const hunt = upsert.mock.calls.find(
      (c) => c[0].where.classKey === useClassKey(RIFLE, 's15_hunt'),
    );
    expect(hunt[0].create.usesProspective).toEqual([
      'I would like to hunt plains game at moderate ranges.',
    ]);
  });

  it('drops catalogue copy, which the gate refuses everywhere', async () => {
    const { svc } = build({
      complete: jest.fn(async () =>
        reply({
          occasional_hunter: [
            'It is used where terminal ballistics matter on plains game.',
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
            'It is suited to plains game in this caliber out to 200 meters.',
          ],
        }),
      ),
    });
    const out = await svc.forClass(RIFLE);
    expect(out[0].uses[0]).toBe(
      'It is suited to plains game in this calibre out to 200 metres.',
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// THE ONE TICK-BOX, AND WHAT IT DOES.
//
// Operator, 2026-09-09: "we just need to ask if the applicant will be using it
// for hunting or Sport shooting or both, that the only tick boxes I want to
// see. and that will decide from which pool of reasons we are going to
// motivate that firearm."
//
// `slicesWanted` lives in motivation-generation.service.ts because it needs
// the licence type; what it produces is fed straight into forClass's `only`
// filter, which is what this suite pins.
// ────────────────────────────────────────────────────────────────────

describe('the pool the tick chooses', () => {
  const rows = [
    { classKey: useClassKey(RIFLE, 's16_hunt'), uses: ['hunt one'] },
    { classKey: useClassKey(RIFLE, 's16_sport'), uses: ['sport one'] },
  ];
  const s16 = { ...RIFLE, section: 'section 16' };

  it('hunting takes the hunting pool alone', async () => {
    const out = await build({ rows }).svc.forClass(s16, '', 'held', [
      's16_hunt',
    ]);
    expect(out.map((g) => g.label)).toEqual(['dedicated hunting']);
  });

  it('sport takes the sport pool alone', async () => {
    const out = await build({ rows }).svc.forClass(s16, '', 'held', [
      's16_sport',
    ]);
    expect(out.map((g) => g.label)).toEqual(['dedicated sport shooting']);
  });

  it('⚠️ BOTH TAKES BOTH, as two labelled lists', async () => {
    const out = await build({ rows }).svc.forClass(s16, '', 'held', [
      's16_hunt',
      's16_sport',
    ]);
    expect(out.map((g) => g.label)).toEqual([
      'dedicated hunting',
      'dedicated sport shooting',
    ]);
  });
});
