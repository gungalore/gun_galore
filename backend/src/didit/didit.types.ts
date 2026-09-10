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
}

export interface DiditScoredCheck {
  status?: string;
  score?: number | null;
  warnings?: unknown[];
}

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
