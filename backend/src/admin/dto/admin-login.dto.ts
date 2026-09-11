import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  /**
   * The six-digit code from the authenticator app.
   *
   * ⚠️ OPTIONAL IN THE DTO, REQUIRED BY THE SERVICE ONCE ENROLLED. It cannot
   * be `@IsNotEmpty()` here: the Desk sign-in form does not know whether this
   * account has a second factor until it has tried, so the first request of a
   * two-step sign-in legitimately arrives without one and is answered with
   * `code: 'TOTP_REQUIRED'`. Making class-validator reject it would turn that
   * conversation into a 400 the login page cannot interpret.
   *
   * Kept loose on length (spaces, an 8-digit code from a mis-configured app)
   * because verifyTotpStep() in ../totp does the real shape check — it strips
   * whitespace, demands exactly six digits, and answers with `null` on a
   * malformed code or secret rather than throwing, because a 500 on a typed
   * code tells an attacker they found an interesting input.
   *
   * ⚠️ verifyTotpStep(), NOT ITS WRAPPER verifyTotpCode(). The wrapper is one
   * line — `verifyTotpStep(...) !== null` — and the boolean it throws away the
   * step to produce is the only thing that can tell a first presentation of a
   * code from a replay of it. The accepted window is three steps wide, so a
   * code caught on a screen-share, over a shoulder or through a real-time
   * phishing proxy verifies for up to ninety seconds and can be presented as
   * often as somebody can type it; a boolean answer says yes every time and
   * mints a second, independent thirty-day session beside the operator's own.
   * AdminAuthService.login therefore takes the step and spends it against
   * AdminUser.totpLastUsedStep (spendTotpStep's guarded updateMany), which is
   * what RFC 6238 §5.2 requires and what makes the code single-use. The
   * wrapper is for callers with no row to record against — the specs. It must
   * never appear on the sign-in path.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  totpCode?: string;

  /**
   * One of the ten single-use recovery codes, used INSTEAD of totpCode when
   * the phone is gone.
   *
   * ⚠️ A session opened this way is read-only until TOTP is re-enrolled —
   * see AdminSession.recoveryOnly. Presenting one spends it permanently,
   * whether or not the rest of the sign-in succeeds afterwards.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  recoveryCode?: string;
}

/**
 * Refresh presents the refresh token in the body OR the cookie.
 *
 * Both, for the same reason the member side takes both: the browser has the
 * httpOnly cookie, and anything that is not a same-site browser context
 * (a script, a future shell client) has only the body.
 */
export class AdminRefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

/**
 * Change your OWN password. There is deliberately no route that sets somebody
 * else's — see the header on AdminAuthService.changePassword.
 */
export class AdminChangePasswordDto {
  @IsString()
  currentPassword: string;

  /**
   * ⚠️ TWELVE, NOT EIGHT. This is the account that will be able to approve a
   * command that runs on the production box; the eight-character floor on
   * AdminLoginDto exists to accept the passwords that already exist, not to
   * bless them as a target. A length floor is the only strength rule here on
   * purpose — composition rules ("one capital, one symbol") measurably push
   * people towards `Password1!` and away from length, which is the only
   * dimension that actually costs an attacker anything.
   */
  @IsString()
  @MinLength(12, {
    message: 'Admin passwords must be at least 12 characters.',
  })
  @MaxLength(200)
  newPassword: string;
}

/**
 * Begin a TOTP enrolment.
 *
 * ⚠️ THE PASSWORD IS REQUIRED ONLY WHEN THERE IS ALREADY A CONFIRMED FACTOR,
 * and the service — not this DTO — decides which case it is in. It cannot be
 * expressed here: `@IsString()` would break the FIRST enrolment, where the
 * operator has no second factor yet and asking for a password buys nothing,
 * and a bare `@IsOptional()` on its own would let a replacement through
 * unauthenticated. The rule is conditional on row state, so it lives where the
 * row is read. See AdminAuthService.enrolTotp.
 */
export class AdminEnrolTotpDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentPassword?: string;
}

/**
 * Confirm a TOTP enrolment by proving the secret reached a phone.
 *
 * ⚠️ Enrolment is two steps for a reason: a secret written to the row and
 * never proved is a lockout waiting for the flag to be switched on. Nothing
 * trusts `totpSecret` until `totpConfirmedAt` is stamped, and only a code
 * minted from that exact secret stamps it.
 */
export class AdminConfirmTotpDto {
  @IsString()
  @MaxLength(20)
  totpCode: string;
}
