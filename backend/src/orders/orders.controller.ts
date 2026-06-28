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
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from '../payments/dto/create-order.dto';

// Phase 8b — single-seller multi-item cart. Signed-in only (plain ClerkGuard;
// no SMS-token path needed for cart checkout). AuthModule is @Global, so
// OrdersModule does not import it.
@Controller('orders')
@UseGuards(ClerkGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('checkout')
  checkout(
    @CurrentUser() clerkId: string,
    @Body() dto: CreateOrderDto,
    @Req() req: Request,
  ) {
    const frontendUrl =
      process.env.FRONTEND_URL ??
      `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
    return this.orders.checkout(clerkId, dto, frontendUrl);
  }

  @Get()
  myOrders(@CurrentUser() clerkId: string) {
    return this.orders.myOrders(clerkId);
  }

  @Get(':id')
  getOrder(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.orders.getOrder(id, clerkId);
  }
}
