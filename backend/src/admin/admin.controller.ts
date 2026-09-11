import {
  StreamableFile,
  Controller,
  Post,
  Get,
  Patch,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  Header,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { toCsv } from '../common/csv.util';
import { DealerVerificationService } from '../payments/dealer-verification.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { ShippingService } from '../shipping/shipping.service';
import { isShipmentFailureReason } from '../common/shipment-failure-policy';
import { SuperadminGuard } from './guards/superadmin.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { ReadShapedRoute } from './decorators/read-shaped-route.decorator';
import { OwnAccountRoute } from './decorators/own-account-route.decorator';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { ListingsService } from '../listings/listings.service';
import {
  AdminChangePasswordDto,
  AdminConfirmTotpDto,
  AdminEnrolTotpDto,
  AdminLoginDto,
  AdminRefreshDto,
} from './dto/admin-login.dto';
import { ListingReviewDto } from './dto/listing-review.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import {
  DeactivateAdminDto,
  UpdateAdminRoleDto,
} from './dto/update-admin-role.dto';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminAnalyticsService,
  AnalyticsPeriod,
  AnalyticsBucket,
} from './admin-analytics.service';
import { InsightsDigestService } from './insights-digest.service';
import { AdminCommandCenterService } from './admin-command-center.service';
import { AdminTrustSafetyService } from './admin-trust-safety.service';
import { AdminHealthService } from './admin-health.service';
import { AdminCreditsService } from './admin-credits.service';
import {
  AdminDealersService,
  CreateDealerDto,
  UpdateDealerDto,
} from './admin-dealers.service';
import {
  AdminCategoriesService,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './admin-categories.service';
import { AdminCategoryAttributesService } from './admin-category-attributes.service';
import {
  CreateCategoryAttributeDto,
  UpdateCategoryAttributeDto,
} from './dto/category-attribute.dto';
import { AdminSettingsService } from './admin-settings.service';
import {
  AdminBroadcastService,
  BroadcastDto,
  BroadcastAudience,
  BroadcastChannel,
} from './admin-broadcast.service';

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------

/**
 * Every response on this controller varies by viewer and most of them carry a
 * token. A shared cache holding one is somebody else's admin session — and
 * this is the session that will be able to approve a command on the box.
 *
 * ⚠️ NOT ONE OF THESE ROUTES CARRIED A Cache-Control HEADER BEFORE 2026-09-11,
 * including the one whose body is a signed credential.
 */
const NoStoreAdmin = () => Header('Cache-Control', 'private, no-store');

/**
 * ⚠️ `secure` FOLLOWS THE SCHEME; IT MUST NOT GO BACK TO A HARDCODED `true`.
 * It was hardcoded on both cookie calls here, which the member controller
 * pointedly avoids and explains why: a Secure cookie is silently DROPPED by
 * the browser over plain http, so on a local backend the login "succeeds",
 * sets nothing, and the next request is anonymous — a broken sign-in with
 * nothing in any log to say so. Production is https end to end (nginx sends
 * X-Forwarded-Proto https), so this stays true where it matters.
 */
const adminCookieIsSecure = () => process.env.NODE_ENV === 'production';

/**
 * The access-token cookie the login route has always set.
 *
 * ⚠️ IT IS STILL WRITE-ONLY, AND THAT IS NOT AN OVERSIGHT. AdminJwtGuard
 * reads `Authorization: Bearer` and nothing else, so this cookie authenticates
 * no request today; the Desk's real credential is the token in the body.
 * It is kept set because `frontend/app/(legal)/cookies/page.tsx` discloses it
 * to users — removing it is a legal-copy change, not a code change — and
 * because the frontend track may move the Desk onto cookie transport.
 *
 * ⚠️ DO NOT MAKE THE GUARD READ IT WITHOUT ALSO ADDING CSRF PROTECTION. The
 * moment a cookie authenticates a request, every state-changing admin route
 * becomes reachable by a cross-site form post. `SameSite=lax` blocks the
 * simple version of that; it is not a CSRF strategy on its own.
 */
const ADMIN_ACCESS_COOKIE = 'gg_admin_sess';

/**
 * The refresh cookie.
 *
 * ⚠️ PATH-SCOPED TO THE AUTH ROUTES on purpose, exactly like the member
 * `ao_rt`. The refresh token is the long-lived half of the pair; the fewer
 * requests carry it, the fewer places it can leak. Widening this path to '/'
 * attaches it to all ~148 admin requests.
 */
const ADMIN_REFRESH_COOKIE = 'gg_admin_rt';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  private meta(req: Request) {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }

  private baseCookie() {
    return {
      httpOnly: true,
      secure: adminCookieIsSecure(),
      sameSite: 'lax' as const,
    };
  }

  private setCookies(
    res: Response,
    issued: {
      accessToken: string;
      refreshToken: string;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
      rotated?: boolean;
    },
  ) {
    res.cookie(ADMIN_ACCESS_COOKIE, issued.accessToken, {
      ...this.baseCookie(),
      path: '/',
      // ⚠️ Follows the ACCESS token's fifteen-minute life, not the old
      // hardcoded eight hours. A cookie outliving the token it holds is a
      // browser confidently sending a credential the server already refuses.
      expires: issued.accessExpiresAt,
    });

    // 🚨 THE REFRESH COOKIE IS ONLY WRITTEN WHEN THE REFRESH SIDE ACTUALLY
    // MOVED. `rotated: false` comes back from exactly one place — the
    // grace-window branch in AdminSessionService.rotate() — and there
    // `refreshToken` is the token the caller PRESENTED, which the winning
    // request has already rotated away.
    //
    // `gg_admin_rt` is ONE cookie shared by every tab in the browser. Writing
    // the dead token back overwrote the winner's fresh one, so the next
    // refresh from any tab matched neither the live hash nor the (by then
    // lapsed) grace window, fell through to the post-grace replay branch, and
    // revoked the session. An ordinary two-tab refresh — or one retried
    // request — therefore signed the operator out of the Desk and recorded it
    // as a stolen credential. The grace window exists to make that race
    // harmless; this is the half that was missing.
    //
    // `rotated === undefined` means a caller that predates the flag, which is
    // only the login and enrol paths — they always rotate, so defaulting to
    // writing is correct.
    if (issued.rotated !== false) {
      res.cookie(ADMIN_REFRESH_COOKIE, issued.refreshToken, {
        ...this.baseCookie(),
        path: '/api/admin/auth',
        expires: issued.refreshExpiresAt,
      });
    }
  }

  private clearCookies(res: Response) {
    // Matching attrs and paths, or some browsers do not recognise the clear
    // and the stale cookie survives the sign-out that was meant to kill it.
    res.clearCookie(ADMIN_ACCESS_COOKIE, { ...this.baseCookie(), path: '/' });
    res.clearCookie(ADMIN_REFRESH_COOKIE, {
      ...this.baseCookie(),
      path: '/api/admin/auth',
    });
  }

  private readRefreshCookie(req: Request): string | undefined {
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[
      ADMIN_REFRESH_COOKIE
    ];
  }

  // Hard-cap brute force at 10 attempts/min/IP.
  //
  // ⚠️ THIS IS NOT THE REAL BRAKE AND MUST NOT BE TREATED AS ONE. The
  // throttler's store is in memory, so every `pm2 reload` — every deploy —
  // clears it and hands an attacker a fresh budget. The durable counter is
  // AdminUser.failedLoginCount; see AdminAuthService.recordFailedLogin.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @NoStoreAdmin()
  async login(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, this.meta(req));
    this.setCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessExpiresAt: new Date(result.expiresAt),
      // ⚠️ FROM THE SERVICE, NOT RE-DERIVED HERE. A second hardcoded "30
      // days" in this file is how a cookie ends up outliving the token inside
      // it — a browser confidently sending a credential the server already
      // refuses, which reads to the operator as a random sign-out.
      refreshExpiresAt: new Date(result.refreshExpiresAt),
    });
    return result;
  }

  /**
   * Rotate the refresh token into a fresh pair.
   *
   * ⚠️ NO AdminJwtGuard, DELIBERATELY. Refresh is what you call once the
   * fifteen-minute access token is already dead — guarding it with the token
   * it exists to replace is a sign-in loop. The refresh token IS the
   * credential here, and AdminSessionService.rotate() is what checks it.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @NoStoreAdmin()
  async refresh(
    @Body() dto: AdminRefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readRefreshCookie(req) ?? dto.refreshToken;
    if (!token) {
      this.clearCookies(res);
      return { ok: false };
    }
    try {
      const issued = await this.authService.refresh(token, this.meta(req));
      this.setCookies(res, issued);
      return {
        token: issued.accessToken,
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresAt: issued.accessExpiresAt.toISOString(),
        recoveryOnly: issued.recoveryOnly,
      };
    } catch (err) {
      // ⚠️ CLEAR BEFORE RETHROWING. A refused refresh means the session is
      // gone; leaving the cookies in place loops the client — a cookie is
      // present, so it renders, so the API 401s, so it refreshes, forever.
      this.clearCookies(res);
      throw err;
    }
  }

  /**
   * ⚠️ THIS NOW REVOKES SOMETHING. The old logout cleared `gg_admin_sess` —
   * a cookie AdminJwtGuard never read — and returned `{ok:true}`. Nothing was
   * revoked, because there was no session row to revoke, so the bearer token
   * the Desk held in localStorage stayed valid for the rest of its eight
   * hours. Sign-out was cosmetic.
   *
   * Still unguarded: you must be able to sign out with a dead access token,
   * and the refresh token presented is itself the proof of what to revoke.
   */
  @Post('logout')
  @HttpCode(200)
  @NoStoreAdmin()
  async logout(
    @Body() dto: AdminRefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readRefreshCookie(req) ?? dto?.refreshToken;
    this.clearCookies(res);
    return this.authService.logout(token);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  @NoStoreAdmin()
  me(@CurrentAdmin() admin: { sub: string; email: string; role: string }) {
    return this.authService.me(admin);
  }

  /**
   * The open sessions on this admin's own account.
   *
   * GET, so no hatch needed — a read-only admin may see their own devices.
   */
  @Get('sessions')
  @UseGuards(AdminJwtGuard)
  @NoStoreAdmin()
  sessions(@CurrentAdmin() admin: { sub: string }) {
    return this.authService.listSessions(admin.sub);
  }

  // ── Own-account writes ────────────────────────────────────────────────
  //
  // ⚠️ THE FOUR ROUTES BELOW CARRY @OwnAccountRoute() AND ARE PINNED BY
  // own-account-routes.spec.ts. Each writes only the caller's own credential,
  // addressed by @CurrentAdmin().sub and by no id from the path, query or
  // body. A route added here that takes a target admin id is a privilege
  // escalation; add it to the AdminAdminsController instead, where it is
  // SUPERADMIN-gated and audited.

  /**
   * ⚠️ THE ONLY WAY AN ADMIN PASSWORD CAN BE SET THROUGH THE API AT ALL.
   * `createAdmin` writes a random throwaway hash nobody has ever seen, so
   * before this route a freshly created admin literally could not sign in —
   * the only working provisioning path was `scripts/create-admin.mjs` on the
   * box. It still is; this is how the printed password stops being the
   * password.
   */
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('password')
  @UseGuards(AdminJwtGuard)
  @OwnAccountRoute()
  @HttpCode(200)
  @NoStoreAdmin()
  changePassword(
    @Body() dto: AdminChangePasswordDto,
    @CurrentAdmin() admin: { sub: string; sid?: string },
  ) {
    return this.authService.changePassword(admin.sub, dto, admin.sid);
  }

  /**
   * Step one of enrolment. The response carries the TOTP secret — the only
   * time it ever leaves the server — so it is no-store and nothing logs it.
   *
   * ⚠️ IT TAKES A BODY, AND THE BODY MATTERS: replacing a confirmed
   * authenticator requires the account's current password. The own-account
   * hatch opens this route to a read-only recovery session on purpose, so the
   * password is what stops a stolen access token swapping the second factor.
   */
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('totp/enrol')
  @UseGuards(AdminJwtGuard)
  @OwnAccountRoute()
  @HttpCode(200)
  @NoStoreAdmin()
  enrolTotp(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: AdminEnrolTotpDto,
  ) {
    return this.authService.enrolTotp(admin.sub, dto);
  }

  /**
   * Step two: prove the secret reached a phone. Returns the ten recovery
   * codes, once. Nothing can re-read them.
   */
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @Post('totp/confirm')
  @UseGuards(AdminJwtGuard)
  @OwnAccountRoute()
  @HttpCode(200)
  @NoStoreAdmin()
  confirmTotp(
    @Body() dto: AdminConfirmTotpDto,
    @CurrentAdmin() admin: { sub: string; sid?: string },
  ) {
    return this.authService.confirmTotp(admin.sub, dto, admin.sid);
  }

  /** "Sign out everywhere else" — the caller's own sessions only. */
  @Post('sessions/revoke-others')
  @UseGuards(AdminJwtGuard)
  @OwnAccountRoute()
  @HttpCode(200)
  @NoStoreAdmin()
  revokeOtherSessions(@CurrentAdmin() admin: { sub: string; sid?: string }) {
    return this.authService.revokeOtherSessions(admin.sub, admin.sid);
  }
}

