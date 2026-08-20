import { safeJson } from './safe-json';

// The Licence Centre's API client. Sibling of motivations-api.ts and
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
  | 'DEDICATED_STATUS'
  | 'DEDICATED_HUNTER'
  | 'PROFESSIONAL_HUNTER'
  | 'PROFICIENCY'
  | 'GOOD_STANDING'
  | 'OTHER';

export type ExpiryState = 'valid' | 'expiring' | 'expired' | 'unknown';

export interface CredentialRow {
  id: string;
  kind: CredentialKind;
  title: string;
  issuedOn: string | null;
  expiresOn: string | null;
  /** The member has checked the date. Nothing is reminded on until they have. */
  confirmed: boolean;
  remindersMuted: boolean;
  state: ExpiryState;
  details: Record<string, string>;
  /** Statute-derived expiry when the document prints none. See the proposal. */
  derivedExpiry?: { on: string; why: string } | null;
  available: boolean;
  mimeType: string;
  byteSize: number;
  createdAt: string;
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

  list: (t: TokenGetter) => request<CredentialRow[]>(t, '', {}, []),

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
   * Confirm what we made of a document: its date, and — when we did the
   * naming — its type and title too.
   *
   * ⚠️ The type is not cosmetic. A licence filed as something else is never
   * offered a renewal, and reminder copy is written per type.
   */
  confirm: (
    t: TokenGetter,
    id: string,
    expiresOn: string,
    issuedOn?: string,
    kind?: string,
    title?: string,
  ) =>
    request<{ confirmed: boolean; expiresOn: string }>(t, `/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ expiresOn, issuedOn, kind, title }),
    }),

  mute: (t: TokenGetter, id: string, muted: boolean) =>
    request<{ muted: boolean }>(
      t,
      `/${id}/mute`,
      { method: 'PATCH', body: JSON.stringify({ muted }) },
      { muted },
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

export const KIND_LABELS: Record<CredentialKind, string> = {
  FIREARM_LICENCE: 'Firearm licence',
  COMPETENCY_CERTIFICATE: 'Competency certificate',
  // The two dedicated statuses are separate accreditations with separate
  // certificates and separate expiry dates, even where one association
  // issues both.
  DEDICATED_STATUS: 'Dedicated sport shooter',
  DEDICATED_HUNTER: 'Dedicated hunter',
  // ⚠️ NOT dedicated status. A PH registration is a provincial nature
  // conservation qualification to hunt for a client. It is kept here because
  // it expires and members want it tracked — never because it evidences
  // anything under section 16.
  PROFESSIONAL_HUNTER: 'Professional hunter (PH)',
  PROFICIENCY: 'Proficiency certificate',
  // ⚠️ SEPARATE FROM THE STATUS ITSELF, because it is a separate piece of
  // paper with its OWN validity window — the status certificate carries an
  // issue date and never expires, while the letter runs out. Filing them
  // together would mean chasing the wrong date, which is the one job the
  // vault exists to do.
  GOOD_STANDING: 'Letter of good standing (section 16)',
  OTHER: 'Something else',
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
