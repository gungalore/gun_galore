import { Controller, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { DiditService } from '../didit/didit.service';
import { DiditWebhookEvent } from '../didit/didit.types';
import { KycService } from './kyc.service';

/**
 * Didit pushes every verification outcome here.
 *
 * ⚠️ PUBLIC ROUTE, NO GUARD — the HMAC signature IS the authentication, and a
 * JWT guard in front of it would reject every delivery. That is the same
 * shape the Peach webhooks use.
 *
 * ⚠️ CLOUDFLARE HAS TO BE TOLD ABOUT THIS. Didit delivers from the single
 * static IP 18.203.201.92 with `User-Agent: DiditWebhook/2.0`. The origin sits
 * behind Cloudflare with a WAF in front, so that IP must be allowed for
 * alloutdoor.co.za or every delivery is dropped at the edge and nothing in any
 * application log will say so.
 */
@Controller('webhooks')
export class DiditWebhookController {
  private readonly logger = new Logger(DiditWebhookController.name);

  constructor(
    private readonly didit: DiditService,
    private readonly kyc: KycService,
  ) {}

  @SkipThrottle()
  @Post('didit')
  @HttpCode(200)
  async handle(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody;
    if (!raw) {
      // rawBody: true is set in main.ts. If it is ever turned off this is the
      // only symptom, so say it plainly rather than failing the signature.
      this.logger.error(
        'Didit webhook: no rawBody on the request — signature cannot be checked',
      );
      return { received: true };
    }

    // ⚠️ A BAD SIGNATURE RETURNS 200 WITH THE HANDLER SKIPPED, NOT A 401 —
    // the house convention the Peach webhooks already follow. A 401 tells a
    // prober their guess was wrong; a 200 tells them nothing. It also means
    // anyone grepping logs for 401s to diagnose a signature mismatch will
    // find nothing, which is why this logs loudly instead.
    if (!this.didit.verifyWebhook(raw, req.headers)) {
      this.logger.error(
        'Didit webhook REJECTED: signature or timestamp did not verify',
      );
      return { received: true };
    }

    let event: DiditWebhookEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as DiditWebhookEvent;
    } catch {
      this.logger.error('Didit webhook: body was not JSON');
      return { received: true };
    }

    // Only session status changes carry a verdict. The entity and transaction
    // families are not subscribed, but a destination misconfigured in the
    // console could still send them here.
    if (event.webhook_type !== 'status.updated') {
      return { received: true };
    }

    try {
      // Prefer the decision on the envelope; fall back to fetching it. The
      // envelope omits `decision` for in-flight statuses, which is exactly
      // when there is nothing to apply anyway.
      const decision =
        event.decision ??
        (await this.didit.getDecision(event.session_id).catch(() => null));
      if (!decision) return { received: true };

      const result = await this.kyc.applyDecision(event.session_id, {
        ...decision,
        // Trust the envelope's status over the body's: it is the thing that
        // was signed alongside the timestamp.
        status: event.status,
        session_id: event.session_id,
      });
      this.logger.log(
        `Didit ${event.status} for session ${event.session_id} → ${
          result.applied ? result.status : 'no-op'
        }`,
      );
    } catch (err) {
      // ⚠️ NEVER RETHROW. A 5xx makes Didit retry twice and then DROP the
      // delivery for good; swallowing here means the status poll is still
      // able to reconcile later.
      this.logger.error(
        `Didit webhook handler failed for ${event.session_id}: ${(err as Error).message}`,
      );
    }

    return { received: true };
  }
}
