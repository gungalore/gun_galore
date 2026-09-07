import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { LicenceCentreService } from './licence-centre.service';
import { VaultLogService } from '../common/vault-log.service';

// Counts, health and the decision ledger ONLY. An admin never sees a member's
// document or a decrypted detail off one — the vault is the member's, and an
// admin surface that can read it is a surface that will be asked to. The
// ledger is built to the same rule: names of things, never their values.

@Controller('admin/licence-centre')
@UseGuards(AdminJwtGuard)
export class LicenceCentreAdminController {
  constructor(
    private readonly svc: LicenceCentreService,
    private readonly ledger: VaultLogService,
  ) {}

  @Get()
  health() {
    return this.svc.adminHealth();
  }

  /**
   * What went wrong most, and how often, over the last N days: every
   * stage/outcome/code with a count and how many members it touched.
   * Operator, 2026-09-07: "build the module smarter over time with
   * intelligence we gathered from real users."
   */
  @Get('ledger/summary')
  ledgerSummary(@Query('days') days?: string) {
    return this.ledger.summary(days ? Number(days) : 30);
  }

  /** The most recent ledger rows, filtered. */
  @Get('ledger')
  ledgerRecent(
    @Query('days') days?: string,
    @Query('stage') stage?: string,
    @Query('code') code?: string,
    @Query('outcome') outcome?: string,
    @Query('credentialId') credentialId?: string,
    @Query('userId') userId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ledger.recent({
      days: days ? Number(days) : undefined,
      stage: stage || undefined,
      code: code || undefined,
      outcome: outcome || undefined,
      credentialId: credentialId || undefined,
      userId: userId || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
