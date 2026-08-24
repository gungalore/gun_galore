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
    /**
     * The field keys the server is holding out for.
     *
     * ⚠️ THE SERVER HAS ALWAYS SENT THESE and nothing ever read them. "Some
     * required answers are still missing" with no list is a dead end: the
     * member is looking at a form where everything they can see is filled in,
     * and the one thing that would let them act — WHICH answers — was in the
     * response body being thrown away.
     */
    readonly missing?: string[],
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
    const body = await safeJson<{
      message?: string | string[];
      code?: string;
      missing?: string[];
    }>(res, {});
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : (body.message ??
        'Something went wrong. Please try again in a moment.');
    throw new MotivationApiError(message, res.status, body.code, body.missing);
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
  /**
   * `date` fields only — where the three-step picker opens.
   *
   * A competency issued two years ago, a dedicated status held for ten and a
   * section 24 renewal lodged this year are not reconcilable by heuristic, and
   * guessing wrong costs a member several taps on the very first screen. So
   * each date field says for itself.
   */
  focusOffsetYears?: number;
  /** 'far' adds a decade strip, for a field that reaches back decades. */
  reach?: 'near' | 'far';
  /**
   * A grouped option list, served rather than written into the registry —
   * fifty-nine shooting disciplines with their governing bodies.
   */
  optionGroups?: {
    group: string;
    options: { value: string; label: string; hint?: string }[];
  }[];
  /** Choosing an option seeds THIS field with text belonging to that option. */
  prefills?: string;
  /** option value -> the text seeded into `prefills`. */
  prefillText?: Record<string, string>;
  /** "Something else" is offered, revealing `${key}_other`. */
  allowOther?: boolean;
  /**
   * A document can answer this. Mirrors docSourced in motivation-fields.ts,
   * and holds the MotivationUploadKind that carries the value.
   *
   * When we have ALREADY filled it in — off a document or from the member's
   * profile — the wizard renders it in place, greyed, with an edit pen. It is
   * never taken off the form.
   *
   * ⚠️ Whether it is locked is decided ONCE, from what was present when the
   * application loaded. An earlier version tested the live answer, so a field
   * locked itself the moment it held one character and the box vanished from
   * under the cursor mid-word.
   */
  docSourced?: string;
}

export interface FieldSet {
  licenceType: string;
  label: string;
  version: string;
  fields: MotivationField[];
}

/** What /status actually returns. Mirrors MotivationQuotaStatus on the server. */
export interface MotivationQuotaStatus {
  enabled: boolean;
  /** Free-beta seats left. */
  freeRemaining: number;
  cap: number;
  used: number;
  priceCents: number;
  /** False while payments are off AND the free cap is exhausted. */
  canStart: boolean;
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
  /**
   * Something has been written. TRUE FOR A DRAFT THAT DID NOT PASS, so it is
   * not a synonym for "finished" — pair it with `status === 'COMPLETED'` for
   * that. It gates the reading copy; the PDF stays behind COMPLETED.
   */
  hasDocument: boolean;
  /**
   * Whether the applicant already holds a firearm in the same class as the one
   * applied for — the ".308 and .270 are both medium game" question the
   * Registrar asks whether or not we do. Computed server-side from the
   * firearms-owned rows.
   */
  overlap?: { needsJustification: boolean; prompt: string | null };
  /** Which of the fifteen templates this pack is set in. */
  template?: { format: TemplateFormat; colourway: Colourway };
  /**
   * The document still carries the PREVIEW mark.
   *
   * True until the pack is paid for or holds a free-beta seat. Payments are
   * not live, so today this is on for almost everyone — which is the right
   * way round: the mark is the only thing between an unpaid pack and a
   * fileable one.
   */
  watermarked?: boolean;
}

/**
 * One format since 2026-08-21 — the operator withdrew Concise and Standard.
 * Kept as a named type because the field is still on the wire and still
 * stored, and older rows hold the withdrawn values.
 */
