import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { DeskService } from './desk.service';
import { DeskPayoutsService } from './desk-payouts.service';
import { DeskSiteService } from './desk-site.service';
import { WardenService } from './warden.service';
import type { DeskFeed } from './desk.types';

/**
 * THE DESK — three routes, and that is the whole surface.
 *
 * One GET that returns the operator's entire worklist already prioritised,
 * and two POSTs for the things that can be done from a card face. Everything
 * heavier — a refund, a release, a payout, a dealer approval — keeps its own
 * existing endpoint, because those carry confirms and audit rows that a
 * generic dispatcher has no business reproducing.
 */
@Controller('admin/desk')
@UseGuards(AdminJwtGuard)
export class DeskController {
  constructor(
    private readonly desk: DeskService,
    private readonly payouts: DeskPayoutsService,
    private readonly site: DeskSiteService,
    /**
     * ⚠️ COMPOSED HERE, NOT INJECTED INTO DeskSiteService. WardenService
     * already depends on that service, so reaching the other way would close
     * a cycle. The controller is the composition point, which also keeps
     * `vitals()` a pure function of its argument.
     */
    private readonly warden: WardenService,
  ) {}

  /**
   * The payout run, sale by sale: what would go out, what you held back,
   * and what the gates are blocking. Read-only — nothing here moves money.
   */
  @Get('payouts/run')
  payoutRun() {
    return this.payouts.run();
  }

  /**
   * The Site board: config gates, outbound channels and what this process
   * can see of its own health. Read-only, and it never emits a secret value —
   * only a mode or a boolean. See DeskSiteService.
   */
  @Get('site/board')
  async siteBoard() {
    // A read that never throws — null covers no daemon, no answer and a bad
    // answer alike, and every tile renders the same "not measured" for all
    // three, with the reason it was given.
    return this.site.board(await this.warden.checkBoard());
  }

  /** The pile, the ribbon, the rail and the feed, in one request. */
  @Get()
  feed(): Promise<DeskFeed> {
    return this.desk.feed();
  }

  /**
   * Fire an undoable action.
   *
   * ⚠️ THE CLIENT HAS ALREADY WAITED TEN SECONDS BEFORE CALLING THIS. The
   * undo window is a client-side delay — nothing is sent until it closes — so
   * by the time a request arrives here the operator has decided. There is no
   * pending state to reconcile server-side and no "undo" route to match it.
   */
  @Post(':id/act')
  act(@Param('id') id: string, @Body() body: { action?: string }): Promise<{ ok: true }> {
    return this.desk.act(id, body?.action ?? '');
  }

  /** Sink a card for four hours. Not money, so it commits immediately. */
  @Post(':id/later')
  later(@Param('id') id: string): { laterUntil: string } {
    return this.desk.later(id);
  }
}
