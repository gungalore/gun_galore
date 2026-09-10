import {
  MAX_IN_PLATE,
  QUARRY,
  quarriesFor,
  quarryByKey,
  quarryCaption,
  quarryFromKey,
  quarryPlateKey,
  quarryPrompt,
} from './motivation-quarry';

// ────────────────────────────────────────────────────────────────────
// PICKING THE ANIMALS.
//
// ⚠️ THE DANGEROUS DIRECTION IS PRINTING ONE, NOT PRINTING NONE. A photograph
// on a licence application says "this is the sort of thing this firearm is
// for", so a wrong animal either contradicts the applicant's own paragraphs or
// implies a hunt they never described. A good deal of what is pinned below is
// this returning nothing.
// ────────────────────────────────────────────────────────────────────

// The real 6,5 Creedmoor brief, from MO000075's research on 2026-09-10.
const CREEDMOOR =
  'Well matched to target shooting and long-range steel out to 900 metres ' +
  'and beyond, and for hunting to small and medium plains game such as ' +
  'springbok, blesbok, impala and warthog. Under-matched to large, heavy or ' +
  'dangerous African game such as eland, kudu bulls, buffalo, elephant or ' +
  'lion, where heavier calibres delivering greater mass and higher energy ' +
  'are required.';

const keys = (t: string, g?: string) =>
  quarriesFor({ cartridgeText: t, gameClasses: g }).map((q) => q.key);

describe('what goes in the frame', () => {
  it('takes every species the round is actually for', () => {
    // The operator's own sample was exactly this line-up.
    expect(keys(CREEDMOOR).sort()).toEqual([
      'blesbok',
      'impala',
      'springbok',
      'warthog',
    ]);
  });

  it('⚠️ NEVER TAKES ONE FROM THE UNDER-MATCHED HALF', () => {
    /**
     * The sentence after the one we want lists what the round must NOT be used
     * on. Matching the whole block would put a buffalo or an elephant on a
     * 6,5 Creedmoor application — the exact animal the document has just said
     * this firearm cannot ethically take.
     */
    for (const bad of ['buffalo', 'elephant', 'lion', 'eland', 'kudu']) {
      expect(keys(CREEDMOOR)).not.toContain(bad);
    }
  });

  it('⚠️ FILTERS THE LINE-UP BY WHAT THE APPLICANT SAID THEY HUNT', () => {
    // Nothing in the well-matched half is medium plains game, so nothing at all.
    expect(keys(CREEDMOOR, 'plains_medium')).toEqual([]);
    // And the lighter plains game keeps the whole line-up.
    expect(keys(CREEDMOOR, 'plains_light').length).toBe(4);
  });

  it('⚠️ PRINTS NOTHING WHEN THE ROUND AND THE APPLICANT SHARE NOTHING', () => {
    const text = 'Well matched to buffalo, elephant and lion at close range.';
    expect(keys(text, 'wingshooting')).toEqual([]);
  });

  it('takes dangerous game when that is what the applicant said', () => {
    const text = 'Well matched to buffalo, elephant and lion at close range.';
    expect(keys(text, 'dangerous')).toEqual(['buffalo', 'elephant', 'lion']);
  });

  it('⚠️ NEVER MORE THAN A FRAME HOLDS', () => {
    // Past five a line-up stops reading as one and becomes a herd photograph.
    const many =
      'Well matched to impala, springbok, blesbok, warthog, bushbuck, ' +
      'reedbuck, duiker and steenbok.';
    expect(keys(many).length).toBe(MAX_IN_PLATE);
  });

  it('handles a brief that names nothing we know, and no brief at all', () => {
    expect(keys('A target cartridge used on paper and steel.')).toEqual([]);
    expect(quarriesFor({})).toEqual([]);
    expect(quarriesFor({ cartridgeText: '   ' })).toEqual([]);
  });
});

describe('⚠️ MATCHING IS WHOLE WORDS', () => {
  it('does not find an animal inside another word', () => {
    /**
     * "eland" sits inside "Zeeland" and "lion" inside "medallion". A substring
     * match put an elephant on a page for a sentence about a rifle's medallion,
     * which is how this rule was written.
     */
    expect(keys('Well matched to a rifle with a medallion.')).toEqual([]);
    expect(keys('Well matched to use in Zeeland.')).toEqual([]);
  });

  it('still matches a plural', () => {
    expect(keys('Well matched to impalas on open ground.')).toEqual(['impala']);
  });

  it('matches an alias the research is likelier to use', () => {
    expect(keys('Well matched to greater kudu.')).toEqual(['kudu']);
    expect(keys('Well matched to oryx on the plains.')).toEqual(['gemsbok']);
  });
});