export type TemplateFormat = 'comprehensive';

/** The ten schemes from the design handoff. */
export type Colourway =
  | 'eucalyptus'
  | 'slate'
  | 'stone'
  | 'sage'
  | 'fogblue'
  | 'clay'
  | 'olive'
  | 'sand'
  | 'graphite'
  | 'mauve';

export interface TemplateFormatOption {
  key: TemplateFormat;
  name: string;
  blurb: string;
  includes: string[];
  lengthHint: string;
  /** Which blocks the mock page draws. Mirrors the renderer's FORMAT_FEATURES. */
  features: { contents: boolean; ownedTable: boolean; specBlock: boolean };
}

/**
 * A scheme, with all eight variables the document is drawn from.
 *
 * \u26a0\ufe0f THIS TYPE UNDER-DECLARED THE RESPONSE ONCE ALREADY, in exactly the
 * way motivationsApi.status did: it named ink/tint/rule while the server sent
 * eight variables. A client type that lists fewer fields than arrive does not
 * merely lose them \u2014 it hides them from the next person to look, and the
 * preview silently drew `undefined` for two of its colours.
 *
 * Names and meanings are the handoff's own, so a value can be checked against
 * the reference without translating.
 */
export interface TemplateColourOption {
  key: Colourway;
  name: string;
  /** Banner gradient start, section node, annexure cross-references. */
  deep: string;
  /** Banner gradient end, and the text colour of a highlight band. */
  deep2: string;
  /** Body text. */
  ink: string;
  /** Secondary prose. */
  sub: string;
  /** Labels, footer strip, small caps. */
  mut: string;
  /** The highlight band behind a section title. */
  band: string;
  /** Hairlines, table rules, panel borders. */
  hair: string;
  /** Panel and footer backgrounds. */
  wash: string;
}

/**
 * The fifteen templates, served rather than hard-coded.
 *
 * ⚠️ THE HEX VALUES COME FROM THE RENDERER. Keeping a copy of "#2A4A32"
 * in the frontend would be right on the day it was written and wrong the
 * first time somebody adjusted the ink — and the failure is the worst kind:
 * a member picks a colour, pays, and the PDF arrives a different one.
 */
export interface TemplateCatalogue {
  formats: TemplateFormatOption[];
  colours: TemplateColourOption[];
  defaults: { format: TemplateFormat; colourway: Colourway };
}

/** What the member's own Document Centre could fill in here. */
/** One vault document offered as a source for a group of fields. */
export interface CredentialChoice {
  credentialId: string;
  title: string;
  expiresOn: string | null;
  /** Field key → the value this document would put there. */
  values: Record<string, string>;
}

/**
 * One document the member already has, offered for reuse.
 *
 * ⚠️ ONE ENTRY PER DOCUMENT, not per stored copy. The same photograph reused
 * onto a second motivation is a second row in the database; the server dedupes
 * on content so the member is never asked to choose between two identical
 * lines.
 */
export interface LibraryItem {
  source: 'credential' | 'upload';
  sourceId: string;
  kind: string;
  title: string;
  addedOn: string;
  /** Already attached to the motivation being filled in. */
  alreadyHere: boolean;
  /**
   * A note to show beside it, or null.
   *
   * ⚠️ A WARNING, NOT A BLOCK. A proof of address four months old is still
   * theirs to send and they may have a reason; what must never happen is it
   * going in silently and a DFO being the one to notice. 'stale' means we can
   * see the problem from the date, 'ask' means only they can know.
   */
  caution: { tone: 'ask' | 'stale'; text: string } | null;
  /**
   * Needs "this is the safe at the address on this application" ticked first.
   *
   * A safe photograph does not go stale with time — it goes wrong when the
   * applicant moves house, and nothing on the file says so.
   */
  askPlace: boolean;
}

