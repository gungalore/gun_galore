import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [WebhooksController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
