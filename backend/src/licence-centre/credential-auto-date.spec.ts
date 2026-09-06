import { CredentialKind } from '@prisma/client';
import { mayArmDerivedExpiry, mayArmReadExpiry } from './credential-auto-date';

// ────────────────────────────────────────────────────────────────────
// THE HUMAN WE REMOVED.
//
// Operator, 2026-08-25: "insert it. No further user interaction required."
// Until now a member had to look at every date before anything reminded on
// it — which is why a licence uploaded and never revisited reminded on
// nothing. That step was also the only thing between an OCR misreading and an
// SMS telling somebody a fact about their own firearm licence.
//
// Every test below is a reading that is plausible and wrong. Failing the
// guard does not hide the date — it is still written and still shown. It only
// withholds the automatic part, so the row keeps asking, exactly as before.
// ────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-25T00:00:00Z');

const licence = (over: Record<string, unknown> = {}) => ({
  kind: CredentialKind.FIREARM_LICENCE,
  coversKinds: [] as CredentialKind[],
  // A real s16 licence: ten years, issued 2025-09-22.
  issuedOn: '2025-09-22',
  expiresOn: '2035-09-21',
  section: 'S16',
  lowConfidence: [] as string[],
  now: NOW,
  ...over,
});

describe('arming a date we read off a document', () => {
  it('arms a clean, corroborated licence date', () => {
    expect(mayArmReadExpiry(licence()).arm).toBe(true);
  });

  it('⚠️ refuses a date the model itself was unsure of', () => {
    // The whole signal. And it was discarded until today: the parser's date
    // branch returned before the confidence was captured, so lowConfidence
    // could never contain expires_on — the one field where it matters most.
    expect(
      mayArmReadExpiry(licence({ lowConfidence: ['expires_on'] })).arm,
    ).toBe(false);
  });

  it('⚠️ refuses a misread YEAR, which nothing else here would catch', () => {
    // This is the failure the term check exists for. A ten-year s16 licence
    // issued 2025-09-22 expires 2035; a model reading "2030" off a smudged
    // card produces a date that is plausible, in the future, after the issue
    // date, and within every other bound on this page. The member would be
    // reminded five years early — or, with the digits the other way, five
    // years after the licence had lapsed.
    expect(
      mayArmReadExpiry(licence({ expiresOn: '2030-09-21' })).arm,
    ).toBe(false);
  });

  it('accepts the term being a little out, because printing is', () => {
    expect(mayArmReadExpiry(licence({ expiresOn: '2035-08-01' })).arm).toBe(true);
  });

  it('⚠️ refuses when there is no section to check the term against', () => {
    // A deliberate cost. The alternative is arming a date nothing corroborates.
    expect(mayArmReadExpiry(licence({ section: null })).arm).toBe(false);
    expect(mayArmReadExpiry(licence({ issuedOn: null })).arm).toBe(false);
  });

  it('⚠️ refuses a kind that is not on the allowlist', () => {
    // The extractor accepts expires_on for every kind, and the CHECK
    // constraint that once stopped a person-document carrying an expiry was
    // dropped in 20260823090100_credential_provenance_guard. So a proof of
    // address can hold a date today — it is simply never armed. Arming it
    // would turn a municipal bill's due date into a notification about a
    // firearm document.
    for (const kind of [
      CredentialKind.ADDRESS_CONFIRMATION,
      CredentialKind.EMPLOYMENT_CONFIRMATION,
      CredentialKind.SAFE_PHOTOGRAPHS,
      CredentialKind.OTHER,
    ]) {
      expect(mayArmReadExpiry(licence({ kind })).arm).toBe(false);
    }
  });

  it('⚠️ NEVER arms the three kinds whose printed date is not an expiry', () => {
    // A competency prints no expiry at all (§5.2) — its date is DERIVED, which
    // is mayArmDerivedExpiry's job — and a proficiency and an ID document do
    // not run out. Anything a reader finds on one of these is another
    // document's date or a misread, so arming it means reminding somebody
    // about a deadline that does not exist.
    for (const kind of [
      CredentialKind.COMPETENCY_CERTIFICATE,
      CredentialKind.PROFICIENCY,
      CredentialKind.IDENTITY_DOCUMENT,
    ]) {
      expect(mayArmReadExpiry(licence({ kind })).arm).toBe(false);
    }
  });

  // 🚨 DEDICATED STATUS WAS REFUSED, AND IT IS THE ONE DOCUMENT BESIDES A
  // LICENCE THAT BOTH PRINTS A REAL EXPIRY AND COSTS A FIREARM WHEN MISSED.
  // Dedicated hunter / dedicated sport shooter is a standing condition of a
  // section 16 licence: let it lapse and the licence behind it goes with it.
  // It could never fire a reminder unless the member went back and ticked a
  // box — the precise failure the operator's "insert it, no further user
  // interaction required" was aimed at.
  describe('a dedicated-status certificate', () => {
    const status = (over: Record<string, unknown> = {}) =>
      licence({
        kind: CredentialKind.DEDICATED_DISCIPLINE,
        // An association sets its own period — usually a year — and prints no
        // statutory section, so there is no term table to check against.
        section: null,
        issuedOn: '2026-03-01',
        expiresOn: '2027-02-28',
        ...over,
      });

    it('arms a confidently-read expiry', () => {
      expect(mayArmReadExpiry(status()).arm).toBe(true);
    });

    it('arms one with no issue date, because there is no term to check', () => {
      // ⚠️ THE SECTION CROSS-CHECK IS A LICENCE-ONLY TEST. Requiring it here
      // would refuse every dedicated status ever filed, silently — which is
      // the state this change ends.
      expect(mayArmReadExpiry(status({ issuedOn: null })).arm).toBe(true);
    });

    it('still refuses when the reader was unsure', () => {
      expect(
        mayArmReadExpiry(status({ lowConfidence: ['expires_on'] })).arm,
      ).toBe(false);
    });

    it('still refuses a date already past, or one wildly out', () => {
      expect(mayArmReadExpiry(status({ expiresOn: '2019-02-28' })).arm).toBe(
        false,
      );
      expect(mayArmReadExpiry(status({ expiresOn: '2060-02-28' })).arm).toBe(
        false,
      );
    });

    it('still refuses one document doing several jobs', () => {
      // An association pack carries a membership validity, a dedicated-status
      // validity and a good-standing date on one page.
      expect(
        mayArmReadExpiry(
          status({ coversKinds: [CredentialKind.DEDICATED_DISCIPLINE] }),
        ).arm,
      ).toBe(false);
    });

    it('covers the two retired dedicated kinds too', () => {
      // Rows filed before the 2026-08-20 consolidation still carry them, and a
      // document that would be armed today should not go unarmed because of
      // when it happened to be filed.
      for (const kind of [
        CredentialKind.DEDICATED_HUNTER,
        CredentialKind.DEDICATED_STATUS,
      ]) {
        expect(mayArmReadExpiry(status({ kind })).arm).toBe(true);
      }
    });
  });

  // 🚨 THE TEXTRACT READER'S OWN VERDICT WAS COMPUTED AND DISCARDED. It knows
  // when a material field scored under the floor or a field the kind cannot do
  // without came back empty; read() dropped it, so this guard was left
  // checking a `lowConfidence` list that on that path can never name a date —
  // `expiresOn` is its own field, never a key in `details`.
  it('⚠️ obeys the reader when it says NOT auto-fillable', () => {
    expect(mayArmReadExpiry(licence({ autoFillable: false })).arm).toBe(false);
  });

  it('treats a missing verdict as no opinion, not as a refusal', () => {
    // The Claude path expresses none — per-field confidence is all it has —
    // and turning silence into a veto would disarm every document it reads.
    expect(mayArmReadExpiry(licence({ autoFillable: undefined })).arm).toBe(true);
    expect(mayArmReadExpiry(licence({ autoFillable: true })).arm).toBe(true);
  });

  it('⚠️ refuses a document doing more than one job', () => {
    // An association pack prints a membership validity, a dedicated-status
    // validity and a good-standing date, and we never record which row a date
    // came off. The extract prompt tells the model there is "ONE validity
    // date" for such a document — an instruction, not a fact about the paper.
    expect(
      mayArmReadExpiry(
        licence({ coversKinds: [CredentialKind.DEDICATED_DISCIPLINE] }),
      ).arm,
    ).toBe(false);
  });

  it('⚠️ refuses a date already in the past', () => {
    // The reminder ladder's last stage fires on anything at or past its
    // expiry, so arming one that lapsed in 2019 sends a notice about it
    // tonight. A past date is exactly where a member should be asked.
    expect(
      mayArmReadExpiry(
        licence({ issuedOn: '2014-09-22', expiresOn: '2024-09-21' }),
      ).arm,
    ).toBe(false);
  });

  it('refuses an expiry before its own issue date', () => {
    expect(
      mayArmReadExpiry(licence({ expiresOn: '2025-01-01' })).arm,
    ).toBe(false);
  });

  it('refuses a term longer than any licence runs', () => {
    // Section 27 tops out at ten years.
    expect(
      mayArmReadExpiry(licence({ expiresOn: '2060-09-21', section: 'S16' })).arm,
    ).toBe(false);
  });

  it('refuses an unreadable date rather than guessing', () => {
    expect(mayArmReadExpiry(licence({ expiresOn: 'March 2035' })).arm).toBe(false);
    expect(mayArmReadExpiry(licence({ expiresOn: null })).arm).toBe(false);
  });

  it('⚠️ reads the section however the card writes it', () => {
    // ⚠️ WITHOUT THIS, NOTHING IS EVER ARMED. The extractor asks for `section`
    // with no format instruction, so the model returns what the card says.
    // The term table is keyed 'S16'. A raw lookup misses on every one of these
    // but the bare 'S16', the term check finds nothing to compare against, and
    // the guard refuses — silently, on every licence, with the member seeing a
    // filled-in date and no reminder and no explanation.
    for (const written of ['S16', 'Section 16', 'section 16(1)', '16', 'SEC. 16']) {
      expect(
        mayArmReadExpiry(licence({ section: written })).arm,
      ).toBe(true);
    }
  });

  it('⚠️ refuses section 20, because the number does not say the term', () => {
    // Business purposes runs ten years for a game rancher or a hunting
    // business and five for everything else. Guessing is a five-year error
    // whichever way it goes, so it is left for the member.
    expect(mayArmReadExpiry(licence({ section: '20' })).arm).toBe(false);
    expect(mayArmReadExpiry(licence({ section: 'Section 20' })).arm).toBe(false);
  });

  it('tells s16 from s16A', () => {
    // Both ten years, so the arming outcome matches — but they are different
    // licences and the distinction must survive the parse.
    expect(mayArmReadExpiry(licence({ section: 'S16A' })).arm).toBe(true);
    expect(mayArmReadExpiry(licence({ section: 'Section 16A' })).arm).toBe(true);
  });

  it('gets an s13 five-year term right too', () => {
    expect(
      mayArmReadExpiry(
        licence({ section: 'S13', issuedOn: '2025-09-22', expiresOn: '2030-09-21' }),
      ).arm,
    ).toBe(true);
    // Ten years under a five-year section is the same misread, inverted.
    expect(
      mayArmReadExpiry(
        licence({ section: 'S13', issuedOn: '2025-09-22', expiresOn: '2035-09-21' }),
      ).arm,
    ).toBe(false);
  });
});

describe('arming a date we derived', () => {
  it('arms one inherited from a real licence', () => {
    expect(mayArmDerivedExpiry('licence').arm).toBe(true);
  });

  it('arms the statutory muzzle-loader period', () => {
    // s10(3) fixes ten years. That is a fact, not an assumption.
    expect(mayArmDerivedExpiry('statute').arm).toBe(true);
  });

  it('⚠️ NEVER arms the five-year no-licence assumption', () => {
    // It is the REPEALED s10(2), applied from habit where the current rule has
    // nothing to bite on. The reference instructs it must "never be presented
    // to a user as the legal position", and a countdown notification is the
    // loudest way to present something. It is still shown and still explained
    // — it just asks rather than tells.
    expect(mayArmDerivedExpiry('fallback').arm).toBe(false);
    expect(mayArmDerivedExpiry('unknown').arm).toBe(false);
  });
});
