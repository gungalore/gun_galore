import {
  ASSOCIATIONS,
  exercisesFor,
  firearmFamily,
  resolveAssociation,
  rulebookCandidates,
  rulebooks,
  rulesFor,
} from './association-rules';

describe('the association rulebook index', () => {
  // ⚠️ THE COMPETITION PAGE IS NOT THE LIBRARY. It publishes only the 22
  // numbered exercises; the sport-shooting page carries the whole set, and a
  // pack that lost the shotguns would look complete while covering one family.
  it('carries the handgun, rifle and shotgun families for NHSA', () => {
    const nhsa = rulebooks().nhsa;
    expect(nhsa).toBeDefined();
    const families = new Set(nhsa.exercises.map((e) => e.appliesTo));
    expect(families.has('handgun')).toBe(true);
    expect(families.has('rifle')).toBe(true);
    expect(families.has('shotgun')).toBe(true);
  });

  it('keeps the published rule text rather than a summary', () => {
    const exercise = rulebooks().nhsa.exercises.find((e) => e.code === 'Com21');
    expect(exercise).toBeDefined();
    // The published text names the firearms and the distances.
    expect(exercise!.text).toMatch(/5[,.]56|\.223/);
    expect(exercise!.text).toMatch(/25 metres|50 metres/i);
    expect(exercise!.text.length).toBeGreaterThan(400);
  });

  it('records where every rulebook came from and when', () => {
    for (const book of Object.values(rulebooks())) {
      expect(book.sourceUrl).toMatch(/^https:\/\//);
      expect(book.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(book.exercises.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveAssociation', () => {
  it('resolves the names members actually type', () => {
    expect(resolveAssociation('Natshoot')).toBe('nhsa');
    expect(resolveAssociation('NHSA')).toBe('nhsa');
    expect(resolveAssociation('Natshoot NHSA')).toBe('nhsa');
    expect(resolveAssociation('FOSA')).toBe('fosa');
    expect(resolveAssociation('Firearms Owners South Africa')).toBe('fosa');
  });

  it('returns null for an association we hold no rulebook for', () => {
    expect(resolveAssociation('SA Hunters')).toBeNull();
    expect(resolveAssociation('')).toBeNull();
    expect(resolveAssociation(undefined)).toBeNull();
  });
});

describe('firearmFamily', () => {
  it('maps the sheet vocabulary', () => {
    expect(firearmFamily('Rifle')).toBe('rifle');
    expect(firearmFamily('Shotgun')).toBe('shotgun');
    expect(firearmFamily('Handgun')).toBe('handgun');
    expect(firearmFamily('Combination')).toBe('any');
    expect(firearmFamily(undefined)).toBe('any');
  });
});

describe('exercisesFor', () => {
  it('offers a handgun its exercises and not the rifles', () => {
    const handgun = exercisesFor('nhsa', 'Handgun');
    expect(handgun.length).toBeGreaterThan(10);
    expect(handgun.every((e) => e.appliesTo === 'handgun' || e.appliesTo === 'any')).toBe(true);
    expect(handgun.some((e) => /rifle/i.test(e.title))).toBe(false);
  });

  it('offers a shotgun its own exercises', () => {
    const shotgun = exercisesFor('nhsa', 'Shotgun');
    const pure = shotgun.filter((e) => e.appliesTo === 'shotgun');
    expect(pure.length).toBeGreaterThanOrEqual(3);
    expect(pure.every((e) => /shotgun|clay/i.test(e.title))).toBe(true);
    // A rulebook exercise that fits any firearm may sit beside them.
    expect(
      shotgun.every((e) => e.appliesTo === 'shotgun' || e.appliesTo === 'any'),
    ).toBe(true);
  });

  it('returns nothing rather than throwing for an unknown association', () => {
    expect(exercisesFor('saga', 'Rifle')).toEqual([]);
    expect(exercisesFor(null, 'Rifle')).toEqual([]);
  });
});

describe('rulesFor', () => {
  it('resolves an exercise by its published code', () => {
    const rule = rulesFor('nhsa', 'Com21');
    expect(rule).not.toBeNull();
    expect(rule!.text.length).toBeGreaterThan(400);
    expect(rule!.sourceUrl).toContain('natshoot.co.za');
  });

  it('resolves an exercise by its title', () => {
    const rule = rulesFor('nhsa', 'Shotgun Clay Target Shooting');
    expect(rule).not.toBeNull();
    expect(rule!.text).toMatch(/shotgun/i);
  });

  it('returns null for a code the rulebook does not carry', () => {
    expect(rulesFor('nhsa', 'Com99')).toBeNull();
    expect(rulesFor('saga', 'Com21')).toBeNull();
  });
});

describe('rulebookCandidates', () => {
  it('picks the association and the exercises that fit the firearm', () => {
    const candidates = rulebookCandidates({
      association_name: 'Natshoot',
      firearm_type: 'Shotgun',
    });
    expect(candidates.association).toBe('nhsa');
    expect(candidates.exercises.length).toBeGreaterThanOrEqual(3);
  });

  it('is empty, not broken, before the association is answered', () => {
    expect(rulebookCandidates({ firearm_type: 'Rifle' })).toEqual({
      association: null,
      exercises: [],
    });
  });

  it('lists every association we hold a rulebook for', () => {
    expect(ASSOCIATIONS.map((a) => a.slug)).toEqual(['nhsa', 'fosa']);
  });
});
