/**
 * THE DESK — one member's dossier.
 *
 * 🚨 THE MOST PRIVACY-SENSITIVE MODULE ON THE DESK. The rules live in the code
 * rather than in a policy note because the code is the only place a rule
 * survives the next refactor.
 *
 * ⚠️ THE ENDPOINT HANDS BACK THE ENTIRE USER ROW. `AdminService.getUserDossier`
 * uses `include`, not `select`, with the comment "Include EVERYTHING — we're
 * not redacting". So every column reaches the browser: the encrypted SA ID,
 * the ID hash, the home address, the OTP hash, the bank account number, the
 * Clerk id. Narrowing is therefore this module's job, and `MemberUser` below
 * is that narrowing: it names ONLY the fields the drawer renders. A field that
 * is not on it is a field no operator will ever be shown, and adding one is a
 * decision rather than a convenience.
 *
 * ⚠️ THE RAW BANK ACCOUNT NUMBER NEVER LEAVES THIS MODULE. `bankStanding()`
 * returns it already masked to the last four digits, because the question the
 * payout section answers is "can this seller be paid, and did the ownership
 * check pass" — and neither question needs the other twelve digits on screen.
 *
 * ⚠️ THE IDENTITY DOCUMENT COSTS A DECRYPTION CALL. `revealKycDocument` is the
 * only function here that reads one; it is never called on mount, only from an
 * explicit press, and the caller must hand the result back to
 * `releaseKycDocument` so the decrypted bytes are not left pinned in the tab
 * after the drawer closes. See the guard on GET admin/users/:id/kyc-file/:which
 * — Bearer header only, which is also why this cannot be an <img src>.
 */
import {
  DESK_API_URL,
  DESK_SIGN_IN_PATH,
  DeskFetchError,
  clearDeskToken,
  deskFetch,
  getDeskToken,
} from './desk-auth';

export type MemberKycStatus = 'NONE' | 'PENDING' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';

export type StandingKind = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/** A label and the tone it is allowed to be drawn in. */
export interface Standing {
  label: string;
  kind: StandingKind;
}

/**
 * The user fields the Member drawer renders — and nothing else.
 *
 * Everything the dossier also returns (idNumberEncrypted, kycIdHash, the
 * address block, phoneOtpHash, clerkId, the notification preferences) is
 * deliberately absent: none of it is needed to approve a verification, judge a
 * payout or decide a ban, and a field that is typed is a field that ends up
 * rendered.
 */
export interface MemberUser {
  id: string;
  username: string | null;
  /** Identity. Behind the drawer's reveal, never on open. */
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  dateOfBirth: string | null;

  createdAt: string;
  sellerTier: string | null;
  trustScore: number;
  averageRating: number | null;
  totalSales: number;
  profileCompletedAt: string | null;

  kycStatus: MemberKycStatus;
  kycMethod: string | null;
  kycTier: string | null;
  kycRequiredAt: string | null;
  kycVerifiedAt: string | null;
  kycAttempts: number;
  kycFaceMatchScore: number | null;
  kycReviewedAt: string | null;
  kycReviewNote: string | null;
  kycClaudeFindings: Record<string, unknown> | null;

  /** Presence only — the bytes come from the authenticated route on demand. */
  kycIdStorageKey: string | null;
  kycSelfieStorageKey: string | null;
  /** ⚠️ World-readable CDN leftovers. Offered only when the encrypted read
   *  fails, and labelled as what they are. See the schema note. */
  kycIdDocumentUrl: string | null;
  kycSelfieUrl: string | null;

  bankName: string | null;
  bankAccountHolder: string | null;
  bankAccountNumber: string | null;
  bankVerifiedAt: string | null;
  bankAvsResult: string | null;

  isBanned: boolean;
  bannedAt: string | null;
  accountClosedAt: string | null;

  auctionStrikes: number;
  dispatchStrikes: number;
  sellerRejectStrikes: number;
  sellingBannedAt: string | null;