// ---------------------------------------------------------------
// Alerts — the inbox for AdminAlert rows. Before this existed the
// command center could COUNT unresolved alerts but there was no UI
// (or endpoint) to view or resolve them; the only way was raw SQL.
// ---------------------------------------------------------------
@Controller('admin/alerts')
@UseGuards(AdminJwtGuard)
export class AdminAlertsController {
  constructor(private readonly adminService: AdminService) {}

  // List alerts, unresolved first. ?resolved=true shows the handled
  // history; default returns everything (the page groups client-side).
  // ?type= / ?urgent= narrow a noisy burst down to one family; ?cursor= is
  // the id of the last row already rendered and pages forward from it
  // (see AdminService.listAlerts for why this is a cursor, not an offset).
  @Get()
  listAlerts(
    @Query('resolved') resolved?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('urgent') urgent?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.adminService.listAlerts(
      resolved === undefined ? undefined : resolved === 'true',
      Number(limit) || 100,
      {
        type: type?.trim() || undefined,
        // Absent/empty means "don't filter" — only an explicit true/false
        // narrows, so ?urgent= from a cleared toggle behaves like no filter.
        urgent:
          urgent === undefined || urgent.trim() === ''
            ? undefined
            : urgent === 'true',
        cursor: cursor?.trim() || undefined,
      },
    );
  }

