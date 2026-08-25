import { safeJson } from './safe-json';

// The Document Centre's API client. ⚠️ The FILE and the ROUTE keep the old
// name deliberately — only what a member reads was renamed, because a phone
// mid-hand-off holds a token minted against /licence-centre/scan. Sibling of motivations-api.ts and
// deliberately the same shape — four properties have to survive the copy:
//   1. the token is fetched INSIDE request(), never hoisted, or a long session
//      sends an expired one
//   2. safeJson on every body — an empty 200 on PATCH/DELETE is the norm here
//   3. 413 is handled BEFORE !res.ok, because nginx rejects an oversized
//      upload itself with an HTML page and there is no JSON to parse
//   4. `fallback` is optional: omit it for calls that must have a body

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type TokenGetter = () => Promise<string | null>;

export class LicenceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export type CredentialKind =
  | 'FIREARM_LICENCE'
  | 'COMPETENCY_CERTIFICATE'
  /** Everything an association says about a member. See KIND_LABELS. */
  | 'DEDICATED_DISCIPLINE'
  | 'DEDICATED_STATUS'
  | 'DEDICATED_HUNTER'
  | 'PROFESSIONAL_HUNTER'
  | 'PROFICIENCY'
  | 'GOOD_STANDING'
  | 'OTHER'
  // ── the documents the Centre keeps rather than chases ──────────────
  //
  // ⚠️ THIS UNION IS HAND-WRITTEN AND NOTHING LINKS IT TO PRISMA. Omit a kind
  // here and the build still passes, the server still returns it, and
  // KIND_LABELS[kind] renders `undefined` on the card with no error and no
  // failing test. So every value added to CredentialKind in schema.prisma has
  // to be added here by hand, in the same commit.
  | 'IDENTITY_DOCUMENT'
  | 'ADDRESS_CONFIRMATION'
  | 'EMPLOYMENT_CONFIRMATION'
  | 'SAFE_PHOTOGRAPHS'
  // Retired 2026-08-23 with the rest of the safe kinds, and kept for the same
  // reason as the association four above: a row filed before the collapse must
  // still render a label rather than `undefined`.
  | 'SAFE_PHOTO_CLOSED'
  | 'SAFE_PHOTO_AJAR'
  | 'SAFE_PHOTO_BOLTS'
  | 'SAFE_INSTALLATION'
  | 'SHOOTING_ACTIVITY_LOG';

/**
 * ⚠️ 'no-expiry' IS A REAL STATE, NOT A MISSING DATE. A photograph of a gun
 * safe has nothing to expire, and showing it as `unknown` — "date not
 * confirmed" — tells the member to go and find a date that does not exist.
 * It must also never fall through to `valid`, which would print "In date"
 * over a folder of photographs.
 */
/** See components/vault-consent.tsx and the server's vault-consent.ts. */
export type ConsentState =
  | 'never-asked'
  | 'declined'
  | 'given'
  | 'stale'
  | 'withdrawn';

export type ExpiryState =
  | 'valid'
  | 'expiring'
  | 'expired'
  | 'unknown'
  | 'no-expiry';

