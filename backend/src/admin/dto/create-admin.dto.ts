import { IsEmail, IsIn } from 'class-validator';

// Whitelist of roles a Full admin is allowed to assign. We deliberately
// exclude SUPERADMIN — the seed-only "Full admin" role is reserved for
// the bootstrapped account, with promotion handled out-of-band by
// changing the row directly. Two user-facing tiers map to this enum:
//   - SUPERADMIN     → "Full admin"
//   - MONITORING_ADMIN → "Monitoring admin"
// Legacy ADMIN is kept in the schema for back-compat but isn't offered
// here.
export const ASSIGNABLE_ROLES = ['SUPERADMIN', 'MONITORING_ADMIN'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export class CreateAdminDto {
  // The target user's email — must already exist in our User table
  // (i.e. they've signed up via Clerk). The service refuses unknown
  // emails so we never create orphan admins.
  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE_ROLES, {
    message: 'role must be SUPERADMIN (Full admin) or MONITORING_ADMIN',
  })
  role!: AssignableRole;
}
