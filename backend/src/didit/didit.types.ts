/**
 * Didit's own vocabulary, kept verbatim.
 *
 * ⚠️ These strings are CASE-SENSITIVE and Didit's spelling is not ours:
 * "In Review" has a space, "Kyc Expired" has a single capital K. They are
 * compared, stored and logged exactly as received — normalising them here
 * would mean an unrecognised status silently becoming a recognised one.
 */
export type DiditSessionStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Approved'
  | 'Declined'
  | 'In Review'
  | 'Abandoned'
  | 'Expired'
  | 'Kyc Expired'
  | 'Resubmitted'
  | 'Awaiting User';

export interface DiditCreatedSession {
  session_id: string;
  /** The hosted verification page. Field is `url`, NOT `verification_url`. */
  url: string;
  session_token: string;
  status: DiditSessionStatus;
  workflow_id: string;
  vendor_data?: string | null;
}

/** What the OCR step read off the document. */
export interface DiditIdVerification {
  status?: string;
  document_type?: string | null;
  document_number?: string | null;
  personal_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  date_of_birth?: string | null;
  issuing_state?: string | null;
  expiration_date?: string | null;
  warnings?: unknown[];
  /**
   * ⚠️ MEDIA LINKS, AND THEY ARE PRESIGNED AND SHORT-LIVED. The decision
   * endpoint re-signs them on every call (a 4-hour window, measured), so a URL
   * copied out of a stored payload is dead by the next morning — which is
   * exactly what happened to the ones we persisted before anyone noticed.
   * Fetch the bytes promptly; never treat one of these as a durable reference.
   *
   * A workflow can also be configured to withhold response attributes, in
   * which case these arrive `null` even though the capture happened.
   */
  front_image?: string | null;
  full_front_image?: string | null;
  back_image?: string | null;
  full_back_image?: string | null;
  portrait_image?: string | null;
  front_video?: string | null;
  back_video?: string | null;
}

export interface DiditScoredCheck {
  status?: string;
  score?: number | null;
  warnings?: unknown[];
  /** The liveness method, e.g. PASSIVE / ACTIVE_3D. */
  method?: string | null;
  /** The live capture behind a liveness check — the member's actual selfie. */
  reference_image?: string | null;
  video_url?: string | null;
}

/**
 * Which of a member's two images an admin is asking for.
 *
 * `id_front` is the document capture; `selfie` is the LIVE capture from the
 * liveness step, not the portrait Didit also crops off the card.
 */
export type DiditSessionImageKind = 'id_front' | 'selfie';

/**
 * The outcome of asking Didit for one of those images.
 *
 * ⚠️ A RESULT, NOT AN EXCEPTION. The caller has to say something honest to the
 * admin — "Didit no longer holds this session", "this deployment's key cannot
 * read that session" and "there is no image on this session" are three
 * different sentences, and a thrown error collapses them into one.
 */
export type DiditMediaResult =
  | { ok: true; bytes: Buffer; mimeType: string }
  | {
      ok: false;
      reason:
        /** Didit no longer has the session: purged, expired, or wrong environment. */
        | 'gone'
        /** The key is valid but cannot read this session (sandbox key vs live session). */
        | 'forbidden'
        /** The decision has no image for this kind (not captured, or withheld). */
        | 'no_image'
        /** Didit itself failed, or the media host could not be reached. */
        | 'unreachable'
        /** The bytes at the URL were not an image we will stream. */
        | 'not_an_image';
    };

/**
 * The decision payload. Per-feature data arrives in PLURAL arrays because one
 * workflow may run the same feature more than once, each carrying a `node_id`
 * that ties it back to a node in the workflow graph.
 */
export interface DiditDecision {
  session_id: string;
  status: DiditSessionStatus;
  vendor_data?: string | null;
  id_verifications?: DiditIdVerification[];
  liveness_checks?: DiditScoredCheck[];
  face_matches?: DiditScoredCheck[];
  ip_analyses?: unknown[];
  reviews?: unknown[];
  [key: string]: unknown;
}

export interface DiditWebhookEvent {
  event_id?: string;
  session_id: string;
  status: DiditSessionStatus;
  webhook_type: string;
  timestamp?: number;
  created_at?: number;
  environment?: 'live' | 'sandbox';
  workflow_id?: string;
  vendor_data?: string | null;
  metadata?: Record<string, unknown>;
  decision?: DiditDecision;
}

export interface DiditOtpResult {
  /** 'Approved' on success. 'Failed' for a wrong code, 'Undeliverable', … */
  status: string;
  [key: string]: unknown;
}

export type DiditErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'undeliverable'
  | 'bad_request'
  | 'upstream';

export class DiditError extends Error {
  constructor(
    readonly code: DiditErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'DiditError';
  }
}