  _count: {
    listings: number;
    buyerTransactions: number;
    sellerTransactions: number;
    offersPlaced: number;
  };
}

export interface MemberListing {
  id: string;
  referenceNumber: string | null;
  title: string;
  price: number | null;
  listingType: string;
  status: string;
  createdAt: string;
}

export interface MemberSale {
  id: string;
  paymentStatus: string;
  sellerPayout: number;
  createdAt: string;
  listing: { title: string } | null;
}

export interface MemberComplaint {
  id: string;
  referenceNumber: string | null;
  category: string;
  subject: string | null;
  status: string;
  createdAt: string;
}

export interface MemberAlert {
  id: string;
  type: string;
  urgent: boolean;
  resolved: boolean;
  createdAt: string;
}

export interface MemberAuditEvent {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
  /** The admin who acted — staff accountability, not member data. */
  adminUser: { email: string } | null;
}

/**
 * The closure record.
 *
 * ⚠️ ONCE AN ACCOUNT CLOSES, THE USER ROW STOPS ANSWERING "WHO WAS THIS".
 * Username, email and phone are released back into the signup namespace, so
 * this row is the only remaining answer — which is exactly why the released
 * name, email and phone sit behind the drawer's identity reveal with the rest
 * of the identity, and only the released handle is used as a heading.
 */
export interface MemberClosure {
  closedAt: string;
  closedBy: string;
  reason: string;
  closedUsername: string | null;
  closedEmail: string | null;
  closedPhone: string | null;
  closedFirstName: string | null;
  closedLastName: string | null;
  wasBanned: boolean;
}

export interface MemberDossier {
  user: MemberUser;
  listings: MemberListing[];
  sellerTransactions: MemberSale[];
  complaintsAgainst: MemberComplaint[];
  complaintsLodged: MemberComplaint[];
  systemAlerts: MemberAlert[];
  auditEvents: MemberAuditEvent[];
  closure: MemberClosure | null;
}

export function fetchMemberDossier(userId: string): Promise<MemberDossier> {
  return deskFetch<MemberDossier>(`/admin/users/${encodeURIComponent(userId)}/dossier`);
}

/* ────────────────────────────────────────────────────────────────────────
 * Decisions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Approve or reject a verification.
 *
 * ⚠️ A REASON IS REQUIRED IN BOTH DIRECTIONS, AND IT IS FIVE CHARACTERS.
 * `AdminService.reviewKyc` rejects the call before it looks at the decision if
 * the reason is shorter — an approve with no reason 400s exactly as hard as a
 * reject does. That is why this signature does not make `reason` optional:
 * a caller that forgets it should not compile.
 *
 * ⚠️ ONLY UNDER_REVIEW MOVES. The write is a guarded updateMany, so a second
 * admin deciding the same member gets "Already decided by another admin"
 * rather than silently overwriting the first decision.
 */
export function reviewMemberKyc(
  userId: string,
  decision: 'APPROVE' | 'REJECT',
  reason: string,
): Promise<{ success: boolean; kycStatus: string }> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}/kyc-review`, {
    method: 'POST',
    body: JSON.stringify({ decision, reason }),
  });
}

/**
 * Ban or unban.
 *
 * ⚠️ NOT THE SAME ACT AS CLOSING AN ACCOUNT, and the drawer must never blur
 * the two. A ban is an enforcement flag: the profile and the listings stay up
 * and the handle stays claimed. A closure is the member leaving, and it
 * releases the handle. Reusing one for the other would mean an Unban button
 * that reopens a closed account.
 *
 * `reason` is required by UpdateUserDto (min 3) and lands on the audit row.
 */
export function setMemberBan(
  userId: string,
  banned: boolean,
  reason: string,
): Promise<unknown> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ isBanned: banned, reason }),
  });
}

/**
 * Re-run the Peach bank-ownership check.
 *
 * ⚠️ IT CLEARS THE CURRENT STAMP. The service sets `bankVerifiedAt: null` and
 * writes `REQUESTED:…` before Peach has answered, so a seller who was payable
 * a moment ago is not payable until the webhook lands. The confirm has to say
 * so — an operator pressing this to "double-check" would otherwise block a
 * payout they were trying to unblock.
 *
 * It also spends a real third-party call, and refuses outright when BANV is
 * not configured. The drawer prints that refusal verbatim rather than trying
 * to predict it from the frontend, which cannot see the backend's config.
 */
export function rerunBankVerification(
  userId: string,
): Promise<{ requested: boolean; bankVerificationId?: string; status?: string }> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}/verify-bank`, {
    method: 'POST',
  });
}

