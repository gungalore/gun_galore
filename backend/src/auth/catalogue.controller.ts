import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Header,
  HttpCode,
  Post,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import {
  CATALOGUE_COOKIE,
  CATALOGUE_TTL_SECONDS,
} from './catalogue-access';
import { sessionCookieBase } from './cookie-options';
import { SessionService } from './session.service';

const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * The 18+ gate's two write endpoints.
 *
 * ⚠️ THE DECLARATION IS A CLICK, NOT AN ACCOUNT. `POST` mints the `ao_cat`
 * cookie; from then on the visitor sees the same catalogue as a signed-in
 * member. It is deliberately its own controller in the Auth module: the JWT
 * secret, the JwtModule wiring and the SessionService that mints/verifies the
 * token all live here, and the AuthModule boot spec already proves they
 * construct.
 *
 * ⚠️ THROTTLED. Anyone can call the endpoint, and a bot that reads the page
 * can call it programmatically — that cannot be prevented without real age
 * verification, which this is not. The throttle keeps a loop from minting
 * tokens at will; it is not an authentication boundary.
 */
@Controller('auth')
export class CatalogueController {
  constructor(private readonly sessions: SessionService) {}

  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @Post('catalogue-declare')
  @HttpCode(200)
  @NoStore()
  async declare(
    @Body() body: { accept?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Explicit, typed confirmation. A bare POST from a scanner is answered
    // with 400 rather than silently granting the cookie.
    if (body?.accept !== true) {
      throw new BadRequestException('The age declaration must be accepted.');
    }
    const { token, expiresAt } =
      await this.sessions.mintCatalogueDeclaration();
    res.cookie(CATALOGUE_COOKIE, token, {
      ...sessionCookieBase(),
      path: '/',
      maxAge: CATALOGUE_TTL_SECONDS * 1000,
      expires: expiresAt,
    });
    return { ok: true, expiresAt: expiresAt.toISOString() };
  }

  @Delete('catalogue-declare')
  @HttpCode(200)
  @NoStore()
  clear(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(CATALOGUE_COOKIE, { ...sessionCookieBase(), path: '/' });
    return { ok: true };
  }
}
