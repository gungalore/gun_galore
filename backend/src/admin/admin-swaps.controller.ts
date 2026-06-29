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
import { SwapProofService } from '../swaps/swap-proof.service';

// Admin-owned swap resolution (S5). Disputed / stalled swaps land here; the
// admin can force-complete (release the held cash to the recipient) or unwind
// (refund the cash to the payer). Both routes are idempotent — they key on the
// same cashReleasedAt money-moved guard inside the service, so a double-click
// can never pay twice.
@Controller('admin/swaps')
@UseGuards(AdminJwtGuard)
export class AdminSwapsController {
  constructor(
    private readonly swaps: SwapFundingService,
    private readonly proof: SwapProofService,
  ) {}

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

  // Override a swap leg's proof-of-possession verdict (approve a borderline
  // photo or reject a bad one). legId = the leg's Transaction id.
  @Post('legs/:legId/proof-override')
  @HttpCode(200)
  proofOverride(
    @Param('legId') legId: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() body: { decision?: string; reason?: string },
  ) {
    const decision = body?.decision === 'APPROVE' ? 'APPROVE' : 'REJECT';
    return this.proof.adminOverride(legId, decision, body?.reason ?? '');
  }
}
