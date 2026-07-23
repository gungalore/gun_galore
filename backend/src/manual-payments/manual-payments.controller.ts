import { Controller, Get, Post, HttpCode, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { ManualPaymentsService } from './manual-payments.service';

// Read-only admin money-state views that survived the manual-EFT rail removal:
// the payouts-due preview, the held-funds (Client-Funds-Payable) position, and
// the Zoho Books failed-sync radar. The manual-EFT pay-in (statement upload /
// inContact scan / unmatched queue) and the FNB payout-batch endpoints have
// been removed. The route base is kept so existing admin links resolve.
@Controller('admin/manual-payments')
@UseGuards(AdminJwtGuard)
export class ManualPaymentsController {
  constructor(private readonly manual: ManualPaymentsService) {}

  // Preview: everything due to sellers now + rows a run would skip.
  @Get('payouts-due')
  payoutsDue() {
    return this.manual.getPayoutsDuePreview();
  }

  // Operator-triggered seller payout run — disburses due payouts to seller
  // banks via Peach Payouts (exactly-once via paidOutAt; the payout webhook
  // reconciles). Gated on PAYMENTS_LIVE inside the service. Real money —
  // operator action, not an automatic cron.
  @Post('run-payouts')
  @HttpCode(200)
  runPayouts() {
    return this.manual.runDuePayouts();
  }

  // P1.3 — every entity whose latest Zoho Books sync FAILED, in one list.
  @Get('zoho-failed')
  zohoFailed() {
    return this.manual.getZohoFailedSyncs();
  }

  // P1.4 — held-funds position: how much of the bank balance is client money
  // (held orders + owed payouts + owed refunds + held swap cash).
  @Get('held-funds')
  heldFunds() {
    return this.manual.getHeldFundsReport();
  }
}
