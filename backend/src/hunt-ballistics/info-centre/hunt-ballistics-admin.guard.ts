import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * HuntBallisticsAdminGuard — simple shared-secret guard for the
 * Hunt Ballistics INFO Centre admin endpoints (PDF import, edit,
 * delete).
 *
 * We deliberately use a shared secret (env: HUNT_BALLISTICS_ADMIN_KEY)
 * rather than the marketplace's AdminJwtGuard pattern because:
 *   - Hunt Ballistics has no admin login UI yet
 *   - The "admin" is the operator running curl from his Mac/Windows box
 *     or from Claude Code on his behalf
 *   - One static secret is enough until we build a proper admin shell
 *
 * Caller sends:  X-Hunt-Admin-Key: <the secret>
 * Server compares against process.env.HUNT_BALLISTICS_ADMIN_KEY.
 *
 * Missing env var → 503 (server misconfigured). Wrong key → 401.
 *
 * Migrating to JWT later: replace `@UseGuards(HuntBallisticsAdminGuard)`
 * with `@UseGuards(AdminJwtGuard)` once the AdminUser model gets a
 * hunt-ballistics scope. The guard interface is identical.
 */
@Injectable()
export class HuntBallisticsAdminGuard implements CanActivate {
  private readonly logger = new Logger(HuntBallisticsAdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.HUNT_BALLISTICS_ADMIN_KEY;
    if (!expected || expected.length < 16) {
      this.logger.error(
        'HUNT_BALLISTICS_ADMIN_KEY not configured (or too short). ' +
          'Set a 32+ char random secret in the backend env to enable admin endpoints.',
      );
      throw new ServiceUnavailableException(
        'Hunt Ballistics admin not configured on this server.',
      );
    }
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-hunt-admin-key'];
    if (typeof provided !== 'string' || provided !== expected) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