/**
 * Clear the seller reject-strikes and lift the selling ban.
 *
 * The backend writes its own audit reason ("Seller reject-strikes cleared
 * after review") and takes no body, so the confirm collects no typed reason —
 * it restates who it affects and what comes back on, which is the part an
 * operator can get wrong.
 */
export function clearRejectStrikes(userId: string): Promise<{ cleared: boolean }> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}/clear-reject-strikes`, {
    method: 'POST',
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * The identity documents
 * ──────────────────────────────────────────────────────────────────────── */

export type KycDocumentKind = 'id' | 'selfie';

export interface RevealedDocument {
  which: KycDocumentKind;
  /** A blob: URL owned by this tab. Hand it back to releaseKycDocument. */
  objectUrl: string;
  mimeType: string;
  /** A photographed ID is an image; a scanned one is often a PDF. */
  isImage: boolean;
}

/** True when there is something to reveal at all — no call made. */
export function hasKycDocument(user: MemberUser, which: KycDocumentKind): boolean {
  return which === 'id'
    ? Boolean(user.kycIdStorageKey || user.kycIdDocumentUrl)
    : Boolean(user.kycSelfieStorageKey || user.kycSelfieUrl);
}

/**
 * The CDN copy, for the one case the encrypted read cannot serve.
 *
 * ⚠️ THIS LINK HAS NO ACCESS CONTROL. These files were uploaded to Cloudinary
 * with the service defaults — no private type, no access_mode — so anybody
 * holding the URL can fetch a South African identity document with no login
 * and no audit trail. That is the exposure the encrypted store exists to
 * close, and the backfill is emptying these columns as it runs. It is offered
 * only after the authenticated read has failed, and the drawer says out loud
 * what it is, because an unmigrated row is otherwise a member who cannot be
 * verified at all.
 */
export function legacyKycUrl(user: MemberUser, which: KycDocumentKind): string | null {
  return which === 'id' ? user.kycIdDocumentUrl : user.kycSelfieUrl;
}

/**
 * Decrypt and load one document. THE ONLY DECRYPTION CALL IN THIS MODULE.
 *
 * ⚠️ NOT deskFetch, AND NOT BECAUSE THE RULE IS BEING DODGED. The route
 * streams bytes, and deskFetch parses every response as JSON — this is the
 * same request with the same Authorization header and the same 401 handling,
 * kept inside the data module so no component ever holds a fetch of its own.
 *
 * ⚠️ THE ROUTE TAKES A DOCUMENT KIND, NEVER A STORAGE KEY. `readKycFile` looks
 * the key up from the user row, so there is no path by which an admin reads
 * another namespace by guessing — do not "improve" this into a key parameter.
 */
export async function revealKycDocument(
  userId: string,
  which: KycDocumentKind,
): Promise<RevealedDocument> {
  const path = `/admin/users/${encodeURIComponent(userId)}/kyc-file/${which}`;
  const token = getDeskToken();
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${DESK_API_URL}${path}`, { headers, cache: 'no-store' });

  if (res.status === 401) {
    clearDeskToken();
    if (typeof window !== 'undefined') window.location.href = DESK_SIGN_IN_PATH;
    throw new DeskFetchError('Signed out', 401, '', path);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DeskFetchError(`${res.status} ${res.statusText}`, res.status, body, path);
  }

  const blob = await res.blob();
  const mimeType = res.headers.get('content-type') ?? blob.type ?? 'application/octet-stream';
  return {
    which,
    objectUrl: URL.createObjectURL(blob),
    mimeType,
    isImage: mimeType.startsWith('image/'),
  };
}

