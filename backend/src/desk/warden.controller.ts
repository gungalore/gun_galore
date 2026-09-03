import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { WardenService } from './warden.service';
import { ApproveProposalDto, DeclineProposalDto, SendWardenChatDto } from './warden.dto';

/**
 * WARDEN — what the Site surface asks for, and nothing else.
 *
 * Six routes: the thread, a reply, the two decisions on a proposal, the
 * config gates and the four settings. Approve and decline get their own
 * endpoints rather than going through POST admin/desk/:id/act, for the same
 * reason a refund and a payout do: act() is the generic undoable dispatcher,
 * and a fix that runs a command on the production box is neither generic nor
 * undoable.
 *
 * ⚠️ THERE IS NO SETTINGS WRITE HERE. PATCH /admin/settings owns that, with
 * its type validation, its go-live reason minimum and its audit row.
 */
@Controller('admin/warden')
@UseGuards(AdminJwtGuard)
export class WardenController {
  constructor(private readonly warden: WardenService) {}

  /**
   * The thread, the open proposals and when Warden last swept.
   *
   * Never fails for an absent or unreachable daemon — it answers
   * `present: false` with the reason, because the Site page renders the whole
   * board around this card.
   */
  @Get('chat')
  chat() {
    return this.warden.chat();
  }

  /** React, refuse, ask or instruct. 503 when no Warden is configured. */
  @Post('chat')
  send(@CurrentAdmin() admin: { sub: string }, @Body() dto: SendWardenChatDto) {
    return this.warden.send(admin.sub, dto);
  }

  /**
   * ⚠️ MONEY-GRADE. The body must echo back the exact command the confirm
   * dialog restated; WardenService re-reads the proposal and refuses on any
   * difference. Writes an audit row naming what ran.
   */
  @Post('proposals/:id/approve')
  approve(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: ApproveProposalDto,
  ) {
    return this.warden.approve(admin.sub, id, dto);
  }

  /** Refuse a fix. Warden reads the reason back as standing guidance. */
  @Post('proposals/:id/decline')
  decline(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: DeclineProposalDto,
  ) {
    return this.warden.decline(admin.sub, id, dto);
  }

  /**
   * The config gates, with which of them are red.
   *
   * Truth, not controls — nothing here is settable. The values are
   * DeskSiteService's, so this endpoint and the Site board can never disagree
   * about what PAYMENTS_LIVE is.
   */
  @Get('gates')
  gates() {
    return this.warden.gates();
  }

  /** The only four, shaped for the panel. Read-only; see the class note. */
  @Get('settings')
  settings() {
    return this.warden.settings();
  }
}
