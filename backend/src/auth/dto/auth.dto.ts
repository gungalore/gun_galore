import { applyDecorators } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Password floor.
 *
 * **Six — an operator decision, 2026-09-10.** It has been fifteen (the old
 * hosted identity provider's own instance setting, never a decision anyone
 * here made) and then twelve; six is the number the operator asked for and
 * is the number to keep unless they say otherwise.
 *
 * ⚠️ SIX IS BELOW EVERY PUBLISHED FLOOR, so the compensating controls are
 * now the only thing standing between a guessed password and a seller's
 * identity documents and bank details. They are load-bearing, not optional:
 * `MAX_FAILED_LOGINS` / `lockedUntil` on the row (which survives the
 * `pm2 reload` that resets the in-memory throttler), the 10/60s login
 * throttle, and bcrypt at cost 12. Weakening any of those is a much larger
 * change than it looks, now that the floor no longer helps.
 *
 * ⚠️ **No user-facing copy may describe this as a strong-password control**,
 * and the POPIA s19 "appropriate technical measures" wording must not lean on
 * it. Nothing claims that today — keep it that way.
 *
 * ⚠️ **COMPOSITION RULES ARE ON, AND THAT IS A REVERSAL.** This file used to
 * say NIST prefers length over composition and therefore carried no "must
 * contain a symbol" regex. The operator asked for six-with-a-number-and-a-
 * symbol on 2026-09-10, so the rules below are theirs and the old note is
 * gone rather than left contradicting the code. Do not cite NIST for either
 * half now: its argument was a longer floor with no composition rules, which
 * is neither of the two things this is.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 200;

/**
 * ⚠️ THESE TWO REGEXES ARE DUPLICATED IN `frontend/lib/password-rule.ts` AND
 * MUST STAY CHARACTER-FOR-CHARACTER IDENTICAL. The backend cannot import from
 * the frontend, and the frontend validates as you type — so any drift means a
 * password the form accepts and the API answers 400 to, on the last click of
 * a sign-up. Change one, change the other, and run that file's spec.
 */
export const PASSWORD_DIGIT_RE = /[0-9]/;
/**
 * "Special" = anything that is not a letter, a digit, or WHITESPACE.
 *
 * ⚠️ The `\s` is the point of the character class, not decoration. Whitespace
 * is still allowed *in* a password — a passphrase with spaces is fine — it
 * just cannot be the character that SATISFIES the rule. Without the `\s`, a
 * stray trailing space silently qualifies, and the member sets a password
 * they will never reproduce and cannot tell apart from a forgotten one.
 */
export const PASSWORD_SPECIAL_RE = /[^A-Za-z0-9\s]/;

/**
 * The whole password rule, in one decorator.
 *
 * ⚠️ APPLY THIS TO EVERY FIELD THAT SETS A PASSWORD — register, reset,
 * change — and to NONE that merely accepts one for comparison. Three copies
 * of five decorators is how a rule ends up enforced on two screens out of
 * three, and the one it is missing from is the one an attacker uses.
 *
 * ⚠️ **NOT ON `LoginDto`, EVER.** Sign-in must fail on the hash comparison,
 * never on validation. A member whose existing password predates a rule
 * change would otherwise be told their own correct password is malformed and
 * locked out of the account by a policy edit — and tightening the rule again
 * later is exactly when that would happen.
 */
function IsMemberPassword() {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN, {
      message: `Password must be at least ${PASSWORD_MIN} characters`,
    }),
    MaxLength(PASSWORD_MAX),
    Matches(PASSWORD_DIGIT_RE, {
      message: 'Password must include at least one number',
    }),
    Matches(PASSWORD_SPECIAL_RE, {
      message:
        'Password must include at least one special character, such as ! ? # or @',
    }),
  );
}

/** Letters, digits, underscore, hyphen. No dots — they read as a domain. */
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(USERNAME_RE, {
    message:
      'Username can contain letters, numbers, underscores and hyphens only',
  })
  username: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsMemberPassword()
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  // Sign-up consent (POPIA accountability). These used to ride in the identity provider's
  // unsafeMetadata and reach us through a webhook, which meant the consent and
  // the account could exist apart. They are part of the request now.
  @IsOptional() @IsBoolean() terms?: boolean;
  @IsOptional() @IsBoolean() privacy?: boolean;
  @IsOptional() @IsBoolean() age?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;
  @IsOptional() @IsString() @MaxLength(40) policyVersion?: string;
  @IsOptional() @IsString() @MaxLength(40) campaignKey?: string;
}

export class VerifyEmailDto {
  @IsEmail() @MaxLength(255) email: string;
  @IsString() @MinLength(4) @MaxLength(10) code: string;
}

export class ResendEmailCodeDto {
  @IsEmail() @MaxLength(255) email: string;
}

export class LoginDto {
  /** Email or username — members remember one or the other, rarely both. */
  @IsString() @MinLength(3) @MaxLength(255) identifier: string;

  @IsString() @MaxLength(PASSWORD_MAX) password: string;
}

export class ForgotPasswordDto {
  @IsEmail() @MaxLength(255) email: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(64) token: string;

  @IsMemberPassword()
  password: string;
}

export class ChangePasswordDto {
  // Not IsMemberPassword: this one is COMPARED, not set. See that helper.
  @IsString() @MaxLength(PASSWORD_MAX) currentPassword: string;

  @IsMemberPassword()
  newPassword: string;
}

/**
 * The app shells have no cookie jar for our origin, so they hand the refresh
 * token back in the body. Browsers never populate this — the cookie wins.
 */
export class RefreshDto {
  @IsOptional() @IsString() @MaxLength(200) refreshToken?: string;
}
