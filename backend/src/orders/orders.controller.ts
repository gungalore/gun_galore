import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from '../payments/dto/create-order.dto';

// Phase 8b — single-seller multi-item cart. Signed-in only (plain AuthGuard;
// no SMS-token path needed for cart checkout). AuthModule is @Global, so
// OrdersModule does not import it.
@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('checkout')
  checkout(
    @CurrentUser() userId: string,
    @Body() dto: CreateOrderDto,
    @Req() req: Request,
  ) {
    const frontendUrl =
      process.env.FRONTEND_URL ??
      `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
    return this.orders.checkout(userId, dto, frontendUrl);
  }

  @Get()
  myOrders(@CurrentUser() userId: string) {
    return this.orders.myOrders(userId);
  }

  @Get(':id')
  getOrder(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.orders.getOrder(id, userId);
  }
}