/**
 * Free a revealed document.
 *
 * ⚠️ CALL THIS ON CLOSE, NOT ON A TIMER. An un-revoked object URL keeps a
 * decrypted identity document alive in the tab for as long as the tab lives,
 * which is precisely the thing the encrypted store was built to stop.
 */
export function releaseKycDocument(doc: RevealedDocument | null): void {
  if (doc) URL.revokeObjectURL(doc.objectUrl);
}

/* ────────────────────────────────────────────────────────────────────────
 * Derivations — pure, so the privacy-critical ones can be tested
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The heading, and the only name that may appear outside the reveal.
 *
 * A closed account has no username left on the User row — it was released so
 * the same person could register again — so the handle comes off the closure
 * record. A handle is public by definition; the real name on that same record
 * is not, and stays behind the reveal with the rest of the identity.
 */
export function handleOf(dossier: MemberDossier): string {
  const handle = dossier.user.username ?? dossier.closure?.closedUsername ?? null;
  return handle ? `@${handle}` : 'Member';
}

/** Initials for the avatar, from the handle — never from a real name. */
export function handleInitials(dossier: MemberDossier): string {
  const handle = dossier.user.username ?? dossier.closure?.closedUsername ?? '';
  const clean = handle.replace(/[^a-z0-9]/gi, '');
  return clean ? clean.slice(0, 2).toUpperCase() : '··';
}

/**
 * The identity, assembled in one place so the drawer has exactly one thing to
 * put behind the reveal.
 *
 * On a closed account the live columns are empty and the closure snapshot is
 * the answer — an admin fielding a police request months later has nowhere
 * else to look.
 */
export interface MemberIdentity {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  dateOfBirth: string | null;
  /** True when these values come off the closure snapshot, not the live row. */
  fromClosure: boolean;
}

export function identityOf(dossier: MemberDossier): MemberIdentity {
  const u = dossier.user;
  const live = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (live || u.email || u.phone) {
    return {
      fullName: live || null,
      email: u.email,
      phone: u.phone,
      phoneVerified: u.phoneVerified,
      dateOfBirth: u.dateOfBirth,
      fromClosure: false,
    };
  }
  const c = dossier.closure;
  const closedName = c ? [c.closedFirstName, c.closedLastName].filter(Boolean).join(' ').trim() : '';
  return {
    fullName: closedName || null,
    email: c?.closedEmail ?? null,
    phone: c?.closedPhone ?? null,
    phoneVerified: false,
    dateOfBirth: null,
    fromClosure: Boolean(c),
  };
}

/** Where the verification stands, and whether it is the operator's move. */
export interface VerificationStanding extends Standing {
  /** Only UNDER_REVIEW can be approved or rejected — the backend guards it. */
  awaitingDecision: boolean;
}

export function verificationStanding(user: MemberUser): VerificationStanding {
  switch (user.kycStatus) {
    case 'VERIFIED':
      return { label: 'Verified', kind: 'ok', awaitingDecision: false };
    case 'UNDER_REVIEW':
      return { label: 'Awaiting your decision', kind: 'warn', awaitingDecision: true };
    case 'REJECTED':
      return { label: 'Rejected', kind: 'bad', awaitingDecision: false };
    case 'PENDING':
      return { label: 'Member has not finished', kind: 'info', awaitingDecision: false };
    default:
      return { label: 'Not started', kind: 'neutral', awaitingDecision: false };
  }
}

