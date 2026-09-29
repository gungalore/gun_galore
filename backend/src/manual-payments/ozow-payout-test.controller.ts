import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import {
  OzowPayoutTestService,
  OzowTestPayoutInput,
} from './ozow-payout-test.service';

// Admin-only Ozow payout test-case harness. Drives the mandatory money-out
// test cases (staging + mock) and returns the raw Ozow result for the evidence
// form. Refused entirely in live mode inside the service. Writes need the
// SUPERADMIN role (AdminJwtGuard).
@Controller('admin/manual-payments/ozow-test')
@UseGuards(AdminJwtGuard)
export class OzowPayoutTestController {
  constructor(private readonly tests: OzowPayoutTestService) {}

  @Get('payouts')
  list() {
    return this.tests.listAttempts();
  }

  @Get('payouts/:id')
  get(@Param('id') id: string) {
    return this.tests.getAttempt(id);
  }

  @Post('payouts')
  @HttpCode(200)
  submit(@Body() body: OzowTestPayoutInput) {
    return this.tests.submitPayout(body);
  }

  @Get('configuration')
  configuration() {
    return this.tests.getTestConfiguration();
  }

  @Post('configuration')
  @HttpCode(200)
  setConfiguration(@Body() body: Record<string, unknown>) {
    return this.tests.setTestConfiguration(body);
  }

  @Get('payouts/:payoutId/mock')
  mock(@Param('payoutId') payoutId: string) {
    return this.tests.getMockPayout(payoutId);
  }
}
