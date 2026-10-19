import { MotivationLicenceType } from '@prisma/client';
import { SUPPORTED_IMAGE_ASPECT_RATIOS } from '../common/llm/llm.types';
import {
  MAX_PLATES,
  buildPlateSpecs,
  purposeFor,
  weaponClass,
} from './motivation-plates';
import { PLATE_REQUEST_RATIO, PLATE_W, PLATE_H } from './motivation-plates.service';

// ────────────────────────────────────────────────────────────────────
// THE PURPOSE EXHIBITS — WHICH SCENES, FOR WHICH PACK.
//
// ⚠️ THE SCENES ARE CHOSEN IN CODE AND NOT BY A MODEL, so this is the file that
// decides what a pack's one to two pages of pictures show. Every assertion here
// is one that would otherwise reach a signed application unnoticed: the wrong
// purpose's scenes, a caption that claims something the applicant never said,
// a prompt that trips the image model's safety filter.
// ────────────────────────────────────────────────────────────────────

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const S14 = MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE;
const S15 = MotivationLicenceType.S15_OCCASIONAL_HUNTER;
const S16_HUNT = MotivationLicenceType.S16_DEDICATED_HUNTER;
const S16_SPORT = MotivationLicenceType.S16_DEDICATED_SPORT;
const S24 = MotivationLicenceType.S24_RENEWAL;

describe('which purpose a pack serves', () => {
  it('maps self-defence and leaves a renewal with nothing', () => {
    expect(purposeFor(S13, {})).toBe('self_defence');
    expect(purposeFor(S14, {})).toBe('self_defence');
    expect(purposeFor(S24, {})).toBeNull();
  });

  it('⚠️ RESOLVES SECTION 15/16 FROM THE PACK, NOT THE LABEL (2026-10-17)', () => {
    // One section 16 entry point; a handgun is sport whichever label the
    // applicant started under.
    expect(purposeFor(S16_HUNT, { firearm_type: 'Handgun' })).toBe('sport');
    expect(purposeFor(S16_SPORT, { firearm_type: 'Handgun' })).toBe('sport');
    // A dangerous-game rifle is hunting.
    expect(
      purposeFor(S16_HUNT, {
        firearm_type: 'Rifle',
        firearm_action: 'Bolt action',
        firearm_calibre: '.375 H&H Magnum',
      }),
    ).toBe('hunting');
    // A manual rifle with nothing to compare against can do both.
    expect(
      purposeFor(S15, {
        firearm_type: 'Rifle',
        firearm_action: 'Bolt action',
        firearm_calibre: '6.5 Creedmoor',
      }),
    ).toBe('both');
    // Nothing described at all: both pools is the only honest answer.
    expect(purposeFor(S16_HUNT, {})).toBe('both');
  });

  it('⚠️ FINDS THE GAP AGAINST THE BATTERY', () => {
    const base = {
      firearm_type: 'Rifle',
      firearm_action: 'Bolt action',
      firearm_calibre: '6.5 Creedmoor',
      existing_firearm_1_type: 'Rifle',
      existing_firearm_1_calibre: '6.5 Creedmoor',
    };
    // The held rifle is the hunting rifle, so the new one is argued for sport.
    expect(
      purposeFor(S16_HUNT, {
        ...base,
        existing_firearm_1_use: 'bushveld plains game',
      }),
    ).toBe('sport');
    // The held rifle is the match rifle, so the new one is argued for hunting.
    expect(
      purposeFor(S16_HUNT, {
        ...base,
        existing_firearm_1_use: 'sport competition',
      }),
    ).toBe('hunting');
  });
});

describe('the self-defence scenarios', () => {
  it('always reaches two pages of plates', () => {
    const plates = buildPlateSpecs({ licenceType: S13, answers: {} });
    expect(plates).toHaveLength(MAX_PLATES);
    expect(plates.map((p) => p.pageIndex)).toEqual([1, 1, 2, 2]);
    expect(plates.map((p) => p.plateIndex)).toEqual([1, 2, 1, 2]);
  });

  it('picks the rural, communal or driveway scene from the premises', () => {
    const titles = buildPlateSpecs({
      licenceType: S13,
      answers: { premises_type: 'rural smallholding' },
    }).map((p) => p.title);
    expect(titles).toContain('A rural perimeter');

    const flat = buildPlateSpecs({
      licenceType: S13,
      answers: { premises_type: 'apartment' },
    }).map((p) => p.title);
    expect(flat).toContain('Communal access');
  });

  it('⚠️ NEVER NAMES A WEAPON, A PERSON OR AN ACT IN THE PROMPT', () => {
    // The review a picture model runs is a violence filter; a self-defence
    // prompt that reads as a scene of violence is refused, and a refused plate
    // is a blank page in a lodged document.
    for (const plate of buildPlateSpecs({ licenceType: S14, answers: {} })) {
      expect(plate.prompt).toMatch(/No people, no firearms, no weapons/i);
    }
  });
});

