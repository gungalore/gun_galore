import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MotivationPrintService } from './motivation-print.service';

/**
 * The one-click Bob Go booking link from the print desk email.
 *
 * ⚠️ UNAUTHENTICATED BY DESIGN — the token IS the credential. It is 32 random
 * bytes, belongs to one print order, exposes only the delivery facts already in
 * the email, and cannot book anything that is not PAID with its PDF delivered.
 * `bookByToken` is idempotent, so a refresh or a second click returns the
 * existing waybill rather than booking a second shipment.
 *
 * The frontend page calls the POST automatically when it opens; the GET exists
 * so the page can show what it is about to book, and so a failed booking can be
 * retried without requesting a new link.
 */
@Controller('motivations/print')
export class MotivationPrintPublicController {
  constructor(private readonly print: MotivationPrintService) {}

  @Get('book/:token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  summary(@Param('token') token: string) {
    return this.print.bookingSummary(token);
  }

  @Post('book/:token')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  book(@Param('token') token: string) {
    return this.print.bookByToken(token);
  }
}
