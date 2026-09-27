import { Injectable, Logger } from '@nestjs/common';
import {
  SAPS_USER_AGENT,
  extractCookie,
  readText,
  sapsGet,
  sapsPostForm,
} from '../common/saps-http';

// ────────────────────────────────────────────────────────────────────
// THE TWO-STEP HANDSHAKE THE ENQUIRY DEMANDS.
//
// SAPS's firearm status enquiry is a CSRF-protected HTML form. There is no
// API and no JSON: a bare GET hands back a form plus a `csrf_token` cookie,
// and the answer only comes from a form-encoded POST that echoes the token
// back BOTH as a field and as a Cookie header.
//
// ⚠️ THE FIELD IS NAMED `csrf_token`, NOT `csrf`. A POST with the token in a
// field called `csrf` is answered with HTTP 400 and nothing else — no
// message, no hint, and it looks exactly like the page being down. The field
// name is the whole trick.
//
// ⚠️ THIS CLASS IS TRANSPORT ONLY AND DECIDES NOTHING. It never reads the
// answer and never classifies it: the markup goes back to the service as a
// string, and saps-enquiry-page.ts parses it, and the service decides what it
// means. A client that classified would put the safety precedence behind a
// network call, and the fixtures that pin it could not be used against it.
//
// ⚠️ NOTHING HERE IS RETRIED. A retry belongs to the caller, which knows
// whether the member is waiting (manual check, refuse politely) or a sweep is
// (back off and move on). A client that retried internally would make the
// enquiry's rate-limit response arrive three times instead of once.
// ────────────────────────────────────────────────────────────────────

export const SAPS_ENQUIRY_URL =
  'https://www.saps.gov.za/services/firearm_status_enquiry.php';

/** The token the landing page sets. Named once; it appears in three places. */
export const CSRF_COOKIE = 'csrf_token';

const TIMEOUT_MS = 20_000;
const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/**
 * The page was reachable but the handshake failed, or it answered outside
 * 2xx. Distinct from a socket error so the SERVICE can tell "SAPS answered
 * with something we cannot use" (worth an operator's attention) from "the
 * request timed out" (worth a log line and a backoff).
 */
export class EnquiryHandshakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnquiryHandshakeError';
  }
}

export interface EnquiryFetch {
  httpStatus: number;
  /** The raw HTML of the answer. Parsed by the service, never here. */
  html: string;
}

@Injectable()
export class SapsEnquiryClient {
  private readonly logger = new Logger(SapsEnquiryClient.name);

  /**
   * Ask SAPS about one reference.
   *
   * `serial` is only sent when the caller supplies one — a competency has no
   * firearm, and sending an empty `fserial` is answered with the validation
   * line rather than the record.
   */
  async fetch(reference: string, serial: string | null): Promise<EnquiryFetch> {
    const opts = {
      accept: ACCEPT,
      userAgent: SAPS_USER_AGENT,
      timeoutMs: TIMEOUT_MS,
    };

    const landing = await sapsGet(SAPS_ENQUIRY_URL, opts);

    // ⚠️ DRAIN THE LANDING BODY BEFORE POSTING. Node will not reuse a socket
    // whose response has not been consumed, and the POST then opens a second
    // connection — which is one more request against a host that is already
    // rate-limiting us, for no benefit. The body itself is discarded: the
    // form's markup is not the token, the cookie is.
    await readText(landing).catch((err) => {
      this.logger.warn(
        `could not drain the enquiry landing page: ${(err as Error).message}`,
      );
      return '';
    });

    const csrf = extractCookie(landing.headers, CSRF_COOKIE);
    if (!csrf) {
      throw new EnquiryHandshakeError(
        `the enquiry page set no ${CSRF_COOKIE} cookie (HTTP ${landing.status})`,
      );
    }

    const form: Record<string, string> = {
      fsref: reference,
      [CSRF_COOKIE]: csrf,
    };
    if (serial) form.fserial = serial;

    const answer = await sapsPostForm(SAPS_ENQUIRY_URL, form, {
      ...opts,
      cookie: `${CSRF_COOKIE}=${csrf}`,
    });

    // Read the body even on a bad status: a block page is the thing an
    // operator most needs to see, and a body left undrained holds the socket.
    const html = await readText(answer).catch(() => '');

    if (answer.status < 200 || answer.status >= 300) {
      throw new EnquiryHandshakeError(
        `the enquiry answered HTTP ${answer.status}`,
      );
    }

    return { httpStatus: answer.status, html };
  }
}