  // Sidebar badge poll — {unresolved, urgent}. Must stay above the
  // parameterised routes so 'count' is never swallowed as an :id.
  @Get('count')
  alertCounts() {
    return this.adminService.alertCounts();
  }

  // Distinct types + unresolved counts, powering the inbox filter chips.
  // Literal path, declared above the parameterised routes for the same
  // reason 'count' is.
  @Get('types')
  alertTypes() {
    return this.adminService.alertTypeFacets();
  }

  // Bulk resolve from the inbox's selection bar. Literal path kept above
  // POST :id/resolve so 'bulk-resolve' can never be read as an alert id.
  // Returns a per-alert tally ({resolved, skipped, failed}) rather than a
  // bare ok — the UI reports what actually landed.
  @Post('bulk-resolve')
  @HttpCode(200)
  bulkResolveAlerts(
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { alertIds?: string[]; reason?: string },
  ) {
    return this.adminService.bulkResolveAlerts(
      admin.sub,
      body?.alertIds ?? [],
      body?.reason,
    );
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolveAlert(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.resolveAlert(admin.sub, id, body?.reason);
  }
}

// ---------------------------------------------------------------
// Listings
// ---------------------------------------------------------------
@Controller('admin/listings')
@UseGuards(AdminJwtGuard)
export class AdminListingsController {
  constructor(
    private readonly adminService: AdminService,
    private readonly listingsService: ListingsService,
  ) {}

  // (The one-time POST /reindex maintenance route was removed 2026-07-18
  // — no UI ever called it. Bulk reindex still runs automatically after
  // category-attribute changes via reindexAllActiveListings; call that
  // from a script if a manual rebuild is ever needed.)

  @Get()
  getListings(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getListings(
      status,
      Number(page) || 1,
      Number(limit) || 20,
      search,
    );
  }

  // Dossier — listing + every relation an admin needs to assess it:
  // moderation history, offers, bids, watchers, transactions,
  // questions, audit trail. Single round-trip.
  @Get(':id/dossier')
  getListingDossier(@Param('id') id: string) {
    return this.adminService.getListingDossier(id);
  }

  @Post(':id/review')
  @HttpCode(200)
  reviewListing(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: ListingReviewDto,
  ) {
    return this.adminService.reviewListing(id, admin.sub, dto);
  }

  // Bulk-review. Body: { listingIds: string[], action: 'APPROVE' | 'REJECT', reason?: string }
  @Post('bulk-review')
  @HttpCode(200)
  bulkReview(
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { listingIds?: string[]; action?: string; reason?: string },
  ) {
    const action =
      body.action === 'APPROVE'
        ? 'APPROVE'
        : body.action === 'REJECT'
          ? 'REJECT'
          : null;
    if (!action) {
      throw new Error('action must be APPROVE or REJECT');
    }
    return this.adminService.bulkReviewListings(
      body.listingIds ?? [],
      admin.sub,
      action,
      body.reason,
    );
  }

