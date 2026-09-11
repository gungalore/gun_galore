import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Roles a Full admin may assign through the Desk.
 *
 * ⚠️ SUPERADMIN IS IN THIS LIST AND ALWAYS HAS BEEN. The comment that used to
 * sit here claimed it was "deliberately excluded… reserved for the
 * bootstrapped account" — the array on the next line said otherwise, and the
 * code is what runs. Corrected 2026-09-11 rather than left to mislead the
 * next reader into concluding the create-a-Full-admin path does not exist.
 * It does, it is the single most sensitive write on the platform, and as of
 * this change it writes an audit row.
 *
 * Two user-facing tiers map to this enum:
 *   - SUPERADMIN        → "Full admin"   (the only tier that may write)
 *   - MONITORING_ADMIN  → "Monitoring admin" (read-only)
 * Legacy ADMIN stays in the schema for existing rows but is not offered here;
 * it is the column default and is treated as read-only.
 */
export const ASSIGNABLE_ROLES = ['SUPERADMIN', 'MONITORING_ADMIN'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * Why every one of these DTOs carries a required `reason`.
 *
 * ⚠️ CREATE / RE-ROLE / DEACTIVATE DECIDE WHO MAY APPROVE A COMMAND THAT RUNS
 * ON THE PRODUCTION BOX, AND UNTIL 2026-09-11 NONE OF THEM WROTE AN AUDIT ROW.
 * Twelve other admin writes in admin.service.ts called audit.record(); these
 * three — the ones that hand out the power the other twelve need — called it
 * from nowhere. There was literally no record that anybody had ever created
 * an admin.
 *
 * AdminAuditService.record() throws BadRequestException on an empty reason
 * BEFORE it inserts, so the reason cannot be optional here: an optional one
 * would fail the whole privilege operation at the audit call instead of at
 * validation, which is a worse place to find out.
 *
 * ⚠️ THIS IS A BREAKING CHANGE FOR ANY CALLER THAT SENDS NO REASON. It must
 * land together with the Desk change that collects one, or creating an admin
 * 400s.
 */
const REASON_MIN = 3;
const REASON_MAX = 500;

export class CreateAdminDto {
  // The target's email — must already exist in our User table (i.e. they have
  // signed up). The service refuses unknown emails so we never create an
  // orphan admin with no member record behind it.
  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE_ROLES, {
    message: 'role must be SUPERADMIN (Full admin) or MONITORING_ADMIN',
  })
  role!: AssignableRole;

  // Minimum 3 chars so a stray "ok" cannot sneak through, matching
  // UpdateUserDto.reason.
  @IsString()
  @MinLength(REASON_MIN, {
    message: 'Say why this account is being granted admin access.',
  })
  @MaxLength(REASON_MAX)
  reason!: string;
}

export { REASON_MIN, REASON_MAX };