export interface CredentialRow {
  id: string;
  kind: CredentialKind;
  title: string;
  issuedOn: string | null;
  expiresOn: string | null;
  /** The member has checked the date. Nothing is reminded on until they have. */
  confirmed: boolean;
  /**
   * The two ticks, as the MEMBER answered them — never inferred from the kind.
   *
   * ⚠️ `neverExpires` IS AN ANSWER, `expiresOn: null` IS A GAP. They look the
   * same on the wire and they are opposites on the screen: the first is a
   * settled document that is simply kept on file, the second is a date nobody
   * has supplied yet. Reading only `expiresOn` is what made the page tell a
   * member holding nine photographs of a gun safe that nine documents still
   * needed their dates checked.
   *
   * `issuedOnUnknown` is the same shape of answer for the issue date: null
   * because nobody knows, rather than null because nobody has looked.
   */
  neverExpires: boolean;
  issuedOnUnknown: boolean;
  /**
   * Other roles this ONE document also fills — a membership certificate that
   * is also the letter of good standing and the dedicated status proof.
   * Usually empty. One row, several roles: never a second row for the same
   * file, which would print the same page twice as two annexures.
   */
  coversKinds: CredentialKind[];
  remindersMuted: boolean;
  state: ExpiryState;
  /**
   * Close enough that offering a renewal helps rather than nags — six months.
   *
   * ⚠️ NOT the same as `state === 'expiring'`, which turns amber at 90 days.
   * Ninety days IS the section 24(1) deadline, so a renewal first offered
   * there arrives on the last day it can be lodged.
   */
  renewalDue: boolean;
  details: Record<string, string>;
  /** Statute-derived expiry when the document prints none. See the proposal. */
  derivedExpiry?: { on: string; why: string } | null;
  available: boolean;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  /**
   * WE named this one, not the member — so there is a guess on it to check.
   *
   * ⚠️ STORED NOW, WHICH IS THE ONLY REASON THE REVIEW SURVIVES A REFRESH.
   * Both of these used to exist solely in the create response, so rebuilding
   * the check-these list from here had to assume the worst for every row: nine
   * documents we were sure about read exactly like the three we were not.
   */
  autoFiled: boolean;
  /** Only meaningful while autoFiled. False reads as "not sure", never "sure". */
  namedConfident: boolean;
  /**
   * Who put the expiry date there: null, 'read' or 'derived'.
   *
   * ⚠️ NON-NULL MEANS WE FILLED IT IN AND NOBODY HAS CHECKED IT — and that
   * the reminder is nonetheless armed. Operator, 2026-08-25: "insert it. No
   * further user interaction required." The row must say so plainly and must
   * never claim the member confirmed it.
   */
  dateSource: 'read' | 'derived' | null;
  /** The sentence saying where the date came from. Safe to show as-is. */
  dateSourceNote: string | null;
}

/** What came back from adding one document. */
export interface AddedCredential {
  id: string;
  kind: CredentialKind;
  title: string;
  /** WE named this one, not the member — so the confirm step asks. */
  autoFiled?: boolean;
  /** Only meaningful when autoFiled: whether we were sure. */
  confident?: boolean;
  /**
   * The two ticks as the row was created with them.
   *
   * ⚠️ OPTIONAL BECAUSE POST /licence-centre DOES NOT SEND THEM TODAY — the
   * create response carries id, kind, title, autoFiled, confident and the
   * proposal, and nothing else. The server nonetheless pre-ticks
   * "Never expires" on a photograph of a safe (defaultsToNeverExpires), so a
   * confirm step that assumed `false` would show that box unticked, demand a
   * date off a photograph, and post the tick back off again. AddPanel fills
   * these in from the list endpoint, which does return both; see the merge in
   * uploadFiles.
   */
  neverExpires?: boolean;
  issuedOnUnknown?: boolean;
  /**
   * What the browser called the file, so a review row knows whether spending
   * a fetch on a thumbnail could possibly draw one.
   *
   * ⚠️ A HINT, NOT A VERDICT — it is the declared type, copied verbatim and
   * never re-checked against the bytes. Optional because the caller has the
   * File in hand either way and can fall back to its own `type`.
   */
  mimeType?: string;
  proposed: CredentialProposal;
}

export interface CredentialProposal {
  expiresOn: string | null;
  issuedOn: string | null;
  details: Record<string, string>;
  lowConfidence: string[];
  /**
   * An expiry worked out from a statute rather than read off the page.
   *
   * Only where the law fixes it — a competency certificate lapses five years
   * after issue — and always with the reason, because a date with no reason
   * behind it is indistinguishable from one we claim to have read.
   */
  derivedExpiry?: { on: string; why: string } | null;
}

