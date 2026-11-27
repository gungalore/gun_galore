import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from '../payments/dto/create-order.dto';

// Phase 8b — multi-item cart. Signed-in only (plain AuthGuard; no SMS-token
// path needed for cart checkout). AuthModule is @Global, so OrdersModule does
// not import it.
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
    return this.orders.checkout(userId, dto, this.frontendUrl(req));
  }

  @Get()
  myOrders(@CurrentUser() userId: string) {
    return this.orders.myOrders(userId);
  }

  @Get(':id')
  getOrder(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.orders.getOrder(id, userId);
  }

  // Buyer resumes an interrupted order checkout: mints one fresh gateway
  // session for the SAME order/total. A paid order reports paid.
  @Post(':id/resume')
  @HttpCode(200)
  resume(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Req() req: Request,
  ) {
    return this.orders.resume(id, userId, this.frontendUrl(req));
  }

  // Buyer cancels an UNPAID order (the close button). Paid orders are refused;
  // their lifecycle is the normal refund/release path.
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.orders.cancel(id, userId);
  }

  // Buyer removes ONE line while the order is unpaid. The line is released
  // immediately, the remaining cart is re-priced and a NEW payment session is
  // returned. `cancelled: true` means that was the last line.
  @Delete(':id/lines/:transactionId')
  @HttpCode(200)
  removeLine(
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
    @CurrentUser() userId: string,
    @Req() req: Request,
  ) {
    return this.orders.removeLine(
      id,
      transactionId,
      userId,
      this.frontendUrl(req),
    );
  }

  private frontendUrl(req: Request): string {
    return (
      process.env.FRONTEND_URL ??
      `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`
    );
  }
}

/**
 * Public return-from-gateway for an ORDER payment.
 *
 * ⚠️ INTENTIONALLY UNAUTHENTICATED — same posture as the single-item
 * `/transactions/:id/verify-result`: the endpoint re-queries the provider using
 * the checkout id STORED ON THE ORDER, so an attacker who only controls the URL
 * cannot fabricate a paid state. Amount + merchant-reference binding happens in
 * markOrderPaid. Throttled hard to bound enumeration side-effects.
 */
@Controller('orders')
export class OrdersPublicController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':id/verify-result')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyResult(@Param('id') id: string) {
    return this.orders.verifyResult(id);
  }
}