  // Admin can take down ANY listing regardless of status (ACTIVE,
  // PENDING_REVIEW, SOLD, etc.) — soft-delete via status=CANCELLED.
  // `reason` is required and surfaced to the seller in the
  // notification email. Audit lives on Listing.adminOverrideReason.
  @Post(':id/delete')
  @HttpCode(200)
  deleteListing(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.deleteListing(id, admin.sub, body?.reason ?? '');
  }
}

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------
@Controller('admin/users')
@UseGuards(AdminJwtGuard)
export class AdminUsersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  getUsers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    // Mirrors admin-service filter names. The command-center deep-links
    // here with ?kyc=stalled — both kyc and filter map to the same code
    // path so we accept either form.
    @Query('kyc') kyc?: string,
    @Query('filter') filter?: string,
  ) {
    const effectiveFilter =
      filter ?? (kyc === 'stalled' ? 'kyc-stalled' : undefined);
    return this.adminService.getUsers(
      search,
      Number(page) || 1,
      Number(limit) || 30,
      effectiveFilter,
    );
  }

  // Dossier — full user record + every adjacent dataset (listings,
  // transactions, offers, bids, ratings, audit, alerts). Powers the
  // /admin/users/[id] drill-down. Single endpoint = single round-trip
  // from the frontend.
  @Get(':id/dossier')
  getDossier(@Param('id') id: string) {
    return this.adminService.getUserDossier(id);
  }

  /**
   * The identity document or selfie, decrypted, for the KYC dossier.
   *
   * ⚠️ THIS ROUTE EXISTS BECAUSE THE FILES CAME OFF A PUBLIC CDN. They were
   * Cloudinary uploads with the service's defaults — no `type: 'private'`, no
   * access_mode — so the dossier could link straight to them with a plain
   * anchor, and so could anybody else who had the link. They are AES-GCM on
   * our own disk now, which means an authenticated read is the only way to
   * see one.
   *
   * ⚠️ NEVER CACHED. It is a South African identity document; a copy sitting
   * in a proxy or a browser cache is the exposure again in miniature.
   */
  @Get(':id/kyc-file/:which')
  async kycFile(
    @Param('id') id: string,
    @Param('which') which: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (which !== 'id' && which !== 'selfie') {
      throw new BadRequestException('Unknown document.');
    }
    const f = await this.adminService.readKycFile(id, which);
    res.set({
      'Content-Type': f.mimeType,
      'Content-Length': String(f.bytes.length),
      'Content-Disposition': `inline; filename="${which}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(f.bytes);
  }

  @Patch(':id')
  updateUser(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, admin.sub, dto);
  }

  // Re-run Peach bank-account verification for this user (dossier action —
  // e.g. after a BANK_VERIFY_FAILED/MISMATCH alert once details are fixed).
  @Post(':id/verify-bank')
  @HttpCode(200)
  verifyBank(@Param('id') id: string, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.rerunBankVerification(id, admin.sub);
  }

  // Close a member's account on their behalf — DISTINCT FROM BAN, and not a
  // delete. Ban keeps the profile and the listings up; this takes them off the
  // public side and releases the handle, while every transaction, rating and
  // complaint stays attached to the row.
  //
  // ⚠️ This is also the ONLY route by which a banned member's account can be
  // closed: the self-service button refuses a restricted account so closing
  // can never launder a ban.
  @Post(':id/close-account')
  @HttpCode(200)
  closeAccount(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.closeAccount(id, admin.sub, body?.reason ?? '');
  }

  // ── POPIA ERASURE ────────────────────────────────────────────────
  //
  // ⚠️ THIS ROUTE EXISTS BECAUSE REMOVING CLERK TOOK ITS ONLY TRIGGER AWAY.
  // The erasure itself is old code and unchanged — it purges the member's
  // motivations, Licence Centre documents and KYC files from disk before the
  // rows that point at them disappear. Its one caller was the identity
  // provider's `user.deleted` webhook. With that gone, a POPIA erasure request
  // had no way to be actioned at all except a hand-written DELETE, which is
  // exactly the situation the erasure code was written to avoid.
  //
  // ⚠️ IT IS NOT THE CLOSE BUTTON, AND MUST NOT BE WIRED TO ONE. Closing an
  // account is reversible and keeps the evidence — the operator's own
  // instruction: "if a user committed a crime they can't just vanish by
  // deleting and wiping evidence." This is the separate, deliberate act of
  // answering a right-to-erasure request, and SUPERADMIN-only by virtue of
  // being a mutating method under AdminJwtGuard.
  @Post(':id/erase')
  @HttpCode(200)
  async erase(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.eraseAccount(id, admin.sub, body?.reason ?? '');
  }

  // Clear seller reject-strikes + lift the offers suspension (after
  // reviewing a SELLER_REJECT_STRIKE alert). Also resolves those alerts.
  @Post(':id/clear-reject-strikes')
  @HttpCode(200)
  clearRejectStrikes(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
  ) {
    return this.adminService.clearRejectStrikes(id, admin.sub);
  }

  // Claude-KYC human review — decide an UNDER_REVIEW verification from
  // the dossier. Guarded transition; reason required for the audit row.
  @Post(':id/kyc-review')
  @HttpCode(200)
  reviewKyc(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { decision?: 'APPROVE' | 'REJECT'; reason?: string },
  ) {
    if (body.decision !== 'APPROVE' && body.decision !== 'REJECT') {
      throw new BadRequestException('decision must be APPROVE or REJECT');
    }
    return this.adminService.reviewKyc(
      id,
      admin.sub,
      body.decision,
      body.reason ?? '',
    );
  }

  // Bulk-ban. Body: { userIds: string[], reason: string }. Each ban
  // gets its own USER_BAN audit row via the underlying updateUser call.
  @Post('bulk-ban')
  @HttpCode(200)
  bulkBan(
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { userIds?: string[]; reason?: string },
  ) {
    return this.adminService.bulkBanUsers(
      body.userIds ?? [],
      admin.sub,
      body.reason ?? '',
    );
  }
}

// ---------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------
@Controller('admin/transactions')
@UseGuards(AdminJwtGuard)
export class AdminTransactionsController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAudit: AdminAuditService,
    private readonly shippingService: ShippingService,
    private readonly dealerVerification: DealerVerificationService,
    // ZohoBooksService used by the /zoho-retry endpoint — admin
    // dossier's "Retry Books sync" button calls it to re-fire the
    // commission-invoice + mark-paid hooks when the first attempt
    // failed (e.g. transient API blip).
    private readonly zohoBooks: ZohoBooksService,
  ) {}

  @Get()
  getTransactions(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    // filter=accept-stalled narrows HELD rows to escalated 48h-accept
    // breaches — the command-center "Sales awaiting accept" deep-link.
    @Query('filter') filter?: string,
  ) {
    return this.adminService.getTransactions(
      status,
      Number(page) || 1,
      Number(limit) || 20,
      filter,
    );
  }

  // Order / financial CSV export (Phase 7 P7.3). Static segment, declared
  // before the :id routes. Admin-only accounting export over a date range.
  @Get('export.csv')
  async exportCsv(
    @CurrentAdmin() admin: { sub: string },
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    const { csv, filename } = await this.adminService.exportTransactionsCsv(
      { fromISO: from, toISO: to, status },
      admin.sub,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // Dossier — parties, listing, payment + shipping timeline, raw Peach result
  // codes, dealer (if firearm), rating, complaints and the admin audit trail.
  // One round-trip so the admin can resolve a dispute from one screen.
  //
  // ⚠️ NO MESSAGES, THOUGH THIS COMMENT PROMISED THEM UNTIL 2026-09-03. Buyer
  // to seller chat was never built; the Prisma Message model is kept only for
  // dormant legacy rows, and the service deliberately does not include it. The
  // promise sent a reader looking for a relation that has never existed.
  //
  // ⚠️ AND NO PRESENTED MONEY. This returns the raw fee columns, never
  // payments/fee-presentation.ts — so every consumer is left to reason about
  // feeModel for itself, which is the exact ambiguity that file exists to end.
  // A `money` block built by the one presenter belongs here.
  @Get(':id/dossier')
  getTransactionDossier(@Param('id') id: string) {
    return this.adminService.getTransactionDossier(id);
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@Param('id') id: string, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.releaseTransaction(id, admin.sub);
  }

  // Record WHY a courier shipment failed, and bill the seller when the reason
  // is one they controlled.
  //
  // Admin-only because the carrier tells us THAT a delivery failed, almost
  // never whose fault it was — that judgement is a person's, and it moves
  // money. GET /shipping/failure-reasons serves the ticklist, including which
  // reasons charge, so the UI can warn before this is submitted.
  @Post(':id/shipment-failure')
  @HttpCode(200)
  async recordShipmentFailure(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body('reason') reason?: string,
    @Body('note') note?: string,
  ) {
    if (!isShipmentFailureReason(reason)) {
      throw new BadRequestException(
        'Pick a failure reason from the list — an unrecognised reason must never move money.',
      );
    }
    const out = await this.shippingService.recordShipmentFailure(id, reason, note);
    // Audited because it moves money. The reason string carries the amount so
    // the trail answers "why was this seller docked?" without a second lookup.
    await this.adminAudit.record({
      adminUserId: admin.sub,
      action: 'SHIPMENT_FAILURE_RECORDED',
      resourceType: 'Transaction',
      resourceId: id,
      newValue: { reason, chargedCents: out.chargeCents, note: note ?? null },
      reason: `Shipment failed: ${reason}${
        out.charged
          ? ` — seller charged R${(out.chargeCents / 100).toFixed(2)}`
          : ' — no seller charge'
      }${note ? ` (${note})` : ''}`,
    });
    return out;
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body('note') note?: string,
    // Optional partial-refund amount in ZAR cents. Omit for a full refund
    // of the remaining balance.
    @Body('amountZarCents') amountZarCents?: number,
  ) {
    return this.adminService.refundTransaction(id, admin.sub, note, amountZarCents);
  }

  // Resolve a DISPUTED transaction in favour of the seller — force
  // release the payout. Body: { reason }. For refunds use the
  // refund endpoint above; the dossier UI presents both as a "Resolve
  // dispute" choice.
  @Post(':id/resolve-dispute-release')
  @HttpCode(200)
  resolveDisputeRelease(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.resolveDisputeRelease(
      id,
      admin.sub,
      body.reason ?? '',
    );
  }

  // M26 (FLOW-F4) — payout-HOLD lever. Withhold a RELEASED/REFUNDED payout that
  // is still due (not yet in a bank batch) so a post-release fraud allegation
  // can be actioned before the cash leaves GG. Body: { reason } (>=5 chars,
  // recorded in the audit log). The daily FNB sweep skips held rows.
  @Post(':id/hold-payout')
  @HttpCode(200)
  holdPayout(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.holdPayout(id, admin.sub, body.reason ?? '');
  }

  @Post(':id/release-payout-hold')
  @HttpCode(200)
  releasePayoutHold(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    return this.adminService.releasePayoutHold(id, admin.sub, body.reason ?? '');
  }

  // Dealer-verification override. Admin reviews Claude's findings +
  // the 3 photos and approves or rejects manually. Body: { decision,
  // reason }. Used for borderline Claude verdicts (PENDING_ADMIN_REVIEW)
  // OR to override a confident Claude verdict the admin disagrees with.
  @Post(':id/dealer-verification/override')
  @HttpCode(200)
  overrideDealerVerification(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { decision?: string; reason?: string },
  ) {
    const decision =
      body.decision === 'APPROVE'
        ? 'APPROVE'
        : body.decision === 'REJECT'
          ? 'REJECT'
          : null;
    if (!decision) {
      throw new BadRequestException('decision must be APPROVE or REJECT');
    }
    return this.dealerVerification.adminOverride(
      id,
      decision,
      admin.sub,
      body.reason ?? '',
    );
  }

  // ── Zoho Books retry — re-fires the commission-invoice + mark-paid
  // hooks for a transaction whose previous sync attempt failed.
  // Called from the admin dossier's ZohoSyncPanel "Retry" button.
  // Idempotent in the ZohoBooksService itself — skips if already
  // posted, so safe to click multiple times.
  @Post(':id/zoho-retry')
  @HttpCode(200)
  async retryZohoSync(@Param('id') id: string) {
    await this.zohoBooks.createCommissionInvoice(id);
    await this.zohoBooks.markCommissionInvoicePaid(id);
    return { triggered: true };
  }
}

// ---------------------------------------------------------------
// Orders (P8b multi-item cart) — list + dossier. FLOW-F3 (H11).
// Read-only discovery surface over the Order parent + its child
// Transaction lines. Money actions still happen per-line on the
// transaction dossier (the refund endpoint's sibling-ordering guard
// sequences the parcel unwind correctly).
// ---------------------------------------------------------------
@Controller('admin/orders')
@UseGuards(AdminJwtGuard)
export class AdminOrdersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  getOrders(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getOrders(
      status,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get(':id/dossier')
  getOrderDossier(@Param('id') id: string) {
    return this.adminService.getOrderDossier(id);
  }
}

// ---------------------------------------------------------------
// Admins — list, create, update role, deactivate
// ---------------------------------------------------------------
// Listing is open to any logged-in admin (so monitoring admins know
// who has access). Mutations are SUPERADMIN-only — the service also
// re-checks the role from the DB so the JWT can't be forged into a
// SUPERADMIN tier and grant access on its own.
@Controller('admin/admins')
@UseGuards(AdminJwtGuard)
export class AdminAdminsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  list() {
    return this.adminService.listAdmins();
  }

  // ⚠️ ALL THREE WRITES BELOW NOW REQUIRE A `reason` AND WRITE AN AUDIT ROW.
  // They decide who may approve a command that runs on the production box,
  // and until 2026-09-11 not one of them called audit.record() — twelve other
  // writes in admin.service.ts did, but the three that hand out the power
  // those twelve need did not. There was no record that anyone had ever
  // created an admin.
  //
  // ⚠️ THE `reason` IS A BREAKING CHANGE FOR A CALLER THAT SENDS NONE:
  // class-validator 400s the request. Backend and Desk must land together.

  @Post()
  @UseGuards(SuperadminGuard)
  @HttpCode(201)
  create(@Body() dto: CreateAdminDto, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.createAdmin(
      dto.email,
      dto.role,
      admin.sub,
      dto.reason,
    );
  }

  @Patch(':id/role')
  @UseGuards(SuperadminGuard)
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentAdmin() admin: { sub: string },
  ) {
    return this.adminService.updateAdminRole(
      id,
      dto.role,
      admin.sub,
      dto.reason,
    );
  }

  // ⚠️ THIS TOOK NO @Body() AT ALL before 2026-09-11 — there was no DTO, so
  // there was nowhere for a reason to go, which is why it logged nothing.
  @Post(':id/deactivate')
  @UseGuards(SuperadminGuard)
  @HttpCode(200)
  deactivate(
    @Param('id') id: string,
    @Body() dto: DeactivateAdminDto,
    @CurrentAdmin() admin: { sub: string },
  ) {
    return this.adminService.deactivateAdmin(id, admin.sub, dto.reason);
  }
}

// ---------------------------------------------------------------
// KYC — VerifyNow credit balance
// ---------------------------------------------------------------
// (AdminKycController removed 2026-07-18 — its standalone VerifyNow
// balance page was an orphan superseded by /admin/credits, which polls
// the same balance through the credit-snapshot cron.)

// ---------------------------------------------------------------
// Global search — powers the type-ahead in the admin layout header.
// Returns a tiny mixed result set (users + listings + transactions).
// Min 2 chars; below that returns empty results.
// ---------------------------------------------------------------
@Controller('admin/search')
@UseGuards(AdminJwtGuard)
export class AdminSearchController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  search(@Query('q') q?: string) {
    return this.adminService.globalSearch(q ?? '');
  }
}

// ---------------------------------------------------------------
// Audit log — read-only chronological view of every destructive
// admin action. Inserts happen inside the services that perform
// the actions (see AdminService.updateUser); this controller is
// query-only. Filter by adminUserId or resourceType.
// ---------------------------------------------------------------
@Controller('admin/audit')
@UseGuards(AdminJwtGuard)
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('adminUserId') adminUserId?: string,
    @Query('resourceType') resourceType?: string,
  ) {
    return this.audit.list({
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      adminUserId,
      resourceType,
    });
  }
}

// ---------------------------------------------------------------
// Analytics — sales / trends dashboard data. All endpoints are
// read-only aggregations over the existing schema (no new tables).
// Period is one of 7d/30d/90d/365d/all; bucket only applies to the
// time-series endpoint and is one of day/week/month.
// ---------------------------------------------------------------
@Controller('admin/analytics')
@UseGuards(AdminJwtGuard)
export class AdminAnalyticsController {
  constructor(
    private readonly analytics: AdminAnalyticsService,
    private readonly digest: InsightsDigestService,
  ) {}

  // Normaliser — falls back to 30d for anything unrecognised so the
  // dashboard always renders something.
  private resolvePeriod(p?: string): AnalyticsPeriod {
    if (
      p === '7d' ||
      p === '30d' ||
      p === '90d' ||
      p === '365d' ||
      p === 'all'
    ) {
      return p;
    }
    return '30d';
  }

  private resolveBucket(b?: string): AnalyticsBucket {
    if (b === 'day' || b === 'week' || b === 'month') return b;
    return 'day';
  }

  @Get('overview')
  overview(@Query('period') period?: string) {
    return this.analytics.overview(this.resolvePeriod(period));
  }

  @Get('time-series')
  timeSeries(
    @Query('period') period?: string,
    @Query('bucket') bucket?: string,
  ) {
    return this.analytics.timeSeries(
      this.resolvePeriod(period),
      this.resolveBucket(bucket),
    );
  }

  @Get('by-listing-type')
  byListingType(@Query('period') period?: string) {
    return this.analytics.byListingType(this.resolvePeriod(period));
  }

  @Get('by-category')
  byCategory(@Query('period') period?: string) {
    return this.analytics.byCategory(this.resolvePeriod(period));
  }

  @Get('top-make-model')
  topMakeModel(@Query('period') period?: string) {
    return this.analytics.topMakeModel(this.resolvePeriod(period));
  }

  @Get('time-to-sale')
  timeToSale(@Query('period') period?: string) {
    return this.analytics.timeToSale(this.resolvePeriod(period));
  }

  // ─── Insights (Phase 3) ────────────────────────────────────────
  /**
   * The analytics time series, as a spreadsheet.
   *
   * 🚨 THE LAST THING THE CUTOVER MAP RECORDED AS GENUINELY MISSING, and the
   * only one that needed a backend route rather than a caller: there was no
   * analytics CSV endpoint at all, only the unrelated transactions export. So
   * this is not "a button nobody wired" — it is the one gap on that list where
   * the map was right that something had to be built.
   *
   * ⚠️ A GET, SO IT STAYS OPEN TO A MONITORING ADMIN. AdminJwtGuard denies
   * mutating methods, and an export reads. Making it a POST to carry a body
   * would have quietly made the report SUPERADMIN-only.
   *
   * ⚠️ SAME period AND bucket VOCABULARY AS THE CHART, resolved by the same
   * two helpers — so the file an operator downloads is the series they were
   * looking at, not a differently-windowed one that happens to look similar.
   */
  @Get('export.csv')
  async exportSeriesCsv(
    @Res() res: Response,
    @Query('period') period?: string,
    @Query('bucket') bucket?: string,
  ) {
    const p = this.resolvePeriod(period);
    const b = this.resolveBucket(bucket);
    const points = await this.analytics.timeSeries(p, b);
    const csv = toCsv([
      ['bucket', 'gmv_rand', 'revenue_rand', 'transactions'],
      ...points.map((pt) => [
        pt.bucket,
        // ⚠️ RAND, NOT CENTS, AND THE HEADER SAYS SO. A spreadsheet column of
        // integers labelled "gmv" is read as rands by whoever opens it, and
        // every figure would be a hundred times too big.
        (pt.gmvCents / 100).toFixed(2),
        (pt.revenueCents / 100).toFixed(2),
        pt.txCount,
      ]),
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="all-outdoor-analytics-${p}-${b}.csv"`,
    );
    res.send(csv);
  }

  @Get('insights/pulse')
  insightsPulse() {
    return this.analytics.insightsPulse();
  }

  @Get('insights/sales-heatmap')
  salesHeatmap(@Query('period') period?: string) {
    return this.analytics.salesHeatmap(this.resolvePeriod(period));
  }

  @Get('insights/activity-heatmap')
  activityHeatmap(@Query('period') period?: string) {
    return this.analytics.activityHeatmap(this.resolvePeriod(period));
  }

  @Get('insights/search')
  searchIntel(@Query('period') period?: string) {
    return this.analytics.searchIntel(this.resolvePeriod(period));
  }

  @Get('insights/funnel')
  engagementFunnel(@Query('period') period?: string) {
    return this.analytics.engagementFunnel(this.resolvePeriod(period));
  }

  @Get('insights/active-users')
  activeUsers(@Query('period') period?: string) {
    return this.analytics.topActiveUsers(this.resolvePeriod(period));
  }

  @Get('insights/user/:id')
  userDrilldown(@Param('id') id: string) {
    return this.analytics.userDrilldown(id);
  }

  @Get('insights/dormant')
  dormantSegment() {
    return this.analytics.dormantSegment();
  }

  @Get('insights/digest')
  latestDigest() {
    return this.digest.getLatest();
  }

  // Admin-triggered generate-now (so the operator doesn't wait for Monday).
  // ⚠️ NOT a read, despite sitting under the insights GETs and being named
  // "generate": it persists an InsightsDigest row and spends on an LLM call.
  // Never give this @ReadShapedRoute() — it is SUPERADMIN-only on purpose.
  @Post('insights/digest/generate')
  generateDigest() {
    return this.digest.generate(30);
  }

  // ─── Operational Health ───────────────────────────────────────
  // Three signals: KYC funnel drop-off, dispatch SLA histogram,
  // refund-risk sellers (refund rate ≥ 2x marketplace baseline).
  @Get('kyc-funnel')
  kycFunnel() {
    return this.analytics.kycFunnel();
  }

  @Get('dispatch-sla')
  dispatchSla() {
    return this.analytics.dispatchSlaDistribution();
  }

  @Get('refund-risk')
  refundRisk() {
    return this.analytics.refundRiskSellers();
  }

  // Freshness graveyard — dead inventory ranked by age × price.
  // Default cutoff is 30 days; admins can pass ?minAgeDays=60 for a
  // tighter view ("only the really stale stuff").
  @Get('freshness-graveyard')
  freshnessGraveyard(
    @Query('minAgeDays') minAgeDays?: string,
    @Query('limit') limit?: string,
  ) {
    const age = minAgeDays ? parseInt(minAgeDays, 10) : 30;
    const lim = limit ? parseInt(limit, 10) : 50;
    return this.analytics.freshnessGraveyard(
      Number.isFinite(age) && age > 0 ? age : 30,
      Number.isFinite(lim) && lim > 0 && lim <= 200 ? lim : 50,
    );
  }
}