async function request<T>(
  getToken: TokenGetter,
  path: string,
  init: RequestInit = {},
  fallback?: T,
): Promise<T> {
  const token = await getToken();
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_URL}/licence-centre${path}`, {
    ...init,
    headers: {
      // FormData sets its own multipart boundary — setting Content-Type by
      // hand produces a boundary-less header and multer parses nothing.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 413) {
    throw new LicenceApiError(
      'That file is too large. Please use one under 10 MB.',
      413,
    );
  }

  if (!res.ok) {
    const body = await safeJson<{ message?: string | string[]; code?: string }>(
      res,
      {},
    );
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : (body.message ?? 'Something went wrong. Please try again in a moment.');
    throw new LicenceApiError(message, res.status, body.code);
  }

  return safeJson<T>(res, (fallback ?? null) as T);
}

export const licenceCentreApi = {
  status: (t: TokenGetter) =>
    request<{ enabled: boolean; reminders: boolean; maxCredentials: number }>(
      t,
      '/status',
      {},
      { enabled: false, reminders: false, maxCredentials: 0 },
    ),

  /**
   * Where every stored document already appears, keyed by credential id.
   *
   * ⚠️ FALLS BACK TO EMPTY RATHER THAN THROWING. This is a "by the way" line
   * under a document; a member whose applications failed to load should still
   * be able to confirm a date and delete a file. Nothing on this screen
   * depends on it.
   */
  usage: (t: TokenGetter) =>
    request<Record<string, CredentialUsage[]>>(t, '/usage', {}, {}),

  list: (t: TokenGetter) => request<CredentialRow[]>(t, '', {}, []),

  /**
   * Is there an ID copy from verification we could keep for them?
   *
   * ⚠️ FALLS BACK TO "NO OFFER" RATHER THAN THROWING. This renders a card at
   * the end of being verified; a failed call must cost the offer, never put
   * an error on the page somebody sees the moment they are told they passed.
   */
  kycIdOffer: (t: TokenGetter) =>
    request<{ available: boolean; alreadyThere: boolean }>(
      t,
      '/kyc-id',
      {},
      { available: false, alreadyThere: false },
    ),

  /** Yes, keep it. Covers this one document — not the blanket permission. */
  adoptKycId: (t: TokenGetter) =>
    request<{ added: boolean; credentialId?: string }>(t, '/kyc-id', {
      method: 'POST',
    }),

  // ── may we keep the paperwork from your applications? ──────────────
  //
  // ⚠️ NONE OF THESE ARE FLAG-GATED SERVER-SIDE. The Motivation Centre has to
  // know the answer whether or not the Document Centre is open, or a page that
  // cannot ask renders as though nobody ever consented — and puts the window
  // in front of somebody who already said yes.

  /** Falls back to "already answered" so a failed call never re-asks. */
  consent: (t: TokenGetter) =>
    request<{
      state: ConsentState;
      version: string;
      ask: boolean;
      keeping: boolean;
      backfillDone: boolean;
      /** From the setting, so the window never hard-codes "two years". */
      retentionDays: number;
    }>(
      t,
      '/consent',
      {},
      {
        state: 'given',
        version: '',
        ask: false,
        keeping: false,
        backfillDone: true,
        retentionDays: 730,
      },
    ),

  answerConsent: (t: TokenGetter, agreed: boolean) =>
    request<{ state: ConsentState }>(t, '/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agreed }),
    }),

  /** ⚠️ Deletes nothing — it stops us keeping anything NEW. */
  withdrawConsent: (t: TokenGetter) =>
    request<{ state: ConsentState }>(t, '/consent', { method: 'DELETE' }),

  /** One bounded batch of the older documents. The caller loops until done. */
  backfillStep: (t: TokenGetter) =>
    request<{
      adopted: number;
      skippedPurged: number;
      cappedOut: number;
      done: boolean;
      remaining: number;
    }>(t, '/consent/backfill-step', { method: 'POST' }),

  /**
   * Add one document.
   *
   * `kind` may be EMPTY, which means "sort it for me": the server names the
   * document from its contents and the confirm step shows the member what it
   * made of it. That is how a whole folder goes in at once.
   */
  create: (t: TokenGetter, kind: string, title: string, file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('title', title);
    form.append('file', file);
    return request<AddedCredential>(t, '', { method: 'POST', body: form });
  },

  /**
   * Confirm what we made of a document: its dates, and — when we did the
   * naming — its type and title too.
   *
   * ⚠️ The type is not cosmetic. A licence filed as something else is never
   * offered a renewal, and reminder copy is written per type.
   *
   * ⚠️ AN OBJECT, NOT SIX POSITIONAL ARGUMENTS, and for the same reason
   * confirmExpiry on the server took one: the two ticks pushed this to six
   * arguments of which four are optional, and `(t, id, expiresOn, issuedOn,
   * kind, title)` is a line nobody can read at the call site. Transposing two
   * of them compiles when both are strings.
   *
   * ⚠️ `expiresOn` MAY BE EMPTY when `neverExpires` is true. The server checks
   * the tick first and only then parses the date, so the empty string is the
   * honest thing to send — there is no date.
   */
  confirm: (
    t: TokenGetter,
    id: string,
    args: {
      expiresOn: string;
      issuedOn?: string;
      neverExpires?: boolean;
      issuedOnUnknown?: boolean;
      kind?: string;
      title?: string;
    },
  ) =>
    // ⚠️ `expiresOn` COMES BACK NULL ON A TICKED ROW. confirmExpiry returns
    // `expiry ? toIsoDate(expiry) : null`, and typing it as a bare string
    // invites the next caller to read `.slice(0, 4)` off it for a year.
    request<{ confirmed: boolean; expiresOn: string | null }>(
      t,
      `/${id}/confirm`,
      { method: 'POST', body: JSON.stringify(args) },
    ),

  mute: (t: TokenGetter, id: string, muted: boolean) =>
    request<{ muted: boolean }>(
      t,
      `/${id}/mute`,
      { method: 'PATCH', body: JSON.stringify({ muted }) },
      { muted },
    ),

  /**
   * Rename a document. Deliberately NOT part of confirm(), which also accepts
   * a title: confirming says the DATES are right, and making somebody
   * re-confirm an expiry to fix a spelling is how a wrong date gets confirmed
   * by reflex.
   */
  rename: (t: TokenGetter, id: string, title: string) =>
    request<{ title: string }>(
      t,
      `/${id}/title`,
      { method: 'PATCH', body: JSON.stringify({ title }) },
      { title },
    ),

  remove: (t: TokenGetter, id: string) =>
    request<{ removed: boolean }>(
      t,
      `/${id}`,
      { method: 'DELETE' },
      { removed: true },
    ),

  /**
   * Start a section 24 renewal pack from this document.
   *
   * Returns the new motivation, which the caller navigates to. The backend
   * refuses by name — wrong document type, unconfirmed date, no licence
   * number — and those messages are shown as-is.
   */
  renew: (t: TokenGetter, id: string) =>
    request<{ motivationId: string; referenceNumber: string; seeded: number }>(
      t,
      `/${id}/renew`,
      { method: 'POST' },
    ),

  /**
   * The file endpoint needs an Authorization header, so <img src> and <a href>
   * cannot reach it. Fetch the bytes and hand back an object URL.
   *
   * ⚠️ The caller owns the URL and must revokeObjectURL it, or the blob is
   * pinned in memory for the life of the tab.
   */
  fileBlobUrl: async (t: TokenGetter, id: string): Promise<string> => {
    const token = await t();
    const r = await fetch(`${API_URL}/licence-centre/${id}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      throw new LicenceApiError('We could not open that document.', r.status);
    }
    return URL.createObjectURL(await r.blob());
  },
};

