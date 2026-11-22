import {
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { YocoService } from '../payments/yoco.service';
import {
  MotivationPaymentsService,
  type YocoWebhookEvent,
} from './motivation-payments.service';

/**
 * Yoco Checkout API webhook — the motivation paygate's fast path.
 *
 * ⚠️ UNGUARDED BY DESIGN. Yoco has no account here; authenticity comes from
 * the `webhook-signature` HMAC over `id.timestamp.rawBody`, checked before the
 * body is read. The raw bytes are required: re-serialising the parsed JSON
 * changes them and every signature would fail.
 *
 * The event is only a HINT that something moved. The handler re-reads the
 * checkout from Yoco and binds the amount and reference before any row is
 * marked paid (see MotivationPaymentsService.handleYocoEvent).
 *
 * A rejected signature returns 200, not 4xx: a forged delivery must not be
 * retried, and a missing signing secret (before webhooks are configured) must
 * not make Yoco hammer us. The reconcile cron still settles every attempt.
 */
@Controller('payments')
export class MotivationPaymentsWebhookController {
  private readonly logger = new Logger(MotivationPaymentsWebhookController.name);

  constructor(
    private readonly payments: MotivationPaymentsService,
    private readonly yoco: YocoService,
  ) {}

  @Post('webhook/yoco')
  @HttpCode(200)
  async yocoWebhook(
    @Req() req: Request,
    @Body() body: YocoWebhookEvent,
  ) {
    this.logger.log('Yoco webhook received');
    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      JSON.stringify(body);
    const verdict = this.yoco.verifyWebhook({
      rawBody,
      headers: {
        id: req.headers['webhook-id'] as string | undefined,
        timestamp: req.headers['webhook-timestamp'] as string | undefined,
        signature: req.headers['webhook-signature'] as string | undefined,
      },
    });
    if (verdict === 'invalid') {
      this.logger.warn('Yoco webhook signature invalid — dropping');
      await this.payments.reportWebhookRejected('invalid signature');
      return { received: true };
    }
    if (verdict === 'unsigned') {
      // Expected until YOCO_WEBHOOK_SECRET is installed. The cron still
      // settles, so this is an observation, not a failure.
      this.logger.warn(
        'Yoco webhook has no signing secret configured — relying on the reconcile cron',
      );
      return { received: true };
    }
    try {
      await this.payments.handleYocoEvent(body);
    } catch (err) {
      this.logger.error(
        `Yoco webhook handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // 500 so Yoco retries — the reconcile cron is the backstop, not the plan.
      throw new InternalServerErrorException('Webhook processing failed');
    }
    return { received: true };
  }
}
