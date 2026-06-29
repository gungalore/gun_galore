import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { SwapFundingService } from '../swaps/swap-funding.service';

// Admin-owned swap resolution (S5). Disputed / stalled swaps land here; the
// admin can force-complete (release the held cash to the recipient) or unwind
// (refund the cash to the payer). Both routes are idempotent — they key on the
// same cashReleasedAt money-moved guard inside the service, so a double-click
// can never pay twice.
@Controller('admin/swaps')
@UseGuards(AdminJwtGuard)
export class AdminSwapsController {
  constructor(private readonly swaps: SwapFundingService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.swaps.adminListSwaps(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.swaps.adminGetSwap(id);
  }

  @Post(':id/force-complete')
  @HttpCode(200)
  forceComplete(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
  ) {
    return this.swaps.adminForceComplete(id);
  }

  @Post(':id/unwind')
  @HttpCode(200)
  unwind(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { reason?: string },
  ) {
    const reason = (body?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('A reason is required.');
    return this.swaps.adminUnwind(id, reason);
  }
}
