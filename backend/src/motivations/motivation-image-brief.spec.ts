import {
  COURSE_AVOID,
  SCENE_AVOID,
  SNAPSHOT_TREATMENT,
  SPECIES_AVOID,
  imageBrief,
} from './motivation-image-brief';

// ────────────────────────────────────────────────────────────────────
// THE PROMPT ORDER IS A RULE, NOT A STYLE.
//
// xAI's Imagine guide says the subject has to come first and the avoid list
// last: a prompt that leads with the film stock or a wall of prohibitions
// draws a styled scene whose subject is a stand-in. Those two failures are
// what these specs exist to catch.
// ────────────────────────────────────────────────────────────────────

const brief = {
  subject: 'An adult impala ram standing broadside in dry grass',
  detail: 'One animal, about a third of the frame wide, seen from eye level',
  art: 'Pale gold grass and a weathered fence post',
  light: 'Warm low sun from the left, exposed so the animal reads clearly',
  colour: 'Russet coat against pale gold grass',
  lens: "A phone's wide camera at eye level",
  treatment: SNAPSHOT_TREATMENT,
  avoid: SPECIES_AVOID,
};

describe('imageBrief', () => {
  it('⚠️ KEEPS THE GUIDE ORDER: SUBJECT, DETAIL, ART, LIGHT, COLOUR, LENS, EXCLUSIONS', () => {
    const prompt = imageBrief(brief);
    const order = [
      brief.subject,
      brief.detail,
      brief.art,
      brief.light,
      brief.colour,
      brief.lens,
      brief.treatment,
      brief.avoid,
    ];
    const indexes = order.map((part) => prompt.indexOf(part));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it('⚠️ PUTS THE SUBJECT BEFORE ANY MENTION OF A PHONE, LIGHT OR EXCLUSION', () => {
    const prompt = imageBrief(brief);
    expect(prompt.startsWith(brief.subject)).toBe(true);
    expect(prompt.indexOf('No people')).toBeGreaterThan(
      prompt.indexOf(brief.light),
    );
  });

  it('closes every clause with exactly one full stop', () => {
    const prompt = imageBrief({ ...brief, detail: 'One animal.  ' });
    expect(prompt).toContain('One animal.');
    expect(prompt).not.toContain('One animal..');
    expect(prompt.endsWith('.')).toBe(true);
  });

  it('omits the treatment when it is absent, rather than leaving a gap', () => {
    const prompt = imageBrief({ ...brief, treatment: undefined });
    expect(prompt).not.toContain(SNAPSHOT_TREATMENT);
    expect(prompt).not.toContain('undefined');
  });
});

describe('the shared exclusions', () => {
  const all = [SCENE_AVOID, SPECIES_AVOID, COURSE_AVOID];

  it('⚠️ EVERY FAMILY BANS PEOPLE AND FIREARMS', () => {
    for (const avoid of all) {
      expect(avoid).toMatch(/no people/i);
      expect(avoid).toMatch(/no firearms/i);
      expect(avoid).toMatch(/no weapons/i);
    }
  });

  it('⚠️ EVERY FAMILY BANS A STUDIO FINISH AND OUR OWN MARKS', () => {
    for (const avoid of all) {
      expect(avoid).toMatch(/no professional studio lighting/i);
      expect(avoid).toMatch(/no colour grading/i);
      expect(avoid).toMatch(/no HDR/i);
      expect(avoid).toMatch(/no text/i);
      expect(avoid).toMatch(/no watermark/i);
    }
  });

  it('⚠️ THE COURSE TAIL STILL BANS A SHOOTER AND ACTION', () => {
    expect(COURSE_AVOID).toMatch(/no shooter/i);
    expect(COURSE_AVOID).toMatch(/no hands/i);
    expect(COURSE_AVOID).toMatch(/no motion or action/i);
  });

  it('⚠️ DROPS THE DEGRADING SNAPSHOT DEMANDS', () => {
    for (const avoid of all) {
      expect(avoid).not.toMatch(
        /motion blur|soft focus|smudged lens|crushed shadows/i,
      );
    }
    expect(SNAPSHOT_TREATMENT).not.toMatch(
      /motion blur|soft focus|smudged lens|crushed shadows/i,
    );
  });
});
