import { describe, expect, it } from 'vitest';
import {
  accountStandings,
  bankStanding,
  composeReason,
  faceMatchPercent,
  handleInitials,
  handleOf,
  hasKycDocument,
  identityOf,
  legacyKycUrl,
  maskAccountNumber,
  readFindings,
  strikeRows,
  verificationStanding,
  type MemberDossier,
  type MemberUser,
} from './desk-member';

/**
 * The Member module's dangerous jobs, tested because being wrong at any of
 * them costs a real person something:
 *
 *   · WHAT SHOWS WITHOUT A REVEAL. The heading and the avatar are the two
 *     things drawn the instant the drawer opens, and they must be built from
 *     the handle — never from firstName/lastName, which are right there in
 *     the same object and one autocomplete away.
 *
 *   · HOW MUCH OF A BANK ACCOUNT IS SHOWN. Four digits answer "which
 *     account"; the other twelve answer nothing and are somebody's money.
 *
 *   · WHETHER THE DECISION BUTTONS APPEAR. Only UNDER_REVIEW can be approved
 *     or rejected — the backend guards it, so offering the button anywhere
 *     else is a 400 with the operator's confidence already spent.
 */

const USER: MemberUser = {
  id: 'usr_1',
  username: 'boetie',
  firstName: 'Gerhard',
  lastName: 'Fourie',
  email: 'member@example.test',
  phone: '+27821234567',
  phoneVerified: true,
  dateOfBirth: '1985-04-02',
  createdAt: '2026-01-05T08:00:00.000Z',
  sellerTier: 'ESTABLISHED',
  trustScore: 42,
  averageRating: 4.6,
  totalSales: 7,
  profileCompletedAt: '2026-02-01T08:00:00.000Z',
  kycStatus: 'UNDER_REVIEW',
  kycMethod: 'CLAUDE',
  kycTier: 'STANDARD',
  kycRequiredAt: '2026-08-30T08:00:00.000Z',
  kycVerifiedAt: null,
  kycAttempts: 2,
  // 0–100, as VerifyNow returns it and kyc.service stores it — NOT a fraction.
  kycFaceMatchScore: 82,
  kycReviewedAt: null,
  kycReviewNote: null,
  kycClaudeFindings: null,
  kycIdStorageKey: 'kyc/abc',
  kycSelfieStorageKey: null,
  kycIdDocumentUrl: null,
  kycSelfieUrl: 'https://cdn.example.test/selfie.jpg',
  bankName: 'FNB',
  bankAccountHolder: 'G Fourie',
  bankAccountNumber: '62012345678',
  bankVerifiedAt: null,
  bankAvsResult: null,
  isBanned: false,
  bannedAt: null,
  accountClosedAt: null,
  auctionStrikes: 0,
  dispatchStrikes: 1,
  sellerRejectStrikes: 3,
  sellingBannedAt: '2026-08-20T08:00:00.000Z',
  _count: { listings: 12, buyerTransactions: 3, sellerTransactions: 7, offersPlaced: 9 },
};

function dossierWith(overrides: Partial<MemberUser> = {}, closure: MemberDossier['closure'] = null): MemberDossier {
  return {
    user: { ...USER, ...overrides },
    listings: [],
    sellerTransactions: [],
    complaintsAgainst: [],
    complaintsLodged: [],
    systemAlerts: [],
    auditEvents: [],
    closure,
  };
}

const CLOSURE: NonNullable<MemberDossier['closure']> = {
  closedAt: '2026-08-28T08:00:00.000Z',
  closedBy: 'MEMBER',
  reason: 'No longer trading',
  closedUsername: 'oldboet',
  closedEmail: 'gone@example.test',
  closedPhone: '+27829999999',
  closedFirstName: 'Gerhard',
  closedLastName: 'Fourie',
  wasBanned: false,
};

describe('the heading never carries a real name', () => {
  it('titles the drawer with the handle', () => {
    expect(handleOf(dossierWith())).toBe('@boetie');
  });

  it('falls back to the released handle on a closed account, not to the name', () => {
    const d = dossierWith(
      { username: null, firstName: null, lastName: null, email: null, phone: null },
      CLOSURE,
    );
    expect(handleOf(d)).toBe('@oldboet');
  });

  it('says "Member" rather than guessing when there is no handle at all', () => {
    const d = dossierWith({ username: null });
    expect(handleOf(d)).toBe('Member');
    expect(handleInitials(d)).toBe('··');
  });

  it('builds the avatar from the handle, never the initials of the name', () => {
    // "Gerhard Fourie" would give GF. The handle gives BO, and that is the point.
    expect(handleInitials(dossierWith())).toBe('BO');
  });
});

describe('the identity is assembled in one place', () => {
  it('reads the live row while the account is open', () => {
    const id = identityOf(dossierWith());
    expect(id.fullName).toBe('Gerhard Fourie');
    expect(id.fromClosure).toBe(false);
  });

  it('reads the closure snapshot once the live row has been emptied', () => {
    const d = dossierWith(
      { username: null, firstName: null, lastName: null, email: null, phone: null },
      CLOSURE,
    );
    const id = identityOf(d);
    expect(id.fullName).toBe('Gerhard Fourie');
    expect(id.email).toBe('gone@example.test');
    expect(id.fromClosure).toBe(true);
  });
});