/**
 * One application a stored document already appears in.
 *
 * ⚠️ MATCHED ON THE FILE'S FINGERPRINT, not on a stored link — attaching a
 * document copies its bytes, and both rows keep sha256 of the same plaintext.
 * Worth knowing at the call site: replacing a document with a newer scan
 * changes its bytes, so packs built from the old file stop matching.
 */
export interface CredentialUsage {
  motivationId: string;
  referenceNumber: string;
  licenceType: string;
  status: string;
  /** Null until the pack has enough attached for this kind to be lettered. */
  annexure: string | null;
}

export const KIND_LABELS: Record<CredentialKind, string> = {
  FIREARM_LICENCE: 'Firearm licence',
  COMPETENCY_CERTIFICATE: 'Competency certificate',
  // ⚠️ ONE LINE WHERE THERE WERE FOUR. A membership certificate, a dedicated
  // sport shooter or hunter status, a section 16 letter of good standing and
  // a professional hunter registration all arrive from an association about
  // the same member — and one page routinely does several of those jobs at
  // once. Four menu entries made the member choose, and made us guess.
  DEDICATED_DISCIPLINE: 'Association status or membership',
  PROFICIENCY: 'Proficiency certificate',
  OTHER: 'Something else',
  // ── retired, never offered ───────────────────────────────────────────
  // Kept only so rows filed before the consolidation still render a label
  // instead of a raw enum name. Postgres cannot drop an enum value.
  DEDICATED_STATUS: 'Dedicated sport shooter',
  DEDICATED_HUNTER: 'Dedicated hunter',
  PROFESSIONAL_HUNTER: 'Professional hunter (PH)',
  GOOD_STANDING: 'Letter of good standing (section 16)',
  // ── kept, never chased ───────────────────────────────────────────────
  IDENTITY_DOCUMENT: 'ID document',
  ADDRESS_CONFIRMATION: 'Proof of address',
  EMPLOYMENT_CONFIRMATION: 'Confirmation of employment',
  // ⚠️ ONE LINE WHERE THERE WERE FOUR. Operator, 2026-08-23: "I dont like the
  // safe picture being seperate four uploads, looks shit. Make it safe
  // pictures. User must be able to upload multiple documents." Four entries
  // made the member choose between shots that differ by how far a door is
  // open, and made the classifier guess — so it was pinned to low confidence
  // on all four and a wrong guess filed the bolts shot under the closed-door
  // annexure.
  SAFE_PHOTOGRAPHS: 'Photographs of my safe',
  // Retired 2026-08-23, never offered. Labels only, for older rows.
  SAFE_PHOTO_CLOSED: 'Safe, closed',
  SAFE_PHOTO_AJAR: 'Safe, half open',
  SAFE_PHOTO_BOLTS: 'Safe, open with bolts showing',
  SAFE_INSTALLATION: 'How the safe is installed',
  SHOOTING_ACTIVITY_LOG: 'Record of hunts and shoots',
};

