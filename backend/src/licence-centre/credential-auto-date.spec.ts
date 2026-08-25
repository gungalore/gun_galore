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

  it('⚠️ refuses anything that is not a firearm licence', () => {
    // The extractor accepts expires_on for every kind, and the CHECK
    // constraint that once stopped a person-document carrying an expiry was
    // dropped in 20260823090100_credential_provenance_guard. So a proof of
    // address can hold a date today — it is simply never armed. Arming it
    // would turn a municipal bill's due date into a notification about a
    // firearm document.
    for (const kind of [
      CredentialKind.ADDRESS_CONFIRMATION,
      CredentialKind.IDENTITY_DOCUMENT,
      CredentialKind.DEDICATED_DISCIPLINE,
      CredentialKind.COMPETENCY_CERTIFICATE,
    ]) {
      expect(mayArmReadExpiry(licence({ kind })).arm).toBe(false);
    }
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