/** The account's own state. Ban, closure and selling ban are three facts. */
export function accountStandings(dossier: MemberDossier): Standing[] {
  const u = dossier.user;
  const out: Standing[] = [];
  if (u.accountClosedAt) out.push({ label: 'Closed by member', kind: 'neutral' });
  if (u.isBanned) out.push({ label: 'Banned', kind: 'bad' });
  if (u.sellingBannedAt) out.push({ label: 'Banned from listing', kind: 'bad' });
  if (u.sellerTier === 'DEALER') out.push({ label: 'SAPS dealer', kind: 'info' });
  return out;
}

/**
 * ⚠️ FOUR DIGITS, AND THE MODULE KEEPS THE REST. The payout question is
 * "which account, and did the ownership check pass" — a masked tail answers
 * it, and a full account number on a shared screen answers nothing extra.
 */
export function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\s/g, '');
  if (digits.length <= 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

export interface BankStanding {
  hasDetails: boolean;
  bankName: string | null;
  accountHolder: string | null;
  /** Already masked. The raw number does not leave this module. */
  accountMasked: string | null;
  /** The manual review stamp — NOT an automated pass. See the label. */
  reviewedAt: string | null;
  avs: Standing;
  /** Peach BANV has been asked and has not answered yet. */
  awaitingPeach: boolean;
}

/**
 * ⚠️ bankVerifiedAt IS A MANUAL REVIEW STAMP UNTIL PEACH BANV IS LIVE, and the
 * drawer labels it that way. Calling it "AVS verified" would claim an
 * automated bank-ownership check that is not running yet, on the one screen
 * where an operator decides whether money can leave.
 */
export function bankStanding(user: MemberUser): BankStanding {
  const raw = user.bankAvsResult ?? '';
  const prefix = raw.split(':')[0];
  const avs: Standing =
    prefix === 'PASS'
      ? { label: 'Passed', kind: 'ok' }
      : prefix === 'MISMATCH'
        ? { label: 'Mismatch', kind: 'bad' }
        : prefix === 'FAILED'
          ? { label: 'Failed', kind: 'bad' }
          : prefix === 'REQUESTED'
            ? { label: 'Requested — waiting on Peach', kind: 'info' }
            : { label: 'Never run', kind: 'neutral' };

  return {
    hasDetails: Boolean(user.bankAccountNumber),
    bankName: user.bankName,
    accountHolder: user.bankAccountHolder,
    accountMasked: maskAccountNumber(user.bankAccountNumber),
    reviewedAt: user.bankVerifiedAt,
    avs,
    awaitingPeach: prefix === 'REQUESTED',
  };
}

export interface StrikeRow {
  label: string;
  count: number;
  /** What happens at the threshold, so the number means something. */
  consequence: string;
  /** The threshold has been reached. */
  hit: boolean;
}

export function strikeRows(user: MemberUser): StrikeRow[] {
  return [
    {
      label: 'Reject strikes',
      count: user.sellerRejectStrikes,
      consequence: 'Three bans this seller from listing',
      hit: user.sellerRejectStrikes >= 3 || Boolean(user.sellingBannedAt),
    },
    {
      label: 'Dispatch strikes',
      count: user.dispatchStrikes,
      consequence: 'Three is the review threshold',
      hit: user.dispatchStrikes >= 3,
    },
    {
      label: 'Auction strikes',
      count: user.auctionStrikes,
      consequence: 'Non-payment on a won auction',
      hit: user.auctionStrikes >= 3,
    },
  ];
}

/**
 * The automated verdict, flattened.
 *
 * This is the evidence the decision actually rests on — a face-match score and
 * a list of cross-check failures — so it is read out of the stored JSON rather
 * than re-run, exactly as the backend intended when it persisted it.
 */
export interface AutomatedFindings {
  scanFailed: boolean;
  mode: string | null;
  recommendation: string | null;
  recommendationReason: string | null;
  scores: { label: string; value: number | null }[];
  issues: string[];
  hardFails: string[];
  softFails: string[];
}

export function readFindings(raw: Record<string, unknown> | null): AutomatedFindings | null {
  if (!raw || typeof raw !== 'object') return null;
  const fm = (raw.face_match ?? {}) as Record<string, unknown>;
  const doc = (raw.document ?? {}) as Record<string, unknown>;
  const cc = (raw.crossCheck ?? {}) as { hardFails?: string[]; softFails?: string[] };
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);

  const scores = [
    { label: 'Selfie vs document photo', value: num(fm.same_person) },
    { label: 'Live-capture impression', value: num(fm.selfie_live_capture) },
    { label: 'Looks a genuine SA ID', value: num(doc.looks_genuine_sa_id) },
    { label: 'Document legibility', value: num(doc.legibility) },
    { label: 'Overall confidence', value: num(raw.overall_confidence) },
  ];
  if (fm.same_person_vs_ha_photo !== undefined) {
    scores.splice(1, 0, {
      label: 'Selfie vs official record photo',
      value: num(fm.same_person_vs_ha_photo),
    });
  }

  return {
    scanFailed: raw.scanFailed === true,
    mode: str(raw.mode),
    recommendation: str(raw.recommendation),
    recommendationReason: str(raw.recommendation_reason),
    scores,
    issues: [
      ...(Array.isArray(fm.issues) ? (fm.issues as string[]) : []),
      ...(Array.isArray(doc.issues) ? (doc.issues as string[]) : []),
    ],
    hardFails: Array.isArray(cc.hardFails) ? cc.hardFails : [],
    softFails: Array.isArray(cc.softFails) ? cc.softFails : [],
  };
}

