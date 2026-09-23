import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { WardenService } from './warden.service';
import { ApproveProposalDto, DeclineProposalDto, PauseWardenDto, SendWardenChatDto } from './warden.dto';

/**
 * WARDEN — what the Warden panel asks for, and nothing else.
 *
 * Eight routes: the thread, a reply, the two decisions on a proposal, the
 * daemon's measured board, and the three Phase 4 added — the audit trail, an
 * on-demand sweep, and a real pause/resume. Approve and decline get their own
 * endpoints rather than going through a generic act dispatcher, for the same
 * reason a refund and a payout do: a fix that runs a command on the production
 * box is not generic and not undoable.
 *
 * ⚠️ THERE IS NO SETTINGS OR CONFIG-GATE ROUTE HERE, DELIBERATELY. The Desk's
 * settings panel and its DeskSiteService-backed config gates were removed with
 * the Desk: a decided rule must not sit behind an off switch in an operator
 * screen, and two readers of PAYMENTS_LIVE is two answers waiting to disagree.
 * The panel's own service probes carry what an operator actually needs.
 *
 * 🚨 THE HTTP METHOD IS THE AUTHORISATION, AND THAT IS STRUCTURAL, NOT A
 * CONVENTION. AdminJwtGuard opens GET/HEAD/OPTIONS to any active admin and
 * restricts EVERY other method to SUPERADMIN. So `GET audit` is readable by a
 * read-only monitoring admin — which is the whole point of an audit trail —
 * while `POST sweep`, `POST pause` and `POST resume` are full-admin only,
 * because each of them changes what the daemon does on a production box.
 * Adding a route here inherits that by the act of authenticating; do not
 * reach for a second guard to re-state it.
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
   * The daemon's measured board, WITH whether it answered at all.
   *
   * Truth, not controls — nothing here is settable. A row that reads `unknown`
   * beside a reason means the daemon could not look, never that the thing is
   * fine. `present: false` is not an empty board; it is "this is not a reading
   * of the box", and the absence is named.
   */
  @Get('board')
  board() {
    return this.warden.board();
  }

  /**
   * EVERY COMMAND WARDEN HAS RUN, newest first. `?proposalId=` narrows to one.
   *
   * 🚨 THIS IS THE ONLY WAY TO READ A RUN AFTER THE FACT. The daemon has
   * written an audit record for every execution since it shipped — operation,
   * resolved arguments, exit code, redacted verbatim transcript — and until
   * this route nothing served them. The operator's single view of a run was
   * its `ran` chat message, which ages out of a 600-record on-disk window and
   * a 200-message wire window; past that, "what has this agent done to the
   * production box" was answerable only by SSH-ing in and reading JSON.
   *
   * A GET, so a read-only MONITORING_ADMIN can see it. That is deliberate:
   * the people most likely to need this are the ones who cannot write.
   */
  @Get('audit')
  audit(@Query('proposalId') proposalId?: string) {
    return this.warden.auditTrail({ proposalId: proposalId || undefined });
  }

  /**
   * Measure the box NOW, cadence ignored.
   *
   * ⚠️ POST, SO SUPERADMIN-ONLY, AND A 200 WITH `finished: false` IS A
   * SUCCESS. A full forced sweep runs every check, expensive ones budgeted
   * sixty seconds EACH; the daemon answers early rather than letting this
   * request outlive nginx's 60s cut, which would hand the operator a 502
   * while the box was being measured behind it. The board lands by itself.
   */
  @Post('sweep')
  sweep(@CurrentAdmin() admin: { sub: string }) {
    return this.warden.sweep(admin.sub);
  }

  /**
   * Hold off on diagnosis and proposals for a while.
   *
   * ⚠️ MEASUREMENT DOES NOT STOP, AND THE COPY MUST NOT SAY IT DOES. The
   * daemon keeps sweeping and keeps announcing what turns; the model call and
   * any new proposal are what pause. A UI that renders this as "Warden
   * stopped" would let an operator read a still-updating board as a frozen
   * one, or worse, a frozen one as live.
   */
  @Post('pause')
  pause(@CurrentAdmin() admin: { sub: string }, @Body() dto: PauseWardenDto) {
    return this.warden.pause(admin.sub, dto);
  }

  /** Back to work now. Resuming a Warden that is not paused is not an error. */
  @Post('resume')
  resume(@CurrentAdmin() admin: { sub: string }) {
    return this.warden.resume(admin.sub);
  }
}
