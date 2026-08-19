import { safeJson } from './safe-json';

// ────────────────────────────────────────────────────────────────────
// The motivation writer's client-side API.
//
// One place, because the wizard makes a lot of calls and every one of them
// needs the same three things right:
//
//   A FRESH TOKEN PER REQUEST. Clerk tokens are short-lived and the wizard is
//   a long sitting — someone can spend twenty minutes on their circumstances
//   before the next autosave. A token captured on mount is stale by then, so
//   getToken() is called per request, never hoisted.
//
//   safeJson ON EVERY BODY. A raw res.json() throws on an empty 200, which is
//   the norm for PATCH and DELETE here. That crash surfaces to the applicant
//   as a blank page over a request that actually SUCCEEDED.
//
//   413 HANDLED SEPARATELY. nginx rejects an oversized upload ITSELF, with an
//   HTML error page — the request never reaches our API, so there is no JSON
//   to read and no message to show. Without this the applicant gets a generic
//   crash instead of "that file is too big".
// ────────────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type TokenGetter = () => Promise<string | null>;

export class MotivationApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(
  getToken: TokenGetter,
  path: string,
  init: RequestInit = {},
  fallback?: T,
): Promise<T> {
  const token = await getToken();
  const isForm = init.body instanceof FormData;
  const res = await fetch(`${API_URL}/motivations${path}`, {
    ...init,
    headers: {
      // FormData sets its own multipart boundary — setting Content-Type by
      // hand here produces a boundary-less header and multer parses nothing.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 413) {
    throw new MotivationApiError(
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
      : (body.message ??
        'Something went wrong. Please try again in a moment.');
    throw new MotivationApiError(message, res.status, body.code);
  }

  return safeJson<T>(res, (fallback ?? null) as T);
}

// ── types the wizard renders from ───────────────────────────────────

export type FieldKind = 'short' | 'long' | 'date' | 'choice' | 'multi' | 'yesno';

export interface MotivationField {
  key: string;
  label: string;
  kind: FieldKind;
  section: string;
  help?: string;
  choices?: string[];
  required?: true;
  sensitive?: true;
  maxLength?: number;
  showIf?: { key: string; equals: string };
  formOnly?: true;
}

export interface FieldSet {
  licenceType: string;
  label: string;
  version: string;
  fields: MotivationField[];
}

export interface MotivationSummary {
  id: string;
  referenceNumber: string;
  licenceType: string;
  status: string;
  createdAt: string;
}

export interface MotivationDetail extends MotivationSummary {
  answers: Record<string, string>;
  missingRequired: string[];
  declarationAcceptedAt: string | null;
  qualityScore: number | null;
}

export interface ProfileOffer {
  alreadyConsented: boolean;
  fields: { key: string; label: string; value: string; from: string }[];
  missingFromProfile: string[];
  note: string;
}

/** A value read off an uploaded document, awaiting confirmation. */
export interface Suggestion {
  key: string;
  value: string;
  label: string;
  from: string;
  /** False when our own checks disagree with what was read. */
  trusted: boolean;
  note?: string;
}

export interface UploadRow {
  id: string;
  kind: string;
  label: string;
  annexure: string | null;
  byteSize: number;
  available: boolean;
}

export interface FollowUp {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  fieldKey: string | null;
  fieldLabel: string | null;
  createdAt: string;
}

// ── calls ───────────────────────────────────────────────────────────

export const motivationsApi = {
  status: (t: TokenGetter) =>
    request<{ enabled: boolean; priceCents?: number }>(t, '/status', {}, {
      enabled: false,
    }),

  fields: (t: TokenGetter, licenceType: string) =>
    request<FieldSet>(t, `/fields/${licenceType}`),

  list: (t: TokenGetter) => request<MotivationSummary[]>(t, '', {}, []),

  create: (t: TokenGetter, licenceType: string) =>
    request<MotivationDetail>(t, '', {
      method: 'POST',
      body: JSON.stringify({ licenceType }),
    }),

  get: (t: TokenGetter, id: string) => request<MotivationDetail>(t, `/${id}`),

  saveAnswers: (t: TokenGetter, id: string, answers: Record<string, string>) =>
    request<{ missingRequired: string[]; rejected?: string[] }>(
      t,
      `/${id}/answers`,
      { method: 'PATCH', body: JSON.stringify({ answers }) },
      { missingRequired: [] },
    ),

  profileOffer: (t: TokenGetter, id: string) =>
    request<ProfileOffer>(t, `/${id}/profile-offer`),

  useProfile: (t: TokenGetter, id: string) =>
    request<{ filled: number; missingRequired: string[] }>(
      t,
      `/${id}/use-profile`,
      { method: 'POST' },
      { filled: 0, missingRequired: [] },
    ),

  uploads: (t: TokenGetter, id: string) =>
    request<UploadRow[]>(t, `/${id}/uploads`, {}, []),

  addUpload: async (t: TokenGetter, id: string, kind: string, file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    // The response carries SUGGESTIONS read off the document. They are not
    // answers yet — the applicant confirms them first.
    return request<UploadRow & { suggestions?: Suggestion[] }>(
      t,
      `/${id}/uploads`,
      { method: 'POST', body: form },
    );
  },

  /** Write the suggestions the applicant accepted. */
  applyExtraction: (
    t: TokenGetter,
    id: string,
    answers: Record<string, string>,
  ) =>
    request<{ filled: number; missingRequired: string[] }>(
      t,
      `/${id}/uploads/apply`,
      { method: 'POST', body: JSON.stringify({ answers }) },
      { filled: 0, missingRequired: [] },
    ),

  removeUpload: (t: TokenGetter, id: string, uploadId: string) =>
    request<{ removed: boolean }>(
      t,
      `/${id}/uploads/${uploadId}`,
      { method: 'DELETE' },
      { removed: true },
    ),

  messages: (t: TokenGetter, id: string) =>
    request<FollowUp[]>(t, `/${id}/messages`, {}, []),

  answerFollowUp: (
    t: TokenGetter,
    id: string,
    messageId: string,
    answer: string,
  ) =>
    request<{ outstandingQuestions: number; missingRequired: string[] }>(
      t,
      `/${id}/messages/${messageId}`,
      { method: 'POST', body: JSON.stringify({ answer }) },
      { outstandingQuestions: 0, missingRequired: [] },
    ),

  acceptDeclaration: (t: TokenGetter, id: string, testimonialConsent: boolean) =>
    request<{ accepted: boolean }>(
      t,
      `/${id}/declaration`,
      { method: 'POST', body: JSON.stringify({ testimonialConsent }) },
      { accepted: true },
    ),

  generate: (t: TokenGetter, id: string) =>
    request<{ status: string; score?: number }>(t, `/${id}/generate`, {
      method: 'POST',
    }),

  checklist: (t: TokenGetter, id: string) =>
    request<{
      sections: {
        key: string;
        title: string;
        intro?: string;
        items: {
          key: string;
          label: string;
          owner: string;
          done: boolean;
          annexure?: string;
          note?: string;
          subItems?: { key: string; label: string }[];
        }[];
      }[];
      oursDone: number;
      oursTotal: number;
      theirsTotal: number;
    }>(t, `/${id}/checklist`),

  /** The finished document. Blob, not JSON — it is a PDF. */
  pdfUrl: (id: string) => `${API_URL}/motivations/${id}/pdf`,
};

/**
 * Only the fields that apply right now.
 *
 * Mirrors isVisible() on the backend. Both halves have to agree about what is
 * being asked, or the wizard shows a question the server will not accept —
 * or hides one it insists on.
 */
export function visibleFields(
  fields: MotivationField[],
  answers: Record<string, string>,
): MotivationField[] {
  return fields.filter(
    (f) =>
      !f.showIf || (answers[f.showIf.key] ?? '').trim() === f.showIf.equals,
  );
}

/** Section order, as the registry lists them — not alphabetical. */
export function groupBySection(
  fields: MotivationField[],
): { section: string; fields: MotivationField[] }[] {
  const out: { section: string; fields: MotivationField[] }[] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (last && last.section === f.section) last.fields.push(f);
    else out.push({ section: f.section, fields: [f] });
  }
  return out;
}
