/**
 * THE DESK — the operator's own account.
 *
 * 🚨 THE ROUTES BEHIND THIS SHIPPED WITH NO UI AT ALL. `POST
 * /admin/auth/totp/enrol`, `/totp/confirm` and `GET /admin/auth/me` landed
 * with the auth rebuild and nothing in the Desk called any of them — so the
 * second factor could be REQUIRED (ADMIN_TOTP_REQUIRED) with no way for
 * anybody to enrol, and AdminJwtGuard's own refusal text tells the operator to
 * "enrol your authenticator again under Account" over a surface that did not
 * exist. This module and components/desk/account-drawer.tsx are that surface.
 *
 * ⚠️ EVERY ROUTE HERE IS @OwnAccountRoute(). They write the CALLER's
 * credential and take no target id from anywhere — which is also why a
 * read-only recovery session may reach them: re-enrolling the authenticator is
 * the one way out of read-only, so the guard lets these through before the
 * recoveryOnly check. Anything that takes a target admin id belongs in
 * desk-site.ts with the SUPERADMIN-gated writes, not here.
 */
import { deskFetch } from './desk-auth';

/**
 * What `GET /admin/auth/me` returns.
 *
 * ⚠️ NO `recoveryOnly` ON THIS SHAPE, and that is the server's shape, not an
 * omission here. Whether the session was opened with a recovery code is known
 * only from the login and refresh response bodies — see isRecoveryOnlySession
 * in desk-auth.ts. Do not add the field hoping it arrives.
 *
 * ⚠️ IT CAN BE null. The handler returns null when the AdminUser row is gone
 * (deactivated and deleted between the token being minted and this read), and
 * a caller that assumes an object renders "undefined" as an email address.
 */
export interface DeskAdminMe {
  id: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  totpConfirmedAt: string | null;
  totpEnrolled: boolean;
  remainingRecoveryCodes: number;
  /** ADMIN_TOTP_REQUIRED on the box. Off today; it is one env change away. */
  totpRequired: boolean;
}

export function fetchDeskMe(): Promise<DeskAdminMe | null> {
  return deskFetch<DeskAdminMe | null>('/admin/auth/me');
}

export interface TotpEnrolment {
  /** The base32 secret. The ONLY time it leaves the server. */
  secret: string;
  /** otpauth://totp/… — what the QR encodes. */
  otpauthUri: string;
  /** True when this REPLACES a confirmed authenticator. */
  alreadyEnrolled: boolean;
}

/**
 * Stage a new secret.
 *
 * ⚠️ THE PASSWORD IS REQUIRED ONLY WHEN REPLACING. The server demands it when
 * `totpConfirmedAt` is set and refuses with 401 "Enter your current password
 * to replace the authenticator on this account." — because the own-account
 * hatch deliberately opens this route to a stolen access token, and the
 * password is the only thing standing between that token and a swapped second
 * factor. On a FIRST enrolment there is no password field to fill, and sending
 * an empty string would fail validation rather than be ignored, so it is
 * omitted from the body entirely.
 */
export function beginTotpEnrolment(currentPassword?: string): Promise<TotpEnrolment> {
  const body = currentPassword ? { currentPassword } : {};
  return deskFetch<TotpEnrolment>('/admin/auth/totp/enrol', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface TotpConfirmation {
  confirmed: true;
  /**
   * ⚠️ TEN CODES, RETURNED ONCE, UNREADABLE AFTERWARDS. They are bcrypt-hashed
   * on the way in; nothing — not this route again, not /me, not the database
   * as an operator reads it — can show them a second time. The screen that
   * renders these is the only chance anybody gets.
   */
  recoveryCodes: string[];
  /**
   * Confirming ends every OTHER session on the account, including a read-only
   * recovery one. That is why the way out of read-only is enrol → sign in
   * again, rather than enrol and carry on.
   */
  otherSessionsEnded: number;
}

export function confirmTotpEnrolment(totpCode: string): Promise<TotpConfirmation> {
  return deskFetch<TotpConfirmation>('/admin/auth/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ totpCode }),
  });
}

/**
 * The secret in groups of four, for somebody typing it by hand.
 *
 * ⚠️ THE TYPED PATH IS NOT A FALLBACK FOR A MISSING LIBRARY — it is the
 * fallback for a QR that will not scan, which on a phone camera pointed at a
 * near-black screen happens often enough to matter. Both are always shown.
 * Groups of four because a base32 secret is 32 characters of look-alikes and
 * an unbroken run of them is where a mistyped character hides.
 */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}
