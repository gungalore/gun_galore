import {
  DISCIPLINE_OTHER,
  SHOOTING_DISCIPLINES,
  disciplineByValue,
  disciplinesInScope,
} from './shooting-disciplines';

// ────────────────────────────────────────────────────────────────────
// A DEDICATED HUNTER WAS OFFERED SIX OPTIONS, ALL OF THEM COMPETITIONS.
//
// Operator, item 9 of twelve, 2026-08-24: "Choose a discipline should have
// different physical hunts in as well where applicable."
//
// The `kind` union has always had a 'hunting' member and NOT ONE ROW USED IT:
// 53 entries were 'sport' and 6 were 'both', so disciplinesInScope('hunting')
// returned only the six hunting-BASED shooting competitions — .222/.223 class,
// baanskiet and the like. A dedicated hunter motivating a rifle for plains
// game had nothing on the list that described what they actually do.
// ────────────────────────────────────────────────────────────────────

describe('what a dedicated hunter is offered', () => {
  it('⚠️ includes actual hunting, not only shooting competitions', () => {
    const hunts = disciplinesInScope('hunting').filter(
      (d) => d.group === 'Physical hunting',
    );
    expect(hunts.length).toBeGreaterThanOrEqual(6);
    const labels = hunts.map((h) => h.label.toLowerCase());
    expect(labels.some((l) => l.includes('plains game'))).toBe(true);
    expect(labels.some((l) => l.includes('dangerous game'))).toBe(true);
    expect(labels.some((l) => l.includes('wing'))).toBe(true);
  });

  it('still offers the hunting-based competitions it always did', () => {
    const inScope = disciplinesInScope('hunting');
    expect(
      inScope.some((d) => d.value === 'hunting-rifle-shooting-222-223-class'),
    ).toBe(true);
  });

  it('keeps pure sport disciplines OUT of the hunter scope', () => {
    expect(disciplinesInScope('hunting').every((d) => d.kind !== 'sport')).toBe(
      true,
    );
  });

  it('a sport shooter still sees everything, hunts included', () => {
    const all = disciplinesInScope('all');
    expect(all.length).toBe(SHOOTING_DISCIPLINES.length);
    expect(all.some((d) => d.group === 'Physical hunting')).toBe(true);
  });
});

describe('the registry stays safe to store against', () => {
  it('⚠️ every value is unique — they are stored in signed answers', () => {
    const values = SHOOTING_DISCIPLINES.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('⚠️ no VALUE contains a comma', () => {
    // `discipline` is a multi field and multi answers are stored comma-joined,
    // so a stored token carrying its own comma cannot round-trip: it splits
    // into fragments, none of which is an offered value, and the whole answer
    // is refused on save.
    //
    // ⚠️ VALUES, NOT LABELS, AND THE DIFFERENCE IS THE WHOLE POINT. This test
    // first asserted it of labels and failed on two real entries —
    // "Multi-platform defensive rifle, carbine and shotgun (SADPA)" and
    // "Baanskiet (CHASA) — centrefire, rimfire and hunting handgun". Neither
    // is a bug: allowedValues() resolves an optionSource field to its slugs
    // (motivation-fields.ts:2211), so the label a human reads never reaches the
    // validator. Constraining labels would have made them worse prose for no
    // reason. The constraint belongs on what is actually stored.
    const offenders = SHOOTING_DISCIPLINES.filter((d) => d.value.includes(','));
    expect(offenders.map((d) => d.value)).toEqual([]);
  });

  it('no value collides with the "not on the list" sentinel', () => {
    expect(SHOOTING_DISCIPLINES.some((d) => d.value === DISCIPLINE_OTHER)).toBe(
      false,
    );
  });

  it('every entry carries the paragraph it seeds', () => {
    // `requirement` is prefilled into discipline_requirement, which the
    // applicant signs under. An empty one would seed a blank claim.
    for (const d of SHOOTING_DISCIPLINES) {
      expect(d.requirement.trim().length).toBeGreaterThan(40);
      expect(d.label.trim()).not.toBe('');
      expect(d.group.trim()).not.toBe('');
    }
  });

  it('⚠️ the hunts do not state a calibre minimum as if it were national law', () => {
    // Minimum hunting calibres are set by PROVINCIAL nature conservation
    // ordinances and differ between provinces — the Firearms Control Act sets
    // none. A paragraph the applicant signs must not assert one as settled.
    for (const d of SHOOTING_DISCIPLINES.filter(
      (x) => x.group === 'Physical hunting',
    )) {
      expect(d.requirement).toMatch(/provinc/i);
    }
  });

  it('resolves every value back to its entry', () => {
    for (const d of SHOOTING_DISCIPLINES) {
      expect(disciplineByValue(d.value)?.label).toBe(d.label);
    }
    expect(disciplineByValue('nonsense')).toBeNull();
  });
});
