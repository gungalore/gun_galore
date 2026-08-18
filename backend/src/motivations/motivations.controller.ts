import { Controller, Get, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { MotivationQuotaService } from './motivation-quota.service';

/**
 * Firearm-licence motivation writer — the member-facing surface.
 *
 * BEHIND THE LOGIN, ENTIRELY (operator decision #4). There is nothing public
 * here and there must not be: the whole point of the auth wall is that
 * alloutdoor.co.za carries no firearm signal for signed-out visitors or
 * crawlers. Note this needs NO entry in the frontend's isPublicRoute — that
 * matcher is an allow-list and the default is deny, so a new route is
 * authenticated by doing nothing.
 *
 * Everything is gated in the SERVICE rather than here, so the cron and admin
 * paths get the same check. With the flag off these endpoints 404.
 */
@Controller('motivations')
@UseGuards(ClerkGuard)
export class MotivationsController {
  constructor(private readonly quota: MotivationQuotaService) {}

  /**
   * What the module costs and whether it is open — the ONLY way the frontend
   * learns the flag state. There is no generic public-config endpoint in this
   * codebase, so each module exposes its own.
   *
   * Deliberately does NOT 404 when the flag is off: the caller is a signed-in
   * member whose UI needs to know whether to render the entry point at all,
   * and `{ enabled: false }` answers that in one round trip. Every endpoint
   * that DOES something still 404s.
   */
  @Get('status')
  status() {
    return this.quota.status();
  }
}
