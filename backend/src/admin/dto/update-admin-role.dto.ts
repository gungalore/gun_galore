import { IsIn } from 'class-validator';
import { ASSIGNABLE_ROLES, type AssignableRole } from './create-admin.dto';

export class UpdateAdminRoleDto {
  @IsIn(ASSIGNABLE_ROLES, {
    message: 'role must be SUPERADMIN (Full admin) or MONITORING_ADMIN',
  })
  role!: AssignableRole;
}
