import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupportService } from './support.service';

// User-facing support tickets (Phase 7 P7.2). the identity provider-guarded; every method
// scopes to the signed-in user inside the service.
@Controller('support')
@UseGuards(AuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentUser() userId: string,
    @Body()
    body: { subject?: string; body?: string; category?: string; transactionId?: string },
  ) {
    return this.support.createTicket(userId, body);
  }

  @Get()
  listMine(@CurrentUser() userId: string) {
    return this.support.listMine(userId);
  }

  @Get(':id')
  getMine(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.support.getMine(userId, id);
  }

  @Post(':id/reply')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  reply(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { body?: string },
  ) {
    return this.support.replyAsUser(userId, id, body?.body ?? '');
  }

  @Post(':id/close')
  close(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.support.closeMine(userId, id);
  }
}
