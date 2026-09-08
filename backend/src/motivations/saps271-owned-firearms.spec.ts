import { MotivationLicenceType } from '@prisma/client';
import { buildSaps271 } from './saps271-map';
import { SAPS271_COORDS, type Saps271FieldName } from './saps271-coords';
import { OWNED_ROWS, SAPS271_FILL, SAPS271_OPT_KEY } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// ITEM 2.1 — THE FIREARMS THE APPLICANT ALREADY OWNS.
//
// Two failures live here, and both reached a form somebody signs.
//
//   EVERY SERIAL BOX WENT BLANK, IN SILENCE. The registry collapsed its two
//   serial questions into one `existing_firearm_N_serial` on 2026-09-07 and
//   this map went on printing `_barrel_serial` / `_frame_serial`. put() drops
//   an empty value without a word, so an applicant would have signed and filed
//   a 271 listing firearms with no serial numbers — and the panel that tells
//   them which boxes still need a pen said nothing either.
//
//   ROWS 7 TO 14 COULD NOT BE PRINTED AT ALL. The paper form is fourteen rows;
//   the map looped to six and the coordinate map stopped at six. Operator,
//   2026-09-07: "all fire arms the applicant owns must be in that list." A
//   member with ten licences had four of them collected, stored, argued about
//   by the overlap check — and printed nowhere.
//
// ⚠️ FOURTEEN IS MEASURED, NOT ASSUMED. scripts/saps271-measure.mjs walks the
// form's own ruling lines; asking it for a fifteenth row answers with "Type"
// p5 has no row 14. That is why these tests read OWNED_ROWS rather than a
// literal — the registry and the paper have to agree, and this file is where
// the two meet.
// ────────────────────────────────────────────────────────────────────

const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;

const build = (answers: Record<string, string>) =>
  buildSaps271({
    licenceType: S16,
    answers: { [SAPS271_OPT_KEY]: SAPS271_FILL, ...answers },
  });

const row = (n: number, over: Record<string, string> = {}) => ({
  [`existing_firearm_${n}_type`]: 'Rifle',
  [`existing_firearm_${n}_calibre`]: '.308 Winchester',
  [`existing_firearm_${n}_make`]: 'CZ',
  [`existing_firearm_${n}_model`]: '550',
  [`existing_firearm_${n}_serial`]: `SER${n}`,
  [`existing_firearm_${n}_expiry`]: '2031-04-30',
  [`existing_firearm_${n}_licence_no`]: `40091178${n}`,
  ...over,
});

const has = (name: string) => name in SAPS271_COORDS;

