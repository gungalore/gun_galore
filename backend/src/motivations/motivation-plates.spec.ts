import { MotivationLicenceType } from '@prisma/client';
import {
  MAX_PLATES,
  buildPlateSpecs,
  purposeFor,
} from './motivation-plates';

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
  it('maps the sections to their purpose', () => {
    expect(purposeFor(S13, {})).toBe('self_defence');
    expect(purposeFor(S14, {})).toBe('self_defence');
    expect(purposeFor(S16_HUNT, {})).toBe('hunting');
    expect(purposeFor(S16_SPORT, {})).toBe('sport');
  });

  it('reads a section 15 by the applicant\u2019s own answer', () => {
    expect(purposeFor(S15, { hunt_game_class: 'plains_medium' })).toBe(
      'hunting',
    );
    expect(purposeFor(S15, { sport_formats: 'IPSC' })).toBe('sport');
    // No answer at all defaults to hunting — s15Purpose's own rule.
    expect(purposeFor(S15, {})).toBe('hunting');
  });

  it('gives a renewal no exhibits at all', () => {
    expect(purposeFor(S24, {})).toBeNull();
    expect(buildPlateSpecs({ licenceType: S24, answers: {} })).toEqual([]);
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
  it('pictures exactly the species the brief names', () => {
    const plates = buildPlateSpecs({
      licenceType: S16_HUNT,
      answers: { hunt_game_class: 'plains_light,plains_medium' },
      research:
        'Well matched to medium-sized plains game such as impala and kudu at bushveld distances.',
    });
    expect(plates.map((p) => p.title)).toEqual(['Impala', 'Kudu']);
    expect(plates.map((p) => p.pageIndex)).toEqual([1, 1]);
  });

  it('⚠️ A SPECIES OUTSIDE THE APPLICANT\u2019S OWN GAME CLASS IS DROPPED', () => {
    // The applicant said plains game; impala is light plains game and is not
    // printed for them even though the cartridge brief names it.
    const plates = buildPlateSpecs({
      licenceType: S16_HUNT,
      answers: { hunt_game_class: 'plains_medium' },
      research: 'Well matched to impala and kudu.',
    });
    expect(plates.map((p) => p.title)).toEqual(['Kudu']);
  });

  it('⚠️ PRINTS NOTHING WHEN THE RESEARCH NAMES NO SPECIES', () => {
    // A guessed animal is worse than a plainer page — the quarry rule.
    expect(
      buildPlateSpecs({
        licenceType: S16_HUNT,
        answers: {},
        research: 'A capable medium-bore cartridge for general use.',
      }),
    ).toEqual([]);
  });
});

describe('the sport plates come from the firearm and discipline', () => {
  it('reaches two pages of activities', () => {
    const plates = buildPlateSpecs({
      licenceType: S16_SPORT,
      answers: { association_name: 'SAPSA', firearm_type: 'Handgun' },
    });
    expect(plates).toHaveLength(MAX_PLATES);
    expect(plates[0].title).toBe('Practical shooting');
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
