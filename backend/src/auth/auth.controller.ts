import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { SessionService, IssuedSession } from './session.service';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './extract-token';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendEmailCodeDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

/**
 * Every response here varies by viewer and several of them carry a token.
 * A shared cache holding one is somebody else's session.
 */
const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * `secure` must follow the scheme, not be hardcoded true: a Secure cookie is
 * silently dropped by the browser over plain http, so hardcoding it makes
 * local development look like a broken login with nothing in any log.
 * Production is https end to end (nginx sends X-Forwarded-Proto https).
 */
const isProd = () => process.env.NODE_ENV === 'production';

const baseCookie = (): CookieOptions => ({
  httpOnly: true,
  secure: isProd(),
  sameSite: 'lax',
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private meta(req: Request) {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }

  /**
   * Put the pair in cookies AND return the access token in the body.
   *
   * Both, deliberately. The browser uses the cookies and never touches the
   * body token; the Capacitor shells are cross-SITE (`capacitor://localhost`),
   * so no `SameSite=Lax` cookie ever reaches them and the body is the only
   * thing they can use.
   */
  private issue(res: Response, issued: IssuedSession) {
    res.cookie(ACCESS_COOKIE, issued.accessToken, {
      ...baseCookie(),
      path: '/',
      expires: issued.accessExpiresAt,
    });
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...baseCookie(),
      // Scoped so the refresh token is not attached to every ordinary API
      // call. The fewer requests carry it, the fewer places it can leak.
      path: '/api/auth',
      expires: issued.refreshExpiresAt,
    });
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.accessExpiresAt.toISOString(),
    };
  }

  private clear(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/auth' });
  }

  // ── Sign-up ──────────────────────────────────────────────────────────

  // Five accounts an hour from one address. Each one costs us a Didit email
  // credit, so this is a spend limit as much as an abuse limit.
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('register')
  @HttpCode(200)
  @NoStore()
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, this.meta(req));
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('verify-email')
  @HttpCode(200)
  @NoStore()
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.verifyEmail(
      dto.email,
      dto.code,
      this.meta(req),
    );
    return { ...this.issue(res, issued), userId: issued.userId };
  }

  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post('resend-email-code')
  @HttpCode(200)
  @NoStore()
  async resend(@Body() dto: ResendEmailCodeDto) {
    await this.auth.sendEmailCode(dto.email);
    return { sent: true };
  }

  // ── Sign-in ──────────────────────────────────────────────────────────

  // Matches the admin login's cap. The per-row lockout in AuthService is the
  // half that survives a deploy.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @NoStore()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.login(dto, this.meta(req));
    return { ...this.issue(res, issued), userId: issued.userId };
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @NoStore()
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;
    const token = cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    if (!token) {
      this.clear(res);
      return { ok: false };
    }
    try {
      const issued = await this.auth.refresh(token, this.meta(req));
      return this.issue(res, issued);
    } catch (err) {
      // A refused refresh means the session is gone. Leaving the cookies in
      // place would loop the client: middleware sees a refresh cookie, lets
      // the page render, the API 401s, the client refreshes, forever.
      this.clear(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @NoStore()
  async logout(
    @Req() req: Request & { sessionId?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;
    await this.auth.logout(cookies?.[REFRESH_COOKIE], req.sessionId);
    this.clear(res);
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @Post('logout-all')
  @HttpCode(200)
  @NoStore()
  async logoutAll(
    @CurrentUser() userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logoutEverywhere(userId);
    this.clear(res);
    return result;
  }

  // ── Passwords ────────────────────────────────────────────────────────

  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  @NoStore()
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    // Always the same answer. Whether the address exists is not this
    // endpoint's to disclose.
    return {
      ok: true,
      message: 'If that address has an account, a reset link is on its way.',
    };
  }

  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('reset-password')
  @HttpCode(200)
  @NoStore()
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(
      dto,
      req.ip,
      req.headers['user-agent'] as string | undefined,
    );
  }

  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('change-password')
  @HttpCode(200)
  @NoStore()
  async change(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request & { sessionId?: string },
  ) {
    return this.auth.changePassword(userId, dto, req.sessionId);
  }

  // ── Viewer ───────────────────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('me')
  @NoStore()
  async me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @UseGuards(AuthGuard)
  @Get('sessions')
  @NoStore()
  async listSessions(
    @CurrentUser() userId: string,
    @Req() req: Request & { sessionId?: string },
  ) {
    const rows = await this.sessions.listForUser(userId);
    return rows.map((r) => ({ ...r, current: r.id === req.sessionId }));
  }
}
