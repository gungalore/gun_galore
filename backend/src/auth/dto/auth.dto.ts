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
 * Twelve, not the fifteen the old hosted form demanded. Fifteen was the
 * identity provider's own instance setting, not a decision anyone here made,
 * and a floor that high pushes people onto a sticky note or a reused
 * password. NIST's guidance
 * is length over composition rules, so there is deliberately no "must contain
 * a symbol" regex to go with it.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

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

  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `Password must be at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX)
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

  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `Password must be at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(PASSWORD_MAX) currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `Password must be at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

/**
 * The app shells have no cookie jar for our origin, so they hand the refresh
 * token back in the body. Browsers never populate this — the cookie wins.
 */
export class RefreshDto {
  @IsOptional() @IsString() @MaxLength(200) refreshToken?: string;
}
