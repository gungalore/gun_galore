import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  HttpCode,
  UseGuards,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(private readonly txService: TransactionsService) {}

  // ---------------------------------------------------------------
  // Create transaction + Peach checkout (buyer)
  // ---------------------------------------------------------------
  @Post()
  @UseGuards(ClerkGuard)
  async create(
    @CurrentUser() clerkId: string,
    @Body() dto: CreateTransactionDto,
    @Req() req: Request,
  ) {
    const frontendUrl =
      process.env.FRONTEND_URL ?? `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
    return this.txService.create(clerkId, dto, frontendUrl);
  }

  // ---------------------------------------------------------------
  // Verify Peach result (called from result page)
  // ---------------------------------------------------------------
  @Post(':id/verify-result')
  verifyResult(
    @Param('id') id: string,
    @Body('resourcePath') resourcePath: string,
  ) {
    return this.txService.verifyResult(id, resourcePath);
  }

  // ---------------------------------------------------------------
  // Fetch all transactions (buyer or seller view)
  // ---------------------------------------------------------------
  @Get()
  @UseGuards(ClerkGuard)
  findAll(
    @CurrentUser() clerkId: string,
    @Query('role') role: 'buyer' | 'seller' = 'buyer',
  ) {
    return this.txService.findForUser(clerkId, role);
  }

  // ---------------------------------------------------------------
  // Single transaction detail
  // ---------------------------------------------------------------
  @Get(':id')
  @UseGuards(ClerkGuard)
  findOne(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.txService.findById(id, clerkId);
  }

  // ---------------------------------------------------------------
  // Buyer confirms delivery → releases payment
  // ---------------------------------------------------------------
  @Post(':id/confirm-delivery')
  @UseGuards(ClerkGuard)
  confirmDelivery(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.txService.confirmDelivery(id, clerkId);
  }

  // ---------------------------------------------------------------
  // Seller confirms dispatch
  // ---------------------------------------------------------------
  @Post(':id/dispatch')
  @UseGuards(ClerkGuard)
  confirmDispatch(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() body: { pudoDropoffLockerId?: string; trackingReference?: string },
  ) {
    return this.txService.confirmDispatch(id, clerkId, body);
  }
}

// ---------------------------------------------------------------
// Peach webhook — separate controller so path is /api/payments/...
// ---------------------------------------------------------------
@Controller('payments')
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly txService: TransactionsService) {}

  @Post('webhook/peach')
  @HttpCode(200)
  async peachWebhook(@Body() body: Record<string, unknown>) {
    // TODO: add Peach HMAC signature verification once secret is confirmed
    this.logger.log('Peach webhook received');
    await this.txService.handlePeachWebhook(body);
    return { received: true };
  }
}