/**
 * The stored VerifyNow face-match score, as a percentage.
 *
 * ⚠️ IT IS ALREADY 0–100 AND MUST NOT BE MULTIPLIED AGAIN. `kyc.service`
 * approves on `confidenceScore >= 75` and stores that number as returned. The
 * legacy dossier multiplied by 100 anyway and printed "8200.0%" for a score of
 * 82 — a figure an operator either dismisses or believes, and both are wrong
 * on the screen where a verification is decided. It lives here, pure, so the
 * scale is asserted by the spec rather than remembered by the next editor.
 */
export function faceMatchPercent(score: number | null): string {
  return score === null ? '—' : `${score.toFixed(1)}%`;
}

/** A confidence percentage reads as ok / warn / bad on the same bands the
 *  Claude verdict itself uses. Nothing else on the drawer is coloured. */
export function scoreKind(value: number | null): StandingKind {
  if (value === null) return 'neutral';
  if (value >= 80) return 'ok';
  if (value >= 50) return 'warn';
  return 'bad';
}

/* ────────────────────────────────────────────────────────────────────────
 * Reasons — ticklists, because a reason that cannot be counted is a sentence
 * ──────────────────────────────────────────────────────────────────────── */

export interface ReasonChoice {
  /**
   * The sentence itself — this IS the label AND the recorded reason.
   *
   * Deliberately not a code with a separate display string: the backend
   * stores free text, so a code would be recorded and a sentence displayed,
   * and the audit row an appeal is read against would then say something the
   * operator never actually saw.
   */
  value: string;
  /** What the choice costs the member, shown under the row. */
  consequence?: string;
}

/**
 * ⚠️ THE BACKEND TAKES FREE TEXT, SO THE TICKLIST IS OURS TO KEEP HONEST.
 * `reviewKyc` stores whatever string it is given on kycReviewNote and the
 * audit row. Left as a text box, the same rejection is spelled six ways by
 * six operators and nothing about the KYC funnel can ever be counted. These
 * labels are the recorded reason; the operator's note is appended to it.
 */
