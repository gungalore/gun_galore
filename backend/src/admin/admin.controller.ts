import {
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
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { DealerVerificationService } from '../payments/dealer-verification.service';
import { ZohoBooksService } from '../zoho/zoho-books.service';
import { Throttle } from '@nestjs/throttler';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { ListingsService } from '../listings/listings.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { ListingReviewDto } from './dto/listing-review.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminRoleDto } from './dto/update-admin-role.dto';
import { KycService } from '../kyc/kyc.service';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminAnalyticsService,
  AnalyticsPeriod,
  AnalyticsBucket,
} from './admin-analytics.service';
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
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  // Hard-cap brute force at 10 attempts/min/IP. A real attacker would
  // distribute across IPs but this stops the casual one + keeps the
  // backend's bcrypt work bounded.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    // Set the JWT as an HTTP-only Secure cookie so the browser handles
    // it server-side (more reliable than document.cookie which was
    // failing to persist across navigations for some users). passthrough
    // keeps Nest's normal JSON response — we just piggyback Set-Cookie.
    res.cookie('gg_admin_sess', result.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours, matches JWT expiry
    });
    return result;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    // Clear the cookie so the browser stops sending it. Matching attrs
    // are required for some browsers to recognise the clear.
    res.clearCookie('gg_admin_sess', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  me(@CurrentAdmin() admin: { sub: string; email: string; role: string }) {
    return this.authService.me(admin);
  }
}

// ---------------------------------------------------------------
// Stats
// ---------------------------------------------------------------
@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminStatsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @UseGuards(SuperadminGuard)
  stats() {
    return this.adminService.stats();
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

  // One-time / maintenance reindex of every ACTIVE listing into
  // Meilisearch. Needed after the parentId/parentSlug rollup fields
  // were added to the search doc — existing docs predate them, so
  // parent-category browse misses them until re-indexed. Returns the
  // count re-indexed.
  @Post('reindex')
  @HttpCode(200)
  reindexAll() {
    return this.listingsService.reindexAllActiveListings();
  }

  @Get()
  getListings(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getListings(
      status,
      Number(page) || 1,
      Number(limit) || 20,
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

  @Patch(':id')
  updateUser(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, admin.sub, dto);
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
  ) {
    return this.adminService.getTransactions(
      status,
      Number(page) || 1,
      Number(limit) || 20,
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

  // Dossier — parties, listing, payment + shipping timeline, messages,
  // raw Peach result codes, dealer (if firearm), rating. One round-trip
  // so the admin can resolve a dispute from one screen.
  @Get(':id/dossier')
  getTransactionDossier(@Param('id') id: string) {
    return this.adminService.getTransactionDossier(id);
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@Param('id') id: string, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.releaseTransaction(id, admin.sub);
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

  @Post()
  @UseGuards(SuperadminGuard)
  @HttpCode(201)
  create(@Body() dto: CreateAdminDto, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.createAdmin(dto.email, dto.role, admin.sub);
  }

  @Patch(':id/role')
  @UseGuards(SuperadminGuard)
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentAdmin() admin: { sub: string },
  ) {
    return this.adminService.updateAdminRole(id, dto.role, admin.sub);
  }

  @Post(':id/deactivate')
  @UseGuards(SuperadminGuard)
  @HttpCode(200)
  deactivate(@Param('id') id: string, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.deactivateAdmin(id, admin.sub);
  }
}

// ---------------------------------------------------------------
// KYC — VerifyNow credit balance
// ---------------------------------------------------------------
// VerifyNow doesn't expose a "buy credits" API, so this controller
// is read-only: cached balance + a forced refresh that hits /my_credits
// live. The admin UI shows the number and links out to verifynow.co.za
// for top-ups.
@Controller('admin/kyc')
@UseGuards(AdminJwtGuard)
export class AdminKycController {
  constructor(private readonly kyc: KycService) {}

  // Returns whatever's in the Settings cache (populated every 5 min by
  // TasksService.refreshVerifyNowBalance). Null if we've never fetched.
  @Get('balance')
  async getBalance() {
    const cached = await this.kyc.getCachedCreditBalance();
    return { balance: cached };
  }

  // Hit VerifyNow live, write to cache, return new value. Used by the
  // admin panel's "Refresh now" button.
  @Post('balance/refresh')
  @HttpCode(200)
  async refreshBalance() {
    const fresh = await this.kyc.refreshCreditBalance();
    return { balance: fresh };
  }
}

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
  constructor(private readonly analytics: AdminAnalyticsService) {}

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
  @Post('preview')
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
  @Post(':service/test')
  @HttpCode(200)
  test(@Param('service') service: string) {
    return this.credits.testService(service);
  }
}
