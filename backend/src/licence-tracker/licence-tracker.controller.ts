import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  AddEventInput,
  CreateTrackerInput,
  LicenceTrackerService,
} from './licence-tracker.service';

/**
 * ⚠️ ON EVERY METHOD — Nest's `@Header` reads a property descriptor and so
 * cannot be applied to a class. The answer is one member's own application
 * status, so it must never sit in a browser or shared cache: a `revalidate`
 * or a cached 200 here would show one person another's application.
 */
const NoStore = () => Header('Cache-Control', 'private, no-store');

/**
 * The SAPS application tracker — /api/licence-centre/tracking.
 *
 * Behind the login, like the rest of the Licence Centre. The frontend route
 * is authenticated by having no entry in `middleware.ts`'s allow-list, which
 * defaults to deny.
 *
 * ⚠️ EVERY ROUTE IS OWNER-SCOPED IN THE SERVICE, not here. `:id` is a
 * TrackedApplication id and every query filters on `userId`, so another
 * member's id answers 404 rather than 403 — the same "do not confirm it
 * exists" rule the public listing paths follow.
 */
@Controller('licence-centre/tracking')
@UseGuards(AuthGuard)
export class LicenceTrackerController {
  constructor(private readonly tracker: LicenceTrackerService) {}

  /**
   * Whether the feature is on, so the screen can render a dark state instead
   * of guessing from a 404. ⚠️ NOT gated itself — see the service.
   */
  @Get('status')
  @NoStore()
  async status(): Promise<{ enabled: boolean }> {
    return this.tracker.status();
  }

  @Get()
  @NoStore()
  async list(@CurrentUser() userId: string) {
    return { trackers: await this.tracker.list(userId) };
  }

  /**
   * ⚠️ THE REFERENCE IS THE ONE REQUIRED FIELD and the service refuses a
   * blank one with 400. A tracker with no reference cannot be asked about,
   * and storing one would put a permanently-unknown row on the screen.
   */
  @Post()
  @NoStore()
  async create(@CurrentUser() userId: string, @Body() body: CreateTrackerInput) {
    return this.tracker.create(userId, body ?? {});
  }

  /** Deactivate, never delete — the member's own history survives. */
  @Delete(':id')
  @NoStore()
  async remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.tracker.remove(userId, id);
  }

  /**
   * Ask SAPS now.
   *
   * ⚠️ THROTTLED AS WELL AS COOLDOWN-GATED. The cooldown is per tracker and
   * is about SAPS; this is per member and is about not letting one account
   * spin the endpoint. Ten a minute is far more than the cooldown will ever
   * admit, so anything this refuses was already going to be refused — it
   * exists so the refusal is cheap.
   */
  @Post(':id/check')
  @NoStore()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async check(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.tracker.check(userId, id);
  }

  @Get(':id')
  @NoStore()
  async get(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.tracker.get(userId, id);
  }

  /** A milestone the member recorded themselves. Always source MEMBER. */
  @Post(':id/events')
  @NoStore()
  async addEvent(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: AddEventInput,
  ) {
    return this.tracker.addEvent(userId, id, body ?? {});
  }
}