describe('the stored plate’s key', () => {
  it('⚠️ KEEPS THE ORDER THEY STAND IN', () => {
    // The caption is built back out of this string and names them left to
    // right, so sorting it would caption the picture wrongly.
    const picked = quarriesFor({ cartridgeText: CREEDMOOR });
    const key = quarryPlateKey(picked);
    expect(quarryFromKey(key).map((q) => q.key)).toEqual(
      picked.map((q) => q.key),
    );
  });

  it('survives a key naming something the registry no longer has', () => {
    // A species removed from the registry must not take the page down with it.
    expect(quarryFromKey('impala+not-a-species').map((q) => q.key)).toEqual([
      'impala',
    ]);
  });
});

describe('the caption', () => {
  it('names them in order and claims nothing about the applicant', () => {
    const c = quarryCaption(quarriesFor({ cartridgeText: CREEDMOOR }));
    expect(c).toContain('Impala');
    expect(c).toContain('Warthog');
    /**
     * ⚠️ NOT A STATEMENT OF FACT ABOUT THIS PERSON. The picture illustrates
     * what the cartridge is used on. A caption saying the applicant hunts
     * these, or intends to, would be a claim they are signing for under
     * section 120(9)(f).
     */
    expect(c).not.toMatch(/\bI\b|\bmy\b|applicant|hunts?\b/i);
  });

  it('reads properly for one animal and for two', () => {
    expect(quarryCaption([quarryByKey('kudu')!])).toMatch(/^Kudu —/);
    expect(
      quarryCaption([quarryByKey('kudu')!, quarryByKey('impala')!]),
    ).toMatch(/^Kudu and Impala —/);
  });

  it('is empty when there is nothing to name', () => {
    expect(quarryCaption([])).toBe('');
  });
});

describe('the registry and the brief', () => {
  it('has unique keys, because a key identifies a stored plate', () => {
    const all = QUARRY.map((q) => q.key);
    expect(new Set(all).size).toBe(all.length);
  });

  it('⚠️ CARRIES NO PROTECTED SPECIES', () => {
    // A rhino in a firearm licence application is a question nobody wants
    // asked, whatever the paperwork behind it says.
    expect(QUARRY.map((q) => q.key).join(' ')).not.toMatch(/rhino/i);
  });

  it('⚠️ ASKS FOR A PHOTOGRAPH WITH NOTHING DRAWN ON IT', () => {
    // Operator, 2026-09-10: "the animal should be a real animal and not show
    // the vital zone." The first attempt marked the heart and lungs, which is
    // an anatomical claim in a document somebody signs and lodges.
    const p = quarryPrompt(quarriesFor({ cartridgeText: CREEDMOOR }));
    expect(p).toMatch(/photorealistic/i);
    expect(p).toMatch(/no overlay/i);
    expect(p).toMatch(/no markings of any kind/i);
    expect(p).not.toMatch(/vital|killzone|kill zone|anatom|heart|lung/i);
  });

  it('⚠️ ASKS FOR THEM IN PROPORTION, which is the point of a line-up', () => {
    // Relative size is what a reader weighing a cartridge against its quarry
    // actually wants to see.
    const p = quarryPrompt(quarriesFor({ cartridgeText: CREEDMOOR }));
    expect(p).toMatch(/same distance from the camera/i);
    expect(p).toMatch(/proportion/i);
    expect(p).toMatch(/broadside/i);
  });

  it('asks for no blood, no injury and no firearms', () => {
    // It is a picture of animals, printed in an application to the police.
    const p = quarryPrompt([quarryByKey('buffalo')!]);
    expect(p).toMatch(/no blood/i);
    expect(p).toMatch(/no injury/i);
    expect(p).toMatch(/no firearms/i);
  });

  it('names the sex where it changes the animal', () => {
    // "impala" alone gets a ewe about half the time; a hunting application is
    // about the ram.
    expect(quarryPrompt([quarryByKey('impala')!])).toContain('ram');
    expect(quarryPrompt([quarryByKey('kudu')!])).toContain('bull');
  });
});