// ---------------------------------------------------------------
// Command Center — powers the redesigned overview page. Three
// endpoints (attention queue, today's pulse, activity feed) that
// together turn the home dashboard from "4 numbers" into a real
// operator NOC view.
// ---------------------------------------------------------------
@Controller('admin/command')
@UseGuards(AdminJwtGuard)
export class AdminCommandCenterController {
  constructor(private readonly commandCenter: AdminCommandCenterService) {}

  @Get('attention-queue')
  attentionQueue() {
    return this.commandCenter.attentionQueue();
  }

  @Get('today-pulse')
  todayPulse() {
    return this.commandCenter.todayPulse();
  }

  @Get('activity-feed')
  activityFeed(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 30;
    return this.commandCenter.activityFeed(
      Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 30,
    );
  }
}

// ---------------------------------------------------------------
// Dealer directory — CRUD over the Dealer model that backs the
// DEALER_TRANSFER checkout path. Soft-delete via isActive flag.
// ---------------------------------------------------------------
@Controller('admin/dealers')
@UseGuards(AdminJwtGuard)
export class AdminDealersController {
  constructor(private readonly dealers: AdminDealersService) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('source') source?: string,
    @Query('pending') pending?: string,
  ) {
    return this.dealers.list(
      search,
      includeInactive === 'true',
      source,
      pending === 'true',
    );
  }

  @Post()
  @HttpCode(201)
  create(@CurrentAdmin() admin: { sub: string }, @Body() dto: CreateDealerDto) {
    return this.dealers.create(admin.sub, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: UpdateDealerDto & { reason?: string },
  ) {
    const { reason, ...dto } = body;
    return this.dealers.update(admin.sub, id, dto, reason ?? '');
  }
}

