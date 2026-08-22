import {
  VaultConsentFields,
  mayKeep,
  mayOfferAcrossApplications,
  mustAsk,
  vaultConsentState,
} from './vault-consent';
import { VAULT_CONSENT_VERSION } from './vault-consent-version';

// The gate that decides whether we may keep somebody's ID copy and the
// photographs of their gun safe past the application they attached them to.
// It is a comparison rather than a null check, and every one of the five
// states below exists because a bare timestamp could not express it.

const at = new Date('2026-08-23T10:00:00Z');
const fields = (o: Partial<VaultConsentFields> = {}): VaultConsentFields => ({
  documentVaultConsentAt: null,
  documentVaultConsentVersion: null,
  documentVaultConsentWithdrawnAt: null,
  ...o,
});

describe('the five states', () => {
  it('never-asked — no stamp of any kind', () => {
    expect(vaultConsentState(fields())).toBe('never-asked');
  });

  it('given — said yes to the wording that is current', () => {
    expect(
      vaultConsentState(
        fields({
          documentVaultConsentAt: at,
          documentVaultConsentVersion: VAULT_CONSENT_VERSION,
        }),
      ),
    ).toBe('given');
  });

  it('declined — the version is stamped and consentAt is not', () => {
    // ⚠️ A NO IS A RECORD, not an absence. Stamping the version on both
    // answers is what lets us ask once and then leave them alone; without it
    // a decline is indistinguishable from never having been asked, and the
    // window returns on every visit.
    expect(
      vaultConsentState(
        fields({ documentVaultConsentVersion: VAULT_CONSENT_VERSION }),
      ),
    ).toBe('declined');
  });

  it('stale — said yes, but to wording that has since changed', () => {
    expect(
      vaultConsentState(
        fields({
          documentVaultConsentAt: at,
          documentVaultConsentVersion: '2020-01-01',
        }),
      ),
    ).toBe('stale');
  });

  it('never-asked — said NO to wording that has since changed', () => {
    // An old no is not a current no. The text they refused is not the text we
    // would be asking about now, so they are asked again.
    expect(
      vaultConsentState(fields({ documentVaultConsentVersion: '2020-01-01' })),
    ).toBe('never-asked');
  });

  it('withdrawn — beats a current, valid yes', () => {
    // Turning it off is the most recent thing they said. Re-asking somebody
    // who has just switched something off is how a preference stops meaning
    // anything.
    expect(
      vaultConsentState(
        fields({
          documentVaultConsentAt: at,
          documentVaultConsentVersion: VAULT_CONSENT_VERSION,
          documentVaultConsentWithdrawnAt: new Date('2026-09-01T10:00:00Z'),
        }),
      ),
    ).toBe('withdrawn');
  });

  it('keeps consentAt through a withdrawal', () => {
    // "Agreed once and withdrew since" is a different fact from "never
    // agreed", and a nulled timestamp cannot tell them apart.
    const f = fields({
      documentVaultConsentAt: at,
      documentVaultConsentVersion: VAULT_CONSENT_VERSION,
      documentVaultConsentWithdrawnAt: new Date('2026-09-01T10:00:00Z'),
    });
    expect(f.documentVaultConsentAt).toEqual(at);
  });
});

describe('what each state permits', () => {
  it('only a current yes lets us keep anything', () => {
    expect(mayKeep('given')).toBe(true);
    for (const s of ['never-asked', 'declined', 'stale', 'withdrawn'] as const) {
      expect(mayKeep(s)).toBe(false);
    }
  });

  it('asks only the two states that have not answered the current wording', () => {
    expect(mustAsk('never-asked')).toBe(true);
    expect(mustAsk('stale')).toBe(true);
    // Answered. Asking again is nagging.
    expect(mustAsk('declined')).toBe(false);
    expect(mustAsk('withdrawn')).toBe(false);
    expect(mustAsk('given')).toBe(false);
  });

  it('stops offering across applications ONLY where somebody said no', () => {
    // ⚠️ never-asked keeps working. Switching a live feature off for everyone
    // the moment this ships would punish members for our omission — nobody
    // had been asked. What a no stops is the NEW processing: nothing is
    // copied into the Centre and nothing outlives its application's clock.
    expect(mayOfferAcrossApplications('never-asked')).toBe(true);
    expect(mayOfferAcrossApplications('given')).toBe(true);
    expect(mayOfferAcrossApplications('stale')).toBe(true);
    expect(mayOfferAcrossApplications('declined')).toBe(false);
    expect(mayOfferAcrossApplications('withdrawn')).toBe(false);
  });

  it('stale fails SOFT — keeps what it has, accrues nothing new', () => {
    // Deleting a feature over a wording change is worse than a banner.
    expect(mayKeep('stale')).toBe(false);
    expect(mayOfferAcrossApplications('stale')).toBe(true);
  });
});
