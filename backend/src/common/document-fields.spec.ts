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

describe('the association document', () => {
  const card = {
    association: 'SA Hunters',
    status_number: 'SA115153SS',
    joined_on: '2015-02-01',
    status_type: 'dedicated hunter',
    holder_name: 'A Person',
  };

  it('⚠️ carries joined_on to the JOIN box, never to dedicated_since', () => {
    // This alias used to read `{ vault: 'joined_on', motivation:
    // 'dedicated_since' }`, and `dedicated_since` is labelled "Dedicated
    // status held since". They are different facts, and for a SAHGCA or NARFO
    // member routinely different years: you join, and then you qualify. The
    // second is also what deriveFacts counts `years_dedicated` from, so the
    // old alias did not merely mislabel a box — it fed the motivation's own
    // argument the wrong number.
    const out = toMotivationAnswers('DEDICATED_DISCIPLINE', card);
    expect(out.association_joined).toBe('2015-02-01');
    expect(out.dedicated_since).toBeUndefined();
  });

  it('gives status_type NO box, deliberately — it decides, it does not fill', () => {
    // It is the only genuine record of WHICH dedicated status a document
    // awards. `Credential.disciplineType` looks like that column and is not:
    // the 2026-08-20 backfill wrote CredentialKind names into it and the only
    // live writer writes MotivationUploadKind names. dedicatedStatusFits in
    // motivations/motivation-credentials.ts reads status_type to keep a
    // dedicated hunter's papers out of a dedicated sport shooter's
    // application.
    const out = toMotivationAnswers('DEDICATED_DISCIPLINE', card);
    expect(Object.values(out)).not.toContain('dedicated hunter');
    const alias = FIELD_ALIASES.DEDICATED_DISCIPLINE.find(
      (a) => a.vault === 'status_type',
    );
    expect(alias).toBeDefined();
    expect(alias!.motivation).toBeNull();
  });

  it('⚠️ has no alias for the "valid until" date, and must not grow one', () => {
    // It is not a detail. The letter of good standing's expiry travels on the
    // vault's `expires_on` channel and lands in the Credential.expiresOn
    // COLUMN, which is what the renewal sweep reads and what credentialOffer
    // reads for `association_expiry`. A details key for the same date would
    // give one document two expiries free to disagree.
    for (const a of FIELD_ALIASES.DEDICATED_DISCIPLINE) {
      expect(a.motivation).not.toBe('association_expiry');
    }
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

  it('⚠️ never carries a card placeholder into a box the applicant signs', () => {
    // ⚠️ THIS BOUNDARY IS NOT REACHED IN PRODUCTION TODAY — see the note on
    // toMotivationAnswers. The live carry is credentialOffer(), and that is
    // where the operator's "Firearm 6 — frame serial NONE · barrel serial
    // NONE" actually came from and where it is actually fixed. This pins the
    // rule for the day the module is wired, and states the rule the mapping
    // must obey: a licence card prints NONE in a row that does not apply — the
    // operator's own Marlin reads "Frame Serial No NONE" — and a NONE that
    // crosses into `answers` is a false statement on a SAPS 271, which section
    // 120(9)(f) of the Act makes an offence.
    //
    // The card is still stored verbatim; see common/card-placeholder.ts for
    // why the rule belongs at ANSWER boundaries and nowhere upstream of them.
    const out = toMotivationAnswers(
      'FIREARM_LICENCE',
      {
        ...licence,
        frame_serial: 'NONE',
        barrel_serial: 'N/A',
        calibre: '-',
      },
      6,
    );
    expect(out).not.toHaveProperty('existing_firearm_6_frame_serial');
    expect(out).not.toHaveProperty('existing_firearm_6_barrel_serial');
    expect(out).not.toHaveProperty('existing_firearm_6_calibre');
    // The rest of the card is untouched — a placeholder in one row says
    // nothing about the next.
    expect(out.existing_firearm_6_make).toBe('CZ');
    expect(out.existing_firearm_6_licence_no).toBe('L998');
  });

  it('keeps a real value that merely contains the word', () => {
    // The test is anchored, so a rifle whose model genuinely reads "None
    // Series" keeps it, and so does the serial NA1234. A rule that ate those
    // would be deleting a fact off somebody's licence.
    const out = toMotivationAnswers(
      'FIREARM_LICENCE',
      { ...licence, make: 'None Series', frame_serial: 'NA1234' },
      1,
    );
    expect(out.existing_firearm_1_make).toBe('None Series');
    expect(out.existing_firearm_1_frame_serial).toBe('NA1234');
  });

  it('substitutes the row token literally and only where it appears', () => {
    expect(ownedFirearmKey('existing_firearm_{n}_make', 6)).toBe(
      'existing_firearm_6_make',
    );
    expect(ownedFirearmKey('competency_for', 6)).toBe('competency_for');
  });
});