// ---------------------------------------------------------------
// Broadcast comms — send a one-off email or SMS to an individual,
// a segment, or all users. Every send creates a BROADCAST_SENT
// audit row with the recipient count + body preview.
// ---------------------------------------------------------------
@Controller('admin/broadcast')
@UseGuards(AdminJwtGuard)
export class AdminBroadcastController {
  constructor(private readonly broadcast: AdminBroadcastService) {}

  // Preview the recipient count before sending. Body: { audience, channel }
  // READ: resolves the recipient list and returns its length — no send,
  // no audit row, nothing written. A POST only because the audience
  // filter travels in the body.
  @Post('preview')
  @ReadShapedRoute()
  @HttpCode(200)
  preview(
    @Body() body: { audience: BroadcastAudience; channel: BroadcastChannel },
  ) {
    return this.broadcast.preview(body.audience, body.channel);
  }

  // Actually send. Body: BroadcastDto
  @Post('send')
  @HttpCode(200)
  send(@CurrentAdmin() admin: { sub: string }, @Body() dto: BroadcastDto) {
    return this.broadcast.send(admin.sub, dto);
  }
}

// ---------------------------------------------------------------
// Marketplace settings — admin-tunable feature flags + thresholds.
// Reads/writes the same key/value Setting table that runtime code
// consults via SettingsService, so changes take effect immediately.
// Every write requires a reason for the audit log.
// ---------------------------------------------------------------
@Controller('admin/settings')
@UseGuards(AdminJwtGuard)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { value?: string; reason?: string },
  ) {
    return this.settings.update(
      admin.sub,
      key,
      body.value ?? '',
      body.reason ?? '',
    );
  }
}

