import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('transactions/:transactionId/messages')
@UseGuards(ClerkGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  send(
    @Param('transactionId') transactionId: string,
    @CurrentUser() clerkId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.send(transactionId, clerkId, dto);
  }

  @Get()
  findThread(
    @Param('transactionId') transactionId: string,
    @CurrentUser() clerkId: string,
  ) {
    return this.messagesService.findThread(transactionId, clerkId);
  }
}

@Controller('messages')
@UseGuards(ClerkGuard)
export class MessagesMetaController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('unread-count')
  unreadCount(@CurrentUser() clerkId: string) {
    return this.messagesService.unreadCount(clerkId).then((count) => ({ count }));
  }
}
