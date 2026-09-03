import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Kept as defence-in-depth on the three admin-account routes (create,
 * re-role, switch off). Since AdminJwtGuard started denying every mutating
 * method to non-SUPERADMIN, this guard is provably redundant on those
 * routes — Nest runs the controller-level AdminJwtGuard FIRST, so a
 * read-only admin is already refused there and never reaches this line,
 * and there is no double-refusal to confuse anyone. It stays because
 * granting account access is the one thing we don't want resting on a
 * single layer, matching AdminService's own DB re-read on the same three
 * writes.
 *
 * It reads request.adminUser.role, which AdminJwtGuard now populates from
 * the AdminUser row rather than the 8-hour-old token — so this check is
 * against the live role too, for free.
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const admin = request['adminUser'] as { role?: string } | undefined;
    if (admin?.role !== 'SUPERADMIN') {
      throw new ForbiddenException(
        `Only a SUPERADMIN ("Full admin") can create, re-role or switch off an admin account. Your role is ${admin?.role ?? 'unknown'}.`,
      );
    }
    return true;
  }
}
