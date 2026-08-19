import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { fieldsFor, requiredKeys } from './motivation-fields';
import {
  nextOwnedSlot,
  remapOwnedSlot,
} from './motivation-extract.service';

// M-A and M-B, from the operator on 2026-08-19:
//   "when applying for a licence a competency can't be pending. User already
//    has to have the certificate."
//   "Remove all the fields that we can get the information off the uploaded
//    documents."
//
// The second one has an edge that matters more than the feature: fewer
// questions must mean WE ALREADY HOLD THE ANSWER, never that we stopped
// asking. So every assertion below about hiding is paired with one about the
// fallback.

const ALL = Object.values(MotivationLicenceType);

describe('a competency can never be pending', () => {
  it('demands the certificate number for every licence type', () => {
    // The number exists nowhere but on the certificate, so requiring it is how
    // possession is enforced. Someone still waiting for competency cannot
    // invent one.
    for (const t of ALL) {
      expect(requiredKeys(t)).toContain('competency_number');
    }
  });

  it('never tells anyone to leave it blank while they wait', () => {
    // The old help said "leave blank if the application is still pending",
    // which described an application SAPS will not accept. Saying WHY a pending
    // competency does not work is the point of the new wording, so the ban is
    // on the instruction, not on the word.
    for (const t of ALL) {
      const f = fieldsFor(t).find((x) => x.key === 'competency_number');
      expect(f).toBeDefined();
      expect(f!.help ?? '').not.toMatch(/leave (it )?blank|optional/i);
    }
  });

  it('says plainly that the certificate has to be in hand', () => {
    const f = fieldsFor(ALL[0]).find((x) => x.key === 'competency_number')!;
    expect(f.help ?? '').toMatch(/certificate/i);
    expect(f.help ?? '').toMatch(/in hand|already have|will not take/i);
  });
});

describe('fields a document answers', () => {
  it('marks the ones extraction actually reads', () => {
    const byKey = new Map(
      fieldsFor(MotivationLicenceType.S16_DEDICATED_HUNTER).map((f) => [
        f.key,
        f,
      ]),
    );
    for (const key of [
      'full_name',
      'id_number',
      'residential_address',
      'competency_number',
      'existing_firearm_1_calibre',
    ]) {
      expect(byKey.get(key)?.docSourced).toBeTruthy();
    }
  });

  it('names a REAL upload kind, so the wizard can say where a value came from', () => {
    const kinds = new Set<string>(Object.values(MotivationUploadKind));
    for (const t of ALL) {
      for (const f of fieldsFor(t)) {
        if (f.docSourced) expect(kinds.has(f.docSourced)).toBe(true);
      }
    }
  });

  it('leaves the narrative questions alone — no document holds those', () => {
    // The things only the applicant knows are the whole remaining form, and
    // collapsing one of them by accident would quietly gut the motivation.
    const byKey = new Map(
      fieldsFor(MotivationLicenceType.S13_SELF_DEFENCE).map((f) => [f.key, f]),
    );
    for (const key of [
      'firearm_fit_reason',
      'safe_storage_detail',
      'occupation',
      'residence_type',
    ]) {
      expect(byKey.get(key)?.docSourced).toBeUndefined();
    }
  });

  it('does not touch what is REQUIRED — hiding is presentation, not a gate', () => {
    // requiredKeys knows nothing about docSourced. A required field with no
    // value still blocks generation and still gets asked.
    for (const t of ALL) {
      const req = requiredKeys(t);
      expect(req).toContain('full_name');
      expect(req).toContain('id_number');
    }
  });

  it('never marks a history question — extraction must never read those', () => {
    for (const t of ALL) {
      for (const f of fieldsFor(t)) {
        if (f.key.startsWith('history_')) {
          expect(f.docSourced).toBeUndefined();
        }
      }
    }
  });
});

describe('a second licence fills a second row', () => {
  it('starts at row 1 when nothing is owned yet', () => {
    expect(nextOwnedSlot({})).toBe(1);
  });

  it('moves to the next free row instead of overwriting the first', () => {
    // THE BUG THIS EXISTS FOR: every CURRENT_LICENCE extraction was written
    // against row 1, so a second uploaded licence either overwrote the first or
    // was dropped as already-answered. Someone with three licensed firearms —
    // exactly the applicant whose overlap needs explaining — ended up arguing
    // the wrong case.
    expect(nextOwnedSlot({ existing_firearm_1_calibre: '.308 Winchester' })).toBe(2);
    expect(
      nextOwnedSlot({
        existing_firearm_1_calibre: '.308 Winchester',
        existing_firearm_2_calibre: '9mm Parabellum',
      }),
    ).toBe(3);
  });

  it('treats a blank calibre as a free row', () => {
    expect(nextOwnedSlot({ existing_firearm_1_calibre: '   ' })).toBe(1);
  });

  it('fills a GAP rather than running past it', () => {
    // Row 1 cleared, row 2 kept: the empty row is the one to write into.
    expect(
      nextOwnedSlot({
        existing_firearm_1_calibre: '',
        existing_firearm_2_calibre: '9mm Parabellum',
      }),
    ).toBe(1);
  });

  it('proposes nothing once all six rows are full', () => {
    const full: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) full[`existing_firearm_${i}_calibre`] = '.22 LR';
    // The registry has no seventh row. Silently overwriting row 6 would be
    // worse than proposing nothing at all.
    expect(nextOwnedSlot(full)).toBeNull();
  });

  it('rewrites every row-1 key onto the row being filled', () => {
    expect(
      remapOwnedSlot(
        ['existing_firearm_1_type', 'existing_firearm_1_licence_no'],
        4,
      ),
    ).toEqual(['existing_firearm_4_type', 'existing_firearm_4_licence_no']);
  });

  it('leaves keys that are not row-scoped alone', () => {
    expect(remapOwnedSlot(['full_name', 'competency_number'], 3)).toEqual([
      'full_name',
      'competency_number',
    ]);
  });
});