export const KYC_REJECT_REASONS: ReasonChoice[] = [
  { value: 'Document does not match the selfie', consequence: 'Member is told to contact support' },
  { value: 'Document is not a valid SA identity document' },
  { value: 'Document is illegible' },
  { value: 'Details do not match the Home Affairs record' },
  { value: 'Suspected forgery or a photo of a screen' },
  { value: 'Duplicate identity — already verified on another account' },
];

export const KYC_APPROVE_REASONS: ReasonChoice[] = [
  { value: 'Document and selfie match on review' },
  { value: 'Automated verdict was inconclusive, evidence is clear' },
  { value: 'Member re-submitted and the new document is good' },
  { value: 'Verified out of band with the member' },
];

export const BAN_REASONS: ReasonChoice[] = [
  { value: 'Fraud or attempted fraud', consequence: 'Listings stay up — cancel them separately' },
  { value: 'Prohibited or illegal item' },
  { value: 'Abuse or threats toward another member' },
  { value: 'Repeated non-payment' },
  { value: 'Repeated failure to dispatch' },
  { value: 'Off-platform dealing' },
];

export const UNBAN_REASONS: ReasonChoice[] = [
  { value: 'Reviewed and cleared' },
  { value: 'Ban was issued in error' },
  { value: 'Member has resolved the underlying issue' },
  { value: 'Appeal upheld' },
];

/**
 * The string that lands on the audit row.
 *
 * The chosen reason first so a later reader — a support agent, or the member's
 * own complaint months on — sees the recorded category before the prose.
 */
export function composeReason(choice: string, note: string): string {
  const extra = note.trim();
  return extra ? `${choice} — ${extra}` : choice;
}

/** The backend floor. Every ticklist label clears it; a bare note might not. */
export const MIN_REASON_LENGTH = 5;

/* ────────────────────────────────────────────────────────────────────────
 * Failure text
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What went wrong on a decision, verbatim.
 *
 * `describeFailure` in desk-auth prefixes "GET", which is right for a region
 * that failed to load and wrong for a POST that was refused — and on this
 * surface a refusal is usually the backend explaining a guard ("This
 * verification is not awaiting review", "Already decided by another admin").
 * That sentence is the whole message, so it is not paraphrased.
 */
export function describeDecisionFailure(err: unknown): string {
  if (err instanceof DeskFetchError) {
    return `${err.path}\n${err.message}${err.body ? `\n\n${err.body}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ────────────────────────────────────────────────────────────────────────
 * Formatting
 * ──────────────────────────────────────────────────────────────────────── */

export function memberDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    // SAST explicitly, matching desk-listing.ts's stamp() and desk-site.ts's.
    // Without it this rendered in the BROWSER's zone, so the same event
    // showed one time on this surface and another on those — and an
    // operator abroad, or on a machine with a wrong clock, read every
    // Desk timestamp shifted. The Desk is one product; a timestamp has to
    // mean the same thing on all five surfaces. (No hour12 here — this is
    // date-only, but the zone still decides which DAY a near-midnight UTC
    // timestamp falls on.)
    timeZone: 'Africa/Johannesburg',
  });
}

export function memberDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  });
}

/* ── The writes the per-row actions menu used to carry ────────────────── */

/**
 * 🚨 THESE WERE A STRAIGHT REMOVAL OF WORKING CAPABILITY. Legacy rendered a
 * UserActions menu on every row of /admin/users AND on /admin/users/[id]; the
 * Member drawer carried three of its writes and the cutover map recorded the
 * rest as simply gone. They are all one endpoint each.
 *
 * ⚠️ EVERY ONE IS SUPERADMIN-ONLY NOW, without anything being written here to
 * make it so: AdminJwtGuard denies every mutating method to a monitoring
 * admin, so a new write is gated by the act of existing.
 */

/**
 * 🚨 TRANSCRIBED FROM prisma/schema.prisma, NOT GUESSED — and the first draft
 * of this line WAS guessed, as NONE / INDIVIDUAL / BUSINESS / DEALER. Only
 * DEALER was real. Every other option would have been a 400 from @IsEnum: a
 * loud failure rather than a silent one, but a picker offering four choices of
 * which three can never work is a control that lies about what it can do.
 */