export interface LicenceCentreOffer {
  /** Nothing in the vault at all. */
  empty: boolean;
  items: {
    key: string;
    label: string;
    value: string;
    /** The vault document it came from, in the member's own words. */
    from: string;
    credentialId: string;
  }[];
  /** Looked at, took nothing from, and why. */
  skipped: { title: string; why: string }[];
  /** Vault documents that also answer a required upload on this pack. */
  documents: {
    credentialId: string;
    title: string;
    kind: string;
    satisfies: string;
    expiresOn: string | null;
  }[];
  /**
   * What the member can CHOOSE from, per group — as opposed to `items`, which
   * is what we would fill if they pressed the one button. Somebody holding
   * two competency certificates has to be asked which.
   */
  choices: {
    competency: CredentialChoice[];
    dedicated: CredentialChoice[];
  };
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

export interface AddedUpload extends UploadRow {
  suggestions?: Suggestion[];
  /** We chose the type, not the member — so offer a correction. */
  autoFiled?: boolean;
  confident?: boolean;
}

export interface UploadRow {
  id: string;
  kind: string;
  label: string;
  annexure: string | null;
  byteSize: number;
  available: boolean;
  /**
   * Filed as something it does not look like.
   *
   * Inferred from the extraction that already ran: a document filed as a
   * competency certificate that yielded none of the fields a competency
   * certificate carries is probably on the wrong line. Only set for kinds we
   * can actually read — a photograph of a safe extracts nothing by design.
   */
  suspect?: boolean;
}

export interface DocumentNeed {
  kind: string;
  label: string;
  /** 'expected' = no statute behind it, and the DFO will insist anyway. */
  tier: 'required' | 'expected' | 'strengthens' | 'extra';
  why: string;
  have: boolean;
  /**
   * How many FILES this line wants before `have` goes true. Absent means one.
   *
   * Only the safe sets it, at three. It used to be three separate kinds with
   * three menu entries; the server counts files now, and the row's `why` names
   * every shot.
   */
  minFiles?: number;
  /**
   * One short line naming what a multi-file row still wants.
   *
   * ⚠️ `why` renders only on the SELECTED row, and the shots the safe wants
   * have to be readable without selecting anything — which is what the four
   * separate menu entries used to do for free.
   */
  minFilesNote?: string;
}

/**
 * One choice in the "document type" menu.
 *
 * SERVED, NOT HARD-CODED. This list used to live in the wizard as a literal
 * array and it had already drifted from the backend: it omitted two kinds
 * outright and described the safe photograph in the singular while the server
 * asked for three separate shots. A list maintained in two places is a list
 * maintained in neither — and the safe has changed shape twice since.
 */
export interface PickableKind {
  kind: string;
  label: string;
  tier: 'required' | 'strengthens' | 'extra';
  /** Already attached. `tier === 'required' && !have` is "still outstanding". */
  have: boolean;
}

export interface DocumentStatus {
  needs: DocumentNeed[];
  missingRequired: string[];
  extras: string[];
  requiredTotal: number;
  requiredHave: number;
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
  /**
   * Whether the module is open, and whether a new one can be started.
   *
   * ⚠️ THE TYPE USED TO DECLARE ONLY { enabled, priceCents? } WHILE THE
   * SERVER SENT SIX FIELDS. That is not a cosmetic omission: `canStart` was
   * invisible to anyone writing against this client, so the motivations page
   * rendered five enabled "start a new one" buttons that the server refused
   * with a 409 — and the member saw nothing happen at all.
   *
   * A client type that under-declares its response does not just lose
   * information, it hides the information from the next person to look.
   */
  status: (t: TokenGetter) =>
    request<MotivationQuotaStatus>(t, '/status', {}, {
      enabled: false,
      freeRemaining: 0,
      cap: 0,
      used: 0,
      priceCents: 0,
      // ⚠️ FALSE ON A FAILED READ. If we cannot tell whether a motivation
      // may be started, offering the buttons is the wrong guess: the click
      // 409s and the member is back where they started.
      canStart: false,
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

  /**
   * ⚠️ `refused` IS NOT COSMETIC. It names registered fields whose value the
   * server would not store — the answer is gone, and until this was read the
   * wizard still said "Saved". (The old declaration here said `rejected`,
   * which the server has never sent; it sends `ignored`. A key nothing could
   * ever match is indistinguishable from a check nobody wrote.)
   */
  saveAnswers: (t: TokenGetter, id: string, answers: Record<string, string>) =>
    request<{
      missingRequired: string[];
      ignored?: string[];
      refused?: string[];
    }>(
      t,
      `/${id}/answers`,
      { method: 'PATCH', body: JSON.stringify({ answers }) },
      { missingRequired: [] },
    ),

  profileOffer: (t: TokenGetter, id: string) =>
    request<ProfileOffer>(t, `/${id}/profile-offer`),

  /**
   * What their vault would fill in, and where each value comes from.
   * Read-only: showing the list before asking is the point.
   */
  licenceCentreOffer: (t: TokenGetter, id: string) =>
    request<LicenceCentreOffer>(
      t,
      `/${id}/licence-centre-offer`,
      {},
      {
        empty: true,
        items: [],
        skipped: [],
        documents: [],
        choices: { competency: [], dedicated: [] },
      },
    ),

  /**
   * Everything this member could reuse instead of photographing it again —
   * their vault plus every document on their other motivations.
   */
  library: (t: TokenGetter, id: string) =>
    request<{ items: LibraryItem[]; suggested: LibraryItem[] }>(
      t,
      `/${id}/library`,
      {},
      { items: [], suggested: [] },
    ),

  /** Attach one, without asking for the file again. */
  addFromLibrary: (
    t: TokenGetter,
    id: string,
    source: 'credential' | 'upload',
    sourceId: string,
    /** "These are the safe at the address on this application." */
    placeConfirmed = false,
  ) =>
    request<AddedUpload & { alreadyHad: boolean }>(
      t,
      `/${id}/uploads/from-library`,
      {
        method: 'POST',
        body: JSON.stringify({ source, sourceId, placeConfirmed }),
      },
    ),

  /** They agree, and we copy. Never overwrites an answer they typed. */
  useLicenceCentre: (t: TokenGetter, id: string) =>
    request<{
      filled: number;
      answers: Record<string, string>;
      missingRequired: string[];
    }>(t, `/${id}/use-licence-centre`, { method: 'POST' }),

  useProfile: (t: TokenGetter, id: string) =>
    request<{ filled: number; missingRequired: string[] }>(
      t,
      `/${id}/use-profile`,
      { method: 'POST' },
      { filled: 0, missingRequired: [] },
    ),

  uploads: (t: TokenGetter, id: string) =>
    request<{
      files: UploadRow[];
      documents: DocumentStatus;
      kinds: PickableKind[];
    }>(
      t,
      `/${id}/uploads`,
      {},
      {
        files: [],
        documents: {
          needs: [],
          missingRequired: [],
          extras: [],
          requiredTotal: 0,
          requiredHave: 0,
        },
        kinds: [],
      },
    ),

  /**
   * Add one document.
   *
   * `kind` may be EMPTY, which means "sort it for me" — the server names the
   * document from its contents. That is how a whole pack goes up at once: the
   * member cannot label files that do not exist yet.
   */
  addUpload: async (t: TokenGetter, id: string, kind: string, file: File) => {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    // The response carries SUGGESTIONS read off the document. They are not
    // answers yet — the applicant confirms them first.
    return request<AddedUpload>(
      t,
      `/${id}/uploads`,
      { method: 'POST', body: form },
    );
  },

  // ── The previous owner's consent, for a private transfer ────────
  //
  // ⚠️ THE FIREARM IS SENT WITH THE INVITE, not read server-side at signing
  // time. It is snapshotted the moment the link goes out so the seller signs
  // for the firearm they were shown — see the schema note on
  // firearmSnapshotEncrypted.
  inviteSellerConsent: (
    t: TokenGetter,
    id: string,
    body: {
      name: string;
      phone: string;
      applicantName: string;
      firearm: Record<string, string | undefined>;
    },
  ) =>
    request<{ id: string; status: string }>(t, `/${id}/seller-consent`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // The buyer checks on the invite and, once signed, collects the firearm the
  // government card records — to confirm into their own application.
  sellerConsentStatus: (t: TokenGetter, id: string) =>
    request<{
      status: 'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED';
      invitedName: string | null;
      cardFirearm: Record<string, string> | null;
    }>(t, `/${id}/seller-consent`, {}, {
      status: 'NONE',
      invitedName: null,
      cardFirearm: null,
    }),

  // ── Character witnesses ─────────────────────────────────────────

  witnesses: (t: TokenGetter, id: string) =>
    request<{ witnesses: WitnessSummary[] }>(t, `/${id}/witnesses`, {}, {
      witnesses: [],
    }),

  inviteWitness: (
    t: TokenGetter,
    id: string,
    body: { slot: number; name: string; phone: string },
  ) =>
    request<WitnessSummary>(t, `/${id}/witnesses`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeWitness: (t: TokenGetter, id: string, witnessId: string) =>
    request<{ removed: true }>(t, `/${id}/witnesses/${witnessId}`, {
      method: 'DELETE',
    }),

  /**
   * The signature, as an object URL.
   *
   * ⚠️ NOT AN <img src> POINTING AT THE ENDPOINT — it needs a bearer token and
   * a browser will not attach one to an image request. Same reason as the
   * cover photograph; the caller revokes the URL.
   */
  witnessSignatureUrl: async (
    t: TokenGetter,
    id: string,
    witnessId: string,
  ): Promise<string | null> => {
    const token = await t();
    const res = await fetch(
      `${API_URL}/motivations/${id}/witnesses/${witnessId}/signature`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

  // ── The cover photograph ────────────────────────────────────────

  /** What we hold, what they chose, and where a stock photograph came from. */
  coverPhoto: (t: TokenGetter, id: string) =>
    request<CoverPhotoState>(t, `/${id}/cover-photo`, {}, {
      // ⚠️ A FALLBACK THAT SHOWS NOTHING, never one that invents a photograph.
      // The card is about approving an image before it prints on a police
      // document; a failed fetch must not leave it saying "we found one".
      choice: null,
      hasOwn: false,
      firearmLine: null,
      stock: null,
      aspect: 86 / 44,
      frameMm: { w: 86, h: 44 },
      maxPx: { w: 1200, h: 614 },
    }),

  /**
   * The image itself, as an object URL.
   *
   * ⚠️ NOT AN <img src> POINTING AT THE ENDPOINT. It needs a bearer token, and
   * a browser will not attach one to an image request — the tag would render a
   * broken-image icon on a card whose entire job is showing somebody a
   * picture. Fetched as a blob, and the caller revokes the URL.
   */
  coverPhotoUrl: async (t: TokenGetter, id: string): Promise<string | null> => {
    const token = await t();
    const res = await fetch(`${API_URL}/motivations/${id}/cover-photo/image`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  },

  setCoverChoice: (t: TokenGetter, id: string, choice: CoverChoice) =>
    request<{ choice: CoverChoice }>(t, `/${id}/cover-photo/choice`, {
      method: 'POST',
      body: JSON.stringify({ choice }),
    }),

  uploadCoverPhoto: async (t: TokenGetter, id: string, file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'cover.jpg');
    return request<{ choice: CoverChoice; hasOwn: boolean }>(
      t,
      `/${id}/cover-photo`,
      { method: 'POST', body: form },
    );
  },

  removeCoverPhoto: (t: TokenGetter, id: string) =>
    request<{ choice: null; hasOwn: false }>(t, `/${id}/cover-photo`, {
      method: 'DELETE',
    }),

  /**
   * The template catalogue. No id — it is product information, the same for
   * everyone, so it is fetched once and reused.
   *
   * The fallback is an EMPTY catalogue rather than a guessed one: a picker
   * showing three colours we invented client-side, one of which the renderer
   * does not have, is worse than a picker that says it could not load.
   */
  templates: (t: TokenGetter) =>
    request<TemplateCatalogue>(t, '/templates', {}, {
      formats: [],
      colours: [],
      defaults: { format: 'comprehensive', colourway: 'eucalyptus' },
    }),

  /**
   * Record the template the applicant picked.
   *
   * Both fields optional and sent independently — changing the colour must
   * not resend the format, or two rapid clicks on different controls would
   * have one overwrite the other's choice.
   */
  setTemplate: (
    t: TokenGetter,
    id: string,
    choice: { format?: TemplateFormat; colourway?: Colourway },
  ) =>
    request<{ format: TemplateFormat; colourway: Colourway }>(
      t,
      `/${id}/template`,
      { method: 'PATCH', body: JSON.stringify(choice) },
      { format: 'comprehensive', colourway: 'eucalyptus' },
    ),

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

  /** Refile a document under a different type. */
  refileUpload: (t: TokenGetter, id: string, uploadId: string, kind: string) =>
    request<{ kind: string }>(
      t,
      `/${id}/uploads/${uploadId}`,
      { method: 'PATCH', body: JSON.stringify({ kind }) },
      { kind },
    ),

  /**
   * Read an attached document again after a failed read.
   *
   * `readable: false` means the kind yields nothing by design — a photograph
   * of a safe — rather than that the attempt failed.
   */
  rereadUpload: (t: TokenGetter, id: string, uploadId: string) =>
    request<{ ok: boolean; fields: string[]; readable: boolean }>(
      t,
      `/${id}/uploads/${uploadId}/reread`,
      { method: 'POST' },
      { ok: false, fields: [], readable: true },
    ),

  removeUpload: (t: TokenGetter, id: string, uploadId: string) =>
    request<{ removed: boolean }>(
      t,
      `/${id}/uploads/${uploadId}`,
      { method: 'DELETE' },
      { removed: true },
    ),

  /**
   * The bytes of one uploaded document, as an object URL.
   *
   * ⚠️ THE ENDPOINT NEEDS AN AUTHORIZATION HEADER, so `<img src>` and
   * `<a href>` cannot reach it — the file is decrypted per request out of the
   * encrypted store and there is deliberately no public URL for it. Fetch the
   * bytes and hand back a blob URL. Mirrors licenceCentreApi.fileBlobUrl.
   *
   * ⚠️ THE CALLER OWNS THE URL and must revokeObjectURL it, or the blob stays
   * pinned in memory for the life of the tab.
   */
  uploadBlobUrl: async (
    t: TokenGetter,
    id: string,
    uploadId: string,
  ): Promise<string> => {
    const token = await t();
    const r = await fetch(`${API_URL}/motivations/${id}/uploads/${uploadId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      throw new MotivationApiError('We could not open that document.', r.status);
    }
    return URL.createObjectURL(await r.blob());
  },

  /** POPIA erasure — deletes the application AND its encrypted documents. */
  erase: (t: TokenGetter, id: string) =>
    request<{ erased: boolean; filesRemoved: number }>(
      t,
      `/${id}`,
      { method: 'DELETE' },
      { erased: true, filesRemoved: 0 },
    ),

  messages: (t: TokenGetter, id: string) =>
    request<FollowUp[]>(t, `/${id}/messages`, {}, []),

  /**
   * The draft as written, passed review or not. NOT fetched with the detail —
   * that is polled every few seconds and this is fifteen hundred words.
   */
  draft: (t: TokenGetter, id: string) =>
    request<{
      text: string;
      status: string;
      qualityScore: number | null;
      findings: unknown;
      final: boolean;
    }>(t, `/${id}/draft`),

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

  /**
   * START the document. Returns 202 as soon as the work is claimed — the
   * document does NOT exist yet, and `status` will be GENERATING.
   *
   * ⚠️ DO NOT WAIT ON THIS REQUEST FOR THE RESULT. A real run takes about a
   * minute and a half; nginx allows an upstream sixty seconds and Cloudflare
   * cuts the origin at a hundred, so the old awaited call returned a 504 —
   * with no JSON body, hence the generic "Something went wrong" below — for a
   * document that had been written and paid for. Poll the row instead.
   */
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
          // subItems went with the safe collapse on 2026-08-23 — the three
          // shots were the only thing that ever hung off a row, and the server
          // stopped sending them. Nothing here rendered them either.
        }[];
      }[];
      oursDone: number;
      oursTotal: number;
      theirsTotal: number;
    }>(t, `/${id}/checklist`),

  /** The finished document. Blob, not JSON — it is a PDF. */
  pdfUrl: (id: string) => `${API_URL}/motivations/${id}/pdf`,

  /** The pre-filled SAPS 271 — only answers for applicants who opted in. */
  saps271Url: (id: string) => `${API_URL}/motivations/${id}/saps271`,

  /**
   * ⚠️ THE URLS ABOVE CANNOT BE PUT IN AN <a href>. Every motivation endpoint
   * sits behind the Clerk guard, and a plain anchor carries no Authorization
   * header — so "Open your motivation" was a guaranteed 401, found the first
   * time a finished document existed to open. Fetch with the token, mint a
   * blob: URL, and point a tab at that instead — the same pattern
   * uploadBlobUrl already uses for viewing attachments.
   */
  pdfBlobUrl: async (t: TokenGetter, id: string): Promise<string> => {
    const token = await t();
    const r = await fetch(`${API_URL}/motivations/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      throw new MotivationApiError('We could not open the document.', r.status);
    }
    return URL.createObjectURL(await r.blob());
  },

  saps271BlobUrl: async (t: TokenGetter, id: string): Promise<string> => {
    const token = await t();
    const r = await fetch(`${API_URL}/motivations/${id}/saps271`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      throw new MotivationApiError('We could not open the form.', r.status);
    }
    return URL.createObjectURL(await r.blob());
  },
};

/**
 * Only the fields that apply right now.
 *
 * Mirrors isVisible() on the backend. Both halves have to agree about what is
 * being asked, or the wizard shows a question the server will not accept —
 * or hides one it insists on.
 */
/** The SAPS 271 opt-in. Mirrors SAPS271_OPT_KEY / SAPS271_FILL on the server. */

// ── the cover photograph ────────────────────────────────────────────

/**
 * `null` means nobody has been asked yet — which is NOT the same as 'NONE'.
 * See the schema comment on coverPhotoChoice: a deliberate refusal has to
 * survive the next time our search finds an image.
 */
export type CoverChoice = 'STOCK' | 'OWN' | 'NONE';

export interface CoverPhotoState {
  choice: CoverChoice | null;
  hasOwn: boolean;
  /** "Tikka T3", from their own answers — what the caption will say. */
  firearmLine: string | null;
  /** Present only when we hold a stock photograph of this model. */
  stock: { source: string } | null;
  /**
   * Width / height of the fixed frame on the cover. The trim box locks to it.
   *
   * ⚠️ SENT BY THE SERVER, NOT HARD-CODED HERE. A copy in this bundle would go
   * stale the first time the cover layout moved, and the symptom would be a
   * red box promising a crop the cover does not print.
   */
  aspect: number;
  /** What that frame measures on paper, for the readout. */
  frameMm: { w: number; h: number };
  maxPx: { w: number; h: number };
}

// ── character witnesses ─────────────────────────────────────────────

export interface WitnessSummary {
  id: string;
  slot: number;
  invitedName: string;
  invitedPhone: string;
  /** INVITED · VERIFIED · DECLINED · COMPLETED. */
  status: string;
  openedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  /** Present only once signed — never for a half-finished statement. */
  answers?: Record<string, string>;
  signedPlace?: string | null;
  hasSignature?: boolean;
}

export const SAPS271_OPT_KEY = 'fill_saps271';
export const SAPS271_FILL = 'Fill it in for me';

export function visibleFields(
  fields: MotivationField[],
  answers: Record<string, string>,
): MotivationField[] {
  // Mirrors isVisible() on the backend, including the 271 gate: form-only
  // fields exist only for the SAPS 271, so on the dealer path they are not
  // shown at all. Both halves must agree or the wizard asks questions the
  // server does not require — or hides ones it insists on.
  const wantsForm = (answers[SAPS271_OPT_KEY] ?? '').trim() === SAPS271_FILL;
  return fields.filter((f) => {
    if (f.formOnly && f.key !== SAPS271_OPT_KEY && !wantsForm) return false;
    return !f.showIf || (answers[f.showIf.key] ?? '').trim() === f.showIf.equals;
  });
}

/** Section order, as the registry lists them — not alphabetical. */
export function groupBySection(
  fields: MotivationField[],
): { section: string; fields: MotivationField[] }[] {
  // ⚠️ BY NAME, NOT BY CONSECUTIVE RUN — and the difference blocked an
  // application from being generated at all.
  //
  // The registry visits "About you" three times: the main block, a later run
  // of postal codes and dialling codes, and a third holding spouse_id_type.
  // Grouping consecutive runs turned that into THREE steps all titled "About
  // you", all keyed on that title, so React had duplicate sibling keys and
  // the later ones rendered unreliably.
  //
  // The consequence was not cosmetic. spouse_id_type is REQUIRED for a
  // married applicant and lives in the third run; spouse_id_number sits in
  // the FIRST run and only appears once spouse_id_type is answered. So a
  // married member could not reach the question, could not answer it, and hit
  // "Some required answers are still missing" on generate with nothing on
  // screen to fix — every field they could see was filled in.
  //
  // One step per section name now, in first-appearance order.
  const out: { section: string; fields: MotivationField[] }[] = [];
  const bySection = new Map<string, MotivationField[]>();
  for (const f of fields) {
    let bucket = bySection.get(f.section);
    if (!bucket) {
      bucket = [];
      bySection.set(f.section, bucket);
      out.push({ section: f.section, fields: bucket });
    }
    bucket.push(f);
  }
  return out.map((s) => ({ ...s, fields: orderByDependency(s.fields) }));
}

/**
 * Put a field that others hang off BEFORE the fields that hang off it.
 *
 * ⚠️ MERGING THE RUNS EXPOSES AN ORDER THE REGISTRY NEVER HAD TO GET RIGHT.
 * While "About you" was three separate steps, nobody noticed that
 * spouse_id_number is declared before the spouse_id_type it depends on —
 * they were pages apart. In one step it means answering a question near the
 * bottom makes a new field appear near the top, above where the member is
 * looking, which is its own way of being invisible.
 *
 * A stable single pass: each field is emitted after anything its showIf names
 * within the same section. Cycles are impossible to express in the registry
 * (showIf takes one key, not a chain), and a dependency in another section is
 * left alone — it is already on an earlier step.
 */
export function orderByDependency(
  fields: MotivationField[],
): MotivationField[] {
  const here = new Map(fields.map((f) => [f.key, f]));
  const out: MotivationField[] = [];
  const placed = new Set<string>();

  const place = (f: MotivationField, seen: Set<string>) => {
    if (placed.has(f.key) || seen.has(f.key)) return;
    seen.add(f.key);
    const dep = f.showIf?.key ? here.get(f.showIf.key) : undefined;
    if (dep) place(dep, seen);
    if (placed.has(f.key)) return;
    placed.add(f.key);
    out.push(f);
  };

  for (const f of fields) place(f, new Set());
  return out;
}