describe('the hunting plates come from the research', () => {
  /** A hunting rifle, forced hunting by a held sport rifle of the same class. */
  const HUNTING = {
    firearm_type: 'Rifle',
    firearm_action: 'Bolt action',
    firearm_calibre: '6.5 Creedmoor',
    existing_firearm_1_type: 'Rifle',
    existing_firearm_1_calibre: '6.5 Creedmoor',
    existing_firearm_1_use: 'sport competition',
  };

  it('pictures the named species, then fills the two pages from the class', () => {
    const plates = buildPlateSpecs({
      licenceType: S16_HUNT,
      answers: { ...HUNTING, hunt_game_class: 'plains_light,plains_medium' },
      research:
        'Well matched to medium-sized plains game such as impala and kudu at bushveld distances.',
    });
    expect(plates.map((p) => p.title).slice(0, 2)).toEqual(['Impala', 'Kudu']);
    expect(plates).toHaveLength(MAX_PLATES);
    expect(plates.map((p) => p.pageIndex)).toEqual([1, 1, 2, 2]);
  });

  it('⚠️ A SPECIES OUTSIDE THE APPLICANT\u2019S OWN GAME CLASS IS DROPPED', () => {
    // The applicant said plains game; impala is light plains game and is not
    // printed for them even though the cartridge brief names it.
    const plates = buildPlateSpecs({
      licenceType: S16_HUNT,
      answers: { ...HUNTING, hunt_game_class: 'plains_medium' },
      research: 'Well matched to impala and kudu.',
    });
    expect(plates.map((p) => p.title)).not.toContain('Impala');
    expect(plates[0].title).toBe('Kudu');
  });

  it('⚠️ FOUR PLATES OVER TWO PAGES, EACH SAYING WHY IT SUITS THE FIREARM', () => {
    const plates = buildPlateSpecs({
      licenceType: S16_HUNT,
      answers: HUNTING,
      research:
        'Well matched to impala, springbok, blesbok, warthog and kudu at bushveld distances.',
    });
    expect(plates).toHaveLength(MAX_PLATES);
    expect(plates.map((p) => p.title)).toEqual([
      'Impala',
      'Springbok',
      'Blesbok',
      'Warthog',
    ]);
    expect(plates.map((p) => p.pageIndex)).toEqual([1, 1, 2, 2]);
    expect(plates.map((p) => p.plateIndex)).toEqual([1, 2, 1, 2]);
    for (const p of plates) {
      expect(p.description).toMatch(/matched to this class of game/);
      expect(p.prompt).toMatch(/Photorealistic/);
    }
  });

  it('⚠️ PRINTS NOTHING WHEN THERE IS NO FIREARM AND NO RESEARCH', () => {
    // A guessed animal is worse than a plainer page — the quarry rule.
    expect(
      buildPlateSpecs({
        licenceType: S16_HUNT,
        answers: {},
        research: 'A capable medium-bore cartridge for general use.',
      }),
    ).toEqual([]);
  });

  it('⚠️ MIXES ANIMALS AND ACTIVITIES FOR A FIREARM THAT DOES BOTH (2026-10-17)', () => {
    const plates = buildPlateSpecs({
      licenceType: S15,
      answers: {
        firearm_type: 'Rifle',
        firearm_action: 'Bolt action',
        firearm_calibre: '6.5 Creedmoor',
      },
      research:
        'Well matched to impala and kudu at bushveld distances.',
    });
    expect(plates).toHaveLength(MAX_PLATES);
    expect(plates.map((p) => p.pageIndex)).toEqual([1, 1, 2, 2]);
    const firstTwo = plates.slice(0, 2).map((p) => p.title);
    expect(firstTwo).toEqual(['Impala', 'Kudu']);
    // Page two is the discipline the same rifle is used for.
    expect(plates.slice(2).every((p) => !/impala|kudu/i.test(p.title))).toBe(
      true,
    );
  });
});

