import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MessagesService } from './messages.service';

/**
 * Buyer ↔ seller messaging on a transaction. Buyer/seller only (checked in the
 * service). Every send is Jev-moderated (contact details auto-stripped, abuse
 * blocked) — see MessagesService.
 */
@Controller('transactions/:transactionId/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @Param('transactionId') transactionId: string,
    @CurrentUser() userId: string,
  ) {
    return this.messages.list(transactionId, userId);
  }

  @Post()
  send(
    @Param('transactionId') transactionId: string,
    @CurrentUser() userId: string,
    @Body() body: { content?: string },
  ) {
    return this.messages.send(transactionId, userId, body?.content ?? '');
  }
}