// ---------------------------------------------------------------
// Categories CRUD — tree of marketplace categories. Soft-delete via
// isActive flag. Slug auto-derived from name; renaming re-slugs.
// ---------------------------------------------------------------
@Controller('admin/categories')
@UseGuards(AdminJwtGuard)
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  list() {
    return this.categories.list();
  }

  // Unmet cross-sell demand report. Distinct path so it doesn't collide
  // with any param route.
  @Get('cross-sell-demand')
  crossSellDemand() {
    return this.categories.crossSellDemand();
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categories.create(admin.sub, dto);
  }

  // Replace a category's cross-sell complementary set ("when browsing
  // THIS category, also suggest these"). Declared BEFORE @Patch(':id') so
  // the two-segment path matches first.
  @Patch(':id/relations')
  setRelations(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { toCategoryIds?: string[]; reason?: string },
  ) {
    return this.categories.setRelations(
      admin.sub,
      id,
      body.toCategoryIds ?? [],
      body.reason ?? '',
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: UpdateCategoryDto & { reason?: string },
  ) {
    const { reason, ...dto } = body;
    return this.categories.update(admin.sub, id, dto, reason ?? '');
  }
}

// ---------------------------------------------------------------
// Category attributes CRUD (P4) — the per-category attribute DEFINITIONS
// (fridge litres, rod class, size…) that drive the sell form + browse
// facets. Nested under a category (3-segment path) so it never collides
// with the 2-segment @Patch(':id') on AdminCategoriesController above.
// Delete is a hard delete; PATCH isActive=false is the soft alternative.
// ---------------------------------------------------------------
@Controller('admin/categories/:categoryId/attributes')
@UseGuards(AdminJwtGuard)
export class AdminCategoryAttributesController {
  constructor(private readonly attributes: AdminCategoryAttributesService) {}