describe('the coordinate map covers every row the registry offers', () => {
  it('has all six columns for every one of them', () => {
    // ⚠️ THIS IS THE CONTRACT BETWEEN THE REGISTRY AND THE PAPER. A row the
    // wizard collects and the map cannot place is a firearm the member
    // answered for that nobody will ever read.
    const missing: string[] = [];
    for (let n = 1; n <= OWNED_ROWS; n++) {
      for (const col of [
        'type',
        'calibre',
        'make',
        'barrel_serial',
        'frame_serial',
        'licence',
      ]) {
        if (!has(`g_owned_${n}_${col}`)) missing.push(`g_owned_${n}_${col}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('does not carry a row the registry does not offer', () => {
    // The other direction: a coordinate for a row nobody can fill is a box
    // that stays blank on every form, and it would hide a registry that had
    // quietly shrunk.
    expect(has(`g_owned_${OWNED_ROWS + 1}_type`)).toBe(false);
  });

  it('runs down page 5 in order, never overlapping', () => {
    // Measured rows, so they descend without a gap or a doubling. A row
    // measured onto the wrong band prints one firearm's details over
    // another's — invisible in a diff, obvious to a DFO.
    let previousBottom = Infinity;
    for (let n = 1; n <= OWNED_ROWS; n++) {
      const box = SAPS271_COORDS[`g_owned_${n}_type` as Saps271FieldName] as {
        page: number;
        y: number;
        h: number;
      };
      expect(box.page).toBe(5);
      expect(box.y + box.h).toBeLessThanOrEqual(previousBottom + 0.5);
      previousBottom = box.y;
    }
  });
});

describe('what item 2.1 prints', () => {
  it('prints the serial from the one question the registry now asks', () => {
    // ⚠️ THE BLOCKER. This printed no serial at all once the registry
    // collapsed the two keys the map was still reading.
    const v = build(row(1));
    expect(v.text.g_owned_1_frame_serial).toBe('SER1');
  });

  it('reads a draft written before the two serial boxes collapsed', () => {
    // A blob saved before 2026-09-07 holds `_barrel_serial` and no `_serial`.
    // It still has to print, or reopening an old application loses a serial
    // the member already gave us.
    const v = build({
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_barrel_serial: 'OLD123',
    });
    expect(v.text.g_owned_1_frame_serial).toBe('OLD123');
  });

  it('prints a correction over the retired key it replaced', () => {
    // ⚠️ THE STALE-SERIAL TRAP. The member opens an old draft, sees an empty
    // "Serial number" box because the legacy key is no longer rendered, and
    // types the RIGHT number into `_serial`. Reading `_barrel_serial` first
    // would print the number they had just corrected.
    const v = build({
      existing_firearm_1_make: 'CZ',
      existing_firearm_1_barrel_serial: 'OLD123',
      existing_firearm_1_serial: 'FIXED456',
    });
    expect(v.text.g_owned_1_frame_serial).toBe('FIXED456');
  });

  it('⚠️ PRINTS THE CARD\u2019S "NONE" IN THE COLUMN THE CARD PUT IT IN', () => {
    // Operator, 2026-09-08: "we need to insert NONE if the barrel serial said
    // NONE. DO NOT LEAVE A NONE BLANK EVER unless I tell you to."
    //
    // NONE against the frame is the card being COMPLETE about a component that
    // carries no number — it is not an empty box, and a DFO comparing the form
    // against the card must find the same word in the same place. Blanking it
    // makes the form say less than the licence does; moving the barrel's
    // number into it makes the form say something false.
    const v = build({
      existing_firearm_1_make: 'Glock',
      existing_firearm_1_frame_serial: 'NONE',
      existing_firearm_1_barrel_serial: 'ZABA01892',
    });
    expect(v.text.g_owned_1_frame_serial).toBe('NONE');
    expect(v.text.g_owned_1_barrel_serial).toBe('ZABA01892');
  });

  it('⚠️ FILLS BOTH SERIAL COLUMNS, AND SAYS WHERE THE SECOND ONE CAME FROM', () => {
    // This left the barrel column blank on the reasoning that one answer must
    // not become two assertions. Operator, 2026-09-08, who fills these forms:
    // "we only need to fill in the first 5 fields." A South African licence
    // card prints the SAME number against the barrel, the frame and the
    // receiver in the ordinary case, and an empty box the applicant would fill
    // with a pen is work handed back to them, not caution.
    //
    // It is still said out loud, because the applicant is signing it.
    const v = build(row(1));
    expect(v.text.g_owned_1_barrel_serial).toBe('SER1');
    expect(v.text.g_owned_1_frame_serial).toBe('SER1');
    expect(v.leftBlank).toContainEqual({
      field: 'saps271_item_2.1_barrel_serial',
      because: expect.stringContaining('check it against the card'),
    });
  });

  it('⚠️ AND SAYS NOTHING WHEN THE CARD GAVE US BOTH COLUMNS ITSELF', () => {
    // Nothing was assumed, so there is nothing to check. The note exists to
    // disclose a duplication, not to decorate a table that came off a card.
    const v = build({
      ...row(1),
      existing_firearm_1_barrel_serial: 'BAR1',
      existing_firearm_1_frame_serial: 'FRM1',
    });
    expect(v.text.g_owned_1_barrel_serial).toBe('BAR1');
    expect(v.text.g_owned_1_frame_serial).toBe('FRM1');
    expect(v.leftBlank.map((b) => b.field)).not.toContain(
      'saps271_item_2.1_barrel_serial',
    );
  });

  it('says nothing about the barrel column when no firearm is listed', () => {
    // A first applicant owns nothing. A note about a table they never fill in
    // is noise on the one panel that has to stay worth reading.
    const v = build({});
    expect(v.leftBlank.map((b) => b.field)).not.toContain(
      'saps271_item_2.1_barrel_serial',
    );
  });

  it('reports a listed firearm that has no serial yet', () => {
    // put() drops an empty in silence, which is how every serial box on this
    // table went blank without anyone knowing. The row is counted and named.
    const v = build({
      ...row(1),
      ...row(2),
      existing_firearm_2_serial: '',
    });
    const said = v.leftBlank.find(
      (b) => b.field === 'saps271_item_2.1_frame_serial',
    );
    expect(said?.because).toMatch(/^one of the firearms/);
  });

  it('counts a row as unused when only the columns this table cannot print are filled', () => {
    // `use`, `model` and `expiry` are real answers with nowhere on the form to
    // go. A row holding only those must not be reported as a firearm missing
    // its serial — the form never shows that row at all.
    const v = build({
      existing_firearm_1_use: 'Bushveld plains game',
      existing_firearm_1_model: '550',
      existing_firearm_1_expiry: '2031-04-30',
    });
    const said = v.leftBlank.map((b) => b.field);
    expect(said).not.toContain('saps271_item_2.1_frame_serial');
    expect(said).not.toContain('saps271_item_2.1_barrel_serial');
  });

  it('prints the fourteenth firearm, not just the sixth', () => {
    // ⚠️ THE SECOND BLOCKER. Operator, 2026-09-07: "all fire arms the
    // applicant owns must be in that list."
    let answers: Record<string, string> = {};
    for (let n = 1; n <= OWNED_ROWS; n++) answers = { ...answers, ...row(n) };
    const v = build(answers);

    for (let n = 1; n <= OWNED_ROWS; n++) {
      expect(v.text[`g_owned_${n}_frame_serial` as Saps271FieldName]).toBe(
        `SER${n}`,
      );
      expect(v.text[`g_owned_${n}_make` as Saps271FieldName]).toBe('CZ');
      expect(v.text[`g_owned_${n}_licence` as Saps271FieldName]).toBe(
        `40091178${n}`,
      );
    }
  });

  it('has nowhere to print the model or the expiry, and invents nowhere', () => {
    // ⚠️ THE FORM'S OWN COLUMNS ARE Type | Calibre | Make | Barrel Serial No |
    // Frame/receiver Serial No | Licence/permit authorization No. `model` and
    // `expiry` belong to the LISTING; writing them into the margin of a signed
    // form is not ours to do. Pinned so nobody adds them later on the
    // assumption that a box was simply missed.
    expect(has('g_owned_1_model')).toBe(false);
    expect(has('g_owned_1_expiry')).toBe(false);

    const v = build(row(1));
    expect(Object.values(v.text)).not.toContain('2031-04-30');
    // The model is not printed on its own, and it is not smuggled into Make.
    expect(v.text.g_owned_1_make).toBe('CZ');
  });
});
