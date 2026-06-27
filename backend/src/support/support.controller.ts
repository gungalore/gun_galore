import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupportService } from './support.service';

// User-facing support tickets (Phase 7 P7.2). Clerk-guarded; every method
// scopes to the signed-in user inside the service.
@Controller('support')
@UseGuards(ClerkGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentUser() clerkId: string,
    @Body()
    body: { subject?: string; body?: string; category?: string; transactionId?: string },
  ) {
    return this.support.createTicket(clerkId, body);
  }

  @Get()
  listMine(@CurrentUser() clerkId: string) {
    return this.support.listMine(clerkId);
  }

  @Get(':id')
  getMine(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.support.getMine(clerkId, id);
  }

  @Post(':id/reply')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reply(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { body?: string },
  ) {
    return this.support.replyAsUser(clerkId, id, body?.body ?? '');
  }

  @Post(':id/close')
  close(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.support.closeMine(clerkId, id);
  }
}