describe('bank details are masked before they leave the module', () => {
  it('keeps four digits and drops the rest', () => {
    expect(maskAccountNumber('62012345678')).toBe('••••5678');
  });

  it('shows nothing at all for a number too short to mask safely', () => {
    expect(maskAccountNumber('123')).toBe('••••');
  });

  it('returns null rather than a fake mask when there is no account', () => {
    expect(maskAccountNumber(null)).toBeNull();
  });

  it('never hands the raw number out on the standing object', () => {
    const bank = bankStanding(USER);
    expect(bank.accountMasked).toBe('••••5678');
    expect(JSON.stringify(bank)).not.toContain('62012345678');
  });

  it('reads the Peach outcome from the stored prefix', () => {
    expect(bankStanding({ ...USER, bankAvsResult: 'PASS:000' }).avs.kind).toBe('ok');
    expect(bankStanding({ ...USER, bankAvsResult: 'MISMATCH:100:NAME' }).avs.kind).toBe('bad');
    expect(bankStanding({ ...USER, bankAvsResult: 'FAILED:900' }).avs.kind).toBe('bad');
    expect(bankStanding({ ...USER, bankAvsResult: 'REQUESTED:PENDING' }).awaitingPeach).toBe(true);
    expect(bankStanding({ ...USER, bankAvsResult: null }).avs.label).toBe('Never run');
  });
});

describe('the decision buttons follow the backend guard', () => {
  it('offers a decision only while the verification is under review', () => {
    expect(verificationStanding({ ...USER, kycStatus: 'UNDER_REVIEW' }).awaitingDecision).toBe(true);
    for (const status of ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'] as const) {
      expect(verificationStanding({ ...USER, kycStatus: status }).awaitingDecision).toBe(false);
    }
  });

  it('keeps a ban and a closure as two separate facts', () => {
    const both = accountStandings(
      dossierWith({ isBanned: true, accountClosedAt: '2026-08-28T08:00:00.000Z' }),
    );
    expect(both.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Banned', 'Closed by member', 'Banned from listing']),
    );
  });
});

describe('documents are only offered when there is one', () => {
  it('sees an encrypted document and a legacy-only one alike', () => {
    expect(hasKycDocument(USER, 'id')).toBe(true);
    expect(hasKycDocument(USER, 'selfie')).toBe(true);
    expect(hasKycDocument({ ...USER, kycIdStorageKey: null }, 'id')).toBe(false);
  });

  it('surfaces the unprotected CDN copy only where one still exists', () => {
    expect(legacyKycUrl(USER, 'id')).toBeNull();
    expect(legacyKycUrl(USER, 'selfie')).toBe('https://cdn.example.test/selfie.jpg');
  });
});

describe('the strike rows say what the number costs', () => {
  it('marks the reject strikes as hit once the listing ban is on', () => {
    const rows = strikeRows(USER);
    expect(rows[0].count).toBe(3);
    expect(rows[0].hit).toBe(true);
    expect(rows[2].hit).toBe(false);
  });
});

describe('the face-match score keeps its scale', () => {
  /**
   * The legacy dossier multiplied this by 100 and printed "8200.0%" for the
   * 82 VerifyNow actually returned. The threshold the same service approves
   * on is `>= 75`, so the stored number is plainly already a percentage —
   * and this is the one screen where a made-up figure decides a verification.
   */
  it('prints the stored 0–100 score as a percentage, unscaled', () => {
    expect(faceMatchPercent(USER.kycFaceMatchScore)).toBe('82.0%');
    expect(faceMatchPercent(75)).toBe('75.0%');
  });

  it('says nothing rather than 0% when no scan has run', () => {
    expect(faceMatchPercent(null)).toBe('—');
  });
});

describe('the recorded reason', () => {
  it('leads with the chosen sentence so an audit row reads in order', () => {
    expect(composeReason('Document is illegible', 'Photo is out of focus')).toBe(
      'Document is illegible — Photo is out of focus',
    );
  });

  it('stands alone when the operator adds nothing', () => {
    expect(composeReason('Document is illegible', '   ')).toBe('Document is illegible');
  });
});

describe('the automated findings survive a half-empty verdict', () => {
  it('returns null when nothing was stored', () => {
    expect(readFindings(null)).toBeNull();
  });

  it('reads scores, fails and the recommendation without throwing on gaps', () => {
    const f = readFindings({
      face_match: { same_person: 91, issues: ['glare on the photo'] },
      document: { looks_genuine_sa_id: 40 },
      crossCheck: { hardFails: ['DOB_MISMATCH'] },
      recommendation: 'REJECT',
      scanFailed: false,
    });
    expect(f?.scores.find((s) => s.label === 'Selfie vs document photo')?.value).toBe(91);
    expect(f?.scores.find((s) => s.label === 'Overall confidence')?.value).toBeNull();
    expect(f?.hardFails).toEqual(['DOB_MISMATCH']);
    expect(f?.issues).toEqual(['glare on the photo']);
    expect(f?.recommendation).toBe('REJECT');
  });

  it('adds the official-record comparison only when the scan ran one', () => {
    const without = readFindings({ face_match: {} });
    expect(without?.scores.some((s) => s.label === 'Selfie vs official record photo')).toBe(false);
    const with_ = readFindings({ face_match: { same_person_vs_ha_photo: 88 } });
    expect(with_?.scores.some((s) => s.label === 'Selfie vs official record photo')).toBe(true);
  });
});
