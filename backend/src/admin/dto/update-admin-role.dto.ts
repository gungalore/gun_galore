import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import {
  ASSIGNABLE_ROLES,
  REASON_MAX,
  REASON_MIN,
  type AssignableRole,
} from './create-admin.dto';

export class UpdateAdminRoleDto {
  @IsIn(ASSIGNABLE_ROLES, {
    message: 'role must be SUPERADMIN (Full admin) or MONITORING_ADMIN',
  })
  role!: AssignableRole;

  // See the header on CreateAdminDto: promoting somebody to Full admin is the
  // write that grants every other write, and it wrote no audit row at all
  // until 2026-09-11.
  @IsString()
  @MinLength(REASON_MIN, {
    message: 'Say why this admin’s role is changing.',
  })
  @MaxLength(REASON_MAX)
  reason!: string;
}

/**
 * ⚠️ DEACTIVATE HAD NO DTO AT ALL — the controller took no @Body(). That is
 * why it wrote no reason and no audit row: there was nowhere to put one.
 * Switching an admin off is the emergency control for a compromised operator,
 * which makes it exactly the action whose "why" somebody will want to read
 * back at 3am.
 */
export class DeactivateAdminDto {
  @IsString()
  @MinLength(REASON_MIN, {
    message: 'Say why this admin is being switched off.',
  })
  @MaxLength(REASON_MAX)
  reason!: string;
}