/** Colour and words for each state. `unknown` is a real state, not a blank. */
export const STATE_TONE: Record<
  ExpiryState,
  { label: string; colour: string; wash: string; line: string }
> = {
  valid: {
    label: 'In date',
    colour: 'var(--success)',
    wash: 'rgba(47,158,107,0.10)',
    line: 'rgba(47,158,107,0.38)',
  },
  expiring: {
    label: 'Renewal due',
    colour: 'var(--warning)',
    wash: 'rgba(212,154,58,0.10)',
    line: 'rgba(212,154,58,0.38)',
  },
  expired: {
    label: 'Expired',
    colour: 'var(--red)',
    wash: 'rgba(200,16,46,0.10)',
    line: 'rgba(200,16,46,0.38)',
  },
  unknown: {
    label: 'Date not confirmed',
    colour: 'var(--text-tertiary-on-card)',
    wash: 'transparent',
    line: 'var(--border)',
  },
  // ⚠️ "KEPT ON FILE", NOT "DATE NOT CONFIRMED". Nothing is outstanding on a
  // photograph of a safe or a copy of an ID — there is no date to confirm and
  // no reminder to schedule. Neutral rather than amber, because amber reads as
  // something the member still has to go and do.
  'no-expiry': {
    label: 'Kept on file',
    colour: 'var(--text-secondary)',
    wash: 'transparent',
    line: 'var(--border)',
  },
};

/** Long form, because the YEAR is the whole point of this screen. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
