import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from './session.service';
import { extractAccessToken } from './extract-token';

/**
 * The ordinary member auth guard. Rejects anyone without a valid session.
 *
 * Stamps `request.userId` with User.id — the one and only user identifier —
 * which is what `@CurrentUser()` reads.
 *
 * ⚠️ Unlike the guard this replaced, it does NOT provision a user row.
 * It never needs to: our own sign-up creates the row before any token exists,
 * so a valid token whose user is missing is a deleted account, not a race.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { userId?: string; sessionId?: string }>();

    const token = extractAccessToken(request);
    if (!token) throw new UnauthorizedException();

    try {
      const payload = await this.sessions.verify(token);
      request.userId = payload.sub;
      request.sessionId = payload.sid;
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }
}
