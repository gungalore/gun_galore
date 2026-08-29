import {
  AnswerProvenance,
  PROVENANCE_SOURCES,
  ProvenanceMap,
  SOURCE_LABELS,
  automaticCount,
  automaticSources,
  changedKeys,
  isAutomatic,
  isProvenanceSource,
  markMember,
  parseProvenance,
  stamp,
} from './answer-provenance';

// ────────────────────────────────────────────────────────────────────
// THE ONE INVARIANT THIS MODULE EXISTS TO HOLD: MEMBER ALWAYS WINS.
//
// Everything else here is bookkeeping. The reason provenance is routed through
// stamp() rather than written directly is that a later automatic pass — a
// second upload, a profile re-sync, the Licence Centre offer applied again —
// must not be able to overwrite a value the member corrected by hand. The
// answer blob and the provenance map are written in the same breath, so a
// caller that got this wrong would silently revert a correction and nothing
// downstream would notice.
// ────────────────────────────────────────────────────────────────────

const AT = new Date('2026-08-28T09:15:00.000Z');

describe('stamp', () => {
  it('records a source, an id, a label and a timestamp', () => {
    const map = stamp({}, ['competency_number'], {
      source: 'VAULT',
      sourceId: 'cred_abc',
      from: 'My competency certificate',
    }, AT);

    expect(map.competency_number).toEqual({
      source: 'VAULT',
      sourceId: 'cred_abc',
      from: 'My competency certificate',
      at: '2026-08-28T09:15:00.000Z',
    });
  });

  it('stamps every key it is given', () => {
    const map = stamp({}, ['a', 'b', 'c'], { source: 'PROFILE', from: 'Your profile' }, AT);
    expect(Object.keys(map).sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the map it was given', () => {
    const before: ProvenanceMap = {};
    const after = stamp(before, ['a'], { source: 'PROFILE', from: 'Your profile' }, AT);
    expect(before).toEqual({});
    expect(after).not.toBe(before);
  });

  it('omits sourceId and inferred rather than writing undefined', () => {
    const map = stamp({}, ['a'], { source: 'PROFILE', from: 'Your profile' }, AT);
    expect('sourceId' in map.a).toBe(false);
    expect('inferred' in map.a).toBe(false);
  });

  it('carries inferred through, for a value that was split rather than read', () => {
    const map = stamp({}, ['firearm_action'], {
      source: 'READ',
      sourceId: 'upl_1',
      from: "Piet's licence card",
      inferred: true,
    }, AT);
    expect(map.firearm_action.inferred).toBe(true);
  });

  it('is a no-op for an empty key list', () => {
    const before: ProvenanceMap = { a: { source: 'PROFILE', from: 'x', at: 'y' } };
    expect(stamp(before, [], { source: 'VAULT', from: 'z' }, AT)).toBe(before);
  });

  // ── the invariant ──────────────────────────────────────────────

  it('REFUSES to overwrite a MEMBER entry with an automatic source', () => {
    const edited = markMember({}, ['firearm_calibre'], AT);
    const later = stamp(edited, ['firearm_calibre'], {
      source: 'READ',
      sourceId: 'upl_2',
      from: 'A second document',
    }, new Date('2026-09-01T00:00:00.000Z'));

    expect(later.firearm_calibre.source).toBe('MEMBER');
    expect(later.firearm_calibre.at).toBe('2026-08-28T09:15:00.000Z');
  });

  it.each(PROVENANCE_SOURCES.filter((s) => s !== 'MEMBER'))(
    'refuses %s over MEMBER',
    (source) => {
      const edited = markMember({}, ['k'], AT);
      const later = stamp(edited, ['k'], { source, from: 'anything' });
      expect(later.k.source).toBe('MEMBER');
    },
  );

  it('still stamps the OTHER keys when one of them is MEMBER-held', () => {
    let map = markMember({}, ['locked'], AT);
    map = stamp(map, ['locked', 'open'], { source: 'VAULT', from: 'My licence' }, AT);

    expect(map.locked.source).toBe('MEMBER');
    expect(map.open.source).toBe('VAULT');
  });

  it('allows MEMBER over MEMBER — that is a member editing twice', () => {
    const first = markMember({}, ['k'], AT);
    const second = markMember(first, ['k'], new Date('2026-09-01T00:00:00.000Z'));
    expect(second.k.at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('allows one automatic source to replace another', () => {
    const fromVault = stamp({}, ['k'], { source: 'VAULT', from: 'Old document' }, AT);
    const fromRead = stamp(fromVault, ['k'], {
      source: 'READ',
      sourceId: 'upl_9',
      from: 'The card you just photographed',
    }, AT);
    expect(fromRead.k.source).toBe('READ');
    expect(fromRead.k.sourceId).toBe('upl_9');
  });
});

describe('changedKeys', () => {
  it('reports only the keys whose value actually differs', () => {
    const before = { a: '1', b: '2', c: '3' };
    const after = { a: '1', b: 'CHANGED', c: '3' };
    expect(changedKeys(before, after)).toEqual(['b']);
  });

  it('counts a newly supplied key as changed', () => {
    expect(changedKeys({}, { a: 'x' })).toEqual(['a']);
  });

  it('counts a CLEARED key as changed — deleting a prefill is a decision', () => {
    expect(changedKeys({ a: 'x' }, { a: '' })).toEqual(['a']);
  });

  it('ignores keys absent from the incoming payload', () => {
    // The wizard sends one step at a time; the other steps are not "unchanged
    // to empty", they are simply not in this request.
    expect(changedKeys({ a: 'x', b: 'y' }, { a: 'x' })).toEqual([]);
  });

  it('is what stops a bare Continue from flipping a whole step to MEMBER', () => {
    const prefilled = { surname: 'Fourie', initials: 'G J P', id_number: '8905…' };
    const resubmitted = { ...prefilled };
    const map = markMember(
      stamp({}, Object.keys(prefilled), { source: 'PROFILE', from: 'Your profile' }, AT),
      changedKeys(prefilled, resubmitted),
      AT,
    );
    expect(automaticCount(map)).toBe(3);
  });
});

describe('parseProvenance', () => {
  it('round-trips a written map', () => {
    const map = stamp({}, ['a'], { source: 'VAULT', sourceId: 'c1', from: 'My licence' }, AT);
    expect(parseProvenance(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });

  it('accepts a Json string as well as parsed Json', () => {
    const map = stamp({}, ['a'], { source: 'PROFILE', from: 'Your profile' }, AT);
    expect(parseProvenance(JSON.stringify(map))).toEqual(map);
  });

  it('reads a null column as UNKNOWN, not as MEMBER', () => {
    // Every motivation that predates this feature has null here. Defaulting
    // those to MEMBER would be the system claiming the member typed values it
    // filled in itself.
    expect(parseProvenance(null)).toEqual({});
    expect(parseProvenance(undefined)).toEqual({});
  });

  it.each([
    ['an array', []],
    ['a number', 7],
    ['unparsable text', '{not json'],
    ['a bare string', 'PROFILE'],
  ])('reads %s as empty rather than throwing', (_label, raw) => {
    expect(parseProvenance(raw)).toEqual({});
  });

  it('drops entries with an unknown source and keeps the rest', () => {
    const parsed = parseProvenance({
      good: { source: 'VAULT', from: 'My licence', at: AT.toISOString() },
      future: { source: 'SOME_SOURCE_WE_ADD_LATER', from: 'x', at: AT.toISOString() },
    });
    expect(Object.keys(parsed)).toEqual(['good']);
  });

  it.each([
    ['no from', { source: 'VAULT', at: '2026-01-01' }],
    ['no at', { source: 'VAULT', from: 'x' }],
    ['a non-string from', { source: 'VAULT', from: 7, at: '2026-01-01' }],
    ['null', null],
  ])('drops a malformed entry (%s)', (_label, entry) => {
    expect(parseProvenance({ k: entry })).toEqual({});
  });

  it('drops a non-string sourceId rather than carrying it', () => {
    const parsed = parseProvenance({
      k: { source: 'VAULT', from: 'x', at: '2026-01-01', sourceId: 12 },
    });
    expect(parsed.k).toEqual({ source: 'VAULT', from: 'x', at: '2026-01-01' });
  });

  it('normalises a truthy-but-not-true inferred to absent', () => {
    const parsed = parseProvenance({
      k: { source: 'READ', from: 'x', at: '2026-01-01', inferred: 'yes' },
    });
    expect('inferred' in parsed.k).toBe(false);
  });

  it('never carries a value through, even when one is present in the column', () => {
    // Nothing writes a value today. This asserts that a future writer that
    // tried could not get one past the reader.
    const parsed = parseProvenance({
      id_number: {
        source: 'PROFILE',
        from: 'Your profile',
        at: '2026-01-01',
        value: '8905125220089',
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('8905125220089');
    expect(Object.keys(parsed.id_number).sort()).toEqual(['at', 'from', 'source']);
  });
});

describe('counting, for the banner', () => {
  const filled: ProvenanceMap = {
    a: { source: 'PROFILE', from: 'Your profile', at: AT.toISOString() },
    b: { source: 'VAULT', from: 'My licence', at: AT.toISOString() },
    c: { source: 'VAULT', from: 'My competency', at: AT.toISOString() },
    d: { source: 'MEMBER', from: SOURCE_LABELS.MEMBER, at: AT.toISOString() },
  };

  it('counts what we filled and not what the member typed', () => {
    expect(automaticCount(filled)).toBe(3);
  });

  it('does not count a prefilled answer the member has since cleared', () => {
    expect(automaticCount(filled, { a: 'x', b: '', c: 'y', d: 'z' })).toBe(2);
  });

  it('counts everything when no answers are supplied to check against', () => {
    expect(automaticCount(filled, {})).toBe(3);
  });

  it('lists the sources behind the fills, most-used first', () => {
    expect(automaticSources(filled)).toEqual(['VAULT', 'PROFILE']);
  });

  it('lists no sources for a map with nothing automatic in it', () => {
    expect(automaticSources({ d: filled.d })).toEqual([]);
  });
});

describe('the source list itself', () => {
  it('labels every source', () => {
    for (const source of PROVENANCE_SOURCES) {
      expect(SOURCE_LABELS[source]).toBeTruthy();
    }
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([...PROVENANCE_SOURCES].sort());
  });

  it('treats every source except MEMBER as automatic', () => {
    for (const source of PROVENANCE_SOURCES) {
      expect(isAutomatic(source)).toBe(source !== 'MEMBER');
    }
  });

  it('guards the persisted strings', () => {
    expect(isProvenanceSource('VAULT')).toBe(true);
    expect(isProvenanceSource('vault')).toBe(false);
    expect(isProvenanceSource('')).toBe(false);
    expect(isProvenanceSource(null)).toBe(false);
  });

  it('holds a stable shape for a written entry', () => {
    // These keys are persisted. A rename is a migration, not an edit.
    const entry: AnswerProvenance = {
      source: 'VAULT',
      sourceId: 'c1',
      from: 'My licence',
      at: AT.toISOString(),
      inferred: true,
    };
    expect(Object.keys(entry).sort()).toEqual(['at', 'from', 'inferred', 'source', 'sourceId']);
  });
});