  @Get()
  list(@Param('categoryId') categoryId: string) {
    return this.attributes.list(categoryId);
  }

  @Post()
  @HttpCode(201)
  create(
    @Param('categoryId') categoryId: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: CreateCategoryAttributeDto,
  ) {
    return this.attributes.create(admin.sub, categoryId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: UpdateCategoryAttributeDto,
  ) {
    return this.attributes.update(admin.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string, @CurrentAdmin() admin: { sub: string }) {
    return this.attributes.remove(admin.sub, id);
  }
}

// ---------------------------------------------------------------
// System Health — external service probes, cron last-run, queue depths.
// One page, one round-trip; the probes themselves are bounded at 5s
// each but run in parallel.
// ---------------------------------------------------------------
@Controller('admin/health')
@UseGuards(AdminJwtGuard)
export class AdminHealthController {
  constructor(private readonly health: AdminHealthService) {}

  @Get('services')
  services() {
    return this.health.probeServices();
  }

  @Get('crons')
  crons() {
    return this.health.cronStatuses();
  }

  @Get('queues')
  queues() {
    return this.health.queueDepths();
  }
}

// ---------------------------------------------------------------
// Cron-freshness probe for an EXTERNAL monitor (system cron on the Vultr
// box, or UptimeRobot/healthchecks.io — which also covers whole-VPS death
// the in-process watchdog can't see). Deliberately OUTSIDE the AdminJwt
// controller so a headless monitor can hit it with a shared secret instead
// of a provider-minted admin JWT. Returns 200 when every monitored cron is
// fresh, 503 with the stale keys otherwise, so the monitor alerts on non-200.
// ---------------------------------------------------------------
@Controller('health')
export class HealthPingController {
  constructor(private readonly health: AdminHealthService) {}

  @Get('crons')
  async cronFreshness(
    @Query('key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const secret = process.env.HEALTH_PING_SECRET;
    // Fail closed until the operator sets a secret — never expose internals
    // unauthenticated. 503 (not 200) so a monitor wired before the secret is
    // set flags loudly rather than reporting a false "healthy".
    if (!secret || key !== secret) {
      res.status(503);
      return { ok: false, error: 'not configured' };
    }
    const crons = await this.health.cronStatuses();
    const stale = crons
      .filter((c) => c.status === 'stale')
      .map((c) => c.name);
    if (stale.length > 0) {
      res.status(503);
      return { ok: false, stale };
    }
    return { ok: true };
  }
}

// ---------------------------------------------------------------
// Trust & Safety queue — recent contact-detail filter rejections,
// repeat offenders (≥3 hits/7d), reported Q&A.
// ---------------------------------------------------------------
@Controller('admin/trust-safety')
@UseGuards(AdminJwtGuard)
export class AdminTrustSafetyController {
  constructor(private readonly ts: AdminTrustSafetyService) {}

  @Get('rejections')
  rejections(@Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : 100;
    return this.ts.recentRejections(
      Number.isFinite(parsed) && parsed > 0 ? parsed : 100,
    );
  }

  @Get('repeat-offenders')
  repeatOffenders() {
    return this.ts.repeatOffenders();
  }

  @Get('reported-questions')
  reportedQuestions() {
    return this.ts.reportedQuestions();
  }

  @Get('reported-listings')
  reportedListings() {
    return this.ts.reportedListings();
  }

  @Get('reported-sellers')
  reportedSellers() {
    return this.ts.reportedSellers();
  }
}

// ---------------------------------------------------------------
// External-service credit balances. Five endpoints:
//   GET /admin/credits/snapshot            — live fetch all services
//   GET /admin/credits/history?service=&days= — per-service trend data
//   GET /admin/credits/thresholds          — list current thresholds
//   PUT /admin/credits/thresholds/:service — upsert threshold for one
//   POST /admin/credits/:service/test       — fire a non-billing probe
//
// Cron-written snapshots accumulate in CreditSnapshot every 15 min;
// the page reads them for the chart and uses snapshot for the grid.
// All routes guarded by AdminJwtGuard (matches the rest of admin).
// ---------------------------------------------------------------
@Controller('admin/credits')
@UseGuards(AdminJwtGuard)
export class AdminCreditsController {
  constructor(private readonly credits: AdminCreditsService) {}

  // Live fetch — bypasses CreditSnapshot, hits every API right now.
  // Used by the "Refresh" button on the credits page. Always returns
  // an array (one entry per service) even when some fetches fail.
  @Get('snapshot')
  snapshot() {
    return this.credits.fetchAll();
  }

  // Time-series for one service. `days` defaults to 30, capped at 365
  // and floored at 1 inside the service.
  @Get('history')
  history(@Query('service') service?: string, @Query('days') days?: string) {
    if (!service) {
      throw new BadRequestException('service query param is required');
    }
    const parsedDays = days ? parseInt(days, 10) : 30;
    return this.credits.history(
      service,
      Number.isFinite(parsedDays) ? parsedDays : 30,
    );
  }

  @Get('thresholds')
  thresholds() {
    return this.credits.listThresholds();
  }

  // Upsert thresholds for one service. Body validates loosely — the
  // service layer normalises nulls and defaults `enabled` to true.
  @Put('thresholds/:service')
  async updateThreshold(
    @Param('service') service: string,
    @Body()
    body: {
      warnThreshold?: number | null;
      alarmThreshold?: number | null;
      enabled?: boolean;
    },
  ) {
    return this.credits.upsertThreshold(service, body);
  }

  // Test endpoint — fires a non-billing probe per service. Returns
  // { ok, detail } so the UI can show a single-line result.
  // READ: every branch is a balance fetch or a bare connectivity ping —
  // none of them write a row or change any state of ours. (The anthropic
  // branch's 1-token probe is real-billed at sub-cent; it changes no data
  // and no authorization state, so it stays on the read side of the line.)
  @Post(':service/test')
  @ReadShapedRoute()
  @HttpCode(200)
  test(@Param('service') service: string) {
    return this.credits.testService(service);
  }
}