export const SELLER_TIERS = ['NEW', 'ESTABLISHED', 'TRUSTED', 'TOP_SELLER', 'DEALER'] as const;
export type SellerTier = (typeof SELLER_TIERS)[number];

/**
 * Also transcribed. The empty state is NONE, not NOT_STARTED — and the list
 * includes UNDER_REVIEW, which a first pass truncated away: it is the
 * Claude-vision inconclusive verdict, and payout gates check `!== VERIFIED`,
 * so it blocks a payout while looking like an ordinary in-progress state.
 * Leaving it off the picker would have made the one status an operator most
 * needs to move a member OUT of the only one they could not select.
 */
export const KYC_STATUSES = [
  'NONE',
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
] as const;
export type KycStatusValue = (typeof KYC_STATUSES)[number];

/**
 * ⚠️ THE ENUM VALUES ARE THE SERVER'S, AND A WRONG ONE IS A 400, NOT A SILENT
 * NO-OP — UpdateUserDto validates both with @IsEnum against the Prisma enums.
 * That is the good failure mode, and it is only good because these lists are
 * transcribed from the schema rather than guessed; a value that IS in the enum
 * but wrong for the situation still writes.
 */
export function setSellerTier(userId: string, tier: SellerTier): Promise<unknown> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sellerTier: tier }),
  });
}

/**
 * Set kycStatus directly, bypassing the review.
 *
 * 🚨 THIS IS NOT THE APPROVE BUTTON AND MUST NOT BE OFFERED AS ONE.
 * reviewMemberKyc runs the real path — it records the decision, notifies the
 * member, and leaves a reviewer on the record. This writes the column and
 * nothing else, which is what makes it the right tool for repairing a stuck
 * state and the wrong tool for deciding a verification. The drawer says so at
 * the control, not only here.
 */
export function setKycStatusDirect(userId: string, status: KycStatusValue): Promise<unknown> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ kycStatus: status }),
  });
}

/** 3–30 characters, enforced by UpdateUserDto and again here. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

export function usernameIsUsable(name: string): boolean {
  const t = name.trim();
  return t.length >= USERNAME_MIN && t.length <= USERNAME_MAX;
}

/**
 * Rename a member.
 *
 * ⚠️ THE MODERATION CASE, NOT THE TIDYING CASE. A username is the only thing
 * about a person that appears on every public surface, so an offensive one is
 * a thing an operator must be able to change today. firstName and lastName are
 * deliberately NOT offered even though the DTO accepts them: those are the
 * identity fields the KYC decision was made against, and editing them from
 * here would quietly break the link between a verification and the person it
 * verified.
 */
export function setUsername(userId: string, username: string): Promise<unknown> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ username: username.trim() }),
  });
}

export const CLOSE_MIN_REASON = 5;

/**
 * Close a member's account on their behalf.
 *
 * 🚨 THIS IS NOT A BAN AND NOT A DELETE, AND THE CONFIRM HAS TO SAY BOTH. A
 * ban keeps the profile and the listings up; this takes them off the public
 * side and RELEASES THE HANDLE, email and phone back into the uniqueness
 * namespace so the person can register again — while every transaction,
 * rating and complaint stays attached to the row.
 *
 * ⚠️ IT IS ALSO THE ONLY ROUTE BY WHICH A BANNED MEMBER CAN BE CLOSED. The
 * self-service button refuses a restricted account, precisely so closing can
 * never launder a ban — which means an admin doing it is taking that decision
 * deliberately and the reason is the record of why.
 */
export function closeMemberAccount(userId: string, reason: string): Promise<unknown> {
  return deskFetch(`/admin/users/${encodeURIComponent(userId)}/close-account`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() }),
  });
}
