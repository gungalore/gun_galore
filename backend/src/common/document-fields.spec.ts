import {
  FIELD_ALIASES,
  toMotivationAnswers,
  vaultKeysFor,
  ownedFirearmKey,
} from './document-fields';
import { WANTED } from '../licence-centre/licence-centre-extract.service';

// ────────────────────────────────────────────────────────────────────
// THE REGISTRIES USED TO BE ALLOWED TO DISAGREE. NOW THEY ARE NOT.
//
// Operator, 2026-08-28: "All rules and requests for scanned or uploaded
// documents must apply to both motivation and license centre going forward."
//
// Before this, library-readability.spec.ts asserted the OPPOSITE — that the
// intersection of the two key registries is empty — because that was the
// documented, deliberate state of the world and deriving a readability verdict
// from it had already shipped four bugs. The gap was pinned so nobody would
// mistake it for agreement.
//
// These tests replace the pin with the fix: a mapping that must be TOTAL over
// what the vault reads. A vault key with no entry is a value that silently
// fails to carry, which is the entire bug class.
// ────────────────────────────────────────────────────────────────────

describe('the alias table covers everything the vault reads', () => {
  it('has an entry for every WANTED key of every kind it claims to map', () => {
    const missing: string[] = [];
    for (const kind of Object.keys(FIELD_ALIASES)) {
      const wanted = (WANTED as Record<string, string[]>)[kind];
      // FIELD_ALIASES may describe a kind the vault does not read at all.
      if (!wanted) continue;
      const mapped = new Set(vaultKeysFor(kind));
      for (const key of wanted) {
        if (!mapped.has(key)) missing.push(`${kind}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('never maps a key the vault does not actually ask for', () => {
    // The reverse direction, and it matters just as much: an alias pointing at
    // a vault key that is not in WANTED is dead weight that reads as working.
    const phantom: string[] = [];
    for (const kind of Object.keys(FIELD_ALIASES)) {
      const wanted = (WANTED as Record<string, string[]>)[kind];
      if (!wanted) continue;
      const asked = new Set(wanted);
      for (const key of vaultKeysFor(kind)) {
        if (!asked.has(key)) phantom.push(`${kind}.${key}`);
      }
    }
    expect(phantom).toEqual([]);
  });
});

describe('the values that never used to carry', () => {
  it("carries a competency's endorsements across the covers/competency_for rename", () => {
    // The vault calls it `covers`, the form calls it `competency_for`, and an
    // exact-name match dropped it every single time.
    const out = toMotivationAnswers('COMPETENCY_CERTIFICATE', {
      competency_number: 'C123',
      covers: 'handgun, self-loading rifle',
      holder_name: 'A Person',
    });
    expect(out.competency_for).toBe('handgun, self-loading rifle');
    expect(out.competency_number).toBe('C123');
  });

  it('carries an ID issue date request through to the vault registry', () => {
    // Operator: "The ID document I just uploaded did not recognize the issue
    // date." The vault has to ASK before anything can carry.
    expect(
      (WANTED as Record<string, string[]>).IDENTITY_DOCUMENT,
    ).toContain('issue_date');
  });

  it('asks for the competency issue date, which every expiry derivation needs', () => {
    expect(
      (WANTED as Record<string, string[]>).COMPETENCY_CERTIFICATE,
    ).toContain('competency_issued');
  });
});

describe('a licence fills an owned-firearm row', () => {
  const licence = {
    licence_number: 'L998',
    firearm_type: 'Rifle',
    make: 'CZ',
    calibre: '.308',
    frame_serial: 'F1',
    barrel_serial: 'B1',
    section: 'Section 16',
    holder_name: 'A Person',
  };

  it('writes into the row it is given, not always row 1', () => {
    // ⚠️ THE BUG THIS PREVENTS: every CURRENT_LICENCE extraction used to write
    // to row 1, so a second licence overwrote the first. Somebody with three
    // licensed firearms — exactly the applicant whose overlap needs explaining
    // — ended up with one row.
    const row3 = toMotivationAnswers('FIREARM_LICENCE', licence, 3);
    expect(row3.existing_firearm_3_make).toBe('CZ');
    expect(row3.existing_firearm_3_calibre).toBe('.308');
    expect(row3.existing_firearm_3_licence_no).toBe('L998');
    expect(row3.existing_firearm_1_make).toBeUndefined();
  });

  it('drops values that have no box rather than inventing one', () => {
    const out = toMotivationAnswers('FIREARM_LICENCE', licence, 1);
    // `section` and `holder_name` are mapped to null on purpose — see the
    // table. Landing them somewhere would put a value where nothing asked.
    expect(Object.values(out)).not.toContain('Section 16');
    expect(Object.values(out)).not.toContain('A Person');
  });

  it('skips blanks instead of writing empty strings over real answers', () => {
    const out = toMotivationAnswers(
      'FIREARM_LICENCE',
      { ...licence, barrel_serial: '   ', calibre: '' },
      1,
    );
    expect(out).not.toHaveProperty('existing_firearm_1_barrel_serial');
    expect(out).not.toHaveProperty('existing_firearm_1_calibre');
    expect(out.existing_firearm_1_make).toBe('CZ');
  });

  it('substitutes the row token literally and only where it appears', () => {
    expect(ownedFirearmKey('existing_firearm_{n}_make', 6)).toBe(
      'existing_firearm_6_make',
    );
    expect(ownedFirearmKey('competency_for', 6)).toBe('competency_for');
  });
});