describe('the sport plates are the courses of fire for the firearm', () => {
  it('reaches two pages of courses', () => {
    const plates = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { firearm_type: 'Handgun' },
    });
    expect(plates).toHaveLength(MAX_PLATES);
    expect(plates[0].title).toBe('IPSC Practical Pistol');
  });

  it('⚠️ PICTURES ONLY THE COURSES THE APPLIED-FOR FIREARM IS ELIGIBLE FOR (MO000096)', () => {
    // A handgun was once drawn with rifle and shotgun venues. Each class — and,
    // for a rifle, each action — is now its own pool.
    const handgun = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { firearm_type: 'Handgun', firearm_calibre: '9MM PAR (9X19MM)' },
    }).map((p) => p.title);
    expect(handgun).toContain('IPSC Practical Pistol');
    expect(handgun).toHaveLength(MAX_PLATES);
    for (const title of handgun) {
      expect(title).not.toMatch(/rifle|shotgun|clay|f-class|prs/i);
    }

    const rifleSemi = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { firearm_type: 'Rifle', firearm_action: 'Semi-automatic (self-loading)' },
    }).map((p) => p.title);
    expect(rifleSemi).toContain('IPSC Practical Rifle');
    for (const title of rifleSemi) {
      expect(title).not.toMatch(/handgun|shotgun|f-class|lever|cowboy/i);
    }

    const rifleManual = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: {
        firearm_type: 'Rifle',
        firearm_action: 'Manual (bolt-action)',
        // A held hunting rifle of the same class makes this application the
        // sport gap — see motivation-purpose.ts.
        existing_firearm_1_type: 'Rifle',
        existing_firearm_1_use: 'bushveld plains game',
      },
    }).map((p) => p.title);
    expect(rifleManual).toContain('F-Class');
    for (const title of rifleManual) {
      expect(title).not.toMatch(/handgun|shotgun|practical rifle|3-gun/i);
    }

    const shotgun = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { firearm_type: 'Shotgun', firearm_calibre: '12 GAUGE' },
    }).map((p) => p.title);
    expect(shotgun).toContain('Clay Pigeon / Trap / Skeet');
    for (const title of shotgun) {
      expect(title).not.toMatch(/handgun|rifle|f-class/i);
    }
  });

  it('⚠️ MINES THE GENERATED USES TO PUT THE RIGHT COURSE FIRST', () => {
    const plates = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { firearm_type: 'Handgun' },
      usesText:
        'It is used in Steel Challenge, scored purely on the time against five steel plates.',
    });
    expect(plates[0].title).toBe('Steel Challenge');
  });

  it('⚠️ GIVES THE IMAGE MODEL THE LAYOUT, NOT A GENERIC VENUE (2026-10-17)', () => {
    const ipsc = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { firearm_type: 'Handgun' },
    })[0];
    // The layout is what the picture is for: a wide, elevated view of the
    // whole stage, the painted fault lines, the shooting box and the target
    // distances. "No markings of any kind" used to ban the very fault lines
    // the prompt asked for.
    expect(ipsc.prompt).toMatch(/elevated three-quarter/i);
    expect(ipsc.prompt).toMatch(/whole stage/i);
    expect(ipsc.prompt).toMatch(/shooting box/i);
    expect(ipsc.prompt).toMatch(/fault lines/i);
    expect(ipsc.prompt).toMatch(/10 to 15 metres/i);
    expect(ipsc.prompt).not.toMatch(/no markings/i);
  });

  it('⚠️ EVERY COURSE PROMPT IS AN EMPTY RANGE — NO PEOPLE, NO ACTION (2026-10-15)', () => {
    for (const firearm_type of ['Handgun', 'Rifle', 'Shotgun']) {
      for (const plate of buildPlateSpecs({
        licenceType: S16_SPORT,
        answers: {
          firearm_type,
          firearm_action: 'Semi-automatic (self-loading)',
        },
      })) {
        expect(plate.prompt).toMatch(/no people/i);
        expect(plate.prompt).toMatch(/no firearms/i);
        expect(plate.prompt).toMatch(/no motion or action/i);
      }
    }
  });

  it('classifies the applied-for firearm from its own answers', () => {
    expect(weaponClass({ firearm_type: 'Handgun' })).toBe('handgun');
    expect(weaponClass({ firearm_type: 'Rifle' })).toBe('rifle');
    expect(weaponClass({ firearm_type: 'Shotgun' })).toBe('shotgun');
    // Type first; calibre only breaks a tie.
    expect(weaponClass({ firearm_calibre: '9MM PAR (9X19MM)' })).toBe('handgun');
    expect(weaponClass({ firearm_type: 'Rifle', firearm_calibre: '9MM PAR' })).toBe(
      'rifle',
    );
    // An unrecognised type keeps the whole catalogue (no class, no withholding).
    expect(weaponClass({ firearm_type: 'Combination' })).toBeNull();
  });

  it('⚠️ ASKS THE MODEL FOR A RATIO IT SUPPORTS, AND KEEPS THE 2:1 FRAME (MO000096)', () => {
    // The image API rejects anything outside SUPPORTED_IMAGE_ASPECT_RATIOS with
    // a 400; the plates asked for "2:1" and drew nothing at all for a day.
    expect(
      SUPPORTED_IMAGE_ASPECT_RATIOS.includes(
        PLATE_REQUEST_RATIO as (typeof SUPPORTED_IMAGE_ASPECT_RATIOS)[number],
      ),
    ).toBe(true);
    // The printed frame stays the operator's 2:1 whatever the model returns.
    expect(PLATE_W / PLATE_H).toBe(2);
  });

  it('⚠️ EVERY PLATE CARRIES A TITLE, A DESCRIPTION AND A PROMPT', () => {
    for (const licenceType of [S13, S16_HUNT, S16_SPORT]) {
      for (const plate of buildPlateSpecs({
        licenceType,
        answers:
          licenceType === S16_HUNT
            ? { hunt_game_class: 'plains_medium' }
            : { firearm_type: 'Rifle' },
        research: 'impala, kudu and gemsbok',
      })) {
        expect(plate.title.trim()).not.toBe('');
        expect(plate.description.trim().length).toBeGreaterThan(20);
        expect(plate.prompt).toContain('Photorealistic');
        expect(plate.prompt).toMatch(/no firearms/i);
      }
    }
  });
});
