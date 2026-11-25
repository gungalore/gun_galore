import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';

/**
 * The 18+ gate, enforced server-side.
 *
 * ⚠️ THIS IS THE ACCESS BOUNDARY FOR EVERY CONTENT READ. The frontend
 * middleware sends a visitor without a declaration to `/gate`; this guard is
 * what stops the same visitor calling `/api/listings` directly. Without it the
 * gate would be a UI trick, and a crawler (or a script) could simply read the
 * API.
 *
 * It runs AFTER {@link OptionalAuthGuard}, which is what stamps
 * `request.userId` and `request.catalogueDeclared`. Access is granted when
 * either is present:
 *
 *   - a member session — signed-in users never see the gate twice;
 *   - a valid `ao_cat` declaration — a visitor who accepted the 18+ gate.
 *
 * Everyone else gets 404, not 403: the same "do not confirm it exists" rule
 * the members-only listing paths already followed. The 404 is what an
 * un-declared crawler receives from the API.
 */
@Injectable()
export class ContentAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { userId?: string; catalogueDeclared?: boolean }
    >();

    if (request.userId || request.catalogueDeclared) return true;

    throw new NotFoundException('Not found');
  }
}
